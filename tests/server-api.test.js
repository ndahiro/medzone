/**
 * End-to-end HTTP contract for the routes the React client depends on.
 * Boots the real Express app on an ephemeral port against the dev MySQL
 * database, then exercises health, bootstrap, follow-up, and the
 * consultant-notes CRUD (with cleanup).
 *
 * RBAC is part of that contract: every clinical read now needs a session, a
 * patient session only ever receives its own chart, and staff-only surfaces
 * refuse it even when it asks directly. Those assertions live here because the
 * API — not the sidebar — is the enforcement point.
 *
 * Tele-visit hardening is pinned the same way: the room is entered only
 * through POST /api/appointments/:id/consultation (participant-checked,
 * server-stamped), and transcript writes are bound to a live visit whose
 * sender identity comes from the session, never the body.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import app from '../server/app.js';
import { closePool, query } from '../server/db.js';

let server;
let base;
let staffCookie;
let patientCookie;

/** Signs in and returns the session cookie header value. */
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

/** fetch() bound to a session cookie. */
const asUser = cookie => (path, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });

const jsonInit = body => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Unique-enough id suffix so parallel test files cannot collide. */
const testSuffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

/**
 * Books a disposable visit on the demo patient's chart as clinical staff,
 * modelled on a seeded visit so every required field is populated.
 *
 * The start defaults to a far-future slot; callers that need a joinable room
 * (the patient admission test) pass `startInMinutes` inside the 15-minute
 * window. A refused slot steps a minute forward so the seeded schedule and
 * suites running in parallel cannot collide with the booking itself.
 */
const bookTestVisit = async (id, { startInMinutes } = {}) => {
  const staff = asUser(staffCookie);
  const bootstrap = await (await staff('/api/bootstrap')).json();
  // The helper's contract is a visit on the demo patient's chart, so model on
  // one of Ahmed Benali's rows rather than whichever seeded visit sorts first
  // (the clinic-wide list starts with the oldest visit, another chart).
  const template =
    bootstrap.appointments.find(a => a.patientId === 'pat-001') ?? bootstrap.appointments[0];
  assert.ok(template, 'seed data must contain a visit to model the booking on');
  const base =
    startInMinutes === undefined
      ? Date.now() + 48 * 60 * 60_000
      : Date.now() + startInMinutes * 60_000;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const booking = {
      ...template,
      id,
      status: 'scheduled',
      scheduledStart: new Date(base + attempt * 61_000).toISOString(),
      reasonForVisit: 'Created by the server-api test for tele-visit hardening.',
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
  patientCookie = await login('patient.demo', 'Patient123');
});

after(async () => {
  await query('DELETE FROM consultant_notes WHERE id LIKE ?', ['test-cn-api-%']);
  await query('DELETE FROM consultation_requests WHERE id LIKE ?', ['test-cr-api-%']);
  await query('DELETE FROM chat_messages WHERE id LIKE ?', ['test-msg-api-%']);
  await query('DELETE FROM appointments WHERE id LIKE ?', ['test-apt-room-%']);
  await new Promise(resolve => server.close(resolve));
  await closePool();
});

test('GET /api/health reports a connected database', async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.database, 'connected');
});

test('GET /api/bootstrap returns every entity the client hydrates', async () => {
  const response = await asUser(staffCookie)('/api/bootstrap');
  assert.equal(response.status, 200);
  const data = await response.json();
  for (const key of [
    'patient', 'providers', 'appointments', 'prescriptions', 'auditLogs',
    'notifications', 'followUp', 'soapNotes', 'chatMessages', 'consultantNotes',
    'consultationRequests',
  ]) {
    assert.ok(key in data, `bootstrap payload must include ${key}`);
  }
  assert.ok(Array.isArray(data.consultantNotes), 'consultantNotes must be an array');
  assert.ok(Array.isArray(data.chatMessages), 'chatMessages must be an array');
  assert.ok(data.patient === null || typeof data.patient === 'object');
  if (data.patient) assert.ok(data.patient.mrn, 'patient MRN must decrypt to a real value');
});

test('signed-out bootstrap carries no chart data', async () => {
  const response = await fetch(`${base}/api/bootstrap`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.patient, null, 'anonymous callers must not receive a chart');
  assert.deepEqual(data.appointments, [], 'anonymous callers must not receive visits');
  assert.deepEqual(data.prescriptions, [], 'anonymous callers must not receive medications');
  assert.deepEqual(data.consultantNotes, [], 'anonymous callers must not receive notes');
  assert.equal(data.followUp, null);
  assert.ok(Array.isArray(data.providers) && data.providers.length > 0, 'provider directory stays public');
});

