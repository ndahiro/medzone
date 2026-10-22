/**
 * MedZone Data Contracts & Types
 * HIPAA-Compliant Telemedicine & EHR Platform
 */

export type UserRole = 'patient' | 'clinician';

/**
 * A single coded clinical concept. `system` is always a canonical FHIR
 * terminology URI so the value can be emitted verbatim in a Coding element.
 */
export interface Coding {
  system: string;
  code: string;
  display: string;
}

/** Canonical FHIR terminology systems used throughout the platform. */
export const TERMINOLOGY_SYSTEMS = {
  SNOMED_CT: 'http://snomed.info/sct',
  ICD10CM: 'http://hl7.org/fhir/sid/icd-10-cm',
  LOINC: 'http://loinc.org',
  RXNORM: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  UCUM: 'http://unitsofmeasure.org',
  NPI: 'http://hl7.org/fhir/sid/us-npi',
} as const;

export interface VitalsReading {
  heartRate: number; // bpm
  systolic: number; // mmHg
  diastolic: number; // mmHg
  spo2: number; // %
  respiratoryRate: number; // breaths/min
  temperature: number; // Fahrenheit
  timestamp: string;
}

interface Allergy {
  substance: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe';
  /** SNOMED CT substance concept (US Core AllergyIntolerance.code). */
  substanceCode: Coding;
}

interface Condition {
  id: string;
  name: string;
  icd10: string;
  /** SNOMED CT concept, the primary code required by US Core Condition. */
  snomed: Coding;
  diagnosedDate: string;
  status: 'active' | 'managed' | 'resolved';
}

export interface LabResult {
  id: string;
  testName: string;
  category: 'Metabolic' | 'Lipid' | 'Hematology' | 'Endocrine';
  /** LOINC concept identifying the laboratory observation. */
  loinc: Coding;
  value: string;
  unit: string;
  referenceRange: string;
  date: string;
  status: 'normal' | 'abnormal' | 'critical';
}

export interface PatientProfile {
  id: string;
  mrn: string; // Medical Record Number e.g. MRN-892410
  name: string;
  dob: string;
  age: number;
  gender: string;
  bloodType: string;
  email: string;
  phone: string;
  avatarUrl: string;
  address: string;
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
  insurance: {
    provider: string;
    policyNumber: string;
    groupNumber: string;
  };
  allergies: Allergy[];
  conditions: Condition[];
  recentLabs: LabResult[];
  vitalsHistory: VitalsReading[];
}

export interface ProviderProfile {
  id: string;
  npi: string; // National Provider Identifier
  name: string;
  title: string;
  specialty: string;
  hospital: string;
  rating: number;
  reviewsCount: number;
  avatarUrl: string;
  bio: string;
  consultationFee: number;
  availableTimes: string[];
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientAge: number;
  patientGender: string;
  providerId: string;
  providerName: string;
  providerTitle: string;
  providerSpecialty: string;
  providerAvatar: string;
  date: string; // YYYY-MM-DD, display only
  time: string; // e.g. "10:30 AM", display only
  /** ISO 8601 instant for the scheduled start; the FHIR-valid Encounter time. */
  scheduledStart: string;
  type: 'Virtual Consultation' | 'Follow-Up' | 'Specialist Review' | 'Prescription Refill';
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  reasonForVisit: string;
  triagePriority: 'routine' | 'urgent' | 'priority';
  roomCode: string;
  notesSnippet?: string;
  encryptedSessionKey: string;
  /**
   * Clinician who picked this visit up from the shared waiting room, or null
   * while it is unclaimed. The booked provider is preserved alongside it.
   */
  claimedBy?: string | null;
  claimedAt?: string | null;
}

export interface SOAPNotes {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  lastUpdated: string;
  signedBy?: string;
  isSigned: boolean;
}

export interface Prescription {
  id: string;
  patientId: string;
  patientName: string;
  medicationName: string;
  /**
   * RxNorm concept for the ordered medication (US Core MedicationRequest).
   * Absent when free-text entry could not be resolved to a vocabulary code.
   */
  rxnorm?: Coding;
  dosage: string; // e.g. "10mg"
  route: 'Oral' | 'Sublingual' | 'Inhalation' | 'Topical' | 'Subcutaneous';
  frequency: string; // e.g. "Once daily with food"
  quantity: number;
  totalRefills: number;
  remainingRefills: number;
  prescribingDoctor: string;
  prescribedDate: string;
  pharmacy: string;
  instructions: string;
  status: 'active' | 'refill-requested' | 'completed';
  /** Minutes until the next dose, derived server-side from `nextDoseAt`. */
  nextDoseMinutes: number;
  /** Absolute instant the next dose is due (ISO 8601), or null when unset. */
  nextDoseAt?: string | null;
  adherencePercentage: number;
}

export interface ChatMessage {
  id: string;
  appointmentId: string;
  senderRole: UserRole;
  senderName: string;
  timestamp: string;
  /**
   * Message body. The API decrypts it for the participants it returns it to;
   * MySQL holds only AES-256-GCM ciphertext under the server PHI key.
   */
  text: string;
  isEncrypted: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userRole: UserRole;
  userName: string;
  action: 'VIEW_RECORD' | 'EXPORT_FHIR' | 'EXPORT_PDF' | 'START_CONSULTATION' | 'SIGN_SOAP_NOTE' | 'ISSUE_PRESCRIPTION' | 'REQUEST_REFILL' | 'MFA_VERIFIED' | 'REQUEST_CONSULTATION' | 'CHECK_IN' | 'CANCEL_VISIT' | 'S2S_CONSENT' | 'S2S_TURN';
  details: string;
  targetMrn?: string;
  ipMasked: string;
  status: 'VERIFIED_HIPAA' | 'FLAGGED';
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'medication' | 'appointment' | 'security' | 'clinical';
  timestamp: string;
  read: boolean;
  actionPayload?: string;
}

