/**
 * Structural empty records used while (or in case) the backend bootstrap
 * has not resolved.
 *
 * These intentionally contain NO clinical or identity data — they are blank
 * typed shapes so the client never falls back to mock records. Every real
 * value arrives from GET /api/bootstrap.
 */
import type { PatientProfile, SOAPNotes } from '../types';

export const EMPTY_PATIENT: PatientProfile = {
  id: '',
  mrn: '',
  name: '',
  dob: '',
  age: 0,
  gender: '',
  bloodType: '',
  email: '',
  phone: '',
  avatarUrl: '',
  address: '',
  emergencyContact: { name: '', relationship: '', phone: '' },
  insurance: { provider: '', policyNumber: '', groupNumber: '' },
  allergies: [],
  conditions: [],
  recentLabs: [],
  vitalsHistory: [],
};

export const EMPTY_SOAP_NOTES: SOAPNotes = {
  subjective: '',
  objective: '',
  assessment: '',
  plan: '',
  lastUpdated: '',
  isSigned: false,
};
