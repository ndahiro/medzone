/**
 * Security hardening contract for provider-bound clinicians.
 *
 * A clinician login bound to a provider (users.provider_id) must only read and
 * write the charts and visits booked with that provider. Covering clinicians
 * (no provider link) and administrators keep the clinic-wide read. The shared
 * waiting room remains clinic-wide by design; a bound clinician may reach a
 * visit after claiming it.
 *
 * Boots the real Express app against the dev MySQL database and uses the
 * seeded scenario accounts. Every row this suite creates is prefixed
 * `test-sec-` and deleted in `after`.
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
let priyaCookie; // patient.priya, chart pat-004

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

const jsonPatch = body => ({
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const jsonPut = body => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const testSuffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

const bootstrap = async cookie => {
  const response = await asUser(cookie)('/api/bootstrap');
  assert.equal(response.status, 200);
  return response.json();
};

/** Books a disposable visit for a chosen chart/provider as an administrator. */
const createTestVisit = async (id, { patientId = 'pat-007', providerId = 'prov-002' } = {}) => {
  const admin = asUser(adminCookie);
  const data = await bootstrap(adminCookie);
  const template = data.appointments.find(a => a.providerId === providerId);
  const patient = data.patients.find(p => p.id === patientId);
  const provider = data.providers.find(p => p.id === providerId);
  assert.ok(template && patient && provider, 'seed data must contain the booking template');
  const base = Date.now() + 37 * 24 * 60 * 60_000;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const booking = {
      ...template,
      id,
      patientId,
      patientName: patient.name,
      patientMrn: patient.mrn,
      patientAge: patient.age,
      patientGender: patient.gender,
      providerId,
      providerName: provider.name,
      providerTitle: provider.title,
      providerSpecialty: provider.specialty,
      providerAvatar: provider.avatarUrl,
      status: 'scheduled',
      scheduledStart: new Date(base + attempt * 61_000).toISOString(),
      reasonForVisit: 'Security hardening test fixture.',
    };
    const created = await admin('/api/appointments', jsonInit(booking));
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
  martinCookie = await login('clinician.martin', 'Clinician123');
  riveraCookie = await login('clinician.rivera', 'Clinician123');
  coveringCookie = await login('clinician.demo', 'Clinician123');
  adminCookie = await login('admin', 'Admin123');
  priyaCookie = await login('patient.priya', 'Patient123');
});

after(async () => {
  // Child rows first, then the visits they belong to.
  await query('DELETE FROM soap_notes WHERE id LIKE ? OR appointment_id LIKE ?', ['soap-test-sec-%', 'test-sec-%']);
  await query('DELETE FROM appointments WHERE id LIKE ?', ['test-sec-%']);
  await query('DELETE FROM prescriptions WHERE id LIKE ?', ['test-sec-%']);
  await query('DELETE FROM consultant_notes WHERE id LIKE ?', ['test-sec-%']);
  await query('DELETE FROM consultation_requests WHERE id LIKE ?', ['test-sec-%']);
  await query('DELETE FROM referrals WHERE id LIKE ?', ['test-sec-%']);
  await query('DELETE FROM audit_logs WHERE id LIKE ?', ['test-sec-%']);
  await query('DELETE FROM follow_ups WHERE id LIKE ?', ['000-test-sec-%']);
  await new Promise(resolve => server.close(resolve));
  await closePool();
});