export interface ConsultantNote {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  authorName: string;
  authorRole: UserRole;
  title: string;
  body: string;
  createdAt: string;
}

/**
 * Consultation request (HCW@Home "consultation request form" parity).
 *
 * A patient asks the care team for a visit on a topic; a clinician triages
 * it from the inbox. Accepting schedules a real appointment; declining only
 * records the decision. `contact` is the callback channel (phone or email).
 */
type ConsultationRequestStatus = 'pending' | 'accepted' | 'declined';

export interface ConsultationRequest {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientAge: number;
  patientGender: string;
  topic: string;
  urgency: 'routine' | 'urgent';
  preferredDate: string;
  details: string;
  contact: string;
  status: ConsultationRequestStatus;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

/**
 * Specialist referral (clinician-created or patient-requested).
 *
 * A clinician refers the patient to a specialty/provider, or the patient
 * requests a specialty referral. Both directions share one triage inbox:
 * pending -> accepted (schedules a Specialist Review visit) | declined,
 * accepted -> completed when the specialty visit is done.
 */
type ReferralStatus = 'pending' | 'accepted' | 'declined' | 'completed';

export interface Referral {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientAge: number;
  patientGender: string;
  specialty: string;
  referredToProviderId?: string;
  referredToProviderName?: string;
  reason: string;
  priority: 'routine' | 'urgent';
  notes: string;
  status: ReferralStatus;
  source: 'clinician' | 'patient';
  createdBy: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

/**
 * Follow-up consultation record served by the backend
 * (GET /api/follow-up, also present on the bootstrap payload).
 */
export interface FollowUpDetail {
  id: string;
  code: string; // e.g. #CC2024-089
  title: string;
  status: 'Active' | 'Closed' | 'Pending';
  createdDate: string;
  description: string;
  createdBy: {
    name: string;
    email: string;
    initials: string;
    isCurrentUser: boolean;
  };
  practitioner: {
    name: string;
    email: string;
    initials: string;
    isCurrentUser: boolean;
    group: string;
  };
  patient: {
    name: string;
    email: string;
    initials: string;
  };
}

// ---------------------------------------------------------------------------
// Tele-visit room control plane (guest roster + WebRTC signaling)
// ---------------------------------------------------------------------------

/** Guest invited to a live visit; the roster is owned by the visit server-side. */
export interface VisitGuest {
  id: string;
  name: string;
  role: 'Family' | 'Translator' | 'Specialist' | 'Observer';
  invitedBy?: string;
  createdAt?: string;
}

/** Channel a patient invitation link is shared through. */
export type InviteChannel = 'link' | 'sms' | 'email' | 'whatsapp';

/**
 * Single-click patient invitation link (HCW@Home parity). Opening the link
 * takes an authenticated participant straight into the visit's lobby; the
 * token is opaque, expiring and revocable, and carries no chart data.
 */
export interface VisitInvite {
  token: string;
  appointmentId: string;
  channel: InviteChannel;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  /** Relative path the client turns into the shareable absolute URL. */
  joinPath: string;
}

/** PHI-free public view of an invitation link (join landing page). */
export interface InviteSummary {
  valid: boolean;
  appointmentId: string;
  type: Appointment['type'];
  providerName: string;
  providerSpecialty: string;
  scheduledStart: string;
  status: Appointment['status'];
  expiresAt: string;
}

/** File or image shared during a live visit (HCW@Home "attachment or image"). */
export interface VisitAttachment {
  id: string;
  appointmentId: string;
  senderRole: UserRole;
  senderName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Base64 file body; the API decrypts it in-process for its participants. */
  content: string;
  createdAt: string;
}

/**
 * Anonymised clinic-level statistics (HCW@Home "anonymised statistics").
 * Aggregates only — never a chart identifier, name or free text.
 */
export interface ClinicStats {
  totalVisits: number;
  byStatus: { scheduled: number; inProgress: number; completed: number; cancelled: number };
  byType: Record<string, number>;
  completionRate: number;
  activePrescriptions: number;
  pendingConsultationRequests: number;
  referrals: { pending: number; accepted: number; completed: number; declined: number };
  labs: { normal: number; abnormal: number; critical: number };
  auditEvents: number;
  providers: number;
  invitesIssued: number;
  attachmentsShared: number;
  generatedAt: string;
}

/** One relayed WebRTC control message (SDP / ICE / presence). */
export type RoomSignalKind = 'join' | 'ping' | 'offer' | 'answer' | 'candidate' | 'bye';

export interface RoomSignal {
  id: number;
  kind: RoomSignalKind;
  senderId: number;
  senderRole: UserRole;
  senderName: string;
  payload: unknown;
  createdAt: string;
}

/** The other participant seen in the heartbeat window. */
interface RoomPresence {
  senderId: number;
  senderRole: UserRole;
  senderName: string;
  kind: RoomSignalKind;
  at: string;
}

export interface RoomSignalsPage {
  latestId: number;
  signals: RoomSignal[];
  presence: RoomPresence[];
}

/** Structural FHIR R4 validation result from POST /api/fhir/validate. */
interface FhirValidationIssue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
  resourceType?: string;
}

export interface FhirValidationResult {
  valid: boolean;
  resourceCount: number;
  issues: FhirValidationIssue[];
}

