import { PatientProfile, ProviderProfile, Appointment, Prescription, AuditLogEntry, NotificationItem } from '../types';

import doctorChenImg from '../assets/images/doctor_cardiology_chen_1791375844784.jpg';
import doctorRiveraImg from '../assets/images/doctor_neurology_rivera_1791375857139.jpg';
import doctorRostovaImg from '../assets/images/doctor_pediatrics_rostova_1791375871692.jpg';
import patientJamesImg from '../assets/images/patient_james_avatar_1791375882733.jpg';

import doctorVideoFeedImg from '../assets/images/doctor_video_feed_1791378183189.jpg';
import patientVideoFeedImg from '../assets/images/patient_video_feed_1791378196252.jpg';
import sophieMartinAvatarImg from '../assets/images/avatar_sophie_martin_1791378206234.jpg';

export { doctorVideoFeedImg, patientVideoFeedImg, sophieMartinAvatarImg };

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

export const CURRENT_PRACTITIONER = {
  name: 'Sophie Martin',
  title: 'General Practitioner',
  email: 'dr.martin@medzone.com',
  initials: 'SM',
  group: 'General Medicine',
};

export const INITIAL_FOLLOW_UP: FollowUpDetail = {
  id: 'fu-2026-001',
  code: '#CC2026-042',
  title: 'Chronic treatment prescription renewal',
  status: 'Active',
  createdDate: 'March 20, 2026',
  description: 'Quarterly renewal of hypertension and type 2 diabetes treatment.',
  createdBy: {
    name: 'Sophie Martin',
    email: 'dr.martin@medzone.com',
    initials: 'SM',
    isCurrentUser: true,
  },
  practitioner: {
    name: 'Sophie Martin',
    email: 'dr.martin@medzone.com',
    initials: 'SM',
    isCurrentUser: true,
    group: 'General Medicine',
  },
  patient: {
    name: 'Ahmed Benali',
    email: 'ahmed.benali@example.com',
    initials: 'AB',
  },
};

export const INITIAL_PATIENT: PatientProfile = {
  id: 'pat-001',
  mrn: 'MRN-849201',
  name: 'Ahmed Benali',
  dob: '1984-06-18',
  age: 41,
  gender: 'Male',
  bloodType: 'O-Positive',
  email: 'ahmed.benali@example.com',
  phone: '+1 (415) 892-4410',
  avatarUrl: patientJamesImg,
  address: '742 Evergreen Terrace, San Francisco, CA',
  emergencyContact: {
    name: 'Fatima Benali',
    relationship: 'Spouse',
    phone: '+1 (415) 892-4419',
  },
  insurance: {
    provider: 'Anthem Blue Cross PPO',
    policyNumber: 'BC-992834190',
    groupNumber: 'GRP-77218',
  },
  allergies: [
    { substance: 'Amoxicillin / Penicillin', reaction: 'Urticaria & facial swelling', severity: 'severe' },
    { substance: 'Sulfa Drugs', reaction: 'Cutaneous erythema', severity: 'moderate' },
  ],
  conditions: [
    { id: 'c1', name: 'Essential Primary Hypertension', icd10: 'I10', diagnosedDate: '2023-02-11', status: 'managed' },
    { id: 'c2', name: 'Type 2 Diabetes Mellitus without complications', icd10: 'E11.9', diagnosedDate: '2024-05-18', status: 'active' },
    { id: 'c3', name: 'Seasonal Allergic Rhinitis', icd10: 'J30.1', diagnosedDate: '2021-09-04', status: 'managed' },
  ],
  recentLabs: [
    { id: 'l1', testName: 'Hemoglobin A1c', category: 'Endocrine', value: '6.4', unit: '%', referenceRange: '4.0 - 5.6', date: '2026-09-15', status: 'abnormal' },
    { id: 'l2', testName: 'eGFR (Creatinine-based)', category: 'Metabolic', value: '94', unit: 'mL/min/1.73m²', referenceRange: '> 60', date: '2026-09-15', status: 'normal' },
    { id: 'l3', testName: 'Total Cholesterol', category: 'Lipid', value: '182', unit: 'mg/dL', referenceRange: '< 200', date: '2026-08-02', status: 'normal' },
    { id: 'l4', testName: 'LDL Cholesterol', category: 'Lipid', value: '104', unit: 'mg/dL', referenceRange: '< 100', date: '2026-08-02', status: 'abnormal' },
    { id: 'l5', testName: 'Serum Potassium', category: 'Metabolic', value: '4.2', unit: 'mEq/L', referenceRange: '3.5 - 5.0', date: '2026-09-15', status: 'normal' },
  ],
  vitalsHistory: [
    { heartRate: 74, systolic: 128, diastolic: 82, spo2: 98, respiratoryRate: 15, temperature: 98.6, timestamp: '2026-09-15T09:30:00Z' },
    { heartRate: 76, systolic: 132, diastolic: 84, spo2: 99, respiratoryRate: 16, temperature: 98.4, timestamp: '2026-10-01T14:15:00Z' },
    { heartRate: 72, systolic: 124, diastolic: 80, spo2: 98, respiratoryRate: 14, temperature: 98.5, timestamp: '2026-10-07T08:00:00Z' },
  ],
};

