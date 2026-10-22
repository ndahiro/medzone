/**
 * Two-sided tele-visit walkthrough (manual/dev tool).
 *
 * Boots the real Express app against the dev MySQL database and drives the
 * same HTTP contract the browser client uses:
 *
 *   patient (Priya Nair, pat-004)          clinician (Dr. Rivera, prov-002)
 *   ------------------------------         ---------------------------------
 *   books a visit with Dr. Rivera
 *   checks in  -> waiting room
 *                                          sees her in the shared queue
 *                                          admits the room (pairs)
 *   admits the room (pairs)
 *   sends an encrypted message             sends an encrypted message
 *   decrypts both messages                 decrypts both messages
 *                                          writes the visit SOAP note
 *                                          files a shared care note
 *                                          issues a prescription
 *   reads care note + prescription
 *   loads the portal and writes the patient-summary PDF
 *
 * The PDF is written to artifacts/patient-summary-<MRN>.pdf from the patient
 * session's own bootstrap payload, so the paired prescription is in the
 * download. Then it asserts that every artifact is bound to Priya's chart and absent
 * from another patient's chart (patient.fatima, pat-007). All rows created by
 * the walkthrough are deleted at the end.
 *
 * The visit is booked inside the 15-minute join window because the patient
 * enters the room below, and admission is window-gated for patients.
 *
 * Run:  npm run walkthrough
 *       (node --import tsx scripts/walkthrough-pairing.mjs — tsx is needed to
 *       import the browser crypto module the transcript round-trip uses)
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import app from '../server/app.js';
import { closePool, query } from '../server/db.js';
import { buildPdf, patientSummaryPdfDocument } from '../src/lib/pdf.ts';

let server;
let base;

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

const login = async (username, password) => {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 200) throw new Error(`${username} could not sign in (${response.status})`);
  const raw = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  return raw.split(';')[0];
};

const asUser = cookie => (path, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });

const jsonInit = body => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const patchInit = body => ({
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const step = (label, detail = '') => {
  console.log(`\n▶ ${label}${detail ? `\n  ${detail}` : ''}`);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};

const created = { appointmentId: null, prescriptionId: null, consultantNoteId: null, soapAppointmentIds: [] };

const cleanup = async () => {
  if (created.appointmentId) {
    await query('DELETE FROM chat_messages WHERE appointment_id = ?', [created.appointmentId]);
    await query('DELETE FROM soap_notes WHERE appointment_id = ?', [created.appointmentId]);
    await query('DELETE FROM visit_attachments WHERE appointment_id = ?', [created.appointmentId]);
    await query('DELETE FROM room_signals WHERE appointment_id = ?', [created.appointmentId]);
    await query('DELETE FROM appointments WHERE id = ?', [created.appointmentId]);
  }
  if (created.prescriptionId) {
    await query('DELETE FROM prescriptions WHERE id = ?', [created.prescriptionId]);
  }
  if (created.consultantNoteId) {
    await query('DELETE FROM consultant_notes WHERE id = ?', [created.consultantNoteId]);
  }
};

try {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  step('Sign in', 'patient.priya (Priya Nair, pat-004) and clinician.rivera (Dr. Marcus Rivera, prov-002)');
  const patient = asUser(await login('patient.priya', 'Patient123'));
  const clinician = asUser(await login('clinician.rivera', 'Clinician123'));
  const otherPatient = asUser(await login('patient.fatima', 'Patient123'));

  const patientBootstrap = await (await patient('/api/bootstrap')).json();
  assert(patientBootstrap.patient.id === 'pat-004', 'patient.priya must hydrate pat-004');
  const template = patientBootstrap.appointments[0];
  assert(template, 'pat-004 needs a seeded visit to model the booking on');

  step('Patient books a visit with the on-duty clinician', 'POST /api/appointments as the patient');
  const appointmentId = `walk-apt-${suffix()}`;
  // The visit starts inside the join window (15 minutes) because the patient
  // enters the room below, and the server refuses early entry.
  const bookingBase = Date.now() + 8 * 60_000;
  let booking;
  let booked;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    booking = {
      ...template,
      id: appointmentId,
      status: 'scheduled',
      scheduledStart: new Date(bookingBase + attempt * 61_000).toISOString(),
      reasonForVisit: 'Walkthrough: cough and home BP review.',
      roomCode: `MED-ZONE-W${suffix().replace(/\D/g, '').slice(-8)}`,
      encryptedSessionKey: `ENC-KEY-WALK-${suffix().slice(-8)}-AES256`,
    };
    booked = await patient('/api/appointments', jsonInit(booking));
    if (booked.status === 201) break;
    assert(booked.status === 409, `booking must be created (got ${booked.status}: ${await booked.text()})`);
  }
  assert(booked.status === 201, `booking must be created (got ${booked.status}: ${await booked.text()})`);
  created.appointmentId = appointmentId;
  console.log(`  ✅ visit ${appointmentId} booked for ${template.patientName}`);

  step('Patient checks in', 'PATCH /api/appointments/:id/status -> in-progress');
  const checkedIn = await patient(`/api/appointments/${appointmentId}/status`, patchInit({ status: 'in-progress' }));
  assert(checkedIn.status === 200, `check-in must succeed (got ${checkedIn.status})`);
  console.log(`  ✅ status is now ${(await checkedIn.json()).status}`);

  step('On-duty clinician sees her in the shared waiting room', 'GET /api/waiting-room + GET /api/bootstrap as Dr. Rivera');
  const queue = await (await clinician('/api/waiting-room')).json();
  assert(queue.some(a => a.id === appointmentId), 'the checked-in visit must appear in the waiting room');
  const clinicianBootstrap = await (await clinician('/api/bootstrap')).json();
  assert(
    clinicianBootstrap.appointments.some(a => a.id === appointmentId),
    'the visit must appear on the bound clinician\'s schedule',
  );
  assert(
    clinicianBootstrap.patients.some(p => p.id === 'pat-004'),
    'Priya must be in the bound clinician\'s patient directory',
  );
  console.log(`  ✅ waiting room, schedule and chart picker all contain ${appointmentId} / Priya Nair`);

  step('Both sides pair in the same room', 'POST /api/appointments/:id/consultation for each participant');
  const patientAdmitted = await patient(`/api/appointments/${appointmentId}/consultation`, { method: 'POST' });
  assert(patientAdmitted.status === 200, `patient admission must succeed (got ${patientAdmitted.status})`);
  const clinicianAdmitted = await clinician(`/api/appointments/${appointmentId}/consultation`, { method: 'POST' });
  assert(clinicianAdmitted.status === 200, `clinician admission must succeed (got ${clinicianAdmitted.status})`);
  const room = await clinicianAdmitted.json();
  console.log(`  ✅ both sessions hold room ${room.roomCode} on ${room.patientName}'s chart (status ${room.status})`);

  step('Both sides send messages into the visit transcript', 'POST /api/appointments/:id/messages; the API encrypts at rest');
  // The body is plaintext over TLS: the API encrypts it with the deployment PHI
  // key before MySQL sees it, so no browser ever holds a transcript key. The
  // body's senderRole/senderName are impersonation attempts on purpose.
  const patientPlain = 'Priya: the dry cough is worse at night.';
  const clinicianPlain = 'Dr. Rivera: start the antihistamine tonight; review in one week if it persists.';
  const patientMsg = await patient(`/api/appointments/${appointmentId}/messages`, jsonInit({
    id: `walk-msg-p-${suffix()}`,
    senderRole: 'patient',
    senderName: 'Impersonated Name',
    text: patientPlain,
  }));
  assert(patientMsg.status === 201, `patient message must be stored (got ${patientMsg.status})`);
  const clinicianMsg = await clinician(`/api/appointments/${appointmentId}/messages`, jsonInit({
    id: `walk-msg-c-${suffix()}`,
    senderRole: 'clinician',
    senderName: 'Impersonated Name',
    text: clinicianPlain,
  }));
  assert(clinicianMsg.status === 201, `clinician message must be stored (got ${clinicianMsg.status})`);

  const patientView = await (await patient(`/api/appointments/${appointmentId}/messages`)).json();
  const clinicianView = await (await clinician(`/api/appointments/${appointmentId}/messages`)).json();
  assert(patientView.length === 2, `patient must see both messages (got ${patientView.length})`);
  assert(clinicianView.length === 2, `clinician must see both messages (got ${clinicianView.length})`);
  assert(
    new Set([...patientView, ...clinicianView].map(m => m.senderRole)).size === 2,
    'transcript must carry one patient note and one clinician note',
  );

  // Each participant reads the transcript back as plaintext: the server
  // decrypts for the caller it has authorised.
  const patientTexts = patientView.map(m => m.text);
  const clinicianTexts = clinicianView.map(m => m.text);
  assert(
    patientTexts.includes(patientPlain) && patientTexts.includes(clinicianPlain),
    'the patient session must read both notes',
  );
  assert(
    clinicianTexts.includes(patientPlain) && clinicianTexts.includes(clinicianPlain),
    'the clinician session must read both notes',
  );

  // At rest the transcript is the server-encrypted envelope, never the text.
  const storedMessages = await query(
    'SELECT cipher_text FROM chat_messages WHERE appointment_id = ? ORDER BY sent_at',
    [appointmentId],
  );
  assert(
    storedMessages.length === 2 && storedMessages.every(row => String(row.cipher_text).startsWith('v1:')),
    'the transcript rows must hold the AES-256-GCM envelope',
  );
  assert(
    storedMessages.every(row => !String(row.cipher_text).includes('antihistamine')),
    'the transcript must never store plaintext',
  );

  const stranger = await otherPatient(`/api/appointments/${appointmentId}/messages`);
  assert(stranger.status === 403, `a third patient must not read the transcript (got ${stranger.status})`);
  console.log('  ✅ both sessions read both notes (encrypted at rest); patient.fatima is refused (403)');

  step('Clinician writes the visit note', 'PUT /api/soap-note with appointmentId');
  const soapMarker = `walkthrough-soap-${suffix()}`;
  const visitNote = {
    subjective: `Priya reports a dry cough. ${soapMarker}`,
    objective: 'Home BP 128/84, HR 74, SpO2 98%. No distress.',
    assessment: 'Viral upper-respiratory illness; hypertension stable.',
    plan: 'Rest, fluids, review in one week if not improving.',
    lastUpdated: new Date().toLocaleTimeString(),
    isSigned: false,
  };
  const savedNote = await clinician('/api/soap-note', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...visitNote, appointmentId }),
  });
  assert(savedNote.status === 200, `SOAP save must succeed (got ${savedNote.status})`);
  created.soapAppointmentIds.push(appointmentId);

  const readBack = await (await clinician(`/api/soap-note?appointmentId=${encodeURIComponent(appointmentId)}`)).json();
  assert(readBack.subjective.includes(soapMarker), 'the visit note must read back on its own appointment');
  const otherVisitNote = await clinician('/api/soap-note?appointmentId=apt-701');
  const otherVisitNoteJson = otherVisitNote.status === 200 ? await otherVisitNote.json() : null;
  assert(
    !otherVisitNoteJson || !otherVisitNoteJson.subjective?.includes(soapMarker),
    'the note must not appear on another patient\'s visit (apt-701, Fatima)',
  );
  console.log('  ✅ note is keyed to this visit; apt-701 (Fatima) does not carry it');

  step('Clinician files a shared care note for the patient', 'POST /api/consultant-notes');
  const noteMarker = `walkthrough-care-note-${suffix()}`;
  const noteResponse = await clinician('/api/consultant-notes', jsonInit({
    id: `walk-cn-${suffix()}`,
    patientId: 'pat-004',
    patientName: 'Priya Nair',
    patientMrn: patientBootstrap.patient.mrn,
    title: `Visit summary ${noteMarker}`,
    body: 'Discussed cough care and blood-pressure logging. Follow up in one week if symptoms persist.',
    createdAt: new Date().toISOString(),
  }));
  assert(noteResponse.status === 201, `care note must be stored (got ${noteResponse.status})`);
  created.consultantNoteId = (await noteResponse.json()).id;

  const priyaAfterNote = await (await patient('/api/bootstrap')).json();
  const fatimaAfterNote = await (await otherPatient('/api/bootstrap')).json();
  assert(
    priyaAfterNote.consultantNotes.some(n => n.title.includes(noteMarker)),
    'Priya must see the care note on her chart',
  );
  assert(
    !fatimaAfterNote.consultantNotes.some(n => n.title.includes(noteMarker)),
    'the care note must not leak into Fatima\'s chart',
  );
  console.log('  ✅ care note visible on Priya\'s portal only');

  step('Clinician prescribes a medication for the patient', 'POST /api/prescriptions');
  const rxMarker = `walkthrough-rx-${suffix()}`;
  const rxTemplate = patientBootstrap.prescriptions[0];
  assert(rxTemplate, 'pat-004 needs a seeded prescription to model the new one on');
  const newRx = {
    ...rxTemplate,
    id: `walk-rx-${suffix()}`,
    patientId: 'pat-004',
    patientName: 'Priya Nair',
    medicationName: `Cetirizine 10mg ${rxMarker}`,
    dosage: '10mg',
    instructions: 'Take one tablet daily at bedtime while symptoms persist.',
    prescribedDate: new Date().toISOString().split('T')[0],
    status: 'active',
  };
  const rxResponse = await clinician('/api/prescriptions', jsonInit(newRx));
  assert(rxResponse.status === 201, `prescription must be stored (got ${rxResponse.status})`);
  created.prescriptionId = newRx.id;

  const priyaAfterRx = await (await patient('/api/bootstrap')).json();
  const fatimaAfterRx = await (await otherPatient('/api/bootstrap')).json();
  assert(
    priyaAfterRx.prescriptions.some(rx => rx.medicationName.includes(rxMarker)),
    'Priya must see the new prescription on her chart',
  );
  assert(
    !fatimaAfterRx.prescriptions.some(rx => rx.medicationName.includes(rxMarker)),
    'the prescription must not leak into Fatima\'s chart',
  );
  console.log('  ✅ prescription visible on Priya\'s chart only');

  step('Patient loads the portal and downloads a PDF summary', 'GET /api/bootstrap as the patient + buildPdf');
  // The patient session receives only its own chart; the PDF is built from
  // exactly that payload, including the prescription the clinician just
  // issued. This is the same document the portal's "PDF" action emits.
  const portal = await (await patient('/api/bootstrap')).json();
  assert(portal.patient.id === 'pat-004', 'the portal payload must be Priya\'s chart');
  assert(
    portal.prescriptions.some(rx => rx.medicationName.includes(rxMarker)),
    'the new prescription must be present in the patient portal payload',
  );
  const pdfBytes = buildPdf(
    patientSummaryPdfDocument({
      patient: portal.patient,
      prescriptions: portal.prescriptions,
      appointments: portal.appointments,
    }),
  );
  const pdfText = Buffer.from(pdfBytes).toString('latin1').replace(/\r?\n/g, ' ');
  assert(pdfText.startsWith('%PDF-1.4'), 'the download must be a real PDF');
  assert(pdfText.includes('Patient Health Summary'), 'the PDF must be the patient summary');
  assert(pdfText.includes(portal.patient.name), 'the PDF must name the patient');
  assert(pdfText.includes(portal.patient.mrn), 'the PDF must carry the MRN');
  assert(pdfText.includes(rxMarker), 'the PDF must include the paired prescription');
  const artifactPath = path.resolve('artifacts', `patient-summary-${portal.patient.mrn}.pdf`);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, pdfBytes);
  console.log(
    `  ✅ ${portal.prescriptions.length} prescription(s) loaded; PDF saved to ${artifactPath} (${pdfBytes.length} bytes)`,
  );

  step('Visit is wrapped up', 'PATCH /api/appointments/:id/status -> completed');
  const completed = await clinician(`/api/appointments/${appointmentId}/status`, patchInit({ status: 'completed' }));
  assert(completed.status === 200, `completion must succeed (got ${completed.status})`);
  const priyaFinal = await (await patient('/api/bootstrap')).json();
  const finalVisit = priyaFinal.appointments.find(a => a.id === appointmentId);
  assert(finalVisit?.status === 'completed', 'the patient must see the completed visit');
  console.log('  ✅ both sides now read the visit as completed');

  console.log('\n🏁 Walkthrough complete: patient and clinician paired on one visit, exchanged notes, and every artifact stayed on Priya Nair\'s chart.');
} catch (error) {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  await new Promise(resolve => server.close(resolve));
  await closePool();
}
