/**
 * Per-provider schedule scope (the "doctor the patient selected" contract).
 *
 * A clinician login bound to a provider (users.provider_id) reads only the
 * visits booked with that provider and only the patients who booked them — so
 * once a patient schedules a visit, the selected doctor sees that patient after
 * signing in. A clinician with no provider link is a covering/supervising
 * account and keeps the clinic-wide read, as does an administrator.
 *
 * Boots the real Express app against the dev MySQL database, so it depends on
 * the seeded scenario accounts (`npm run db:setup`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import app from '../server/app.js';
import { closePool, query } from '../server/db.js';

let server;
let base;
let martinCookie; // clinician bound to prov-001
let riveraCookie; // clinician bound to prov-002
let coveringCookie; // clinician.demo, no provider link
let adminCookie;
let patientCookie;

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

const asUser = cookie => (path, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });

const jsonInit = body => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const bootstrap = async cookie => {
  const response = await asUser(cookie)('/api/bootstrap');
  assert.equal(response.status, 200);
  return response.json();
};

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  martinCookie = await login('clinician.martin', 'Clinician123');
  riveraCookie = await login('clinician.rivera', 'Clinician123');
  coveringCookie = await login('clinician.demo', 'Clinician123');
  adminCookie = await login('admin', 'Admin123');
  patientCookie = await login('patient.demo', 'Patient123');
});

after(async () => {
  await query('DELETE FROM chat_messages WHERE appointment_id LIKE ?', ['test-apt-scope-%']);
  await query('DELETE FROM appointments WHERE id LIKE ?', ['test-apt-scope-%']);
  await new Promise(resolve => server.close(resolve));
  await closePool();
});

test('a bound clinician reports the provider they practise as at login', async () => {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'clinician.martin', password: 'Clinician123' }),
  });
  assert.equal(response.status, 200);
  const user = await response.json();
  assert.equal(user.role, 'clinician');
  assert.equal(user.providerId, 'prov-001', 'the provider binding must reach the client');
  assert.equal(user.patientId, null, 'a clinician holds no chart');
});

test('a bound clinician only receives visits booked with their provider', async () => {
  const data = await bootstrap(martinCookie);
  assert.ok(data.appointments.length > 0, 'the demo dataset must contain visits for prov-001');
  for (const appointment of data.appointments) {
    assert.equal(appointment.providerId, 'prov-001', 'no other provider\'s visit may appear');
  }
  for (const other of data.appointments) {
    assert.ok(other.patientId, 'each visit names the chart it belongs to');
  }
});

test('a bound clinician only receives the patients who booked with them', async () => {
  const data = await bootstrap(martinCookie);
  const ids = data.patients.map(p => p.id);
  assert.ok(ids.includes('pat-001'), 'the patient who booked with prov-001 must be listed');
  for (const patient of data.patients) {
    const visits = await query('SELECT provider_id FROM appointments WHERE patient_id = ?', [patient.id]);
    assert.ok(
      visits.some(row => row.provider_id === 'prov-001'),
      `${patient.id} must have a visit with prov-001 to appear in the directory`
    );
  }
});

test('a bound clinician sees their own panel, not another provider\'s patients', async () => {
  const data = await bootstrap(riveraCookie);
  assert.ok(data.appointments.length > 0, 'prov-002 has seeded visits');
  for (const appointment of data.appointments) {
    assert.equal(appointment.providerId, 'prov-002', 'no other provider\'s visit may appear');
  }
  const ids = data.patients.map(p => p.id);
  assert.ok(ids.includes('pat-004'), 'Priya Nair books with prov-002');
  assert.ok(ids.includes('pat-007'), 'Fatima Al-Sayed books with prov-002');
  assert.ok(!ids.includes('pat-002'), 'Lucia Ortega only books with prov-001');
});

test('a bound clinician follow-up inbox is scoped to their own panel', async () => {
  const martin = await bootstrap(martinCookie);
  assert.ok(martin.followUps.length > 0, 'prov-001 has seeded follow-ups');
  const martinNames = new Set(martin.patients.map(p => p.name));
  for (const followUp of martin.followUps) {
    assert.ok(
      martinNames.has(followUp.patient.name),
      `${followUp.patient.name} must be on the prov-001 panel`
    );
  }

  const rivera = await bootstrap(riveraCookie);
  assert.ok(rivera.followUps.length > 0, 'prov-002 has seeded follow-ups');
  const riveraNames = new Set(rivera.patients.map(p => p.name));
  for (const followUp of rivera.followUps) {
    assert.ok(
      riveraNames.has(followUp.patient.name),
      `${followUp.patient.name} must be on the prov-002 panel`
    );
  }
});

test('the single follow-up endpoint and its status write respect the provider panel', async () => {
  const martin = await bootstrap(martinCookie);
  const martinNames = new Set(martin.patients.map(p => p.name));

  const ownFollowUp = await (await asUser(martinCookie)('/api/follow-up')).json();
  assert.ok(ownFollowUp, 'prov-001 has a follow-up to open');
  assert.ok(
    martinNames.has(ownFollowUp.patient.name),
    'a bound clinician must only be handed a follow-up from their own panel'
  );

  const rivera = await bootstrap(riveraCookie);
  const foreign = rivera.followUps.find(f => !martinNames.has(f.patient.name));
  assert.ok(foreign, 'the fixture must include a follow-up outside the prov-001 panel');

  const attempt = await asUser(martinCookie)(`/api/follow-up/${foreign.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Closed' }),
  });
  assert.equal(attempt.status, 404, 'another panel\'s follow-up must look unknown');
});

test('a covering clinician (no provider link) keeps the clinic-wide read', async () => {
  const data = await bootstrap(coveringCookie);
  const providers = new Set(data.appointments.map(a => a.providerId));
  assert.ok(providers.size > 0, 'the covering clinician sees the seeded visits');
  const ids = data.patients.map(p => p.id);
  assert.ok(ids.includes('pat-001') && ids.includes('pat-002'), 'the covering read spans every chart');
});

test('an administrator keeps the clinic-wide read', async () => {
  const data = await bootstrap(adminCookie);
  assert.ok(data.appointments.length > 0);
  const ids = data.patients.map(p => p.id);
  assert.ok(ids.includes('pat-001') && ids.includes('pat-002'));
});

test('GET /api/appointments is scoped for a bound clinician and open for a covering one', async () => {
  const martin = await (await asUser(martinCookie)('/api/appointments')).json();
  assert.ok(martin.length > 0);
  assert.ok(martin.every(a => a.providerId === 'prov-001'), 'only the bound provider\'s visits');

  const covering = await (await asUser(coveringCookie)('/api/appointments')).json();
  const admin = await (await asUser(adminCookie)('/api/appointments')).json();
  assert.equal(
    covering.length,
    admin.length,
    'a covering clinician reads the same clinic-wide set as an administrator'
  );
  assert.ok(covering.length >= martin.length, 'and never fewer than the bound scope');
});

test('a patient booking lands with the selected doctor and shows up for that doctor only', async () => {
  const patient = asUser(patientCookie);
  const template = (await (await patient('/api/bootstrap')).json()).appointments[0];
  assert.ok(template, 'the patient must have a visit to model the booking on');

  const base = Date.now() + 51 * 60 * 60_000;
  let booking;
  let created;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    booking = {
      ...template,
      id: `test-apt-scope-${Date.now()}`,
      providerId: 'prov-002',
      providerName: 'Dr. Marcus Rivera, MD',
      providerTitle: 'Consulting Physician',
      providerSpecialty: 'Cardiovascular & Internal Medicine',
      providerAvatar: 'doctor_neurology_rivera_1791375857139.jpg',
      status: 'scheduled',
      scheduledStart: new Date(base + attempt * 61_000).toISOString(),
      reasonForVisit: 'Provider-scope test: booked with Dr. Rivera.',
    };
    created = await patient('/api/appointments', jsonInit(booking));
    if (created.status === 201) break;
    assert.equal(created.status, 409, `patient booking failed unexpectedly (${created.status})`);
  }
  assert.equal(created.status, 201, 'a patient must be able to book on their own chart');

  const rivera = await bootstrap(riveraCookie);
  assert.ok(
    rivera.appointments.some(a => a.id === booking.id),
    'the selected doctor must see the visit after signing in'
  );
  assert.ok(
    rivera.patients.some(p => p.id === template.patientId),
    'and the patient who booked must appear in their directory'
  );

  const martin = await bootstrap(martinCookie);
  assert.ok(
    !martin.appointments.some(a => a.id === booking.id),
    'a different doctor must not see a visit booked with someone else'
  );

  await query('DELETE FROM appointments WHERE id = ?', [booking.id]);
});

test('a patient session is still confined to its own chart', async () => {
  const data = await bootstrap(patientCookie);
  assert.equal(data.patient.id, 'pat-001');
  for (const appointment of data.appointments) {
    assert.equal(appointment.patientId, 'pat-001', 'a patient reads only their own chart');
  }
});
