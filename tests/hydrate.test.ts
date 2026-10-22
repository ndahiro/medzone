/**
 * Hydration contract: GET /api/bootstrap is the single source of truth for
 * the client store. Every entity is replaced by the server's data — empty
 * collections included — and no mock/seed value can survive hydration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFromBootstrap } from '../src/lib/hydrate';
import { EMPTY_PATIENT, EMPTY_SOAP_NOTES } from '../src/data/defaults';
import type { BootstrapPayload } from '../src/lib/api';
import type {
  Appointment,
  ChatMessage,
  ConsultantNote,
  FollowUpDetail,
  ProviderProfile,
} from '../src/types';

const payload = (overrides: Partial<BootstrapPayload> = {}): BootstrapPayload => ({
  patient: null,
  patients: [],
  providers: [],
  appointments: [],
  prescriptions: [],
  auditLogs: [],
  notifications: [],
  followUp: null,
  followUps: [],
  soapNotes: null,
  chatMessages: [],
  consultantNotes: [],
  consultationRequests: [],
  referrals: [],
  ...overrides,
});

test('empty server collections replace local state outright (no merge, no seeds)', () => {
  const snapshot = snapshotFromBootstrap(payload());
  assert.deepEqual(snapshot.providers, []);
  assert.deepEqual(snapshot.appointments, []);
  assert.deepEqual(snapshot.prescriptions, []);
  assert.deepEqual(snapshot.auditLogs, []);
  assert.deepEqual(snapshot.notifications, []);
  assert.deepEqual(snapshot.chatMessages, []);
  assert.deepEqual(snapshot.consultantNotes, []);
});

test('missing patient/soap/follow-up rows resolve to blank, PHI-free defaults', () => {
  const snapshot = snapshotFromBootstrap(payload());
  assert.equal(snapshot.patient, EMPTY_PATIENT);
  assert.equal(snapshot.patient.mrn, '');
  assert.equal(snapshot.patient.name, '');
  assert.equal(snapshot.patient.allergies.length, 0);
  assert.equal(snapshot.patient.conditions.length, 0);
  assert.equal(snapshot.soapNotes, EMPTY_SOAP_NOTES);
  assert.equal(snapshot.soapNotes.subjective, '');
  assert.equal(snapshot.soapNotes.isSigned, false);
  assert.equal(snapshot.followUp, null);
});

test('server entities pass through verbatim; avatar mapper is applied', () => {
  const patient = { ...EMPTY_PATIENT, id: 'pat-42', mrn: 'MRN-777', name: 'Jane Doe', avatarUrl: 'patient-avatar' };
  const directoryPatient = { ...patient, avatarUrl: 'directory-avatar' };
  const provider = {
    id: 'prov-1', npi: '123', name: 'Dr Who', title: 'GP', specialty: 'General',
    hospital: 'Clinic', rating: 5, reviewsCount: 1, avatarUrl: 'provider-avatar',
    bio: '', consultationFee: 0, availableTimes: [],
  } satisfies ProviderProfile;
  const appointment = {
    id: 'apt-1', providerAvatar: 'appointment-avatar', patientId: 'pat-42',
    patientName: 'Jane Doe', patientMrn: 'MRN-777', patientAge: 40, patientGender: 'F',
    providerId: 'prov-1', providerName: 'Dr Who', providerTitle: 'GP',
    providerSpecialty: 'General', date: '2026-03-26', time: '4:00 PM',
    scheduledStart: '2026-03-26T16:00:00Z', type: 'Follow-Up', status: 'scheduled',
    reasonForVisit: 'Quarterly review', triagePriority: 'routine', roomCode: 'R1',
    encryptedSessionKey: 'K',
  } satisfies Appointment;
  const note = {
    id: 'cn-9', patientId: 'pat-42', patientName: 'Jane Doe', patientMrn: 'MRN-777',
    authorName: 'Dr Who', authorRole: 'clinician', title: 'T', body: 'B',
    createdAt: '2026-01-01T00:00:00.000Z',
  } satisfies ConsultantNote;
  const followUp: FollowUpDetail = {
    id: 'fu-1', code: '#CC-1', title: 'Review', status: 'Active',
    createdDate: 'March 20, 2026', description: 'desc',
    createdBy: { name: 'A', email: 'a@b.c', initials: 'A', isCurrentUser: true },
    practitioner: { name: 'B', email: 'b@b.c', initials: 'B', isCurrentUser: false, group: 'GM' },
    patient: { name: 'Jane Doe', email: 'j@d.c', initials: 'JD' },
  };

  const seen: string[] = [];
  const mapper = (value: string) => {
    seen.push(value);
    return `resolved:${value}`;
  };

  const snapshot = snapshotFromBootstrap(
    payload({
      patient,
      patients: [directoryPatient],
      providers: [provider],
      appointments: [appointment],
      consultantNotes: [note],
      followUp,
    }),
    mapper
  );

  assert.equal(snapshot.patient.avatarUrl, 'resolved:patient-avatar');
  assert.equal(snapshot.patients[0].avatarUrl, 'resolved:directory-avatar');
  assert.equal(snapshot.providers[0].avatarUrl, 'resolved:provider-avatar');
  assert.equal(snapshot.appointments[0].providerAvatar, 'resolved:appointment-avatar');
  assert.deepEqual(
    seen.sort(),
    ['appointment-avatar', 'directory-avatar', 'patient-avatar', 'provider-avatar'],
  );

  assert.deepEqual(snapshot.consultantNotes, [note]);
  assert.deepEqual(snapshot.followUp, followUp);
  assert.equal(snapshot.followUp?.patient.name, 'Jane Doe');
});

test('consultation requests hydrate from the server payload verbatim', () => {
  assert.deepEqual(snapshotFromBootstrap(payload()).consultationRequests, []);
  const request = {
    id: 'cr-1',
    patientId: 'pat-42',
    patientName: 'Jane Doe',
    patientMrn: 'MRN-777',
    patientAge: 40,
    patientGender: 'Female',
    topic: 'Cardiology review',
    urgency: 'urgent',
    preferredDate: '2026-12-01',
    details: 'Chest discomfort on exertion.',
    contact: '+10000000000',
    status: 'pending',
    createdAt: '2026-01-02T03:04:05.000Z',
  } as const;
  assert.deepEqual(
    snapshotFromBootstrap(payload({ consultationRequests: [{ ...request }] })).consultationRequests,
    [{ ...request }]
  );
});

test('chat transcript comes only from the server — never synthesized locally', () => {  const message = {
    id: 'msg-1', appointmentId: 'apt-1', senderRole: 'clinician', senderName: 'Dr Who',
    timestamp: '10:30 AM', text: 'Reported chest tightness.', isEncrypted: true,
  } satisfies ChatMessage;
  assert.deepEqual(snapshotFromBootstrap(payload({ chatMessages: [] })).chatMessages, []);
  assert.deepEqual(snapshotFromBootstrap(payload({ chatMessages: [message] })).chatMessages, [message]);
});
