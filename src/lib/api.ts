/**
 * MedZone API client.
 *
 * Talks to the Express/MySQL backend (server.js). Every call is failure
 * tolerant: reads resolve to `null` and writes resolve to `null` when the
 * backend is unreachable, so the client keeps working from its last backend
 * snapshot instead of surfacing errors. In development Vite proxies `/api` to
 * the backend; set VITE_API_URL to target a different origin.
 *
 * Session requests send the httpOnly JWT cookie (`credentials: 'include'`),
 * so authenticated endpoints see the logged-in user.
 */
import type {
  Appointment,
  AuditLogEntry,
  ChatMessage,
  ClinicStats,
  ConsultationRequest,
  FhirValidationResult,
  InviteChannel,
  InviteSummary,
  NotificationItem,
  PatientProfile,
  Prescription,
  ProviderProfile,
  Referral,
  RoomSignalKind,
  RoomSignalsPage,
  SOAPNotes,
  ConsultantNote,
  FollowUpDetail,
  VisitAttachment,
  VisitGuest,
  VisitInvite,
  VitalsReading,
} from '../types';

// `import.meta.env` only exists under the Vite bundler; guarded so this
// client module can also be imported by plain-Node tests.
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const API_BASE = (viteEnv?.VITE_API_URL ?? '').replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = 8000;

export interface BootstrapPayload {
  patient: PatientProfile | null;
  patients: PatientProfile[];
  providers: ProviderProfile[];
  appointments: Appointment[];
  prescriptions: Prescription[];
  auditLogs: AuditLogEntry[];
  notifications: NotificationItem[];
  followUp: FollowUpDetail | null;
  followUps: FollowUpDetail[];
  soapNotes: SOAPNotes | null;
  chatMessages: ChatMessage[];
  consultantNotes: ConsultantNote[] | null;
  consultationRequests: ConsultationRequest[];
  referrals: Referral[];
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!response.ok) return null;
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    // Backend offline or request aborted: caller keeps its last snapshot.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const fetchBootstrap = () => request<BootstrapPayload>('/api/bootstrap');

export const fetchSoapNote = (appointmentId?: string) =>
  request<SOAPNotes>(
    appointmentId
      ? `/api/soap-note?appointmentId=${encodeURIComponent(appointmentId)}`
      : '/api/soap-note',
  );

export const fetchAppointments = () => request<Appointment[]>('/api/appointments');

export const fetchChatMessages = (appointmentId: string) =>
  request<ChatMessage[]>(`/api/appointments/${encodeURIComponent(appointmentId)}/messages`);

/**
 * Recorded vitals telemetry for a chart (newest last). The consultation room
 * displays these instead of generating a synthetic feed.
 */
export const fetchVitals = (patientId: string) =>
  request<{ patientId: string; readings: VitalsReading[] }>(
    `/api/vitals?patientId=${encodeURIComponent(patientId)}`,
  );

/**
 * Server-side structural validation of a FHIR bundle. Resolves to null when
 * the backend cannot be reached — the caller must then refuse to claim the
 * bundle was validated rather than assume success.
 */
export const validateFhirBundle = (bundle: unknown) =>
  post<FhirValidationResult>('/api/fhir/validate', { bundle });

export const fetchVisitGuests = (appointmentId: string) =>
  request<VisitGuest[]>(`/api/appointments/${encodeURIComponent(appointmentId)}/guests`);

/** Mints a single-click patient invitation link for a visit. */
export const createVisitInvite = (appointmentId: string, channel: InviteChannel = 'link') =>
  post<VisitInvite>(`/api/appointments/${encodeURIComponent(appointmentId)}/invite`, { channel });

/** PHI-free invite summary for the join landing page (public). */
export const fetchInviteSummary = (token: string) =>
  request<InviteSummary>(`/api/invites/${encodeURIComponent(token)}`);

/** Clinic-wide waiting room: every checked-in visit, for any available doctor. */
export const fetchWaitingRoom = () => request<Appointment[]>('/api/waiting-room');

/** Claims a waiting visit for the signed-in clinician. */
export const claimWaitingVisit = (appointmentId: string) =>
  post<Appointment>(`/api/waiting-room/${encodeURIComponent(appointmentId)}/claim`, {});