test('a bound clinician cannot read another provider\'s chart, visit, or collections', async () => {
  const suffix = testSuffix();
  const admin = asUser(adminCookie);
  const martin = asUser(martinCookie);

  const [{ mrn: ownMrn }] = await query('SELECT mrn FROM patients WHERE id = ?', ['pat-001']);

  // Fixtures on Rivera's chart (pat-007): a request, a referral, a note and
  // two audit rows. Before the fix these are visible to Martin.
  const requestId = `test-sec-cr-${suffix}`;
  const request = await admin('/api/consultation-requests', jsonInit({
    id: requestId,
    patientId: 'pat-007',
    patientName: 'Fatima Al-Sayed',
    patientMrn: 'MRN-819336',
    patientAge: 34,
    patientGender: 'Female',
    topic: 'Security scope probe',
    preferredDate: '2026-12-01',
    details: 'Scope fixture',
    contact: 'fatima@example.test',
    urgency: 'routine',
  }));
  assert.equal(request.status, 201);

  const referralId = `test-sec-ref-${suffix}`;
  const referral = await admin('/api/referrals', jsonInit({
    id: referralId,
    patientId: 'pat-007',
    patientName: 'Fatima Al-Sayed',
    patientMrn: 'MRN-819336',
    patientAge: 34,
    patientGender: 'Female',
    specialty: 'Cardiology',
    reason: 'Scope fixture',
    priority: 'routine',
    source: 'clinician',
  }));
  assert.equal(referral.status, 201);

  const noteId = `test-sec-cn-${suffix}`;
  const note = await admin('/api/consultant-notes', jsonInit({
    id: noteId,
    patientId: 'pat-007',
    patientName: 'Fatima Al-Sayed',
    patientMrn: 'MRN-819336',
    title: 'Scope fixture',
    body: 'Scope fixture body',
    createdAt: new Date().toISOString(),
  }));
  assert.equal(note.status, 201);

  const foreignAuditId = `test-sec-audit-foreign-${suffix}`;
  const foreignAudit = await admin('/api/audit-logs', jsonInit({
    id: foreignAuditId,
    action: 'VIEW_RECORD',
    details: 'Scope fixture foreign chart',
    targetMrn: 'MRN-819336',
  }));
  assert.equal(foreignAudit.status, 201);

  const ownAuditId = `test-sec-audit-own-${suffix}`;
  const ownAudit = await admin('/api/audit-logs', jsonInit({
    id: ownAuditId,
    action: 'VIEW_RECORD',
    details: 'Scope fixture own chart',
    targetMrn: ownMrn,
  }));
  assert.equal(ownAudit.status, 201);

  // Single-chart reads.
  assert.equal((await martin('/api/patient?patientId=pat-007')).status, 404);
  assert.equal((await martin('/api/vitals?patientId=pat-007')).status, 404);
  assert.equal((await martin('/api/soap-note?appointmentId=apt-701')).status, 404);

  // Collection reads must be scoped to the prov-001 panel.
  const panel = new Set((await bootstrap(martinCookie)).patients.map(p => p.id));
  assert.ok(panel.has('pat-001'), 'the fixture must include Martin\'s own panel');

  const prescriptions = await (await martin('/api/prescriptions')).json();
  assert.ok(prescriptions.every(rx => panel.has(rx.patientId)), 'prescriptions must stay on the panel');
  assert.ok(!prescriptions.some(rx => rx.id === 'rx-701'), 'Rivera\'s prescription must not appear');

  const notes = await (await martin('/api/consultant-notes')).json();
  assert.ok(notes.every(n => panel.has(n.patientId)), 'consultant notes must stay on the panel');
  assert.ok(!notes.some(n => n.id === noteId), 'the foreign note must not appear');

  const requests = await (await martin('/api/consultation-requests')).json();
  assert.ok(requests.every(r => panel.has(r.patientId)), 'consultation requests must stay on the panel');
  assert.ok(!requests.some(r => r.id === requestId), 'the foreign request must not appear');

  const referrals = await (await martin('/api/referrals')).json();
  assert.ok(referrals.every(r => panel.has(r.patientId)), 'referrals must stay on the panel');
  assert.ok(!referrals.some(r => r.id === referralId), 'the foreign referral must not appear');

  const auditLogs = await (await martin('/api/audit-logs')).json();
  assert.ok(!auditLogs.some(l => l.id === foreignAuditId), 'another chart\'s audit row must not appear');
  assert.ok(auditLogs.some(l => l.id === ownAuditId), 'the panel\'s own audit row must remain visible');

  // The single hydration read must not smuggle the same data back.
  const hyd = await bootstrap(martinCookie);
  assert.ok(hyd.prescriptions.every(rx => panel.has(rx.patientId)));
  assert.ok(hyd.consultantNotes.every(n => panel.has(n.patientId)));
  assert.ok(hyd.consultationRequests.every(r => panel.has(r.patientId)));
  assert.ok(hyd.referrals.every(r => panel.has(r.patientId)));
  assert.ok(!hyd.auditLogs.some(l => l.id === foreignAuditId));

  // Covering clinicians and admins keep the clinic-wide read.
  const covering = asUser(coveringCookie);
  assert.equal((await covering('/api/patient?patientId=pat-007')).status, 200);
  assert.ok((await (await covering('/api/prescriptions')).json()).some(rx => rx.id === 'rx-701'));

  // Martin's own chart still works.
  assert.equal((await martin('/api/patient?patientId=pat-001')).status, 200);
  assert.equal((await martin('/api/vitals?patientId=pat-001')).status, 200);
});

