/**
 * Server mapper contract tests: PHI columns are AES-256-GCM ciphertext at
 * rest and decrypt back to the exact client-facing shapes the React app
 * consumes (consultant notes, follow-ups, SOAP narrative).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import {
  consultantNoteColumns,
  followUpColumns,
  mapConsultantNote,
  mapFollowUp,
  mapSoapNote,
  mapUserRow,
  overlayPatientAvatars,
} from '../server/mappers.js';
import { encryptField } from '../server/crypto.js';

test('user rows expose the registration avatar without leaking credentials', () => {
  const mapped = mapUserRow({
    id: 7,
    username: 'avatar.user',
    display_name: 'Avatar User',
    modules: '["dashboard"]',
    is_admin: 0,
    role: 'patient',
    patient_id: 'pat-001',
    provider_id: null,
    avatar_url: 'data:image/jpeg;base64,AAAA',
    token_version: 0,
    created_at: '2026-01-02T03:04:05.000Z',
  });

  assert.equal(mapped.avatarUrl, 'data:image/jpeg;base64,AAAA');
  assert.equal(mapped.displayName, 'Avatar User');
  assert.equal('password_hash' in mapped, false);
});

test('a linked patient account avatar replaces the chart photo for reports', () => {
  const patients = [
    { id: 'pat-001', name: 'James', avatarUrl: 'chart-photo.jpg' },
    { id: 'pat-002', name: 'No Account', avatarUrl: 'chart-photo-2.jpg' },
  ];
  const rows = [
    { patient_id: 'pat-001', avatar_url: 'data:image/jpeg;base64,ACCOUNT' },
    { patient_id: 'pat-001', avatar_url: 'data:image/jpeg;base64,LATER' },
  ];

  const mapped = overlayPatientAvatars(patients, rows);
  assert.equal(mapped[0].avatarUrl, 'data:image/jpeg;base64,ACCOUNT');
  assert.equal(mapped[1].avatarUrl, 'chart-photo-2.jpg');
  assert.equal(patients[0].avatarUrl, 'chart-photo.jpg', 'input rows must stay untouched');
});

test('consultant note title/body are encrypted at rest and round-trip exactly', () => {
  const note = {
    id: 'test-cn-roundtrip',
    patientId: 'pat-001',
    patientName: 'Round Trip',
    patientMrn: 'MRN-RT',
    authorName: 'Dr Tester',
    authorRole: 'clinician',
    title: 'Sensitive title with "quotes" and (parens)',
    body: 'Line one.\nLine two — with unicode.',
    createdAt: '2026-02-03T04:05:06.000Z',
  };

  const columns = consultantNoteColumns(note);
  assert.notEqual(columns.title, note.title, 'title must not be stored as plaintext');
  assert.notEqual(columns.body, note.body, 'body must not be stored as plaintext');
  assert.ok(String(columns.title).startsWith('v1:'), 'ciphertext must use the self-describing v1 format');
  assert.ok(String(columns.body).startsWith('v1:'));

  const mapped = mapConsultantNote(columns);
  assert.deepEqual(mapped, note);
});

test('consultant note authorRole is normalised to patient|clinician', () => {
  const columns = consultantNoteColumns({
    id: 'x', patientId: 'p', patientName: 'N', patientMrn: 'M',
    authorName: 'A', authorRole: 'admin', title: 'T', body: 'B',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(columns.author_role, 'clinician');
  assert.equal(mapConsultantNote(columns).authorRole, 'clinician');
});

test('follow-up record columns round-trip into the FollowUpDetail shape', () => {
  const followUp = {
    id: 'fu-1',
    code: '#CC-2026-1',
    title: 'Quarterly renewal',
    status: 'Active',
    createdDate: 'March 20, 2026',
    description: 'Renew hypertension treatment.',
    createdBy: { name: 'Sophie Martin', email: 'dr@med.zone', initials: 'SM', isCurrentUser: true },
    practitioner: { name: 'Sophie Martin', email: 'dr@med.zone', initials: 'SM', isCurrentUser: true, group: 'General Medicine' },
    patient: { name: 'Jane Doe', email: 'jane@example.com', initials: 'JD' },
  };

  const columns = followUpColumns(followUp);
  assert.equal(columns.created_by_current, 1, 'booleans persist as 0/1 flags');
  assert.deepEqual(mapFollowUp(columns), followUp);
});

test('SOAP narrative is decrypted in-process from ciphertext columns', () => {
  const row = {
    id: 'soap-1',
    appointment_id: 'apt-1',
    subjective: encryptField('Patient reports headaches.'),
    objective: alertSafeRow(),
    assessment: encryptField('Essential hypertension.'),
    plan: encryptField('Continue Lisinopril.'),
    last_updated: '10:42:00',
    signed_by: 'Dr Tester',
    is_signed: 1,
  };

  assert.ok(String(row.subjective).startsWith('v1:'));
  const mapped = mapSoapNote(row);
  assert.equal(mapped.subjective, 'Patient reports headaches.');
  assert.equal(mapped.objective, 'Alert and oriented.');
  assert.equal(mapped.assessment, 'Essential hypertension.');
  assert.equal(mapped.plan, 'Continue Lisinopril.');
  assert.equal(mapped.signedBy, 'Dr Tester');
  assert.equal(mapped.isSigned, true);
});

function alertSafeRow() {
  return encryptField('Alert and oriented.');
}
