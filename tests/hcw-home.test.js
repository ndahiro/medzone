/**
 * HCW@Home parity surface, exercised end-to-end against the real Express app
 * and dev MySQL (like server-api.test.js). Covers:
 *   - one-click patient invitation links (create, public PHI-free summary,
 *     re-issue supersedes, expiry/revocation)
 *   - in-visit file & image exchange (participant-bound, encrypted at rest)
 *   - the shared clinic-wide waiting room (any doctor can pick up a patient)
 *   - anonymised clinic statistics (aggregates only, admin-gated)
 * plus a static guard for the multilingual portal.
 *
 * Depends on the seeded scenario accounts (`npm run db:setup`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import app from '../server/app.js';
import { closePool, query } from '../server/db.js';

let server;
let base;
let staffCookie;
let otherStaffCookie;
let patientCookie;
let otherPatientCookie;
let adminCookie;

const login = async (username, password) => {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `${username} must be able to sign in`);
  const raw = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  assert.ok(raw, 'login must set a session cookie');
  return raw.split(';')[0];
};

const asUser = cookie => (p, init = {}) =>
  fetch(`${base}${p}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });

const jsonInit = body => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

/**
 * Books a disposable visit on the demo patient's chart, modelled on a seed
 * row. Starts far enough out that the join window never matters here, stepping
 * a minute forward on a refused slot (the seed and parallel suites share the
 * schedule).
 */
const bookVisit = async id => {
  const staff = asUser(staffCookie);
  const bootstrap = await (await staff('/api/bootstrap')).json();
  // Contract: the disposable visit lands on the demo patient's chart. The
  // clinic-wide list sorts oldest first, which may be another chart's row.
  const template =
    bootstrap.appointments.find(a => a.patientId === 'pat-001') ?? bootstrap.appointments[0];
  assert.ok(template, 'seed data must contain a visit to model the booking on');
  const base = Date.now() + 72 * 60 * 60_000;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const booking = {
      ...template,
      id,
      status: 'scheduled',
      scheduledStart: new Date(base + attempt * 61_000).toISOString(),
      reasonForVisit: 'Created by the HCW@Home parity test.',
    };
    const created = await staff('/api/appointments', jsonInit(booking));
    if (created.status === 201) return booking;
    assert.equal(created.status, 409, `booking ${id} failed unexpectedly (${created.status})`);
  }
  return assert.fail(`no free slot for ${id} after 8 attempts`);
};

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  staffCookie = await login('clinician.demo', 'Clinician123');
  otherStaffCookie = await login('clinician.martin', 'Clinician123');
  patientCookie = await login('patient.demo', 'Patient123');
  otherPatientCookie = await login('patient.demo2', 'Patient123');
  adminCookie = await login('admin', 'Admin123');
});

after(async () => {
  await query('DELETE FROM visit_attachments WHERE id LIKE ?', ['test-att-%']);
  await query('DELETE FROM visit_invites WHERE appointment_id LIKE ?', ['test-apt-hcw-%']);
  await query('DELETE FROM chat_messages WHERE appointment_id LIKE ?', ['test-apt-hcw-%']);
  await query('DELETE FROM appointments WHERE id LIKE ?', ['test-apt-hcw-%']);
  await new Promise(resolve => server.close(resolve));
  await closePool();
});

// ---------------------------------------------------------------------------
// Patient invitation link
// ---------------------------------------------------------------------------

test('a clinician can mint a one-click patient invitation link', async () => {
  const visit = await bookVisit(`test-apt-hcw-invite-${suffix()}`);
  const created = await asUser(staffCookie)(`/api/appointments/${visit.id}/invite`, jsonInit({ channel: 'link' }));
  assert.equal(created.status, 201);
  const invite = await created.json();
  assert.ok(invite.token, 'an invitation must carry a token');
  assert.equal(invite.appointmentId, visit.id);
  assert.equal(invite.channel, 'link');
  assert.equal(invite.joinPath, `/join/${invite.token}`);
  assert.ok(Date.parse(invite.expiresAt) > Date.now(), 'the link must not already be expired');

  await query('DELETE FROM appointments WHERE id = ?', [visit.id]);
});

