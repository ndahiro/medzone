/**
 * MedZone pair burst load test — users arrive as consultant+patient pairs.
 *
 *   npm run load:test [-- <pairs> <holdMs> <rampMs>]
 *   LOAD_BASE_URL=http://localhost:3001 npm run load:test -- 250
 *
 * Each pair runs the real paired consultation flow against the API:
 *   1. both parties bootstrap (heaviest read);
 *   2. a visit is booked for the pair;
 *   3. the patient checks in  (PATCH status -> in-progress, the waiting room);
 *   4. both parties poll the appointment list (clinician sees the check-in);
 *   5. patient + consultant exchange chat messages (POST + per-room GET,
 *      the same endpoints the 3s live-sync ticker hits);
 *   6. the consultant completes the visit (PATCH status -> completed).
 * The pair then holds briefly to simulate staying on the page.
 *
 * By default boots the real Express app on an ephemeral port against the
 * configured MySQL database. Set LOAD_BASE_URL to target a running server
 * instead (e.g. one started with WORKERS=4 for multi-process numbers).
 *
 * Arrival spread: pairs land over RAMP_MS (default 2000ms past 100 pairs) —
 * a real "everyone at once" burst lands over seconds, not one millisecond —
 * while hold time keeps sessions overlapping.
 *
 * Test rows are namespaced `load-pair-*` and deleted afterwards, so dev data
 * is untouched. Reports throughput, failure count, and p50/p95/max latency.
 * Exits non-zero when any request fails.
 */
import 'dotenv/config';
import app from '../server/app.js';
import { closePool, query, warmPool } from '../server/db.js';

const PAIRS = Math.max(1, Number(process.argv[2] || 250));
const HOLD_MS = Math.max(0, Number(process.argv[3] || 1500));
const RAMP_MS = Math.max(0, Number(process.argv[4] || (PAIRS > 100 ? 2000 : 0)));
// Bcrypt logins are CPU-bound on the event loop: 100 of them in one tick
// starve MySQL handshakes (ETIMEDOUT) on a single worker. Stagger pair starts
// so logins spread across the ramp instead of landing in the same millisecond.
const STAGGER_MS = Math.max(0, Number(process.env.LOAD_STAGGER_MS || 50));
const EXTERNAL_BASE = (process.env.LOAD_BASE_URL || '').replace(/\/+$/, '');
const TAG = `load-pair-${Date.now()}`;
// Tele-visit rooms are security-scoped references: booking only accepts a
// roomCode matching ^MED-ZONE-[A-Z0-9]{3,20}$ (server/app.js). TAG carries
// lowercase letters and hyphens, so derive an alphanumeric suffix from it and
// append the pair id to keep each visit's room unique.
const ROOM_TAG = TAG.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(-6);

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

let server = null;
const base = EXTERNAL_BASE || await (async () => {
  server = app.listen({ port: 0, host: '127.0.0.1', backlog: 2048 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return `http://127.0.0.1:${server.address().port}`;
})();

const json = (body) => JSON.stringify(body);
const headers = { 'Content-Type': 'application/json' };

async function expectOk(response, what) {
  if (!response.ok) throw new Error(`${what} -> ${response.status}`);
  return response.json();
}

// Authenticated sessions: booking/check-in/chat require a signed-in caller,
// so each pair signs in as the demo patient + covering clinician. Credentials
// come from env (defaults match the dev seed accounts).
const LOAD_PATIENT_USER = process.env.LOAD_PATIENT_USER || 'patient.demo';
const LOAD_PATIENT_PASS = process.env.LOAD_PATIENT_PASS || 'Patient123';
const LOAD_CLINICIAN_USER = process.env.LOAD_CLINICIAN_USER || 'clinician.demo';
const LOAD_CLINICIAN_PASS = process.env.LOAD_CLINICIAN_PASS || 'Clinician123';

async function loginSession(username, password) {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers,
    body: json({ username, password }),
  });
  await expectOk(response, `login ${username}`);
  const raw = response.headers.getSetCookie?.()?.[0] ?? response.headers.get('set-cookie');
  if (!raw) throw new Error(`login ${username} set no cookie`);
  return raw.split(';')[0];
}