test('a patient session hydrates its own chart only', async () => {
  const response = await asUser(patientCookie)('/api/bootstrap');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.patient, 'the patient must receive their own chart');
  assert.equal(data.patient.id, 'pat-001', 'the chart is the one bound to the account');
  for (const appointment of data.appointments) {
    assert.equal(appointment.patientId, data.patient.id, 'visits must belong to the patient');
  }
  for (const prescription of data.prescriptions) {
    assert.equal(prescription.patientId, data.patient.id, 'medications must belong to the patient');
  }
  for (const note of data.consultantNotes) {
    assert.equal(note.patientId, data.patient.id, 'notes must belong to the patient');
  }
  // Operational, clinic-wide collections carry no patient ownership column and
  // must not reach a patient session at all.
  assert.deepEqual(data.auditLogs, [], 'audit trail is a staff surface');
  assert.deepEqual(data.notifications, [], 'clinic notifications are a staff surface');
});

test('staff-only endpoints refuse a patient session', async () => {
  const patient = asUser(patientCookie);
  const auditLogs = await patient('/api/audit-logs');
  assert.equal(auditLogs.status, 403, 'audit trail must be staff-only');

  const followUp = await patient('/api/follow-up');
  assert.equal(followUp.status, 403, 'the follow-up chart is a staff-only view');

  const issueRx = await patient('/api/prescriptions', jsonInit({ id: 'test-rx-rbac', patientId: 'pat-001' }));
  assert.equal(issueRx.status, 403, 'issuing a prescription is a clinical act');

  const soapNote = await patient('/api/soap-note', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjective: 'x', objective: 'x', assessment: 'x', plan: 'x' }),
  });
  assert.equal(soapNote.status, 403, 'charting a SOAP note is a clinical act');
});

test('a patient may not reach another chart through booking', async () => {
  const response = await asUser(patientCookie)(
    '/api/appointments',
    jsonInit({
      id: `test-apt-rbac-${Date.now()}`,
      patientId: 'pat-999-other',
      providerId: 'prov-001',
      scheduledStart: '2026-12-01T10:00:00.000Z',
      type: 'Virtual Consultation',
      status: 'scheduled',
      roomCode: 'MED-ZONE-000',
    })
  );
  assert.equal(response.status, 403, 'patients may only book on their own chart');
});

test('a patient may still book on their own chart, and sees the visit afterwards', async () => {
  const patient = asUser(patientCookie);
  const before = await (await patient('/api/bootstrap')).json();
  assert.ok(before.patient, 'the patient has a chart to book against');
  const template = before.appointments[0];
  assert.ok(template, 'seed data must contain a visit to model the booking on');

  const booking = {
    ...template,
    id: `test-apt-own-${Date.now()}`,
    status: 'scheduled',
    scheduledStart: new Date(Date.now() + 50 * 60 * 60_000).toISOString(),
    reasonForVisit: 'Booked by the server-api test on the patient\'s own chart.',
  };

  const created = await patient('/api/appointments', jsonInit(booking));
  assert.equal(created.status, 201, 'patients must be able to book their own visits');

  const after = await (await patient('/api/bootstrap')).json();
  assert.ok(
    after.appointments.some(a => a.id === booking.id),
    'the booking must land on the patient\'s chart'
  );
  assert.ok(
    after.appointments.every(a => a.patientId === after.patient.id),
    'no other patient\'s visit may appear'
  );

  await query('DELETE FROM appointments WHERE id = ?', [booking.id]);
});

test('clinical reads refuse an anonymous caller', async () => {
  for (const path of ['/api/patient', '/api/appointments', '/api/prescriptions', '/api/consultant-notes']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 401, `${path} must require a session`);
  }
});

test('GET /api/follow-up returns the FollowUpDetail shape the view renders', async () => {
  const response = await asUser(staffCookie)('/api/follow-up');
  assert.equal(response.status, 200);
  const followUp = await response.json();
  for (const key of ['id', 'code', 'title', 'status', 'createdDate', 'description', 'createdBy', 'practitioner', 'patient']) {
    assert.ok(key in followUp, `follow-up must include ${key}`);
  }
  assert.ok(followUp.patient.name, 'patient name must come from the database');
  assert.ok(followUp.practitioner.name, 'practitioner name must come from the database');
});