test('the public invite summary names the visit but never the patient (PHI-free)', async () => {
  const visit = await bookVisit(`test-apt-hcw-summary-${suffix()}`);
  const invite = await (await asUser(staffCookie)(
    `/api/appointments/${visit.id}/invite`,
    jsonInit({ channel: 'email' }),
  )).json();

  const response = await fetch(`${base}/api/invites/${invite.token}`);
  assert.equal(response.status, 200);
  const summary = await response.json();
  assert.equal(summary.appointmentId, visit.id);
  assert.equal(summary.valid, true);
  assert.ok(summary.providerName, 'the clinician is named so the invitee recognises the visit');
  assert.ok(summary.type, 'the visit type is named');
  assert.ok(!('patientName' in summary), 'the patient identity must never leak on a public link');
  assert.ok(!('patientMrn' in summary), 'no chart identifier on a public link');

  await query('DELETE FROM appointments WHERE id = ?', [visit.id]);
});

test('re-issuing supersedes the previous link and an unknown token is refused', async () => {
  const visit = await bookVisit(`test-apt-hcw-supersede-${suffix()}`);
  const first = await (await asUser(staffCookie)(
    `/api/appointments/${visit.id}/invite`,
    jsonInit({ channel: 'link' }),
  )).json();
  const second = await (await asUser(staffCookie)(
    `/api/appointments/${visit.id}/invite`,
    jsonInit({ channel: 'whatsapp' }),
  )).json();
  assert.notEqual(first.token, second.token);

  const oldResponse = await fetch(`${base}/api/invites/${first.token}`);
  assert.equal(oldResponse.status, 404, 'the superseded link must stop working');

  const liveResponse = await fetch(`${base}/api/invites/${second.token}`);
  assert.equal(liveResponse.status, 200);

  const unknown = await fetch(`${base}/api/invites/does-not-exist-token`);
  assert.equal(unknown.status, 404);

  await query('DELETE FROM appointments WHERE id = ?', [visit.id]);
});

// ---------------------------------------------------------------------------
// In-visit file & image exchange
// ---------------------------------------------------------------------------

test('participants can share a file during a live visit; it is ciphertext at rest', async () => {
  const visit = await bookVisit(`test-apt-hcw-att-${suffix()}`);
  const staff = asUser(staffCookie);
  const attachmentId = `test-att-${suffix()}`;
  const contentBase64 = Buffer.from('hello medzone attachment').toString('base64');

  // A scheduled visit has no live encounter to share into.
  const early = await staff(
    `/api/appointments/${visit.id}/attachments`,
    jsonInit({ id: attachmentId, fileName: 'note.txt', mimeType: 'text/plain', contentBase64 }),
  );
  assert.equal(early.status, 409, 'attachments require a live visit');

  const opened = await staff(`/api/appointments/${visit.id}/consultation`, { method: 'POST' });
  assert.equal(opened.status, 200);

  const created = await staff(
    `/api/appointments/${visit.id}/attachments`,
    jsonInit({ id: attachmentId, fileName: 'note.txt', mimeType: 'text/plain', contentBase64 }),
  );
  assert.equal(created.status, 201);
  const stored = await created.json();
  assert.equal(stored.fileName, 'note.txt');
  assert.equal(stored.senderRole, 'clinician');
  assert.equal(stored.content, contentBase64);

  // The row holds ciphertext, never the plaintext file name or body.
  const [row] = await query('SELECT file_name, content FROM visit_attachments WHERE id = ?', [attachmentId]);
  assert.ok(row, 'the attachment must exist in MySQL');
  assert.ok(String(row.file_name).startsWith('v1:'), 'file name must be encrypted at rest');
  assert.notEqual(row.content, contentBase64, 'content must be encrypted at rest');

  // The patient participant reads it back decrypted through the API.
  const patientList = await asUser(patientCookie)(`/api/appointments/${visit.id}/attachments`);
  assert.equal(patientList.status, 200);
  const listed = await patientList.json();
  assert.ok(listed.some(a => a.id === attachmentId && a.content === contentBase64));

  // A different patient learns nothing about this visit.
  const stranger = await asUser(otherPatientCookie)(`/api/appointments/${visit.id}/attachments`);
  assert.equal(stranger.status, 403, 'only participants may read an attachment list');

  // Malformed input is refused before it reaches the store.
  const bad = await staff(
    `/api/appointments/${visit.id}/attachments`,
    jsonInit({ id: `${attachmentId}-bad`, fileName: '', mimeType: 'text/plain', contentBase64 }),
  );
  assert.equal(bad.status, 400);

  await query('DELETE FROM visit_attachments WHERE appointment_id = ?', [visit.id]);
  await query('DELETE FROM appointments WHERE id = ?', [visit.id]);
});