const authedHeaders = (cookie) => ({ ...headers, cookie });
const logoutSession = (cookie) =>
  fetch(`${base}/api/logout`, { method: 'POST', headers: authedHeaders(cookie) }).catch(() => {});

// Real ids: appointments FK-restrict to existing patients/providers.
await warmPool();
const seedPatient = await query('SELECT * FROM patients ORDER BY created_at LIMIT 1').then(r => r[0]);
const seedProvider = await query('SELECT * FROM providers ORDER BY name LIMIT 1').then(r => r[0]);
if (!seedPatient || !seedProvider) {
  console.error('[load] dev database has no patient/provider rows; run npm run db:setup first.');
  process.exitCode = 2;
  if (server) await new Promise(resolve => server.close(resolve));
  await closePool();
  process.exit();
}
const providerSlots = await query('SELECT slot FROM provider_availability WHERE provider_id = ? ORDER BY position', [seedProvider.id]);
const slot = providerSlots[0]?.slot ?? '10:00 AM';

const latencies = [];
let failures = 0;
const fail = (id, err, step) => {
  failures += 1;
  const reason = err?.cause?.code || err.message;
  if (failures <= 5) console.error(`[load] pair ${id} failed at ${step}: ${reason}`);
};

async function pair(id) {
  if (RAMP_MS > 0) await new Promise(resolve => setTimeout(resolve, Math.random() * RAMP_MS));
  const t0 = performance.now();
  const aptId = `${TAG}-apt-${id}`;
  let patientCookie = '';
  let consultantCookie = '';
  let step = 'start';
  try {
    // 0. Both parties sign in (booking/check-in/chat are session-guarded).
    step = 'login';
    [patientCookie, consultantCookie] = await Promise.all([
      loginSession(LOAD_PATIENT_USER, LOAD_PATIENT_PASS),
      loginSession(LOAD_CLINICIAN_USER, LOAD_CLINICIAN_PASS),
    ]);
    const patientFetch = (path, init = {}) =>
      fetch(`${base}${path}`, { ...init, headers: { ...authedHeaders(patientCookie), ...(init.headers ?? {}) } });
    const consultantFetch = (path, init = {}) =>
      fetch(`${base}${path}`, { ...init, headers: { ...authedHeaders(consultantCookie), ...(init.headers ?? {}) } });

    // 1. Both parties bootstrap.
    step = 'bootstrap';
    const [patientBoot, consultantBoot] = await Promise.all([
      patientFetch('/api/bootstrap').then(r => expectOk(r, 'patient bootstrap')),
      consultantFetch('/api/bootstrap').then(r => expectOk(r, 'consultant bootstrap')),
    ]);
    if (!Array.isArray(patientBoot.appointments) || !Array.isArray(consultantBoot.appointments)) {
      throw new Error('bootstrap shape');
    }

    // 2. Visit booked for the pair. Each pair gets its own minute: the server
    // refuses two live visits on the same chart+provider at one instant.
    step = 'book';
    const now = new Date(Date.now() + 3600_000 + id * 61_000);
    const appointment = {
      id: aptId,
      patientId: seedPatient.id,
      providerId: seedProvider.id,
      patientName: seedPatient.name,
      patientMrn: seedPatient.mrn,
      patientAge: seedPatient.age,
      patientGender: seedPatient.gender,
      providerName: seedProvider.name,
      providerTitle: seedProvider.title,
      providerSpecialty: seedProvider.specialty,
      providerAvatar: seedProvider.avatar_url,
      date: now.toISOString().split('T')[0],
      time: slot,
      scheduledStart: now.toISOString(),
      type: 'Virtual Consultation',
      status: 'scheduled',
      reasonForVisit: `Pair burst visit ${id}`,
      triagePriority: 'routine',
      roomCode: `MED-ZONE-${ROOM_TAG}${id}`,
      encryptedSessionKey: `${TAG}-key-${id}`,
    };
    await patientFetch('/api/appointments', { method: 'POST', headers, body: json(appointment) })
      .then(r => expectOk(r, 'book visit'));

    // 3. Patient checks in -> waiting room.
    step = 'check-in';
    await patientFetch(`/api/appointments/${aptId}/status`, {
      method: 'PATCH', headers, body: json({ status: 'in-progress' }),
    }).then(r => expectOk(r, 'check in'));

    // 4. Consultant polls the list and sees the waiting patient.
    step = 'poll';
    const list = await consultantFetch('/api/appointments').then(r => expectOk(r, 'poll visits'));
    const seen = list.find(a => a.id === aptId);
    if (!seen || seen.status !== 'in-progress') throw new Error('check-in not visible to pair');

    // 5. Paired chat exchange, then each party re-reads the room transcript
    // (the live-sync ticker path).
    step = 'chat';
    const msg = (who, n) => ({
      id: `${TAG}-msg-${id}-${who}-${n}`,
      senderRole: who === 'patient' ? 'patient' : 'clinician',
      senderName: who === 'patient' ? seedPatient.name : seedProvider.name,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `Load probe message ${n} from ${who}.`,
      isEncrypted: true,
    });
    await patientFetch(`/api/appointments/${aptId}/messages`, { method: 'POST', headers, body: json(msg('patient', 1)) })
      .then(r => expectOk(r, 'patient message'));
    await consultantFetch(`/api/appointments/${aptId}/messages`, { method: 'POST', headers, body: json(msg('consultant', 1)) })
      .then(r => expectOk(r, 'consultant message'));
    const [patientTranscript, consultantTranscript] = await Promise.all([
      patientFetch(`/api/appointments/${aptId}/messages`).then(r => expectOk(r, 'patient transcript')),
      consultantFetch(`/api/appointments/${aptId}/messages`).then(r => expectOk(r, 'consultant transcript')),
    ]);
    if (patientTranscript.length < 2 || consultantTranscript.length < 2) {
      throw new Error('transcript exchange incomplete');
    }

    // 6. Consultant completes the visit.
    step = 'complete';
    await consultantFetch(`/api/appointments/${aptId}/status`, {
      method: 'PATCH', headers, body: json({ status: 'completed' }),
    }).then(r => expectOk(r, 'complete visit'));

    // 7. Both parties linger on the page.
    step = 'hold';
    await new Promise(resolve => setTimeout(resolve, Math.random() * HOLD_MS));
    await fetch(`${base}/api/health`).then(r => expectOk(r, 'health'));

    latencies.push(performance.now() - t0);
  } catch (err) {
    fail(id, err, step);
  } finally {
    if (patientCookie) void logoutSession(patientCookie);
    if (consultantCookie) void logoutSession(consultantCookie);
  }
}