test('a bound clinician cannot open, chart, close, prescribe, or note another provider\'s visit', async () => {
  const suffix = testSuffix();
  const visitId = `test-sec-apt-${suffix}`;
  await createTestVisit(visitId);

  const martin = asUser(martinCookie);
  const rivera = asUser(riveraCookie);

  const room = await martin(`/api/appointments/${visitId}/consultation`, { method: 'POST' });
  assert.equal(room.status, 404, 'another provider\'s room must look unknown');

  const soap = await martin('/api/soap-note', jsonPut({
    appointmentId: visitId,
    subjective: 'forged',
    objective: 'forged',
    assessment: 'forged',
    plan: 'forged',
    isSigned: false,
  }));
  assert.equal(soap.status, 404, 'another provider\'s visit note must be unwritable');

  const status = await martin(`/api/appointments/${visitId}/status`, jsonPatch({ status: 'cancelled' }));
  assert.equal(status.status, 404, 'another provider\'s visit must be uncloseable');

  const rxTemplate = (await bootstrap(riveraCookie)).prescriptions.find(rx => rx.patientId === 'pat-007');
  assert.ok(rxTemplate, 'Rivera must have a prescription fixture to model the write on');
  const rxId = `test-sec-rx-${suffix}`;
  const prescription = await martin('/api/prescriptions', jsonInit({
    ...rxTemplate,
    id: rxId,
    patientId: 'pat-007',
    patientName: 'Forged Patient',
    medicationName: 'Forged Medication',
    prescribingDoctor: 'Dr. Impostor',
  }));
  assert.equal(prescription.status, 404, 'another provider\'s chart must be unprescribable');

  const unknownRx = await martin('/api/prescriptions', jsonInit({
    ...rxTemplate,
    id: `test-sec-rx-unknown-${suffix}`,
    patientId: 'pat-does-not-exist',
  }));
  assert.equal(unknownRx.status, 404, 'an unknown chart must look foreign to a bound clinician');

  const noteId = `test-sec-cn-${suffix}`;
  const note = await martin('/api/consultant-notes', jsonInit({
    id: noteId,
    patientId: 'pat-007',
    patientName: 'Forged Patient',
    patientMrn: 'MRN-FORGED',
    title: 'Forged note',
    body: 'Forged note body',
    createdAt: new Date().toISOString(),
  }));
  assert.equal(note.status, 404, 'another provider\'s chart must be unnoteable');

  const unknownNote = await martin('/api/consultant-notes', jsonInit({
    id: `test-sec-cn-unknown-${suffix}`,
    patientId: 'pat-does-not-exist',
    title: 'Unknown chart',
    body: 'Unknown chart body',
  }));
  assert.equal(unknownNote.status, 404, 'an unknown chart must look foreign to a bound clinician');

  // The booked provider still owns the visit and can work it.
  assert.equal((await rivera(`/api/appointments/${visitId}/consultation`, { method: 'POST' })).status, 200);
  assert.equal((await rivera('/api/soap-note', jsonPut({
    appointmentId: visitId,
    subjective: 'own',
    objective: 'own',
    assessment: 'own',
    plan: 'own',
    isSigned: false,
  }))).status, 200);
  assert.equal((await rivera(`/api/appointments/${visitId}/status`, jsonPatch({ status: 'cancelled' }))).status, 200);
});