test('consultant notes: list, encrypted create round-trip, 400 validation, cleanup', async () => {
  const staff = asUser(staffCookie);
  const listBefore = await (await staff('/api/consultant-notes')).json();
  assert.ok(Array.isArray(listBefore));

  const note = {
    id: `test-cn-api-${Date.now()}`,
    patientId: 'pat-001',
    patientName: 'API Test Patient',
    patientMrn: 'MRN-API',
    authorName: 'API Tester',
    authorRole: 'clinician',
    title: 'Created by server-api test',
    body: 'Assert the full HTTP round-trip.',
    createdAt: new Date().toISOString(),
  };

  const created = await staff('/api/consultant-notes', jsonInit(note));
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  // Identity is stamped from the session (never the body): the title/body
  // round-trip exactly, the author is the signed-in clinician.
  assert.equal(createdBody.id, note.id);
  assert.equal(createdBody.title, note.title);
  assert.equal(createdBody.body, note.body);
  assert.equal(createdBody.authorRole, 'clinician');
  assert.ok(createdBody.authorName, 'author is stamped from the session');

  const [stored] = await query('SELECT title, body FROM consultant_notes WHERE id = ?', [note.id]);
  assert.ok(stored, 'row must exist in MySQL');
  assert.notEqual(stored.title, note.title, 'PHI title must be ciphertext at rest');
  assert.ok(String(stored.title).startsWith('v1:'));

  const fetched = await (await staff('/api/consultant-notes')).json();
  assert.ok(fetched.some(candidate => candidate.id === note.id), 'note must appear in GET list');

  // The patient the note is about downloads it from their own list.
  const patientNoteIds = (await (await asUser(patientCookie)('/api/consultant-notes')).json()).map(n => n.id);
  assert.ok(patientNoteIds.includes(note.id), 'a patient must receive their own clinician notes');

  const invalid = await staff('/api/consultant-notes', jsonInit({ id: 'test-cn-api-invalid' }));
  assert.equal(invalid.status, 400);
  const error = await invalid.json();
  assert.ok(error.error.includes('Missing required fields'));

  await query('DELETE FROM consultant_notes WHERE id = ?', [note.id]);
});