/** Files and images shared during a live visit. */
export const fetchVisitAttachments = (appointmentId: string) =>
  request<VisitAttachment[]>(`/api/appointments/${encodeURIComponent(appointmentId)}/attachments`);

export const createVisitAttachment = (
  appointmentId: string,
  body: { id: string; fileName: string; mimeType: string; contentBase64: string },
) =>
  post<VisitAttachment>(`/api/appointments/${encodeURIComponent(appointmentId)}/attachments`, body);

/** Anonymised clinic statistics for the operations console (admins only). */
export const fetchClinicStats = () => request<ClinicStats>('/api/stats');

export const createVisitGuest = (
  appointmentId: string,
  guest: { name: string; role: VisitGuest['role'] },
) =>
  post<VisitGuest>(`/api/appointments/${encodeURIComponent(appointmentId)}/guests`, guest);

/**
 * Removes a guest from the visit roster. Returns true only on the server's
 * 204 — `request()` cannot be used here because it maps a successful 204 and
 * an unreachable backend to the same null.
 */
export async function deleteVisitGuest(appointmentId: string, guestId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${API_BASE}/api/appointments/${encodeURIComponent(appointmentId)}/guests/${encodeURIComponent(guestId)}`,
      { method: 'DELETE', credentials: 'include' },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * WebRTC signaling relay. `keepalive` lets the browser flush a final `bye`
 * while the page unloads (a normal fetch would be aborted).
 */
export async function postRoomSignal(
  appointmentId: string,
  kind: RoomSignalKind,
  payload: unknown = null,
  options: { keepalive?: boolean } = {},
): Promise<boolean> {
  try {
    const response = await fetch(
      `${API_BASE}/api/appointments/${encodeURIComponent(appointmentId)}/signals`,
      {
        method: 'POST',
        credentials: 'include',
        keepalive: options.keepalive === true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, payload }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** Signals sent by the other participant(s) since `afterId`, plus presence. */
export const fetchRoomSignals = (appointmentId: string, afterId: number) =>
  request<RoomSignalsPage>(
    `/api/appointments/${encodeURIComponent(appointmentId)}/signals?after=${encodeURIComponent(String(afterId))}`,
  );

// ---------------------------------------------------------------------------
// S2S voice bridge (Crane AI Labs first, opt-in per visit per user)
// ---------------------------------------------------------------------------

export interface S2SLanguage {
  code: string;
  label: string;
  native: string;
  craneStt: boolean;
  sttNote: string;
}

export interface S2SStatus {
  available: boolean;
  provider: string;
  engine: string;
  reason: string | null;
  languages: S2SLanguage[];
  model: string;
  stt: boolean;
  mt: boolean;
  tts: boolean;
}

export interface S2STurn {
  ok: boolean;
  transcript: string;
  translation: string;
  translationEngine: string;
  translationNote: string | null;
  audioBase64: string | null;
  audioMimeType: string | null;
  audioEngine: string;
  engine: string;
}

/** Capability probe for the room's voice toggle (no secrets). */
export const fetchS2SStatus = () => request<S2SStatus>('/api/s2s/status');

/** Explicit per-visit consent (identity comes from the session). */
export const postS2SConsent = (
  appointmentId: string,
  body: { enabled: boolean; sourceLang: string; targetLang: string },
) => post<{ ok: boolean; enabled: boolean; sourceLang: string; targetLang: string }>(
  `/api/appointments/${encodeURIComponent(appointmentId)}/s2s/consent`, body,
);

/**
 * One S2S turn. Unlike fire-and-forget writes this surfaces the refusal
 * reason (live visit required, STT offline, rate-limited) instead of
 * collapsing into null — the caller renders it as caption chrome.
 */
export async function postS2STurn(
  appointmentId: string,
  body: { audioBase64: string; mimeType: string; sourceLang: string; targetLang: string },
): Promise<{ turn: S2STurn | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(
      `${API_BASE}/api/appointments/${encodeURIComponent(appointmentId)}/s2s/translate`,
      {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      return { turn: null, error: payload?.error ?? `Voice translation refused the turn (HTTP ${response.status}).` };
    }
    return { turn: (await response.json()) as S2STurn, error: null };
  } catch {
    return { turn: null, error: 'Voice translation unreachable — captions paused, the call itself is unaffected.' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Server admission for a tele-visit room.
 *
 * Unlike the fire-and-forget writes below (which resolve to null so the client
 * keeps its snapshot), opening the consultation room must know the server's
 * decision, so this carries the API's refusal reason instead of hiding it.
 * The returned appointment is the backend's record — the client joins with the
 * room the server admitted it to, never with a locally-built copy.
 */
export async function startConsultationSession(
  appointmentId: string,
): Promise<{ appointment: Appointment | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${API_BASE}/api/appointments/${encodeURIComponent(appointmentId)}/consultation`,
      {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      const fallback = `The tele-visit service refused the request (HTTP ${response.status}).`;
      return { appointment: null, error: payload?.error ?? fallback };
    }
    return { appointment: (await response.json()) as Appointment, error: null };
  } catch {
    return { appointment: null, error: 'The secure visit service is unreachable — the room was not opened.' };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Writes (fire-and-forget; resolve to null when the backend is down)
// ---------------------------------------------------------------------------

export const createAppointment = (appointment: Appointment) =>
  post<Appointment>('/api/appointments', appointment);

/**
 * Booking admission, like startConsultationSession: the server refuses past,
 * invalid and clashing starts, and a provider slot taken between the client's
 * local check and the write (or on a chart this session cannot see) must
 * report the refusal reason instead of collapsing into "the backend is down".
 */
export async function createAppointmentChecked(
  appointment: Appointment,
): Promise<{ appointment: Appointment | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/api/appointments`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appointment),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      const fallback = `The scheduling service refused the booking (HTTP ${response.status}).`;
      return { appointment: null, error: payload?.error ?? fallback };
    }
    return { appointment: (await response.json()) as Appointment, error: null };
  } catch {
    return {
      appointment: null,
      error: 'The scheduling service could not be reached — no appointment was booked.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const updateAppointmentStatus = (id: string, status: Appointment['status']) =>
  patch<Appointment>(`/api/appointments/${encodeURIComponent(id)}/status`, { status });

export const createPrescription = (prescription: Prescription) =>
  post<Prescription>('/api/prescriptions', prescription);

export const updatePrescription = (
  id: string,
  patchBody: { status?: Prescription['status']; next_dose_minutes?: number; adherence_percentage?: number; remaining_refills?: number }
) => patch<Prescription>(`/api/prescriptions/${encodeURIComponent(id)}`, patchBody);

/**
 * Records an audited action. Only the caller-controlled fields are sent —
 * identity, masked IP and status are stamped server-side from the session and
 * the request, and the response carries the canonical stored entry.
 */
export const createAuditLog = (entry: {
  id: string;
  action: AuditLogEntry['action'];
  details: string;
  targetMrn?: string;
}) => post<AuditLogEntry>('/api/audit-logs', entry);

export const createNotification = (notification: NotificationItem) =>
  post<NotificationItem>('/api/notifications', notification);

export const markNotificationRead = (id: string) =>
  request<void>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });

export const markAllNotificationsRead = () => post<void>('/api/notifications/read-all', {});

export const createChatMessage = (appointmentId: string, message: ChatMessage) =>
  post<ChatMessage>(`/api/appointments/${encodeURIComponent(appointmentId)}/messages`, message);

export const saveSoapNote = (soapNotes: SOAPNotes, appointmentId?: string) =>
  request<SOAPNotes>('/api/soap-note', {
    method: 'PUT',
    body: JSON.stringify({ ...soapNotes, appointmentId }),
  });

export const createConsultantNote = (note: ConsultantNote) =>
  post<ConsultantNote>('/api/consultant-notes', note);

export const createConsultationRequest = (requestBody: ConsultationRequest) =>
  post<ConsultationRequest>('/api/consultation-requests', requestBody);

export const updateConsultationRequestStatus = (
  id: string,
  status: ConsultationRequest['status'],
) =>
  patch<ConsultationRequest>(
    `/api/consultation-requests/${encodeURIComponent(id)}/status`,
    { status },
  );

export const updateFollowUpStatus = (id: string, status: FollowUpDetail['status']) =>
  patch<FollowUpDetail>(`/api/follow-up/${encodeURIComponent(id)}/status`, { status });

export const createReferral = (referral: Referral) =>
  post<Referral>('/api/referrals', referral);

export const updateReferralStatus = (
  id: string,
  status: Referral['status'],
) =>
  patch<Referral>(
    `/api/referrals/${encodeURIComponent(id)}/status`,
    { status },
  );
