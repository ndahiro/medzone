/**
 * MedZone backend - row <-> domain mappers.
 *
 * The API emits exactly the TypeScript shapes in src/types/index.ts, so these
 * functions translate between snake_case MySQL rows and the camelCase contracts
 * the React client consumes.
 */
import { decryptField, encryptField, encryptTranscript } from './crypto.js';
import { parseModules } from './auth.js';

const num = (value) => (value === null || value === undefined ? value : Number(value));
const bool = (value) => value === 1 || value === true || value === '1';
const pad = (n) => String(n).padStart(2, '0');

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Splits an ISO 8601 instant into a UTC DATETIME string and the originating
 * offset in minutes, so the instant can be reconstructed losslessly.
 */
function parseIsoInstant(iso) {
  const match = ISO_RE.exec(String(iso || '').trim());
  if (!match) return null;
  const [, Y, Mo, D, H, Mi, S = '0', tz = 'Z'] = match;
  let offsetMinutes = 0;
  if (tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    const [oh, om] = tz.slice(1).split(':').map(Number);
    offsetMinutes = sign * (oh * 60 + om);
  }
  const utc = new Date(Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S) - offsetMinutes * 60_000);
  const utcStr = `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())} ${pad(
    utc.getUTCHours()
  )}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}`;
  return { utc: utcStr, offsetMinutes };
}