test('consultation requests: create, triage accept/decline, validation, cleanup', async () => {
  const staff = asUser(staffCookie);
  const listBefore = await (await staff('/api/consultation-requests')).json();
  assert.ok(Array.isArray(listBefore));

  const request = {
    id: `test-cr-api-${Date.now()}`,
    patientId: 'pat-001',
    patientName: 'API Test Patient',
    patientMrn: 'MRN-API',
    patientAge: 40,
    patientGender: 'Female',
    topic: 'Dermatology review',
    urgency: 'routine',
    preferredDate: '2026-12-01',
    details: 'Rash follow-up requested by server-api test.',
    contact: '+10000000000',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  const created = await staff('/api/consultation-requests', jsonInit(request));
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const [chart] = await query('SELECT name, mrn, age, gender FROM patients WHERE id = ?', ['pat-001']);
  assert.equal(createdBody.id, request.id);
  assert.equal(createdBody.topic, request.topic);
  assert.equal(createdBody.patientName, chart.name, 'patient name is stamped from the chart');
  assert.equal(createdBody.patientMrn, chart.mrn, 'MRN is stamped from the chart');
  assert.equal(createdBody.patientAge, chart.age);
  assert.equal(createdBody.patientGender, chart.gender);
  assert.equal(createdBody.status, 'pending', 'a new request cannot arrive pre-approved');

  const invalid = await staff('/api/consultation-requests', jsonInit({ id: 'test-cr-api-invalid' }));
  assert.equal(invalid.status, 400);

  const badStatus = await staff(`/api/consultation-requests/${request.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'pending' }),
  });
  assert.equal(badStatus.status, 400);

  // Triage is staff-only: the patient who filed the request cannot accept it.
  const patientTriage = await asUser(patientCookie)(`/api/consultation-requests/${request.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted' }),
  });
  assert.equal(patientTriage.status, 403, 'triaging requests is a staff action');

  const missing = await staff('/api/consultation-requests/test-cr-api-nope/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'declined', reviewedBy: 'API Tester' }),
  });
  assert.equal(missing.status, 404);

  const accepted = await staff(`/api/consultation-requests/${request.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    // A spoofed reviewer in the body must be ignored: the session's own
    // display name is stamped server-side.
    body: JSON.stringify({ status: 'accepted', reviewedBy: 'Spoofed Reviewer' }),
  });
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.status, 'accepted');
  assert.equal(acceptedBody.reviewedBy, 'Dr. Sarah Chen');
  assert.ok(acceptedBody.reviewedAt, 'review timestamp must be stamped');

  const fetched = await (await staff('/api/consultation-requests')).json();
  assert.ok(fetched.some(candidate => candidate.id === request.id), 'request must appear in GET list');

  await query('DELETE FROM consultation_requests WHERE id = ?', [request.id]);
});

test('booking refuses malformed room references and unknown visit shapes', async () => {
  const staff = asUser(staffCookie);
  const template = (await (await staff('/api/bootstrap')).json()).appointments[0];
  const base = { ...template, id: `test-apt-room-${testSuffix()}`, status: 'scheduled' };

  const badRoom = await staff('/api/appointments', jsonInit({ ...base, id: `${base.id}-room`, roomCode: '<script>' }));
  assert.equal(badRoom.status, 400, 'a room reference must look like MED-ZONE-…');

  const badType = await staff('/api/appointments', jsonInit({ ...base, id: `${base.id}-type`, type: 'Webinar' }));
  assert.equal(badType.status, 400, 'only real visit types can be booked');

  const missingKey = await staff('/api/appointments', jsonInit({ ...base, id: `${base.id}-key`, encryptedSessionKey: '' }));
  assert.equal(missingKey.status, 400, 'the visit room key is required');
});

test('tele-visit admission: participant-checked, server-stamped, closed visits refused', async () => {
  const visit = await bookTestVisit(`test-apt-room-${testSuffix()}`);
  const staff = asUser(staffCookie);

  // No session, no room.
  const anonymous = await fetch(`${base}/api/appointments/${visit.id}/consultation`, { method: 'POST' });
  assert.equal(anonymous.status, 401, 'room admission must require a session');

  // Unknown visits are refused outright.
  const unknown = await staff('/api/appointments/test-apt-room-nope/consultation', { method: 'POST' });
  assert.equal(unknown.status, 404);

  // The clinician opens the scheduled visit: the server moves it to
  // in-progress and answers with its own record (room code included), so the
  // client can only ever join a room the backend actually holds.
  const opened = await staff(`/api/appointments/${visit.id}/consultation`, { method: 'POST' });
  assert.equal(opened.status, 200);
  const admitted = await opened.json();
  assert.equal(admitted.id, visit.id);
  assert.equal(admitted.status, 'in-progress');
  assert.equal(admitted.roomCode, visit.roomCode);
  assert.ok(admitted.encryptedSessionKey, 'the admitted record carries the room key');

  // Rejoining an in-progress room is allowed and changes nothing.
  const rejoined = await staff(`/api/appointments/${visit.id}/consultation`, { method: 'POST' });
  assert.equal(rejoined.status, 200);
  assert.equal((await rejoined.json()).status, 'in-progress');

  // A visit that has ended cannot be reopened.
  const ended = await staff(`/api/appointments/${visit.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  });
  assert.equal(ended.status, 200);
  const closed = await staff(`/api/appointments/${visit.id}/consultation`, { method: 'POST' });
  assert.equal(closed.status, 409, 'a closed visit must not reopen');

  await query('DELETE FROM appointments WHERE id = ?', [visit.id]);
});

test('a patient may open their own visit, and learns nothing about others', async () => {
  // The start must sit inside the join window: this test enters as the
  // patient, and the server refuses early entry (see booking-rules.test.js).
  const visit = await bookTestVisit(`test-apt-room-${testSuffix()}`, { startInMinutes: 2 });
  const patient = asUser(patientCookie);

  const opened = await patient(`/api/appointments/${visit.id}/consultation`, { method: 'POST' });
  assert.equal(opened.status, 200, 'a patient must be able to enter their own visit');
  assert.equal((await opened.json()).status, 'in-progress');

  const unknown = await patient(`/api/appointments/test-apt-room-nope/consultation`, { method: 'POST' });
  assert.equal(unknown.status, 404, 'a patient session learns nothing about unknown visits');

  await query('DELETE FROM appointments WHERE id = ?', [visit.id]);
});

