/**
 * Pure mapping from the backend bootstrap payload to the client store shape.
 *
 * The backend is the single source of truth: once a bootstrap response
 * arrives, every entity is replaced by what the server returned — empty
 * collections included — so no local or mock value survives hydration.
 *
 * Avatar resolution is injected as `mapAvatar` to keep this module free of
 * bundler asset concerns, which also makes it importable by plain Node tests.
 */
import type {
  Appointment,
  AuditLogEntry,
  ChatMessage,
  ConsultantNote,
  ConsultationRequest,
  FollowUpDetail,
  NotificationItem,
  PatientProfile,
  Prescription,
  ProviderProfile,
  Referral,
  SOAPNotes,
} from '../types';
import type { BootstrapPayload } from './api';
import { EMPTY_PATIENT, EMPTY_SOAP_NOTES } from '../data/defaults';

export interface BootstrapSnapshot {
  patient: PatientProfile;
  patients: PatientProfile[];
  providers: ProviderProfile[];
  appointments: Appointment[];
  prescriptions: Prescription[];
  auditLogs: AuditLogEntry[];
  notifications: NotificationItem[];
  followUp: FollowUpDetail | null;
  followUps: FollowUpDetail[];
  soapNotes: SOAPNotes;
  chatMessages: ChatMessage[];
  consultantNotes: ConsultantNote[];
  consultationRequests: ConsultationRequest[];
  referrals: Referral[];
}

type AvatarMapper = (value: string) => string;

const identity = (value: string): string => value;

/** Builds the full client snapshot for a successful bootstrap response. */
export function snapshotFromBootstrap(
  data: BootstrapPayload,
  mapAvatar: AvatarMapper = identity
): BootstrapSnapshot {
  return {
    patient: data.patient
      ? { ...data.patient, avatarUrl: mapAvatar(data.patient.avatarUrl) }
      : EMPTY_PATIENT,
    patients: (data.patients ?? []).map(patient => ({
      ...patient,
      avatarUrl: mapAvatar(patient.avatarUrl),
    })),
    providers: (data.providers ?? []).map(provider => ({
      ...provider,
      avatarUrl: mapAvatar(provider.avatarUrl),
    })),
    appointments: (data.appointments ?? []).map(appointment => ({
      ...appointment,
      providerAvatar: mapAvatar(appointment.providerAvatar),
    })),
    prescriptions: data.prescriptions ?? [],
    auditLogs: data.auditLogs ?? [],
    notifications: data.notifications ?? [],
    followUp: data.followUp ?? null,
    followUps: data.followUps ?? [],
    soapNotes: data.soapNotes ?? EMPTY_SOAP_NOTES,
    chatMessages: data.chatMessages ?? [],
    consultantNotes: data.consultantNotes ?? [],
    consultationRequests: data.consultationRequests ?? [],
    referrals: (data as Partial<BootstrapPayload>).referrals ?? [],
  };
}
