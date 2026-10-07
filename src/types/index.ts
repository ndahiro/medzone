/**
 * MedZone Data Contracts & Types
 * HIPAA-Compliant Telemedicine & EHR Platform
 */

export type UserRole = 'patient' | 'clinician';

export interface VitalsReading {
  heartRate: number; // bpm
  systolic: number; // mmHg
  diastolic: number; // mmHg
  spo2: number; // %
  respiratoryRate: number; // breaths/min
  temperature: number; // Fahrenheit
  timestamp: string;
}

export interface Allergy {
  substance: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe';
}

export interface Condition {
  id: string;
  name: string;
  icd10: string;
  diagnosedDate: string;
  status: 'active' | 'managed' | 'resolved';
}

export interface LabResult {
  id: string;
  testName: string;
  category: 'Metabolic' | 'Lipid' | 'Hematology' | 'Endocrine';
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
  date: string; // YYYY-MM-DD
  time: string; // e.g. "10:30 AM"
  type: 'Virtual Consultation' | 'Follow-Up' | 'Specialist Review' | 'Prescription Refill';
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  reasonForVisit: string;
  triagePriority: 'routine' | 'urgent' | 'priority';
  roomCode: string;
  notesSnippet?: string;
  encryptedSessionKey: string;
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
  nextDoseMinutes: number; // countdown
  adherencePercentage: number;
}

export interface ChatMessage {
  id: string;
  appointmentId: string;
  senderRole: UserRole;
  senderName: string;
  timestamp: string;
  plainText: string;
  cipherText: string;
  ivHex: string;
  isEncrypted: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userRole: UserRole;
  userName: string;
  action: 'VIEW_RECORD' | 'EXPORT_FHIR' | 'EXPORT_PDF' | 'START_CONSULTATION' | 'SIGN_SOAP_NOTE' | 'ISSUE_PRESCRIPTION' | 'REQUEST_REFILL' | 'MFA_VERIFIED';
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