export const PROVIDERS: ProviderProfile[] = [
  {
    id: 'prov-001',
    npi: '1892019482',
    name: 'Dr. Sophie Martin',
    title: 'General Practitioner',
    specialty: 'General Medicine & Tele-Followups',
    hospital: 'HCW@Home Virtual Medical Center',
    rating: 4.98,
    reviewsCount: 342,
    avatarUrl: doctorChenImg,
    bio: 'Licensed practitioner leading chronic care follow-ups and remote teleconsultations.',
    consultationFee: 145,
    availableTimes: ['09:00 AM', '10:30 AM', '01:15 PM', '04:00 PM'],
  },
  {
    id: 'prov-002',
    npi: '1548291048',
    name: 'Dr. Marcus Rivera, MD',
    title: 'Consulting Physician',
    specialty: 'Cardiovascular & Internal Medicine',
    hospital: 'Pacific Medical Health Network',
    rating: 4.92,
    reviewsCount: 218,
    avatarUrl: doctorRiveraImg,
    bio: 'Specialist in hypertensive follow-up and chronic treatment renewals.',
    consultationFee: 160,
    availableTimes: ['11:00 AM', '01:30 PM', '03:45 PM'],
  },
  {
    id: 'prov-003',
    npi: '1904729103',
    name: 'Dr. Elena Rostova, MD',
    title: 'Lead Primary Care Clinician',
    specialty: 'Internal Medicine & Diabetes Care',
    hospital: 'Bay Health Medical Center',
    rating: 4.98,
    reviewsCount: 489,
    avatarUrl: doctorRostovaImg,
    bio: 'Holistic internal medicine clinician focused on glycemic control and treatment adherence.',
    consultationFee: 120,
    availableTimes: ['08:30 AM', '10:00 AM', '11:45 AM', '02:00 PM'],
  },
];

export const INITIAL_APPOINTMENTS: Appointment[] = [
  {
    id: 'apt-101',
    patientId: 'pat-001',
    patientName: 'Ahmed Benali',
    patientMrn: 'MRN-849201',
    patientAge: 41,
    patientGender: 'Male',
    providerId: 'prov-001',
    providerName: 'Dr. Sophie Martin',
    providerTitle: 'General Practitioner',
    providerSpecialty: 'General Medicine',
    providerAvatar: doctorChenImg,
    date: '2026-03-26',
    time: '4:00 PM',
    type: 'Virtual Consultation',
    status: 'scheduled',
    reasonForVisit: 'Prescription renewal teleconsultation for quarterly treatment.',
    triagePriority: 'priority',
    roomCode: 'MED-ZONE-772',
    notesSnippet: 'Quarterly review of Lisinopril and Metformin dosages with live vitals check.',
    encryptedSessionKey: 'ENC-KEY-89410-X256',
  },
  {
    id: 'apt-102',
    patientId: 'pat-001',
    patientName: 'Ahmed Benali',
    patientMrn: 'MRN-849201',
    patientAge: 41,
    patientGender: 'Male',
    providerId: 'prov-001',
    providerName: 'Dr. Sophie Martin',
    providerTitle: 'General Practitioner',
    providerSpecialty: 'General Medicine',
    providerAvatar: doctorChenImg,
    date: '2026-04-15',
    time: '2:30 PM',
    type: 'Follow-Up',
    status: 'scheduled',
    reasonForVisit: 'Post-renewal glycemic checkup and basic metabolic panel review.',
    triagePriority: 'routine',
    roomCode: 'MED-ZONE-918',
    encryptedSessionKey: 'ENC-KEY-99214-A128',
  },
];