test('a claimed shared waiting-room visit joins the claiming clinician\'s schedule', async () => {
  const suffix = testSuffix();
  const visitId = `test-sec-apt-claim-${suffix}`;
  await createTestVisit(visitId);

  const admin = asUser(adminCookie);
  const martin = asUser(martinCookie);
  const checkin = await admin(`/api/appointments/${visitId}/status`, jsonPatch({ status: 'in-progress' }));
  assert.equal(checkin.status, 200, 'the booked visit must be checked in before it enters the queue');

  const claim = await martin(`/api/waiting-room/${visitId}/claim`, { method: 'POST' });
  assert.equal(claim.status, 200, 'any clinician may claim a checked-in patient');

  const list = await (await martin('/api/appointments')).json();
  assert.ok(list.some(a => a.id === visitId), 'the claimed visit must appear in the claiming clinician\'s schedule');

  const hydrated = await bootstrap(martinCookie);
  assert.ok(hydrated.appointments.some(a => a.id === visitId), 'the claimed visit must hydrate in bootstrap');

  const room = await martin(`/api/appointments/${visitId}/consultation`, { method: 'POST' });
  assert.equal(room.status, 200, 'the claimant may open the room they picked up');
});

test('follow-up scoping is keyed on chart identity, not just a shared display name', async () => {
  const suffix = testSuffix();
  const martinFixture = `000-test-sec-fu-martin-${suffix}`;
  const priyaFixture = `000-test-sec-fu-priya-${suffix}`;
  const insertFollowUp = (id, patientName, patientInitials, patientId) => query(
    `INSERT INTO follow_ups
      (id, patient_id, code, title, status, created_date, description,
       created_by_name, created_by_email, created_by_initials, created_by_current,
       practitioner_name, practitioner_email, practitioner_initials, practitioner_current, practitioner_group,
       patient_name, patient_email, patient_initials)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, patientId, '#SEC-000', 'Same-name foreign fixture', 'Active', '2026-01-01', 'Scope fixture',
      'Impostor', 'impostor@example.test', 'IM', 0,
      'Impostor', 'impostor@example.test', 'IM', 0, 'Security',
      patientName, 'impostor@example.test', patientInitials,
    ],
  );

  // The display names are deliberately those of Martin's and Priya's charts,
  // but the chart ids belong to someone else.
  await insertFollowUp(martinFixture, 'Ahmed Benali', 'AB', 'pat-004');
  await insertFollowUp(priyaFixture, 'Priya Nair', 'PN', 'pat-001');
  try {
    const martinData = await bootstrap(martinCookie);
    assert.ok(
      !martinData.followUps.some(f => f.id === martinFixture),
      'a same-name foreign follow-up must not enter the staff bootstrap',
    );

    const single = await (await asUser(martinCookie)('/api/follow-up')).json();
    assert.notEqual(single?.id, martinFixture, 'the single-chart endpoint must not return the foreign row');

    const priyaData = await bootstrap(priyaCookie);
    assert.notEqual(priyaData.followUp?.id, priyaFixture, 'a patient must not receive a same-name foreign follow-up');
  } finally {
    await query('DELETE FROM follow_ups WHERE id IN (?, ?)', [martinFixture, priyaFixture]);
  }
});

test('clinical identity and visit status are stamped by the server, not the body', async () => {
  const suffix = testSuffix();
  const priya = asUser(priyaCookie);
  const martin = asUser(martinCookie);
  const rivera = asUser(riveraCookie);
  const priyaData = await bootstrap(priyaCookie);
  const provider = priyaData.providers.find(p => p.id === 'prov-002');
  assert.ok(provider, 'seed data must contain prov-002');
  const template = priyaData.appointments.find(a => a.patientId === 'pat-004');
  assert.ok(template, 'the patient must have a visit to model the booking on');
  const start = Date.now() + 61 * 24 * 60 * 60_000;

  const spoofed = {
    ...template,
    patientId: 'pat-004',
    patientName: 'IMPOSTOR PATIENT',
    patientMrn: 'MRN-IMPOSTOR',
    patientAge: 99,
    patientGender: 'Male',
    providerId: 'prov-002',
    providerName: 'IMPOSTOR DOCTOR',
    providerTitle: 'Fake Title',
    providerSpecialty: 'Fake Specialty',
    providerAvatar: '',
  };

  // A new visit may only enter the schedule as `scheduled`; check-in is a
  // separate, state-machine-guarded action.
  for (const [index, status] of ['in-progress', 'completed', 'cancelled'].entries()) {
    const refusedId = `test-sec-apt-${status}-${suffix}`;
    const refused = await priya('/api/appointments', jsonInit({
      ...spoofed,
      id: refusedId,
      status,
      scheduledStart: new Date(start + index * 30 * 60_000).toISOString(),
      roomCode: `MED-ZONE-SECURITY${status.replace('-', '').toUpperCase()}`,
      encryptedSessionKey: 'probe-key',
    }));
    assert.equal(refused.status, 400, `a patient cannot create a ${status} visit`);
    const [refusedRow] = await query('SELECT id FROM appointments WHERE id = ?', [refusedId]);
    assert.equal(refusedRow, undefined, `the rejected ${status} visit must not be stored`);
  }

  const goodId = `test-sec-apt-stamp-${suffix}`;
  const booking = await priya('/api/appointments', jsonInit({
    ...spoofed,
    id: goodId,
    status: 'scheduled',
    scheduledStart: new Date(start + 2 * 60 * 60_000).toISOString(),
    roomCode: 'MED-ZONE-SECURITYSTAMP',
    encryptedSessionKey: 'probe-key',
  }));
  assert.equal(booking.status, 201);
  const stampedVisit = await booking.json();
  assert.equal(stampedVisit.patientName, priyaData.patient.name, 'patient name comes from the chart');
  assert.equal(stampedVisit.patientMrn, priyaData.patient.mrn, 'MRN comes from the chart');
  assert.equal(stampedVisit.patientAge, priyaData.patient.age);
  assert.equal(stampedVisit.patientGender, priyaData.patient.gender);
  assert.equal(stampedVisit.providerName, provider.name, 'provider identity comes from the directory');
  assert.equal(stampedVisit.providerTitle, provider.title);
  assert.equal(stampedVisit.providerSpecialty, provider.specialty);
  assert.equal(stampedVisit.status, 'scheduled');

  const [visitRow] = await query(
    `SELECT patient_name, patient_mrn, patient_age, patient_gender,
            provider_name, provider_title, provider_specialty, provider_avatar, status
       FROM appointments WHERE id = ?`,
    [goodId],
  );
  assert.ok(visitRow, 'the stamped visit must be persisted');
  assert.equal(visitRow.patient_name, priyaData.patient.name);
  assert.equal(visitRow.patient_mrn, priyaData.patient.mrn);
  assert.equal(visitRow.patient_age, priyaData.patient.age);
  assert.equal(visitRow.patient_gender, priyaData.patient.gender);
  assert.equal(visitRow.provider_name, provider.name);
  assert.equal(visitRow.provider_title, provider.title);
  assert.equal(visitRow.provider_specialty, provider.specialty);
  assert.equal(visitRow.provider_avatar, provider.avatarUrl || '');
  assert.equal(visitRow.status, 'scheduled');

  const riveraData = await bootstrap(riveraCookie);
  const ownChart = riveraData.patients.find(p => p.id === 'pat-007');
  const rxTemplate = riveraData.prescriptions.find(rx => rx.patientId === 'pat-007');
  assert.ok(ownChart && rxTemplate, 'Rivera must have the chart and medication fixture');
  const rxId = `test-sec-rx-stamp-${suffix}`;
  const prescription = await rivera('/api/prescriptions', jsonInit({
    ...rxTemplate,
    id: rxId,
    patientId: 'pat-007',
    patientName: 'IMPOSTOR PATIENT',
    medicationName: 'Stamped Medication',
    prescribingDoctor: 'Dr. Impostor',
    prescribedDate: '1999-01-01',
  }));
  assert.equal(prescription.status, 201);
  const stampedRx = await prescription.json();
  assert.equal(stampedRx.patientName, ownChart.name, 'the medication is filed against the chart');
  assert.equal(stampedRx.prescribingDoctor, 'Dr. Marcus Rivera, MD', 'the prescriber is the session');
  assert.equal(stampedRx.prescribedDate, new Date().toISOString().slice(0, 10));

  const [rxRow] = await query(
    'SELECT patient_name, prescribing_doctor, prescribed_date FROM prescriptions WHERE id = ?',
    [rxId],
  );
  assert.ok(rxRow, 'the stamped prescription must be persisted');
  assert.equal(rxRow.patient_name, ownChart.name);
  assert.equal(rxRow.prescribing_doctor, 'Dr. Marcus Rivera, MD');
  assert.equal(String(rxRow.prescribed_date).slice(0, 10), new Date().toISOString().slice(0, 10));

  const martinData = await bootstrap(martinCookie);
  const martinChart = martinData.patients.find(p => p.id === 'pat-001');
  assert.ok(martinChart, 'Martin must have his own panel chart');
  const noteId = `test-sec-cn-stamp-${suffix}`;
  const note = await martin('/api/consultant-notes', jsonInit({
    id: noteId,
    patientId: 'pat-001',
    patientName: 'IMPOSTOR PATIENT',
    patientMrn: 'MRN-IMPOSTOR',
    title: 'Stamped note',
    body: 'Stamped note body',
    createdAt: '1999-01-01T00:00:00.000Z',
  }));
  assert.equal(note.status, 201);
  const stampedNote = await note.json();
  assert.equal(stampedNote.patientName, martinChart.name);
  assert.equal(stampedNote.patientMrn, martinChart.mrn);
  assert.equal(stampedNote.authorName, 'Dr. Sophie Martin', 'the note author is the session');
  assert.equal(stampedNote.authorRole, 'clinician');
  assert.ok(
    Date.parse(stampedNote.createdAt) > Date.now() - 60_000,
    'the note timestamp is server-stamped, not backdated by the body',
  );

  const [noteRow] = await query(
    `SELECT patient_name, patient_mrn, author_name, author_role, created_at
       FROM consultant_notes WHERE id = ?`,
    [noteId],
  );
  assert.ok(noteRow, 'the stamped note must be persisted');
  assert.equal(noteRow.patient_name, martinChart.name);
  assert.equal(noteRow.patient_mrn, martinChart.mrn);
  assert.equal(noteRow.author_name, 'Dr. Sophie Martin');
  assert.equal(noteRow.author_role, 'clinician');
  assert.ok(Date.parse(noteRow.created_at) > Date.now() - 60_000, 'the stored note timestamp is server-stamped');

  const requestId = `test-sec-cr-stamp-${suffix}`;
  const request = await priya('/api/consultation-requests', jsonInit({
    id: requestId,
    patientId: 'pat-004',
    patientName: 'IMPOSTOR PATIENT',
    patientMrn: 'MRN-IMPOSTOR',
    patientAge: 99,
    patientGender: 'Male',
    topic: 'Stamped request',
    preferredDate: '2026-12-02',
    details: 'Stamped request details',
    contact: 'priya@example.test',
    urgency: 'routine',
  }));
  assert.equal(request.status, 201);
  const stampedRequest = await request.json();
  assert.equal(stampedRequest.patientName, priyaData.patient.name);
  assert.equal(stampedRequest.patientMrn, priyaData.patient.mrn);
  assert.equal(stampedRequest.patientAge, priyaData.patient.age);
  assert.equal(stampedRequest.patientGender, priyaData.patient.gender);
  assert.equal(stampedRequest.status, 'pending', 'a patient cannot self-triage a new request');
  const [requestRow] = await query(
    `SELECT patient_name, patient_mrn, patient_age, patient_gender, status
       FROM consultation_requests WHERE id = ?`,
    [requestId],
  );
  assert.ok(requestRow, 'the stamped request must be persisted');
  assert.equal(requestRow.patient_name, priyaData.patient.name);
  assert.equal(requestRow.patient_mrn, priyaData.patient.mrn);
  assert.equal(requestRow.patient_age, priyaData.patient.age);
  assert.equal(requestRow.patient_gender, priyaData.patient.gender);
  assert.equal(requestRow.status, 'pending');

  const referralId = `test-sec-ref-stamp-${suffix}`;
  const referral = await priya('/api/referrals', jsonInit({
    id: referralId,
    patientId: 'pat-004',
    patientName: 'IMPOSTOR PATIENT',
    patientMrn: 'MRN-IMPOSTOR',
    patientAge: 99,
    patientGender: 'Male',
    specialty: 'Dermatology',
    reason: 'Stamped referral',
    priority: 'routine',
    source: 'patient',
  }));
  assert.equal(referral.status, 201);
  const stampedReferral = await referral.json();
  assert.equal(stampedReferral.patientName, priyaData.patient.name);
  assert.equal(stampedReferral.patientMrn, priyaData.patient.mrn);
  assert.equal(stampedReferral.patientAge, priyaData.patient.age);
  assert.equal(stampedReferral.patientGender, priyaData.patient.gender);
  assert.equal(stampedReferral.status, 'pending', 'a patient cannot self-approve a new referral');
  const [referralRow] = await query(
    `SELECT patient_name, patient_mrn, patient_age, patient_gender, status
       FROM referrals WHERE id = ?`,
    [referralId],
  );
  assert.ok(referralRow, 'the stamped referral must be persisted');
  assert.equal(referralRow.patient_name, priyaData.patient.name);
  assert.equal(referralRow.patient_mrn, priyaData.patient.mrn);
  assert.equal(referralRow.patient_age, priyaData.patient.age);
  assert.equal(referralRow.patient_gender, priyaData.patient.gender);
  assert.equal(referralRow.status, 'pending');
});

test('unsafe requests from a same-site origin on another port are refused', async () => {
  const sameSite = await fetch(`${base}/api/logout`, {
    method: 'POST',
    headers: {
      Origin: 'http://127.0.0.1:9999',
      'Sec-Fetch-Site': 'same-site',
    },
  });
  assert.equal(sameSite.status, 403, 'same-site is not same-origin; the port must matter');

  // A client that omits Sec-Fetch-Site must still be checked by Origin, and
  // the port is part of the origin.
  const portOnly = await fetch(`${base}/api/logout`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:9999' },
  });
  assert.equal(portOnly.status, 403, 'the Origin fallback must compare the port too');

  const wrongScheme = await fetch(`${base}/api/logout`, {
    method: 'POST',
    headers: { Origin: base.replace('http://', 'https://') },
  });
  assert.equal(wrongScheme.status, 403, 'the Origin fallback must compare the scheme too');

  const crossSite = await fetch(`${base}/api/logout`, {
    method: 'POST',
    headers: {
      Origin: 'http://attacker.example',
      'Sec-Fetch-Site': 'cross-site',
    },
  });
  assert.equal(crossSite.status, 403);

  const sameOrigin = await fetch(`${base}/api/logout`, {
    method: 'POST',
    headers: {
      Origin: base,
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  assert.equal(sameOrigin.status, 200, 'the app itself must still be able to sign out');

  // nginx terminates the browser connection on :3000 and forwards the public
  // authority; the API must compare against that, not the internal socket.
  const proxied = await fetch(`${base}/api/logout`, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:3000',
      'X-Forwarded-Host': 'localhost:3000',
      'X-Forwarded-Proto': 'http',
    },
  });
  assert.equal(proxied.status, 200, 'a proxy preserving the browser authority must pass');
});