console.log(`[load] ${PAIRS} consultant+patient pairs (${PAIRS * 2} users) against ${base}`);
const started = performance.now();
// Staggered start: logins (bcrypt, event-loop-bound) spread over time instead
// of hitting the same tick — mirrors how a real clinic burst arrives.
const results = [];
for (let i = 0; i < PAIRS; i += 1) {
  results.push(pair(i));
  if (STAGGER_MS > 0 && i < PAIRS - 1) {
    await new Promise((resolve) => setTimeout(resolve, STAGGER_MS));
  }
}
await Promise.allSettled(results);
const wallMs = performance.now() - started;

// Cleanup test rows (appointments + their messages).
await query('DELETE FROM chat_messages WHERE id LIKE ?', [`${TAG}-msg-%`]);
await query('DELETE FROM appointments WHERE id LIKE ?', [`${TAG}-apt-%`]);

latencies.sort((a, b) => a - b);
console.log(`[load] completed=${latencies.length} failed=${failures} wall=${Math.round(wallMs)}ms`);
console.log(
  `[load] throughput=${(latencies.length / (wallMs / 1000)).toFixed(1)} pairs/s ` +
  `p50=${Math.round(percentile(latencies, 50))}ms ` +
  `p95=${Math.round(percentile(latencies, 95))}ms ` +
  `max=${Math.round(latencies[latencies.length - 1] ?? 0)}ms`
);

await new Promise(resolve => { if (server) server.close(resolve); else resolve(); });
await closePool();
process.exitCode = failures > 0 ? 1 : 0;