/** Rebuilds an ISO 8601 instant from a UTC DATETIME string and offset minutes. */
function formatIsoInstant(utcDateTime, offsetMinutes = 0) {
  const [datePart, timePart] = String(utcDateTime).split(' ');
  const [Y, Mo, D] = datePart.split('-').map(Number);
  const [H, Mi, S] = timePart.split(':').map(Number);
  const local = new Date(Date.UTC(Y, Mo - 1, D, H, Mi, S) + offsetMinutes * 60_000);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
  if (!offsetMinutes) return `${date}T${time}Z`;
  const sign = offsetMinutes > 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `${date}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Converts a stored UTC DATETIME to an ISO 8601 instant (UTC). */
function utcDateTimeToIso(utcDateTime) {
  if (!utcDateTime) return null;
  return new Date(`${String(utcDateTime).replace(' ', 'T')}Z`).toISOString();
}

/** Converts an ISO instant to a UTC DATETIME string for storage. */
export function isoToUtcDateTime(iso) {
  const parsed = parseIsoInstant(iso);
  return parsed ? parsed.utc : null;
}

/** The instant a raw appointment row starts at, or null when unreadable. */
export function appointmentStartMs(row) {
  if (!row.scheduled_start_utc) return null;
  const ms = Date.parse(formatIsoInstant(row.scheduled_start_utc, row.scheduled_start_offset ?? 0));
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// Row -> domain
// ---------------------------------------------------------------------------

export const mapUserRow = (r) => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  modules: parseModules(r.modules),
  isAdmin: r.is_admin === 1 || r.is_admin === true,
  role: r.role === 'clinician' || r.role === 'admin' || r.role === 'patient' ? r.role : 'patient',
  patientId: r.patient_id ?? null,
  providerId: r.provider_id ?? null,
  avatarUrl: r.avatar_url ?? '',
  // Authenticator state, as booleans only: the secret itself is never mapped
  // out of the row (this shape is served to administrators). `pending` means a
  // secret is stored but no code from it has been accepted yet.
  mfaEnrolled: Boolean(r.mfa_enrolled_at),
  mfaPending: Boolean(r.mfa_secret) && !r.mfa_enrolled_at,
  // Session epoch compared by sessionSubject on every authenticated request.
  // Not a credential; toSafeUser (the login payload) omits it.
  tokenVersion: Number(r.token_version ?? 0) || 0,
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
});

/**
 * A patient account's registration portrait is the person's current likeness.
 * Overlay it on the chart row so staff reports show the same face the patient
 * sees for themselves. The first linked account with a portrait wins; chart
 * photos remain the fallback when no account has one.
 */
export const overlayPatientAvatars = (patients, accountRows = []) => {
  const byPatient = new Map();
  for (const row of accountRows) {
    if (row.patient_id && row.avatar_url && !byPatient.has(row.patient_id)) {
      byPatient.set(row.patient_id, row.avatar_url);
    }
  }
  return patients.map((patient) =>
    byPatient.has(patient.id)
      ? { ...patient, avatarUrl: byPatient.get(patient.id) }
      : patient
  );
};

const mapAllergyRow = (r) => ({
  substance: r.substance,
  reaction: r.reaction,
  severity: r.severity,
  substanceCode: { system: r.code_system, code: r.code, display: r.code_display },
});

const mapConditionRow = (r) => ({
  id: r.id,
  name: r.name,
  icd10: r.icd10,
  snomed: { system: r.snomed_system, code: r.snomed_code, display: r.snomed_display },
  diagnosedDate: r.diagnosed_date,
  status: r.status,
});

const mapLabRow = (r) => ({
  id: r.id,
  testName: r.test_name,
  category: r.category,
  loinc: { system: r.loinc_system, code: r.loinc_code, display: r.loinc_display },
  value: r.value,
  unit: r.unit,
  referenceRange: r.reference_range,
  date: r.result_date,
  status: r.status,
});

export const mapVitalsRow = (r) => ({
  heartRate: r.heart_rate,
  systolic: r.systolic,
  diastolic: r.diastolic,
  spo2: r.spo2,
  respiratoryRate: r.respiratory_rate,
  temperature: num(r.temperature),
  timestamp: utcDateTimeToIso(r.recorded_at),
});

export const mapPatient = (row, { allergies = [], conditions = [], labs = [], vitals = [] } = {}) => ({
  id: row.id,
  mrn: row.mrn,
  name: row.name,
  dob: row.dob,
  age: row.age,
  gender: row.gender,
  bloodType: row.blood_type,
  email: row.email,
  phone: row.phone,
  avatarUrl: row.avatar_url,
  address: row.address,
  emergencyContact: {
    name: row.emergency_contact_name,
    relationship: row.emergency_contact_relation,
    phone: row.emergency_contact_phone,
  },
  insurance: {
    provider: row.insurance_provider,
    policyNumber: row.insurance_policy_number,
    groupNumber: row.insurance_group_number,
  },
  allergies: allergies.map(mapAllergyRow),
  conditions: conditions.map(mapConditionRow),
  recentLabs: labs.map(mapLabRow),
  vitalsHistory: vitals.map(mapVitalsRow),
});

export const mapProvider = (row, slots = []) => ({
  id: row.id,
  npi: row.npi,
  name: row.name,
  title: row.title,
  specialty: row.specialty,
  hospital: row.hospital,
  rating: num(row.rating),
  reviewsCount: row.reviews_count,
  avatarUrl: row.avatar_url,
  bio: row.bio,
  consultationFee: num(row.consultation_fee),
  availableTimes: slots,
});

export const mapAppointment = (row) => ({
  id: row.id,
  patientId: row.patient_id,
  patientName: row.patient_name,
  patientMrn: row.patient_mrn,
  patientAge: row.patient_age,
  patientGender: row.patient_gender,
  providerId: row.provider_id,
  providerName: row.provider_name,
  providerTitle: row.provider_title,
  providerSpecialty: row.provider_specialty,
  providerAvatar: row.provider_avatar,
  date: row.appointment_date,
  time: row.appointment_time,
  scheduledStart: formatIsoInstant(row.scheduled_start_utc, row.scheduled_start_offset),
  type: row.type,
  status: row.status,
  reasonForVisit: row.reason_for_visit,
  triagePriority: row.triage_priority,
  roomCode: row.room_code,
  notesSnippet: row.notes_snippet ?? undefined,
  encryptedSessionKey: row.encrypted_session_key,
  claimedBy: row.claimed_by_name ?? null,
  claimedAt: utcDateTimeToIso(row.claimed_at),
});

export const mapPrescription = (row) => {
  // The countdown is clock-driven: when the row carries an absolute instant,
  // the remaining minutes are derived from it at read time so every client
  // sees the same value instead of running its own local ticker.
  const doseAtMs = row.next_dose_at
    ? Date.parse(`${String(row.next_dose_at).replace(' ', 'T')}Z`)
    : Number.NaN;
  const derivedMinutes = Number.isFinite(doseAtMs)
    ? Math.max(0, Math.round((doseAtMs - Date.now()) / 60000))
    : num(row.next_dose_minutes);
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    medicationName: row.medication_name,
    ...(row.rxnorm_code
      ? { rxnorm: { system: row.rxnorm_system, code: row.rxnorm_code, display: row.rxnorm_display } }
      : {}),
    dosage: row.dosage,
    route: row.route,
    frequency: row.frequency,
    quantity: row.quantity,
    totalRefills: row.total_refills,
    remainingRefills: row.remaining_refills,
    prescribingDoctor: row.prescribing_doctor,
    prescribedDate: row.prescribed_date,
    pharmacy: row.pharmacy,
    instructions: row.instructions,
    status: row.status,
    nextDoseMinutes: derivedMinutes,
    nextDoseAt: utcDateTimeToIso(row.next_dose_at),
    adherencePercentage: row.adherence_percentage,
  };
};

export const mapAuditLog = (row) => ({
  id: row.id,
  timestamp: utcDateTimeToIso(row.logged_at),
  userRole: row.user_role,
  userName: row.user_name,
  action: row.action,
  details: row.details,
  targetMrn: row.target_mrn ?? undefined,
  ipMasked: row.ip_masked,
  status: row.status,
});

export const mapNotification = (row) => ({
  id: row.id,
  title: row.title,
  message: row.message,
  type: row.type,
  timestamp: row.display_time,
  read: bool(row.read_flag),
  ...(row.action_payload ? { actionPayload: row.action_payload } : {}),
});

export const mapFollowUp = (row) => ({
  id: row.id,
  ...(row.patient_id ? { patientId: row.patient_id } : {}),
  code: row.code,
  title: row.title,
  status: row.status,
  createdDate: row.created_date,
  description: row.description,
  createdBy: {
    name: row.created_by_name,
    email: row.created_by_email,
    initials: row.created_by_initials,
    isCurrentUser: bool(row.created_by_current),
  },
  practitioner: {
    name: row.practitioner_name,
    email: row.practitioner_email,
    initials: row.practitioner_initials,
    isCurrentUser: bool(row.practitioner_current),
    group: row.practitioner_group,
  },
  patient: {
    name: row.patient_name,
    email: row.patient_email,
    initials: row.patient_initials,
  },
});

/** SOAP narrative is decrypted in-process; the database only holds ciphertext. */
export const mapSoapNote = (row) => ({
  // Empty sections persist as '' (see soapColumns); surface them as '' so
  // the client never renders null into a controlled textarea.
  subjective: decryptField(row.subjective) ?? '',
  objective: decryptField(row.objective) ?? '',
  assessment: decryptField(row.assessment) ?? '',
  plan: decryptField(row.plan) ?? '',
  lastUpdated: row.last_updated,
  ...(row.signed_by ? { signedBy: row.signed_by } : {}),
  isSigned: bool(row.is_signed),
});

export const mapChatMessage = (row) => ({
  id: row.id,
  appointmentId: row.appointment_id,
  senderRole: row.sender_role,
  senderName: row.sender_name,
  timestamp: row.sent_at,
  cipherText: row.cipher_text,
  ivHex: row.iv_hex,
  saltHex: row.salt_hex,
  isEncrypted: bool(row.is_encrypted),
});

// ---------------------------------------------------------------------------
// Domain -> column values
// ---------------------------------------------------------------------------

export const patientColumns = (p) => ({
  id: p.id,
  mrn: p.mrn,
  name: p.name,
  dob: p.dob,
  age: p.age,
  gender: p.gender,
  blood_type: p.bloodType,
  email: p.email,
  phone: p.phone,
  avatar_url: p.avatarUrl,
  address: p.address,
  emergency_contact_name: p.emergencyContact?.name ?? '',
  emergency_contact_relation: p.emergencyContact?.relationship ?? '',
  emergency_contact_phone: p.emergencyContact?.phone ?? '',
  insurance_provider: p.insurance?.provider ?? '',
  insurance_policy_number: p.insurance?.policyNumber ?? '',
  insurance_group_number: p.insurance?.groupNumber ?? '',
});

export const allergyColumns = (patientId, a) => ({
  id: a.id,
  patient_id: patientId,
  substance: a.substance,
  reaction: a.reaction,
  severity: a.severity,
  code_system: a.substanceCode?.system ?? '',
  code: a.substanceCode?.code ?? '',
  code_display: a.substanceCode?.display ?? '',
});

export const conditionColumns = (patientId, c) => ({
  id: c.id,
  patient_id: patientId,
  name: c.name,
  icd10: c.icd10,
  snomed_system: c.snomed?.system ?? '',
  snomed_code: c.snomed?.code ?? '',
  snomed_display: c.snomed?.display ?? '',
  diagnosed_date: c.diagnosedDate,
  status: c.status,
});

export const labColumns = (patientId, l) => ({
  id: l.id,
  patient_id: patientId,
  test_name: l.testName,
  category: l.category,
  loinc_system: l.loinc?.system ?? '',
  loinc_code: l.loinc?.code ?? '',
  loinc_display: l.loinc?.display ?? '',
  value: l.value,
  unit: l.unit,
  reference_range: l.referenceRange,
  result_date: l.date,
  status: l.status,
});

export const vitalsColumns = (patientId, v) => ({
  patient_id: patientId,
  heart_rate: v.heartRate,
  systolic: v.systolic,
  diastolic: v.diastolic,
  spo2: v.spo2,
  respiratory_rate: v.respiratoryRate,
  temperature: v.temperature,
  recorded_at: isoToUtcDateTime(v.timestamp) || v.timestamp,
});

export const providerColumns = (p) => ({
  id: p.id,
  npi: p.npi,
  name: p.name,
  title: p.title,
  specialty: p.specialty,
  hospital: p.hospital,
  rating: p.rating,
  reviews_count: p.reviewsCount,
  avatar_url: p.avatarUrl,
  bio: p.bio,
  consultation_fee: p.consultationFee,
});

export const appointmentColumns = (a) => {
  const parsed = parseIsoInstant(a.scheduledStart);
  return {
    id: a.id,
    patient_id: a.patientId,
    provider_id: a.providerId,
    patient_name: a.patientName,
    patient_mrn: a.patientMrn,
    patient_age: a.patientAge,
    patient_gender: a.patientGender,
    provider_name: a.providerName,
    provider_title: a.providerTitle,
    provider_specialty: a.providerSpecialty,
    provider_avatar: a.providerAvatar,
    appointment_date: a.date,
    appointment_time: a.time,
    scheduled_start_utc: parsed ? parsed.utc : isoToUtcDateTime(new Date().toISOString()),
    scheduled_start_offset: parsed ? parsed.offsetMinutes : 0,
    type: a.type,
    status: a.status,
    reason_for_visit: a.reasonForVisit,
    triage_priority: a.triagePriority,
    room_code: a.roomCode,
    notes_snippet: a.notesSnippet ?? null,
    encrypted_session_key: a.encryptedSessionKey,
  };
};

export const prescriptionColumns = (r) => ({
  id: r.id,
  patient_id: r.patientId,
  patient_name: r.patientName,
  medication_name: r.medicationName,
  rxnorm_system: r.rxnorm?.system ?? null,
  rxnorm_code: r.rxnorm?.code ?? null,
  rxnorm_display: r.rxnorm?.display ?? null,
  dosage: r.dosage,
  route: r.route,
  frequency: r.frequency,
  quantity: r.quantity,
  total_refills: r.totalRefills,
  remaining_refills: r.remainingRefills,
  prescribing_doctor: r.prescribingDoctor,
  prescribed_date: r.prescribedDate,
  pharmacy: r.pharmacy,
  instructions: r.instructions,
  status: r.status,
  next_dose_minutes: r.nextDoseMinutes,
  // Stamp the absolute instant whenever minutes are supplied: the stored
  // countdown becomes a projection of `next_dose_at`, not an independent
  // value that drifts from wall-clock time.
  next_dose_at:
    isoToUtcDateTime(r.nextDoseAt) ||
    (Number.isFinite(Number(r.nextDoseMinutes))
      ? isoToUtcDateTime(new Date(Date.now() + Number(r.nextDoseMinutes) * 60_000).toISOString())
      : null),
  adherence_percentage: r.adherencePercentage,
});

export const soapColumns = (id, s, appointmentId = null) => ({
  id,
  appointment_id: appointmentId,
  // encryptField maps '' to NULL, but the columns are NOT NULL: persist an
  // empty section as empty-string ciphertext so a partially filled note
  // (e.g. only Subjective typed before signing) never 500s on write.
  subjective: encryptField(s.subjective) ?? '',
  objective: encryptField(s.objective) ?? '',
  assessment: encryptField(s.assessment) ?? '',
  plan: encryptField(s.plan) ?? '',
  last_updated: s.lastUpdated,
  signed_by: s.signedBy ?? null,
  is_signed: s.isSigned ? 1 : 0,
});

export const chatMessageColumns = (m) => ({
  id: m.id,
  appointment_id: m.appointmentId,
  sender_role: m.senderRole,
  sender_name: m.senderName,
  // Display metadata the route deliberately leaves optional: stamp it
  // server-side instead of 500ing on an undefined bind parameter.
  sent_at: m.timestamp || new Date().toISOString(),
  // PHI is encrypted here, server-side, with the deployment PHI key: the
  // browser never holds a transcript key, so a database dump cannot be
  // decrypted from a visit id. The `v1:` envelope carries its own IV and salt.
  cipher_text: encryptTranscript(m.text) ?? '',
  // Legacy per-record material columns (NOT NULL): the envelope above carries
  // both values now, and nothing reads these.
  iv_hex: '',
  salt_hex: '',
  is_encrypted: 1,
});

export const auditLogColumns = (l) => ({
  id: l.id,
  logged_at: isoToUtcDateTime(l.timestamp) || isoToUtcDateTime(new Date().toISOString()),
  user_role: l.userRole,
  user_name: l.userName,
  action: l.action,
  details: l.details,
  target_mrn: l.targetMrn ?? null,
  ip_masked: l.ipMasked,
  status: l.status,
});

export const notificationColumns = (n) => ({
  id: n.id,
  title: n.title,
  message: n.message,
  type: n.type,
  created_at: isoToUtcDateTime(n.createdAt) || isoToUtcDateTime(new Date().toISOString()),
  display_time: n.timestamp,
  read_flag: n.read ? 1 : 0,
  action_payload: n.actionPayload ?? null,
});

export const followUpColumns = (f) => ({
  id: f.id,
  patient_id: f.patientId ?? null,
  code: f.code,
  title: f.title,
  status: f.status,
  created_date: f.createdDate,
  description: f.description,
  created_by_name: f.createdBy.name,
  created_by_email: f.createdBy.email,
  created_by_initials: f.createdBy.initials,
  created_by_current: f.createdBy.isCurrentUser ? 1 : 0,
  practitioner_name: f.practitioner.name,
  practitioner_email: f.practitioner.email,
  practitioner_initials: f.practitioner.initials,
  practitioner_current: f.practitioner.isCurrentUser ? 1 : 0,
  practitioner_group: f.practitioner.group,
  patient_name: f.patient.name,
  patient_email: f.patient.email,
  patient_initials: f.patient.initials,
});

export const mapConsultantNote = (row) => ({
  id: row.id,
  patientId: row.patient_id,
  patientName: row.patient_name,
  patientMrn: row.patient_mrn,
  authorName: row.author_name,
  authorRole: row.author_role === 'patient' ? 'patient' : 'clinician',
  title: decryptField(row.title),
  body: decryptField(row.body),
  createdAt: row.created_at,
});

export const consultantNoteColumns = (n) => ({
  id: n.id,
  patient_id: n.patientId,
  patient_name: n.patientName,
  patient_mrn: n.patientMrn,
  author_name: n.authorName,
  author_role: n.authorRole === 'patient' ? 'patient' : 'clinician',
  title: encryptField(n.title),
  body: encryptField(n.body),
  created_at: n.createdAt || new Date().toISOString(),
});

export const mapConsultationRequest = (row) => ({
  id: row.id,
  patientId: row.patient_id,
  patientName: row.patient_name,
  patientMrn: row.patient_mrn,
  patientAge: row.patient_age,
  patientGender: row.patient_gender,
  topic: row.topic,
  urgency: row.urgency === 'urgent' ? 'urgent' : 'routine',
  preferredDate: row.preferred_date,
  details: row.details,
  contact: row.contact,
  status: row.status === 'accepted' || row.status === 'declined' ? row.status : 'pending',
  createdAt: row.created_at,
  ...(row.reviewed_by ? { reviewedBy: row.reviewed_by } : {}),
  ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
});

export const consultationRequestColumns = (r) => ({
  id: r.id,
  patient_id: r.patientId,
  patient_name: r.patientName,
  patient_mrn: r.patientMrn,
  patient_age: r.patientAge,
  patient_gender: r.patientGender,
  topic: r.topic,
  urgency: r.urgency === 'urgent' ? 'urgent' : 'routine',
  preferred_date: r.preferredDate,
  details: r.details,
  contact: r.contact,
  status: r.status === 'accepted' || r.status === 'declined' ? r.status : 'pending',
  created_at: r.createdAt || new Date().toISOString(),
  reviewed_by: r.reviewedBy ?? null,
  reviewed_at: r.reviewedAt ?? null,
});

export const mapReferral = (row) => ({
  id: row.id,
  patientId: row.patient_id,
  patientName: row.patient_name,
  patientMrn: row.patient_mrn,
  patientAge: row.patient_age,
  patientGender: row.patient_gender,
  specialty: row.specialty,
  ...(row.referred_to_provider_id ? { referredToProviderId: row.referred_to_provider_id } : {}),
  ...(row.referred_to_provider_name ? { referredToProviderName: row.referred_to_provider_name } : {}),
  reason: row.reason,
  priority: row.priority === 'urgent' ? 'urgent' : 'routine',
  notes: row.notes ?? '',
  status:
    row.status === 'accepted' || row.status === 'declined' || row.status === 'completed'
      ? row.status
      : 'pending',
  source: row.source === 'patient' ? 'patient' : 'clinician',
  createdBy: row.created_by,
  createdAt: row.created_at,
  ...(row.reviewed_by ? { reviewedBy: row.reviewed_by } : {}),
  ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
});

export const referralColumns = (r) => ({
  id: r.id,
  patient_id: r.patientId,
  patient_name: r.patientName,
  patient_mrn: r.patientMrn,
  patient_age: r.patientAge,
  patient_gender: r.patientGender,
  specialty: r.specialty,
  referred_to_provider_id: r.referredToProviderId ?? null,
  referred_to_provider_name: r.referredToProviderName ?? null,
  reason: r.reason,
  priority: r.priority === 'urgent' ? 'urgent' : 'routine',
  notes: r.notes ?? '',
  status:
    r.status === 'accepted' || r.status === 'declined' || r.status === 'completed'
      ? r.status
      : 'pending',
  source: r.source === 'patient' ? 'patient' : 'clinician',
  created_by: r.createdBy,
  created_at: r.createdAt || new Date().toISOString(),
  reviewed_by: r.reviewedBy ?? null,
  reviewed_at: r.reviewedAt ?? null,
});

// ---------------------------------------------------------------------------
// Tele-visit room control plane (guest roster + WebRTC signaling)
// ---------------------------------------------------------------------------

export const mapVisitGuest = (row) => ({
  id: row.id,
  appointmentId: row.appointment_id,
  name: row.name,
  role: row.role,
  invitedBy: row.invited_by,
  createdAt: utcDateTimeToIso(row.created_at),
});

/** Patient invitation link -> client shape (join URL is composed by the route). */
export const mapVisitInvite = (row) => ({
  token: row.token,
  appointmentId: row.appointment_id,
  channel: row.channel,
  createdBy: row.created_by,
  createdAt: utcDateTimeToIso(row.created_at),
  expiresAt: utcDateTimeToIso(row.expires_at),
  revoked: bool(row.revoked),
});

/** In-visit attachment: file name and content are decrypted in-process. */
export const mapVisitAttachment = (row) => ({
  id: row.id,
  appointmentId: row.appointment_id,
  senderRole: row.sender_role === 'patient' ? 'patient' : 'clinician',
  senderName: row.sender_name,
  fileName: decryptField(row.file_name),
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  content: decryptField(row.content),
  createdAt: utcDateTimeToIso(row.created_at),
});

export const visitAttachmentColumns = (a) => ({
  id: a.id,
  appointment_id: a.appointmentId,
  sender_id: a.senderId,
  sender_role: a.senderRole === 'patient' ? 'patient' : 'clinician',
  sender_name: a.senderName,
  file_name: encryptField(a.fileName),
  mime_type: a.mimeType,
  size_bytes: a.sizeBytes,
  content: encryptField(a.content),
  created_at: isoToUtcDateTime(a.createdAt) || isoToUtcDateTime(new Date().toISOString()),
});

/** Signaling row -> client envelope. Payload is opaque JSON (SDP / ICE). */
export const mapRoomSignal = (row) => {
  let payload = null;
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = null;
    }
  }
  return {
    id: Number(row.id),
    kind: row.kind,
    senderId: row.sender_id,
    senderRole: row.sender_role,
    senderName: row.sender_name,
    payload,
    createdAt: utcDateTimeToIso(row.created_at),
  };
};