// ---------------------------------------------------------------------------
// Shared waiting room
// ---------------------------------------------------------------------------

test('a checked-in patient appears in the clinic-wide waiting room for any doctor', async () => {
  const visit = await bookVisit(`test-apt-hcw-wait-${suffix()}`);
  const staff = asUser(staffCookie);
  await staff(`/api/appointments/${visit.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'in-progress' }),
  });

  // A covering clinician (bound to a different provider) still sees the queue.
  const queue = await (await asUser(otherStaffCookie)('/api/waiting-room')).json();
  assert.ok(Array.isArray(queue));
  assert.ok(queue.some(a => a.id === visit.id), 'the checked-in visit must be in the shared queue');
  assert.ok(queue.every(a => a.status === 'in-progress'), 'only waiting visits appear');

  // The first claim wins; the same visit cannot be claimed by someone else.
  const claim = await asUser(otherStaffCookie)(`/api/waiting-room/${visit.id}/claim`, { method: 'POST' });
  assert.equal(claim.status, 200);
  const claimed = await claim.json();
  assert.ok(claimed.claimedBy, 'the claim records who picked the patient up');

  const secondClaim = await staff(`/api/waiting-room/${visit.id}/claim`, { method: 'POST' });
  assert.equal(secondClaim.status, 409, 'a claimed visit cannot be picked up twice');

  // The queue is a clinical-staff surface.
  const patientQueue = await asUser(patientCookie)('/api/waiting-room');
  assert.equal(patientQueue.status, 403);

  await query('DELETE FROM appointments WHERE id = ?', [visit.id]);
});

// ---------------------------------------------------------------------------
// Anonymised statistics
// ---------------------------------------------------------------------------

test('the anonymised statistics endpoint is admin-only and carries no PHI', async () => {
  const clinicianResponse = await asUser(staffCookie)('/api/stats');
  assert.equal(clinicianResponse.status, 403, 'statistics are an admin surface');

  const response = await asUser(adminCookie)('/api/stats');
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.equal(typeof stats.totalVisits, 'number');
  assert.equal(typeof stats.completionRate, 'number');
  assert.ok(stats.byStatus && typeof stats.byStatus.inProgress === 'number');
  assert.equal(typeof stats.invitesIssued, 'number');
  assert.equal(typeof stats.attachmentsShared, 'number');
  const serialized = JSON.stringify(stats);
  for (const banned of ['name', 'mrn', 'patientName', 'reasonForVisit']) {
    assert.ok(!serialized.includes(banned), `statistics must not carry ${banned}`);
  }
});

// ---------------------------------------------------------------------------
// Multilingual portal (static guard)
// ---------------------------------------------------------------------------

test('the patient portal ships a multilingual switcher with complete dictionaries', () => {
  const src = path.resolve(process.cwd(), 'src');
  const i18n = fs.readFileSync(path.join(src, 'context', 'LanguageContext.tsx'), 'utf8');
  for (const code of ["'en'", "'fr'", "'es'", "'ar'"]) {
    assert.ok(i18n.includes(code), `the language list must include ${code}`);
  }
  for (const key of ['portal.welcome', 'portal.upcoming', 'nav.home', 'app.language']) {
    assert.ok(i18n.includes(key), `the dictionary must define ${key}`);
  }

  const app = fs.readFileSync(path.join(src, 'App.tsx'), 'utf8');
  assert.ok(app.includes('LanguageProvider'), 'the shell must mount the language provider');

  const sidebar = fs.readFileSync(path.join(src, 'components', 'layout', 'AppSidebar.tsx'), 'utf8');
  assert.ok(sidebar.includes('setLang'), 'the rail must offer a language switcher');
  assert.ok(sidebar.includes('useLanguage'), 'the rail labels must follow the chosen language');
});

test('the shell resolves a /join invitation deep link', () => {
  const app = fs.readFileSync(path.resolve(process.cwd(), 'src', 'App.tsx'), 'utf8');
  assert.ok(app.includes('/^\\/join\\/'), 'the shell must parse the /join/<token> path');
  assert.ok(app.includes('fetchInviteSummary'), 'the deep link must resolve through the invite API');
});
