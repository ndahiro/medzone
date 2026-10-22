import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  UserRole,
  PatientProfile,
  ProviderProfile,
  Appointment,
  Prescription,
  AuditLogEntry,
  ConsultationRequest,
  NotificationItem,
  Referral,
  SOAPNotes,
  ChatMessage,
  ConsultantNote,
  FollowUpDetail,
  VisitAttachment,
  VisitInvite,
  InviteChannel,
} from '../types';
import { EMPTY_PATIENT, EMPTY_SOAP_NOTES } from '../data/defaults';
import { snapshotFromBootstrap } from '../lib/hydrate';
import { validateBooking } from '../lib/bookingValidation';
import { useAuth } from './AuthContext';
import {
  revokeMfaSession as apiRevokeMfaSession,
  verifyMfaCode as apiVerifyMfaCode,
} from '../lib/auth';
import { soundManager } from '../lib/audio';
import { lookupRxNorm, toFhirDateTime } from '../lib/terminology';
import { resolveAvatarUrl, toAvatarKey } from '../lib/assets';
import {
  fetchBootstrap,
  fetchAppointments as apiFetchAppointments,
  fetchSoapNote,
  startConsultationSession as apiStartConsultationSession,
  createAppointment as apiCreateAppointment,
  createAppointmentChecked as apiCreateAppointmentChecked,
  updateAppointmentStatus as apiUpdateAppointmentStatus,
  createPrescription as apiCreatePrescription,
  updatePrescription as apiUpdatePrescription,
  createAuditLog as apiCreateAuditLog,
  createNotification as apiCreateNotification,
  markNotificationRead as apiMarkNotificationRead,
  markAllNotificationsRead as apiMarkAllNotificationsRead,
  createChatMessage as apiCreateChatMessage,
  fetchChatMessages as apiFetchChatMessages,
  saveSoapNote as apiSaveSoapNote,
  createConsultantNote as apiCreateConsultantNote,
  createConsultationRequest as apiCreateConsultationRequest,
  updateConsultationRequestStatus as apiUpdateConsultationRequestStatus,
  updateFollowUpStatus as apiUpdateFollowUpStatus,
  createReferral as apiCreateReferral,
  updateReferralStatus as apiUpdateReferralStatus,
  createVisitInvite as apiCreateVisitInvite,
  fetchWaitingRoom as apiFetchWaitingRoom,
  claimWaitingVisit as apiClaimWaitingVisit,
  fetchVisitAttachments as apiFetchVisitAttachments,
  createVisitAttachment as apiCreateVisitAttachment,
} from '../lib/api';

interface MedZoneContextType {
  role: UserRole;
  /**
   * The chart in focus. A patient session always sees its own chart; a staff
   * session sees the chart selected from `patients` (never a guessed first
   * row), so the clinician station can move between patients.
   */
  patient: PatientProfile;
  /** Staff directory from the bootstrap; a patient session receives one row. */
  patients: PatientProfile[];
  /** Chart currently in focus (empty id for an unlinked patient account). */
  selectedPatientId: string;
  /** Staff chart selection; ignored for a patient session. */
  selectPatient: (patientId: string) => void;
  providers: ProviderProfile[];
  appointments: Appointment[];
  prescriptions: Prescription[];
  auditLogs: AuditLogEntry[];
  /** Backend-first audit write for a user-driven clinical/document action. */
  addAuditLog: (action: AuditLogEntry['action'], details: string, targetMrn?: string) => void;
  notifications: NotificationItem[];
  unreadNotifsCount: number;
  mfaVerified: boolean;
  /**
   * Server-verified TOTP. The code is checked by POST /api/mfa/verify, which
   * re-signs the session cookie with the verification claim; resolves false
   * (with an explanation) when the code is wrong or MFA is unconfigured.
   */
  verifyMfa: (code: string) => Promise<boolean>;
  revokeMfa: () => Promise<void>;
  soundEnabled: boolean;
  toggleSound: () => void;
  activeConsultation: Appointment | null;
  /**
   * Server-authorized room admission. Resolves true once the backend admitted
   * this session to the visit; false (with a notification) when it refused or
   * was unreachable, in which case no room opens.
   */
  startConsultation: (appointment: Appointment) => Promise<boolean>;
  endConsultation: () => void;
  /** Closes the local room without completing the visit (lobby cancel). */
  leaveConsultationRoom: () => void;
  /** Patient checks in: scheduled -> in-progress (waiting room). */
  checkInAppointment: (id: string) => Promise<boolean>;
  /** Either party cancels an upcoming visit. */
  cancelAppointment: (id: string) => Promise<boolean>;
  soapNotes: SOAPNotes;
  updateSoapNotes: (partial: Partial<SOAPNotes>) => void;
  /** Signs the encounter note; only true once the backend stored it. */
  signSoapNotes: () => Promise<boolean>;
  chatMessages: ChatMessage[];
  sendConsultationMessage: (text: string) => Promise<void>;
  bookAppointment: (
    providerId: string,
    date: string,
    time: string,
    type: Appointment['type'],
    reason: string
  ) => Promise<boolean>;
  issuePrescription: (
    medicationName: string,
    dosage: string,
    route: Prescription['route'],
    frequency: string,
    quantity: number,
    refills: number,
    instructions: string,
    pharmacy: string
  ) => Promise<boolean>;
  requestRefill: (prescriptionId: string) => Promise<boolean>;
  markDoseTaken: (prescriptionId: string) => Promise<boolean>;
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;
  triggerPushNotification: (title: string, message: string, type?: NotificationItem['type']) => void;
  showComplianceModal: boolean;
  setShowComplianceModal: (show: boolean) => void;
  showFhirModal: boolean;
  setShowFhirModal: (show: boolean) => void;
  showSummaryExportModal: boolean;
  setShowSummaryExportModal: (show: boolean) => void;
  /** Clinician-authored notes surfaced on the patient portal. */
  consultantNotes: ConsultantNote[];
  addConsultantNote: (input: { patientId: string; title: string; body: string }) => Promise<boolean>;
  /** Consultation requests (patient-submitted, clinician-triaged). */
  consultationRequests: ConsultationRequest[];
  submitConsultationRequest: (input: {
    topic: string;
    urgency: ConsultationRequest['urgency'];
    preferredDate: string;
    details: string;
    contact: string;
  }) => Promise<boolean>;
  /** Triage a pending request; accepting auto-schedules the visit. */
  reviewConsultationRequest: (
    id: string,
    decision: 'accepted' | 'declined'
  ) => Promise<boolean>;
  /** Specialist referrals (both directions share one triage inbox). */
  referrals: Referral[];
  createReferral: (input: {
    specialty: string;
    reason: string;
    priority: Referral['priority'];
    notes: string;
    referredToProviderId?: string;
  }) => Promise<boolean>;
  /** Triage a pending referral; accepting auto-schedules a Specialist Review. */
  reviewReferral: (id: string, decision: 'accepted' | 'declined') => Promise<boolean>;
  /** Mark an accepted referral completed once the specialty visit is done. */
  completeReferral: (id: string) => Promise<boolean>;
  /** Follow-up record in focus (null while absent). */
  followUp: FollowUpDetail | null;
  /** Staff follow-up inbox; a patient session receives only its own record. */
  followUps: FollowUpDetail[];
  /** Staff follow-up selection. */
  selectFollowUp: (followUpId: string) => void;
  /** Persisted close: Active/Pending -> Closed. False when backend unreachable. */
  closeFollowUp: () => Promise<boolean>;
  /** Reopen a Closed follow-up back to Active. */
  reopenFollowUp: () => Promise<boolean>;
  /** Generic persisted follow-up status update. */
  updateFollowUpStatus: (status: FollowUpDetail['status']) => Promise<boolean>;
  /** True once the bootstrap read has settled (success or failure). */
  isHydrated: boolean;
  /** Display name of the signed-in account, sourced from the auth backend. */
  signedInUserName: string;
  /**
   * Mints a single-click patient invitation link for a visit (HCW@Home
   * parity). Resolves null when the backend refuses or is unreachable.
   */
  createInviteLink: (appointmentId: string, channel?: InviteChannel) => Promise<VisitInvite | null>;
  /**
   * Clinic-wide waiting room: every checked-in visit for any available doctor
   * to pick up, plus the claim action that records who took the patient.
   */
  waitingRoom: Appointment[];
  refreshWaitingRoom: () => Promise<void>;
  claimWaitingVisit: (appointmentId: string) => Promise<boolean>;
  /** Files/images shared in the active visit; loaded on room open. */
  attachments: VisitAttachment[];
  loadAttachments: (appointmentId: string) => Promise<void>;
  shareAttachment: (file: File) => Promise<boolean>;
}