export const INITIAL_PRESCRIPTIONS: Prescription[] = [
  {
    id: 'rx-201',
    patientId: 'pat-001',
    patientName: 'Ahmed Benali',
    medicationName: 'Lisinopril',
    dosage: '10mg',
    route: 'Oral',
    frequency: 'Once daily in morning with water',
    quantity: 30,
    totalRefills: 3,
    remainingRefills: 3,
    prescribingDoctor: 'Dr. Sophie Martin',
    prescribedDate: '2026-03-20',
    pharmacy: 'Central Care Pharmacy #4190',
    instructions: 'Take 1 tablet by mouth daily in the morning.',
    status: 'active',
    nextDoseMinutes: 45,
    adherencePercentage: 98,
  },
  {
    id: 'rx-202',
    patientId: 'pat-001',
    patientName: 'Ahmed Benali',
    medicationName: 'Metformin Hydrochloride ER',
    dosage: '500mg',
    route: 'Oral',
    frequency: 'Once daily with evening meal',
    quantity: 60,
    totalRefills: 2,
    remainingRefills: 2,
    prescribingDoctor: 'Dr. Sophie Martin',
    prescribedDate: '2026-03-20',
    pharmacy: 'Central Care Pharmacy #4190',
    instructions: 'Take with evening meal to minimize gastrointestinal discomfort.',
    status: 'active',
    nextDoseMinutes: 320,
    adherencePercentage: 95,
  },
  {
    id: 'rx-203',
    patientId: 'pat-001',
    patientName: 'Ahmed Benali',
    medicationName: 'Atorvastatin Calcium',
    dosage: '20mg',
    route: 'Oral',
    frequency: 'Once daily at bedtime',
    quantity: 30,
    totalRefills: 1,
    remainingRefills: 1,
    prescribingDoctor: 'Dr. Sophie Martin',
    prescribedDate: '2026-03-20',
    pharmacy: 'Central Care Pharmacy #4190',
    instructions: 'Take 1 tablet daily at bedtime.',
    status: 'active',
    nextDoseMinutes: 480,
    adherencePercentage: 94,
  },
];

export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'aud-01',
    timestamp: '2026-03-26T15:58:30Z',
    userRole: 'clinician',
    userName: 'Sophie Martin',
    action: 'VIEW_RECORD',
    details: 'Opened Follow-up Details for Chronic treatment prescription renewal (#CC2026-042)',
    targetMrn: 'MRN-849201',
    ipMasked: '192.168.1.***',
    status: 'VERIFIED_HIPAA',
  },
  {
    id: 'aud-02',
    timestamp: '2026-03-26T16:00:12Z',
    userRole: 'clinician',
    userName: 'Sophie Martin',
    action: 'START_CONSULTATION',
    details: 'Initiated secure teleconsultation session with patient Ahmed Benali',
    targetMrn: 'MRN-849201',
    ipMasked: '192.168.1.***',
    status: 'VERIFIED_HIPAA',
  },
];

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    title: 'Teleconsultation Starting',
    message: 'Prescription renewal meeting with Ahmed Benali scheduled for 4:00 PM.',
    type: 'appointment',
    timestamp: 'Just now',
    read: false,
    actionPayload: 'apt-101',
  },
  {
    id: 'notif-2',
    title: 'Treatment Protocol Updated',
    message: 'Chronic treatment follow-up #CC2026-042 has been marked active.',
    type: 'clinical',
    timestamp: '1h ago',
    read: true,
  },
];