test('transcript writes are participant-bound; identity is stamped by the session', async () => {
  const visitId = `test-apt-room-${testSuffix()}`;
  const visit = await bookTestVisit(visitId);
  const staff = asUser(staffCookie);
  const patient = asUser(patientCookie);
  const payload = {
    id: `test-msg-api-${testSuffix()}`,
    senderRole: 'patient',
    senderName: 'Impersonated Patient',
    text: 'Patient reports intermittent chest tightness on exertion.',
    // Attempt to backdate the clinical record; the server must ignore it.
    timestamp: '1999-01-01T00:00:00.000Z',
  };

  // A scheduled visit has no live transcript to write to.
  const early = await staff(`/api/appointments/${visit.id}/messages`, jsonInit(payload));
  assert.equal(early.status, 409, 'transcript writes require a live visit');

  const opened = await staff(`/api/appointments/${visit.id}/consultation`, { method: 'POST' });
  assert.equal(opened.status, 200);

  // Staff post with a spoofed identity: the server stamps the session's own.
  const stamped = await staff(`/api/appointments/${visit.id}/messages`, jsonInit(payload));
  assert.equal(stamped.status, 201);
  const storedStaff = await stamped.json();
  assert.equal(storedStaff.senderRole, 'clinician', 'staff cannot post as a patient');
  assert.equal(storedStaff.senderName, 'Dr. Sarah Chen', 'the session display name is used');
  assert.ok(storedStaff.timestamp, 'the server stamps the sent time');
  assert.notEqual(storedStaff.timestamp, payload.timestamp, 'a client cannot backdate a message');
  assert.ok(
    Math.abs(Date.now() - Date.parse(storedStaff.timestamp)) < 5 * 60_000,
    'the stored time is the server clock, not the supplied one'
  );
  assert.equal(storedStaff.appointmentId, visit.id, 'the message is bound to the visit route');
  assert.equal(storedStaff.text, payload.text, 'the message body round-trips to the client');

  // At rest the row is the server-encrypted AES-256-GCM envelope, never the
  // plaintext: the browser holds no transcript key, so the visit id must not
  // be enough to read a stored dump.
  const [storedRow] = await query('SELECT cipher_text FROM chat_messages WHERE id = ?', [storedStaff.id]);
  assert.match(storedRow.cipher_text, /^v1:\d+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/, 'the row holds the v1 envelope');
  assert.ok(!storedRow.cipher_text.includes('chest tightness'), 'the row never holds the plaintext message');

  // The patient posts on their own live visit; identity is still server-side.
  const patientMsg = await patient(`/api/appointments/${visit.id}/messages`, jsonInit({
    ...payload,
    id: `${payload.id}-patient`,
  }));
  assert.equal(patientMsg.status, 201);
  const storedPatient = await patientMsg.json();
  assert.equal(storedPatient.senderRole, 'patient');
  assert.equal(storedPatient.senderName, 'Ahmed Benali');

  // An empty or oversized body is refused before it reaches the store.
  const malformed = await staff(`/api/appointments/${visit.id}/messages`, jsonInit({
    ...payload, id: `${payload.id}-bad`, text: '   ',
  }));
  assert.equal(malformed.status, 400);
  const oversized = await staff(`/api/appointments/${visit.id}/messages`, jsonInit({
    ...payload, id: `${payload.id}-long`, text: 'x'.repeat(4001),
  }));
  assert.equal(oversized.status, 400, 'a transcript message is capped at 4000 characters');

  // Unknown and closed visits refuse transcript writes.
  const unknown = await staff('/api/appointments/test-apt-room-nope/messages', jsonInit(payload));
  assert.equal(unknown.status, 404);

  await staff(`/api/appointments/${visit.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  });
  const afterClose = await staff(`/api/appointments/${visit.id}/messages`, jsonInit({
    ...payload, id: `${payload.id}-closed`,
  }));
  assert.equal(afterClose.status, 409, 'a closed visit must not accept new messages');

  // Transcript reads follow the same participation.
  const read = await patient(`/api/appointments/${visit.id}/messages`);
  assert.equal(read.status, 200);
  const transcript = await read.json();
  assert.ok(transcript.some(m => m.id === storedPatient.id), 'the patient reads their own transcript');
  assert.ok(transcript.some(m => m.id === storedStaff.id), 'both participants share one transcript');
  assert.deepEqual(
    transcript.find(m => m.id === storedStaff.id).text,
    payload.text,
    'the reading participant receives the decrypted body'
  );
  assert.equal(
    'cipherText' in transcript.find(m => m.id === storedStaff.id),
    false,
    'cipher material never leaves the server'
  );

  await query('DELETE FROM chat_messages WHERE appointment_id = ?', [visit.id]);
  await query('DELETE FROM appointments WHERE id = ?', [visit.id]);
});