const MedZoneContext = createContext<MedZoneContextType | undefined>(undefined);

// UI preferences only. Clinical entities are never cached in localStorage:
// the backend bootstrap is the single source of truth, and persisting PHI
// in the browser would be both a staleness risk and a HIPAA concern.
const UI_PREF_PREFIX = 'medzone_ui_v1_';

/** Collision-safe client IDs; the backend treats them as opaque keys. */
const newId = (prefix: string): string => {
  const unique =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return `${prefix}-${unique}`;
};

/** Reads a browser File into a base64 string (no data: prefix). */
const fileToBase64 = (file: File): Promise<string | null> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });

export const MedZoneProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Signed-in identity comes from the session backend (AuthProvider mounts
  // above MedZoneProvider) — never from hardcoded persona strings.
  const { user } = useAuth();

  // 1. Role — the clinical identity of the signed-in account, never a local
  // preference. RBAC follows the session: a patient login must render the
  // patient surfaces whatever the browser previously stored, so the old
  // localStorage persona switch is gone — it let a patient flip the UI into
  // the clinician view and expose staff-only controls.
  // Admin accounts carry the clinical (staff) scope, mirroring CLINICAL_ROLES
  // on the API. Default to the least-privileged role when signed out.
  const role: UserRole =
    user?.role === 'clinician' || user?.role === 'admin' ? 'clinician' : 'patient';

  // 2. Patient & Clinical Entities — backend-owned, never seeded locally.
  // Each starts empty and is replaced wholesale by GET /api/bootstrap.
  //
  // `chart` is the patient's own chart. Staff bootstrap returns `patient:
  // null` plus a directory; `selectedPatientId` chooses which directory row
  // is in focus, and `patient` below resolves to that row.
  const [chart, setChart] = useState<PatientProfile>(EMPTY_PATIENT);
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const isPatientAccount = user?.role === 'patient' && !user?.isAdmin;
  const selectedPatient = isPatientAccount
    ? chart
    : patients.find(p => p.id === selectedPatientId) ?? EMPTY_PATIENT;
  const patient = selectedPatient;

  const selectPatient = useCallback((patientId: string) => {
    // A patient account is bound to one chart; switching is a staff action.
    if (isPatientAccount) return;
    setSelectedPatientId(prev => (prev === patientId ? prev : patientId));
  }, [isPatientAccount]);

  /**
   * Notification feed write. The entry is persisted first so the bell list
   * survives reloads; when the backend is unreachable the alert is still
   * raised locally (the event happened in this session) but the durable
   * record is honestly absent.
   */
  const triggerPushNotification = useCallback(
    (title: string, message: string, type: NotificationItem['type'] = 'medication') => {
      const newNotif: NotificationItem = {
        id: newId('notif'),
        title,
        message,
        type,
        timestamp: new Date().toISOString(),
        read: false,
      };

      // Check standard Web Notification permission if allowed
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(title, {
            body: message,
            icon: '/favicon.ico',
          });
        } catch {
          // Ignore iframe restrictions
        }
      }

      soundManager.playNotificationChime();
      // Patients cannot write the clinical notification feed (the API scopes
      // that write to staff); keep their alert local instead of firing a 403.
      if (isPatientAccount) {
        setNotifications(prev => [newNotif, ...prev]);
        return;
      }
      void apiCreateNotification(newNotif).then(saved => {
        setNotifications(prev => [saved ?? newNotif, ...prev]);
      });
    },
    [isPatientAccount]
  );

  // 4b. Consultant notes (clinician-authored, downloadable by the patient as PDF)
  const [consultantNotes, setConsultantNotes] = useState<ConsultantNote[]>([]);

  // Consultation requests (patient-submitted visit requests, clinician-triaged).
  const [consultationRequests, setConsultationRequests] = useState<ConsultationRequest[]>([]);

  // Specialist referrals (clinician-created or patient-requested, shared triage).
  const [referrals, setReferrals] = useState<Referral[]>([]);

  const [providers, setProviders] = useState<ProviderProfile[]>([]);

  // Follow-up records from the backend. Staff receive the inbox scoped to
  // their panel; a patient receives only their own record.
  const [followUp, setFollowUp] = useState<FollowUpDetail | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpDetail[]>([]);
  const [selectedFollowUpId, setSelectedFollowUpId] = useState<string>('');
  const activeFollowUp = isPatientAccount
    ? followUp
    : followUps.find(f => f.id === selectedFollowUpId) ?? followUps[0] ?? null;
  const selectFollowUp = useCallback((followUpId: string) => {
    if (isPatientAccount) return;
    setSelectedFollowUpId(prev => (prev === followUpId ? prev : followUpId));
  }, [isPatientAccount]);

  // Bootstrap completion flag: gates rendering until the backend read settles
  // so the UI never shows pre-backend (empty or stale) state.
  const [isHydrated, setIsHydrated] = useState(false);

  // Display name of the authenticated account (session backend via useAuth).
  const signedInUserName = user?.displayName ?? patient.name;

  // 3. Security & Settings — MFA is a server-side fact. The session cookie
  // carries the verification claim (set by POST /api/mfa/verify), so the badge
  // reflects what the API actually verified — never a client-side assumption.
  const [mfaVerified, setMfaVerified] = useState<boolean>(false);
  useEffect(() => {
    setMfaVerified(user?.mfaVerified === true);
  }, [user]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`${UI_PREF_PREFIX}sound`) !== 'off';
    } catch {
      return true;
    }
  });

  // Keep the audio synthesizer in sync with the persisted preference.
  useEffect(() => {
    soundManager.soundEnabled = soundEnabled;
  }, [soundEnabled]);

  // 4. Modal Triggers
  const [showComplianceModal, setShowComplianceModal] = useState<boolean>(false);
  const [showFhirModal, setShowFhirModal] = useState<boolean>(false);
  const [showSummaryExportModal, setShowSummaryExportModal] = useState<boolean>(false);

  // 5. Active Consultation State
  const [activeConsultation, setActiveConsultation] = useState<Appointment | null>(null);

  const [soapNotes, setSoapNotes] = useState<SOAPNotes>(EMPTY_SOAP_NOTES);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  // In-visit attachments and the clinic-wide waiting room (HCW@Home parity).
  const [attachments, setAttachments] = useState<VisitAttachment[]>([]);
  const [waitingRoom, setWaitingRoom] = useState<Appointment[]>([]);

  // Hydrate from the Express/MySQL backend. The bootstrap response is the
  // single source of truth: every entity is replaced with the server's data
  // (empty collections included). When the backend is unreachable the store
  // keeps its blank defaults; isHydrated settles either way so the shell can
  // stop waiting.
  //
  // The read is scoped to the session — a patient receives their own chart
  // only — so it must re-run when the session changes instead of being fetched
  // once while signed out. Waiting for `loading` avoids that wasted read.
  const authLoading = useAuth().loading;
  const sessionKey = user ? `${user.id}:${user.role}` : 'anonymous';
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    // A new session must not render the previous user's chart while its own
    // bootstrap is in flight, and no modal opened by the previous account may
    // reappear over the new one.
    setIsHydrated(false);
    setShowComplianceModal(false);
    setShowFhirModal(false);
    setShowSummaryExportModal(false);
    (async () => {
      try {
        const data = await fetchBootstrap();
        if (cancelled || !data) return;
        const snapshot = snapshotFromBootstrap(data, resolveAvatarUrl);
        setChart(snapshot.patient);
        setPatients(snapshot.patients);
        // A patient session always has exactly its own chart. Staff sessions
        // receive a directory; keep the current selection if it is still in
        // the directory, otherwise open the first chart so the station is not
        // blank. The visible chart picker is the explicit way to switch.
        setSelectedPatientId(prev => {
          if (snapshot.patient) return snapshot.patient.id;
          if (snapshot.patients.some(p => p.id === prev)) return prev;
          return snapshot.patients[0]?.id ?? '';
        });
        setProviders(snapshot.providers);
        setAppointments(snapshot.appointments);
        setPrescriptions(snapshot.prescriptions);
        setAuditLogs(snapshot.auditLogs);
        setNotifications(snapshot.notifications);
        setFollowUp(snapshot.followUp);
        setFollowUps(snapshot.followUps);
        setSelectedFollowUpId(prev =>
          snapshot.followUps.some(f => f.id === prev) ? prev : snapshot.followUps[0]?.id ?? ''
        );
        setSoapNotes(snapshot.soapNotes);
        setChatMessages(snapshot.chatMessages);
        setConsultantNotes(snapshot.consultantNotes);
        setConsultationRequests(snapshot.consultationRequests);
        setReferrals(snapshot.referrals);
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, sessionKey]);

  // Persist UI preferences only — never clinical entities.

  // Prescription countdown: recompute remaining minutes from the server's
  // absolute due time. The countdown is a projection of `nextDoseAt` — it can
  // no longer drift from the stored record, and a reload shows the same value
  // every other client sees.
  useEffect(() => {
    const timer = setInterval(() => {
      setPrescriptions(prevList =>
        prevList.map(rx => {
          if (rx.status !== 'active' || !rx.nextDoseAt) return rx;
          const dueMs = Date.parse(rx.nextDoseAt);
          if (!Number.isFinite(dueMs)) return rx;
          const remaining = Math.max(0, Math.round((dueMs - Date.now()) / 60000));
          if (remaining === rx.nextDoseMinutes) return rx;
          if (remaining === 15 && rx.nextDoseMinutes > 15) {
            triggerPushNotification(
              `Medication Reminder: ${rx.medicationName}`,
              `Your ${rx.dosage} dose is scheduled in 15 minutes.`,
              'medication'
            );
          }
          return { ...rx, nextDoseMinutes: remaining };
        })
      );
    }, 60000); // every minute

    return () => clearInterval(timer);
  }, [triggerPushNotification]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundManager.soundEnabled = next;
    try {
      localStorage.setItem(`${UI_PREF_PREFIX}sound`, next ? 'on' : 'off');
    } catch {
      // Ignore persistence failures.
    }
  };

  /**
   * Audit write, backend-first: the entry enters the local trail only after
   * the server stored it, and the stored copy (identity, masked IP and status
   * stamped server-side from the session and the request) is what gets shown.
   * A failed write is announced — never fabricated into the trail.
   */
  const addAuditLog = useCallback(
    (action: AuditLogEntry['action'], details: string, targetMrn?: string) => {
      void (async () => {
        const saved = await apiCreateAuditLog({
          id: newId('aud'),
          action,
          details,
          targetMrn: targetMrn || patient.mrn,
        });
        if (!saved) {
          triggerPushNotification(
            'Audit Entry Not Recorded',
            'The compliance log could not be reached — this action was not recorded.',
            'security',
          );
          return;
        }
        setAuditLogs(prev => [saved, ...prev]);
      })();
    },
    [patient.mrn, triggerPushNotification]
  );

  // Automated visit reminders (HCW@Home parity): a 24-hour heads-up and a
  // 15-minute "starting soon" nudge for each scheduled visit. Each window
  // fires at most once per session — the dedup set is session-scoped in a
  // ref, so no reminder or PHI state is ever persisted.
  const appointmentsRef = useRef<Appointment[]>([]);
  appointmentsRef.current = appointments;
  const remindedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const apt of appointmentsRef.current) {
        if (apt.status !== 'scheduled') continue;
        const start = Date.parse(apt.scheduledStart);
        if (Number.isNaN(start)) continue;
        const minsLeft = (start - now) / 60000;
        if (minsLeft < 0) continue;
        const windows = [
          {
            key: '24h',
            withinMinutes: 24 * 60,
            title: `Appointment Reminder: ${apt.type}`,
            message: `Visit with ${apt.providerName} is within 24 hours (${apt.date} at ${apt.time}).`,
          },
          {
            key: '15m',
            withinMinutes: 15,
            title: `Starting Soon: ${apt.providerName}`,
            message: `Your visit begins in under 15 minutes. Check in from your dashboard when ready.`,
          },
        ];
        for (const window of windows) {
          const dedupKey = `${apt.id}:${window.key}`;
          if (minsLeft <= window.withinMinutes && !remindedRef.current.has(dedupKey)) {
            remindedRef.current.add(dedupKey);
            triggerPushNotification(window.title, window.message, 'appointment');
          }
        }
      }
    };
    check();
    const timer = setInterval(check, 60000);
    return () => clearInterval(timer);
  }, [triggerPushNotification]);

  // Pair live-sync: while a consultation is active, poll that appointment's
  // transcript and append only unseen messages, so the two parties' replies
  // arrive without a reload. Scoped to the active call — idle clients poll
  // nothing. Hidden tabs skip ticks. The interval is jittered so 50 pairs do
  // not pulse the transcript endpoint on the same millisecond.
  const activeConsultationRef = useRef<Appointment | null>(null);
  activeConsultationRef.current = activeConsultation;

  useEffect(() => {
    if (!isHydrated) return;
    const tick = async () => {
      const active = activeConsultationRef.current;
      if (!active) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const fresh = await apiFetchChatMessages(active.id);
      if (!fresh) return;
      setChatMessages(prev => {
        const known = new Set(prev.map(m => m.id));
        const incoming = fresh.filter(m => !known.has(m.id));
        return incoming.length > 0 ? [...prev, ...incoming] : prev;
      });
    };
    const intervalMs = 3000 + Math.floor(Math.random() * 1500);
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [isHydrated]);

  // Pair live-sync: merge server appointment state (status moves, new visits
  // booked by the other party) into the local list. Existing rows update in
  // place, unknown ids are added with resolved avatars, and nothing local is
  // ever deleted — the server has no appointment delete route, so a merge
  // cannot drop a just-created optimistic record. The active consultation
  // follows its row so a remote cancel/complete is reflected in the room.
  // Jittered (50 pairs must not pulse the list endpoint together); the active
  // room short-circuits through the 3s transcript tick for status moves.
  useEffect(() => {
    if (!isHydrated) return;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const fresh = await apiFetchAppointments();
      if (!fresh) return;
      const serverById = new Map(fresh.map(a => [a.id, a]));
      setAppointments(prev => {
        let changed = false;
        const next = prev.map(local => {
          const server = serverById.get(local.id);
          if (!server) return local;
          const merged = {
            ...server,
            providerAvatar: resolveAvatarUrl(server.providerAvatar),
          };
          if (JSON.stringify(merged) !== JSON.stringify(local)) changed = true;
          return merged;
        });
        for (const server of fresh) {
          if (!next.some(a => a.id === server.id)) {
            changed = true;
            next.unshift({
              ...server,
              providerAvatar: resolveAvatarUrl(server.providerAvatar),
            });
          }
        }
        return changed ? next : prev;
      });
      const active = activeConsultationRef.current;
      const activeFresh = active ? serverById.get(active.id) : undefined;
      if (active && activeFresh && activeFresh.status !== active.status) {
        if (activeFresh.status === 'completed' || activeFresh.status === 'cancelled') {
          // The encounter closed server-side (the other party ended the visit
          // or the clinic cancelled it). The room must not linger on a closed
          // visit: drop out and explain why.
          setActiveConsultation(null);
          triggerPushNotification(
            'Visit Ended',
            activeFresh.status === 'cancelled'
              ? 'The clinic cancelled this visit — the room was closed.'
              : 'The other participant ended the visit — the room was closed.',
            'appointment'
          );
        } else {
          setActiveConsultation({
            ...activeFresh,
            providerAvatar: resolveAvatarUrl(activeFresh.providerAvatar),
          });
        }
      }
    };
    const intervalMs = 15000 + Math.floor(Math.random() * 5000);
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [isHydrated, triggerPushNotification]);

  // Backend-first write: the note is POSTed first and only enters the store
  // once the server confirms it, so the patient portal can never show a note
  // the backend does not have. Returns false (with an error notification)
  // when the backend is unreachable.
  const addConsultantNote = useCallback(
    async (input: { patientId: string; title: string; body: string }): Promise<boolean> => {
      const appointment = appointments.find((apt) => apt.patientId === input.patientId);
      const isCurrentPatient = patient.id === input.patientId;
      const note: ConsultantNote = {
        id: newId('cn'),
        patientId: input.patientId,
        patientName: appointment?.patientName ?? (isCurrentPatient ? patient.name : 'Unknown Patient'),
        patientMrn: appointment?.patientMrn ?? (isCurrentPatient ? patient.mrn : 'N/A'),
        authorName: signedInUserName,
        authorRole: role,
        title: input.title,
        body: input.body,
        createdAt: new Date().toISOString(),
      };
      const saved = await apiCreateConsultantNote(note);
      if (!saved) {
        triggerPushNotification(
          'Consultant Note Not Saved',
          'The backend could not be reached — please retry. Nothing was saved.',
          'clinical',
        );
        return false;
      }
      setConsultantNotes((prev) => [saved, ...prev]);
      triggerPushNotification(
        'Consultant Note Saved',
        `The note "${saved.title}" is now available on ${saved.patientName}'s portal.`,
        'clinical',
      );
      return true;
    },
    [appointments, patient, role, signedInUserName, triggerPushNotification],
  );

  // Backend-first write: the request is POSTed first and only enters the
  // store once the server confirms it. Returns false (with an error
  // notification) when the backend is unreachable.
  const submitConsultationRequest = useCallback(
    async (input: {
      topic: string;
      urgency: ConsultationRequest['urgency'];
      preferredDate: string;
      details: string;
      contact: string;
    }): Promise<boolean> => {
      const request: ConsultationRequest = {
        id: newId('cr'),
        patientId: patient.id,
        patientName: patient.name,
        patientMrn: patient.mrn,
        patientAge: patient.age,
        patientGender: patient.gender,
        topic: input.topic,
        urgency: input.urgency,
        preferredDate: input.preferredDate,
        details: input.details,
        contact: input.contact,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      const saved = await apiCreateConsultationRequest(request);
      if (!saved) {
        triggerPushNotification(
          'Request Not Sent',
          'The backend could not be reached — please retry. Nothing was sent.',
          'clinical',
        );
        return false;
      }
      setConsultationRequests((prev) => [saved, ...prev]);
      addAuditLog(
        'REQUEST_CONSULTATION',
        `Submitted consultation request "${saved.topic}" for ${saved.preferredDate} (${saved.urgency})`
      );
      triggerPushNotification(
        'Consultation Request Sent',
        `Your request "${saved.topic}" is with the care team for triage.`,
        'clinical',
      );
      return true;
    },
    [patient, triggerPushNotification, addAuditLog],
  );

  // Triage a pending request. Accepting also schedules the visit with the
  // best-matching provider (specialty mention wins, otherwise the first
  // provider) on the requested date.
  const reviewConsultationRequest = useCallback(
    async (id: string, decision: 'accepted' | 'declined'): Promise<boolean> => {
      const target = consultationRequests.find((r) => r.id === id);
      if (!target || target.status !== 'pending') return false;
      const updated = await apiUpdateConsultationRequestStatus(id, decision);
      if (!updated) {
        triggerPushNotification(
          'Review Not Saved',
          'The backend could not be reached — please retry.',
          'clinical',
        );
        return false;
      }
      setConsultationRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
      addAuditLog(
        'REQUEST_CONSULTATION',
        `${decision === 'accepted' ? 'Accepted' : 'Declined'} consultation request "${target.topic}" from ${target.patientName} (${target.patientMrn})`
      );
      if (decision === 'accepted') {
        const topic = target.topic.toLowerCase();
        const matched =
          providers.find((p) =>
            topic.includes(p.specialty.toLowerCase()) || p.specialty.toLowerCase().includes(topic)
          ) ?? providers[0];
        if (matched) {
          const visitType: Appointment['type'] = topic.includes('specialist')
            ? 'Specialist Review'
            : 'Virtual Consultation';
          const slot = matched.availableTimes[0] ?? '10:00 AM';
          const visit = buildAppointmentRecord(
            matched,
            target.preferredDate,
            slot,
            visitType,
            `${target.topic}: ${target.details}`,
          );
          setAppointments((prev) => [visit, ...prev]);
          void apiCreateAppointment({ ...visit, providerAvatar: toAvatarKey(visit.providerAvatar) });
          triggerPushNotification(
            'Visit Scheduled From Request',
            `${target.patientName}: ${visitType} with ${matched.name} on ${target.preferredDate} at ${slot}.`,
            'appointment',
          );
        }
      } else {
        triggerPushNotification(
          'Request Declined',
          `The consultation request "${target.topic}" was declined. The patient has been notified.`,
          'clinical',
        );
      }
      return true;
    },
    [consultationRequests, providers, signedInUserName, addAuditLog, triggerPushNotification],
  );

  // Backend-first write: works for both directions. The caller’s role becomes
  // the referral source; patient demographics come from the current record.
  const createReferral = useCallback(
    async (input: {
      specialty: string;
      reason: string;
      priority: Referral['priority'];
      notes: string;
      referredToProviderId?: string;
    }): Promise<boolean> => {
      const specialty = input.specialty.trim();
      const reason = input.reason.trim();
      if (!specialty || !reason) return false;
      const targetProvider = input.referredToProviderId
        ? providers.find((p) => p.id === input.referredToProviderId)
        : providers.find(
            (p) => p.specialty.toLowerCase().includes(specialty.toLowerCase()) ||
              specialty.toLowerCase().includes(p.specialty.toLowerCase().split(' ')[0])
          );
      const referral: Referral = {
        id: newId('ref'),
        patientId: patient.id,
        patientName: patient.name,
        patientMrn: patient.mrn,
        patientAge: patient.age,
        patientGender: patient.gender,
        specialty,
        ...(targetProvider ? { referredToProviderId: targetProvider.id, referredToProviderName: targetProvider.name } : {}),
        reason,
        priority: input.priority,
        notes: input.notes.trim(),
        status: 'pending',
        source: role === 'clinician' ? 'clinician' : 'patient',
        createdBy: signedInUserName,
        createdAt: new Date().toISOString(),
      };
      const saved = await apiCreateReferral(referral);
      if (!saved) {
        triggerPushNotification(
          'Referral Not Sent',
          'The backend could not be reached — please retry. Nothing was sent.',
          'clinical',
        );
        return false;
      }
      setReferrals((prev) => [saved, ...prev]);
      addAuditLog(
        'REQUEST_CONSULTATION',
        `${role === 'clinician' ? 'Referred' : 'Requested referral for'} ${saved.patientName} to ${saved.specialty} (${saved.priority}): ${saved.reason}`
      );
      triggerPushNotification(
        role === 'clinician' ? 'Referral Created' : 'Referral Requested',
        `${saved.patientName} → ${saved.specialty}${saved.referredToProviderName ? ` (${saved.referredToProviderName})` : ''} is pending triage.`,
        'clinical',
      );
      return true;
    },
    [patient, providers, role, signedInUserName, addAuditLog, triggerPushNotification],
  );

  // Triage a pending referral. Accepting auto-schedules a Specialist Review
  // with the named (or best-matching) provider; declining only records it.
  const reviewReferral = useCallback(
    async (id: string, decision: 'accepted' | 'declined'): Promise<boolean> => {
      const target = referrals.find((r) => r.id === id);
      if (!target || target.status !== 'pending') return false;
      const updated = await apiUpdateReferralStatus(id, decision);
      if (!updated) {
        triggerPushNotification(
          'Referral Not Updated',
          'The backend could not be reached or the transition is illegal — please retry.',
          'clinical',
        );
        return false;
      }
      setReferrals((prev) => prev.map((r) => (r.id === id ? updated : r)));
      addAuditLog(
        'REQUEST_CONSULTATION',
        `${decision === 'accepted' ? 'Accepted' : 'Declined'} referral of ${target.patientName} to ${target.specialty}`
      );
      if (decision === 'accepted') {
        const matched =
          providers.find((p) => p.id === target.referredToProviderId) ??
          providers.find((p) =>
            target.specialty.toLowerCase().includes(p.specialty.toLowerCase()) ||
            p.specialty.toLowerCase().includes(target.specialty.toLowerCase())
          ) ?? providers[0];
        if (matched) {
          const slot = matched.availableTimes[0] ?? '10:00 AM';
          const visit = buildAppointmentRecord(
            matched,
            new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
            slot,
            'Specialist Review',
            `Referral to ${target.specialty}: ${target.reason}${target.notes ? ` — ${target.notes}` : ''}`,
          );
          setAppointments((prev) => [visit, ...prev]);
          void apiCreateAppointment({ ...visit, providerAvatar: toAvatarKey(visit.providerAvatar) });
          triggerPushNotification(
            'Specialist Visit Scheduled',
            `${target.patientName}: Specialist Review for ${target.specialty} with ${matched.name}.`,
            'appointment',
          );
        }
      } else {
        triggerPushNotification(
          'Referral Declined',
          `The referral of ${target.patientName} to ${target.specialty} was declined.`,
          'clinical',
        );
      }
      return true;
    },
    [referrals, providers, signedInUserName, addAuditLog, triggerPushNotification],
  );

  const completeReferral = useCallback(
    async (id: string): Promise<boolean> => {
      const target = referrals.find((r) => r.id === id);
      if (!target || target.status !== 'accepted') return false;
      const updated = await apiUpdateReferralStatus(id, 'completed');
      if (!updated) {
        triggerPushNotification(
          'Referral Not Updated',
          'The backend could not be reached — please retry.',
          'clinical',
        );
        return false;
      }
      setReferrals((prev) => prev.map((r) => (r.id === id ? updated : r)));
      triggerPushNotification(
        'Referral Completed',
        `The referral of ${target.patientName} to ${target.specialty} is marked completed.`,
        'clinical',
      );
      return true;
    },
    [referrals, signedInUserName, triggerPushNotification],
  );

  // Backend-first persisted follow-up status. The server is the source of
  // truth: local state only changes after PATCH /api/follow-up/:id/status
  // confirms, so a reload shows the same status badge.
  const updateFollowUpStatus = useCallback(
    async (status: FollowUpDetail['status']): Promise<boolean> => {
      const target = activeFollowUp;
      if (!target) return false;
      if (target.status === status) return true;
      const updated = await apiUpdateFollowUpStatus(target.id, status);
      if (!updated) {
        triggerPushNotification(
          'Follow-up Not Updated',
          'The backend could not be reached — please retry. Nothing was changed.',
          'clinical',
        );
        return false;
      }
      setFollowUp(updated);
      setFollowUps(prev => prev.map(f => (f.id === updated.id ? updated : f)));
      if (status === 'Closed') {
        triggerPushNotification(
          'Follow-up Status Updated',
          `Follow-up ${updated.code} marked as closed in clinical archive.`,
          'clinical',
        );
      } else {
        triggerPushNotification(
          'Follow-up Reopened',
          `Follow-up ${updated.code} is ${status.toLowerCase()} again.`,
          'clinical',
        );
      }
      return true;
    },
    [activeFollowUp, triggerPushNotification],
  );

  const closeFollowUp = useCallback(
    () => updateFollowUpStatus('Closed'),
    [updateFollowUpStatus],
  );

  const reopenFollowUp = useCallback(
    () => updateFollowUpStatus('Active'),
    [updateFollowUpStatus],
  );

  /**
   * Server-side MFA: the TOTP code is verified by the API (which also re-signs
   * the session cookie), so the secret never reaches the browser. A refusal —
   * wrong code, unconfigured deployment, rate limit — is surfaced as-is.
   */
  const verifyMfa = async (code: string): Promise<boolean> => {
    try {
      const result = await apiVerifyMfaCode(code);
      const verified = result.mfaVerified === true;
      setMfaVerified(verified);
      if (!verified) return false;
      addAuditLog(
        'MFA_VERIFIED',
        'Passed server-verified RFC 6238 TOTP authentication (HMAC-SHA-1, 30s step, 6 digits)'
      );
      soundManager.playNotificationChime();
      return true;
    } catch (error) {
      triggerPushNotification(
        'MFA Verification Failed',
        error instanceof Error ? error.message : 'The MFA service could not be reached.',
        'security'
      );
      return false;
    }
  };

  const revokeMfa = async () => {
    try {
      const result = await apiRevokeMfaSession();
      setMfaVerified(result.mfaVerified === true);
    } catch (error) {
      triggerPushNotification(
        'MFA Not Revoked',
        error instanceof Error ? error.message : 'The MFA service could not be reached.',
        'security'
      );
    }
  };

  /**
   * Hardened room admission: the room opens only after the API authorizes
   * this session for the visit (participant, open status) and returns the
   * server's record — the client's copy of an appointment is never trusted to
   * mint a room. A refusal (another chart's visit, a closed encounter, an
   * expired session, backend down) surfaces as a notification and no room
   * opens. Joined rooms are recorded on the session's audit trail.
   */
  const startConsultation = useCallback(
    async (appointment: Appointment): Promise<boolean> => {
      const { appointment: admitted, error } = await apiStartConsultationSession(appointment.id);
      if (!admitted) {
        triggerPushNotification(
          'Visit Not Opened',
          error ?? 'The tele-visit was refused by the server.',
          'security'
        );
        return false;
      }
      setActiveConsultation({
        ...admitted,
        providerAvatar: resolveAvatarUrl(admitted.providerAvatar),
      });
      // The room is a chart context: staff prescribing and notes must target
      // the patient in this visit, not whichever chart was open before.
      if (!isPatientAccount) {
        setSelectedPatientId(admitted.patientId);
      }
      soundManager.playCallConnect();
      addAuditLog(
        'START_CONSULTATION',
        `Joined encrypted tele-visit room ${admitted.roomCode} for the ${admitted.type} with ${admitted.providerName}`
      );
      return true;
    },
    [addAuditLog, triggerPushNotification, isPatientAccount]
  );

  /**
   * Mints a single-click patient invitation link (HCW@Home parity). The link
   * is created backend-first, so a returned invite is one the server will
   * actually honour; a refusal is announced rather than faked locally.
   */
  const createInviteLink = useCallback(
    async (appointmentId: string, channel: InviteChannel = 'link'): Promise<VisitInvite | null> => {
      const invite = await apiCreateVisitInvite(appointmentId, channel);
      if (!invite) {
        triggerPushNotification(
          'Invite Not Created',
          'The visit service could not be reached — no link was created. Please retry.',
          'appointment',
        );
        return null;
      }
      addAuditLog('VIEW_RECORD', `Issued a patient invitation link for visit ${appointmentId} (${channel})`);
      return invite;
    },
    [addAuditLog, triggerPushNotification],
  );

  /**
   * Shared waiting room: every checked-in visit across the clinic, so any
   * available doctor can pick up a waiting patient (HCW@Home "waiting rooms
   * dispatched across several doctors").
   */
  const refreshWaitingRoom = useCallback(async () => {
    const list = await apiFetchWaitingRoom();
    if (list) setWaitingRoom(list.map(a => ({ ...a, providerAvatar: resolveAvatarUrl(a.providerAvatar) })));
  }, []);

  const claimWaitingVisit = useCallback(
    async (appointmentId: string): Promise<boolean> => {
      const claimed = await apiClaimWaitingVisit(appointmentId);
      if (!claimed) {
        triggerPushNotification(
          'Visit Not Claimed',
          'Another clinician may have picked this patient up already — the queue was refreshed.',
          'appointment',
        );
        await refreshWaitingRoom();
        return false;
      }
      setWaitingRoom(prev => prev.filter(a => a.id !== appointmentId));
      setAppointments(prev => {
        const exists = prev.some(a => a.id === claimed.id);
        const merged = { ...claimed, providerAvatar: resolveAvatarUrl(claimed.providerAvatar) };
        return exists ? prev.map(a => (a.id === claimed.id ? { ...a, ...merged } : a)) : [merged, ...prev];
      });
      addAuditLog(
        'START_CONSULTATION',
        `Picked up waiting patient ${claimed.patientName} (room ${claimed.roomCode})`,
      );
      triggerPushNotification(
        'Patient Picked Up',
        `${claimed.patientName} is now assigned to you — room ${claimed.roomCode}.`,
        'appointment',
      );
      return true;
    },
    [addAuditLog, refreshWaitingRoom, triggerPushNotification],
  );

  const loadAttachments = useCallback(async (appointmentId: string) => {
    const list = await apiFetchVisitAttachments(appointmentId);
    if (list) setAttachments(list);
  }, []);

  /**
   * Shares a file or image with the other participant of the live visit. The
   * row is stored backend-first (file name and content encrypted at rest), so
   * a shared file is one the backend actually holds for both parties.
   */
  const shareAttachment = useCallback(
    async (file: File): Promise<boolean> => {
      const active = activeConsultation;
      if (!active) return false;
      const contentBase64 = await fileToBase64(file);
      if (!contentBase64) {
        triggerPushNotification('File Not Shared', 'The selected file could not be read.', 'security');
        return false;
      }
      const saved = await apiCreateVisitAttachment(active.id, {
        id: newId('att'),
        fileName: file.name || 'attachment',
        mimeType: file.type || 'application/octet-stream',
        contentBase64,
      });
      if (!saved) {
        triggerPushNotification(
          'File Not Shared',
          'The visit service could not be reached — the file was not shared. Please retry.',
          'security',
        );
        return false;
      }
      setAttachments(prev => (prev.some(a => a.id === saved.id) ? prev : [...prev, saved]));
      return true;
    },
    [activeConsultation, triggerPushNotification],
  );

  // Load the active visit's shared files when a room opens; a closed room
  // keeps nothing, so no other visit's files can leak into the next one.
  useEffect(() => {
    const activeId = activeConsultation?.id;
    if (!activeId) {
      setAttachments([]);
      return;
    }
    void loadAttachments(activeId);
  }, [activeConsultation?.id, loadAttachments]);

  // Load the active visit's note and transcript when a room opens. Notes are
  // keyed to the appointment, never a clinic-wide singleton, so a note written
  // in one encounter cannot surface in another chart.
  useEffect(() => {
    const activeId = activeConsultation?.id;
    if (!activeId) {
      setChatMessages([]);
      setSoapNotes(EMPTY_SOAP_NOTES);
      return;
    }
    let cancelled = false;
    setChatMessages([]);
    setSoapNotes(EMPTY_SOAP_NOTES);
    void Promise.all([
      apiFetchChatMessages(activeId),
      fetchSoapNote(activeId),
    ]).then(([messages, note]) => {
      if (cancelled) return;
      if (messages) setChatMessages(messages);
      if (note) setSoapNotes(note);
    });
    return () => {
      cancelled = true;
    };
  }, [activeConsultation?.id]);

  // Leaving the room ends the encounter for both parties (visit state
  // machine: in-progress -> completed). The local room closes immediately so
  // the participant is never trapped; a failed sync is announced rather than
  // silently assumed.
  const endConsultation = () => {
    const ending = activeConsultation;
    if (ending) {
      setAppointments(prev =>
        prev.map(a => (a.id === ending.id ? { ...a, status: 'completed' } : a))
      );
      void apiUpdateAppointmentStatus(ending.id, 'completed').then(updated => {
        if (!updated) {
          triggerPushNotification(
            'Visit Not Synced',
            'The visit service could not be reached — the encounter may still show as in progress to the other participant.',
            'appointment'
          );
        }
      });
    }
    setActiveConsultation(null);
    setChatMessages([]);
    setSoapNotes(EMPTY_SOAP_NOTES);
    setAttachments([]);
  };

  // Lobby cancel is not an encounter end: the visit stays in progress so the
  // patient can rejoin. Ending a visit is the explicit "Leave" action.
  const leaveConsultationRoom = () => {
    setActiveConsultation(null);
    setChatMessages([]);
    setSoapNotes(EMPTY_SOAP_NOTES);
    setAttachments([]);
  };

  // Waiting-room flow (HCW@Home queue parity): a scheduled visit moves to
  // `in-progress` when the patient checks in, so the clinician sees a live
  // waiting room instead of a static schedule. The transition is persisted
  // first — a check-in the server refused is announced, not staged locally.
  const checkInAppointment = useCallback(
    async (id: string): Promise<boolean> => {
      const apt = appointments.find(a => a.id === id);
      if (!apt || apt.status !== 'scheduled') return false;
      const updated = await apiUpdateAppointmentStatus(id, 'in-progress');
      if (!updated) {
        triggerPushNotification(
          'Check-in Not Recorded',
          'The visit service could not be reached — you are not checked in yet. Please retry.',
          'appointment'
        );
        return false;
      }
      setAppointments(prev =>
        prev.map(a => (a.id === id ? { ...a, ...updated } : a))
      );
      addAuditLog(
        'CHECK_IN',
        `Patient checked in to the waiting room for ${apt.type} with ${apt.providerName} (room ${apt.roomCode})`
      );
      triggerPushNotification(
        'Patient Checked In',
        `${apt.patientName} is waiting for ${apt.providerName} — room ${apt.roomCode}.`,
        'appointment'
      );
      return true;
    },
    [appointments, addAuditLog, triggerPushNotification]
  );

  const cancelAppointment = useCallback(
    async (id: string): Promise<boolean> => {
      const apt = appointments.find(a => a.id === id);
      if (!apt || apt.status === 'completed' || apt.status === 'cancelled') return false;
      const updated = await apiUpdateAppointmentStatus(id, 'cancelled');
      if (!updated) {
        triggerPushNotification(
          'Cancellation Not Recorded',
          'The visit service could not be reached — the visit was not cancelled. Please retry.',
          'appointment'
        );
        return false;
      }
      setAppointments(prev =>
        prev.map(a => (a.id === id ? { ...a, ...updated } : a))
      );
      addAuditLog(
        'CANCEL_VISIT',
        `Cancelled ${apt.type} with ${apt.providerName} on ${apt.date} at ${apt.time}`
      );
      triggerPushNotification(
        'Visit Cancelled',
        `The visit with ${apt.providerName} on ${apt.date} at ${apt.time} was cancelled.`,
        'appointment'
      );
      return true;
    },
    [appointments, addAuditLog, triggerPushNotification]
  );

  // SOAP autosave stays local-first (clinical typing must never block on the
  // network), but a rejected write is announced once — never silently assumed
  // saved; the next keystroke retries.
  const soapSaveWarnedAtRef = useRef(0);
  const updateSoapNotes = (partial: Partial<SOAPNotes>) => {
    const next: SOAPNotes = {
      ...soapNotes,
      ...partial,
      lastUpdated: new Date().toLocaleTimeString(),
    };
    setSoapNotes(next);
    if (!activeConsultation) return;
    void apiSaveSoapNote(next, activeConsultation.id).then(saved => {
      if (saved || Date.now() - soapSaveWarnedAtRef.current < 60000) return;
      soapSaveWarnedAtRef.current = Date.now();
      triggerPushNotification(
        'Notes Not Saved',
        'The clinical record service could not be reached — recent edits may not be stored. They will retry as you type.',
        'clinical'
      );
    });
  };

  // Signing is a clinical act, so it is backend-first: the note is marked
  // signed locally only after the server stored the signature.
  const signSoapNotes = async (): Promise<boolean> => {
    const next: SOAPNotes = {
      ...soapNotes,
      isSigned: true,
      signedBy: signedInUserName,
      lastUpdated: new Date().toLocaleTimeString(),
    };
    const saved = await apiSaveSoapNote(next, activeConsultation?.id);
    if (!saved) {
      triggerPushNotification(
        'Notes Not Signed',
        'The clinical record service could not be reached — the note was not signed. Please retry.',
        'clinical'
      );
      return false;
    }
    setSoapNotes(next);
    addAuditLog('SIGN_SOAP_NOTE', 'Cryptographically signed clinical SOAP documentation for encounter');
    triggerPushNotification(
      'Clinical Notes Signed',
      `${signedInUserName} completed and signed your consultation notes.`,
      'clinical'
    );
    return true;
  };

  /**
   * Transcript write, hardened: the message is bound to the live room only
   * (no arbitrary-appointment fallback), it enters local state only after the
   * backend confirms it, and the server re-stamps sender identity from the
   * session — the copy built here is display-only.
   */
  const sendConsultationMessage = async (text: string) => {
    if (!text.trim()) return;
    const active = activeConsultation;
    if (!active) {
      triggerPushNotification(
        'Message Not Sent',
        'Chat is only available inside a live tele-visit room.',
        'security'
      );
      return;
    }

    // The transcript is encrypted at rest by the API under the deployment PHI
    // key (server/crypto.js), so the body travels over TLS as plaintext and the
    // server stamps the sender and the encounter clock. The browser never holds
    // a transcript key.
    const newMsg: ChatMessage = {
      id: newId('msg'),
      appointmentId: active.id,
      senderRole: role,
      senderName: signedInUserName,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: text.trim(),
      isEncrypted: true,
    };

    const saved = await apiCreateChatMessage(active.id, newMsg);
    if (!saved) {
      triggerPushNotification(
        'Message Not Sent',
        'The secure transcript channel could not be reached — nothing was delivered.',
        'security'
      );
      return;
    }
    setChatMessages(prev => (prev.some(m => m.id === saved.id) ? prev : [...prev, saved]));
    soundManager.playNotificationChime();
  };

  // Backend-first booking: the visit enters the calendar only after the server
  // scheduled it, and the stored row (ids, room code, session key) is what the
  // client keeps — nothing is invented locally.
  const bookAppointment = async (
    providerId: string,
    date: string,
    time: string,
    type: Appointment['type'],
    reason: string
  ): Promise<boolean> => {
    // A session with no chart bound cannot schedule anything: the visit needs a
    // patientId the API will accept. Say that outright instead of reporting a
    // phantom outage when the write is refused.
    if (!patient.id) {
      triggerPushNotification(
        'No Chart Linked',
        'This login is not bound to a patient record, so a visit cannot be scheduled. Ask the clinic to link your chart.',
        'appointment'
      );
      return false;
    }
    const prov = providers.find(p => p.id === providerId) ?? providers[0];
    if (!prov) {
      triggerPushNotification(
        'Booking Unavailable',
        'No providers were returned by the server — please retry once they load.',
        'appointment'
      );
      return false;
    }
    const newApt = buildAppointmentRecord(prov, date, time, type, reason);

    // Local half of the scheduling rules (the server re-checks as the
    // authority): an unreadable or past start, or a slot already held by the
    // same provider or on this chart, is refused with a specific reason
    // instead of an opaque write failure.
    const check = validateBooking(
      { scheduledStart: newApt.scheduledStart, providerId: prov.id, patientId: patient.id },
      appointments
    );
    if (!check.ok) {
      triggerPushNotification('Booking Not Available', check.message, 'appointment');
      return false;
    }

    const { appointment: saved, error } = await apiCreateAppointmentChecked({
      ...newApt,
      providerAvatar: toAvatarKey(newApt.providerAvatar),
    });
    if (!saved) {
      triggerPushNotification(
        'Booking Not Confirmed',
        error ?? 'The scheduling service could not be reached — no appointment was booked. Please retry.',
        'appointment'
      );
      return false;
    }

    setAppointments(prev => [
      { ...saved, providerAvatar: resolveAvatarUrl(saved.providerAvatar) },
      ...prev,
    ]);
    addAuditLog('START_CONSULTATION', `Scheduled ${type} with ${prov.name} on ${date} at ${time}`);
    triggerPushNotification(
      'Appointment Confirmed',
      `Virtual consultation scheduled with ${prov.name} for ${date} at ${time}.`,
      'appointment'
    );
    return true;
  };

  // Builds (but does not persist) an appointment record for a provider. Shared
  // by direct booking and by consultation-request acceptance so both paths
  // produce identically-shaped backend rows.
  function buildAppointmentRecord(
    prov: ProviderProfile,
    date: string,
    time: string,
    type: Appointment['type'],
    reason: string,
  ): Appointment {
    return {
      id: newId('apt'),
      patientId: patient.id,
      patientName: patient.name,
      patientMrn: patient.mrn,
      patientAge: patient.age,
      patientGender: patient.gender,
      providerId: prov.id,
      providerName: prov.name,
      providerTitle: prov.title,
      providerSpecialty: prov.specialty,
      providerAvatar: prov.avatarUrl,
      date,
      time,
      scheduledStart: toFhirDateTime(date, time),
      type,
      status: 'scheduled',
      reasonForVisit: reason,
      triagePriority: type === 'Specialist Review' ? 'priority' : 'routine',
      roomCode: `MED-ZONE-${newId('room').slice(-8).toUpperCase()}`,
      encryptedSessionKey: `ENC-KEY-${newId('key').slice(-12).toUpperCase()}-AES256`,
    };
  }

  // Backend-first prescribing: the medication enters the chart only after the
  // server stored it. The room's "signed & transmitted" banner is driven by
  // the returned true, so it can never claim a prescription the backend lost.
  const issuePrescription = async (
    medicationName: string,
    dosage: string,
    route: Prescription['route'],
    frequency: string,
    quantity: number,
    refills: number,
    instructions: string,
    pharmacy: string
  ): Promise<boolean> => {
    // Prescribing inside a live visit must target that visit's patient even if
    // the station chart was switched after the room opened.
    const rxPatient = activeConsultation && !isPatientAccount
      ? patients.find(p => p.id === activeConsultation.patientId) ?? patient
      : patient;
    if (!rxPatient.id) {
      triggerPushNotification(
        'No Chart Selected',
        'Select a patient chart before issuing a prescription.',
        'medication'
      );
      return false;
    }
    const newRx: Prescription = {
      id: newId('rx'),
      patientId: rxPatient.id,
      patientName: rxPatient.name,
      medicationName,
      rxnorm: lookupRxNorm(medicationName, dosage),
      dosage,
      route,
      frequency,
      quantity,
      totalRefills: refills,
      remainingRefills: refills,
      prescribingDoctor: signedInUserName,
      prescribedDate: new Date().toISOString().split('T')[0],
      pharmacy,
      instructions,
      status: 'active',
      nextDoseMinutes: 120,
      adherencePercentage: 100,
    };

    const saved = await apiCreatePrescription(newRx);
    if (!saved) {
      triggerPushNotification(
        'Prescription Not Issued',
        'The prescribing service could not be reached — nothing was transmitted. Please retry.',
        'medication'
      );
      return false;
    }

    setPrescriptions(prev => [saved, ...prev]);
    addAuditLog(
      'ISSUE_PRESCRIPTION',
      `Authorized e-prescription for ${medicationName} ${dosage} (${quantity} qty, ${refills} refills)`,
      rxPatient.mrn,
    );
    triggerPushNotification(
      'New Prescription Issued',
      `${signedInUserName} issued ${medicationName} ${dosage}. Forwarded to ${pharmacy}.`,
      'medication'
    );
    return true;
  };

  const requestRefill = async (prescriptionId: string): Promise<boolean> => {
    const rx = prescriptions.find(p => p.id === prescriptionId);
    const updated = await apiUpdatePrescription(prescriptionId, { status: 'refill-requested' });
    if (!updated) {
      triggerPushNotification(
        'Refill Request Not Transmitted',
        'The medication service could not be reached — the request was not sent. Please retry.',
        'medication'
      );
      return false;
    }
    setPrescriptions(prev => prev.map(item => (item.id === prescriptionId ? updated : item)));
    addAuditLog('REQUEST_REFILL', `Patient requested electronic refill for ${rx?.medicationName || 'medication'}`);
    triggerPushNotification(
      'Refill Request Submitted',
      `Your refill request for ${rx?.medicationName} has been transmitted to your physician.`,
      'clinical'
    );
    return true;
  };

  // Adherence writes are persisted first; the stored prescription (including
  // its recalculated `nextDoseAt`) replaces the local row.
  const markDoseTaken = async (prescriptionId: string): Promise<boolean> => {
    const target = prescriptions.find(rx => rx.id === prescriptionId);
    // Reset dose countdown to 24 hours (1440 mins) or 12 hours (720 mins)
    const nextDoseMinutes = target?.frequency.toLowerCase().includes('twice') ? 720 : 1440;
    const adherencePercentage = Math.min(100, (target?.adherencePercentage ?? 0) + 1);

    const updated = await apiUpdatePrescription(prescriptionId, {
      next_dose_minutes: nextDoseMinutes,
      adherence_percentage: adherencePercentage,
    });
    if (!updated) {
      triggerPushNotification(
        'Dose Not Logged',
        'The medication service could not be reached — the dose was not recorded. Please retry.',
        'medication'
      );
      return false;
    }
    setPrescriptions(prev => prev.map(rx => (rx.id === prescriptionId ? updated : rx)));
    soundManager.playNotificationChime();
    triggerPushNotification('Dose Logged', 'Medication adherence recorded in your health chart.', 'medication');
    return true;
  };

  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
    void apiMarkNotificationRead(id);
  };

  const clearAllNotifications = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    void apiMarkAllNotificationsRead();
  };

  const unreadNotifsCount = notifications.filter(n => !n.read).length;

  return (
    <MedZoneContext.Provider
      value={{
        role,
        patient,
        patients,
        selectedPatientId,
        selectPatient,
        providers,
        appointments,
        prescriptions,
        auditLogs,
        addAuditLog,
        notifications,
        unreadNotifsCount,
        mfaVerified,
        verifyMfa,
        revokeMfa,
        soundEnabled,
        toggleSound,
        activeConsultation,
        startConsultation,
        endConsultation,
        leaveConsultationRoom,
        checkInAppointment,
        cancelAppointment,
        soapNotes,
        updateSoapNotes,
        signSoapNotes,
        chatMessages,
        sendConsultationMessage,
        bookAppointment,
        issuePrescription,
        requestRefill,
        markDoseTaken,
        markNotificationRead,
        clearAllNotifications,
        triggerPushNotification,
        showComplianceModal,
        setShowComplianceModal,
        showFhirModal,
        setShowFhirModal,
        showSummaryExportModal,
        setShowSummaryExportModal,
        consultantNotes,
        addConsultantNote,
        consultationRequests,
        submitConsultationRequest,
        reviewConsultationRequest,
        referrals,
        createReferral,
        reviewReferral,
        completeReferral,
        followUp: activeFollowUp,
        followUps,
        selectFollowUp,
        closeFollowUp,
        reopenFollowUp,
        updateFollowUpStatus,
        createInviteLink,
        waitingRoom,
        refreshWaitingRoom,
        claimWaitingVisit,
        attachments,
        loadAttachments,
        shareAttachment,
        isHydrated,
        signedInUserName,
      }}
    >
      {children}
    </MedZoneContext.Provider>
  );
};

export function useMedZone() {
  const context = useContext(MedZoneContext);
  if (!context) {
    throw new Error('useMedZone must be used within a MedZoneProvider');
  }
  return context;
}
