/**
 * MedZone backend - Express REST API.
 *
 * Mounted by server.js. Every route is namespaced under /api so the Vite dev
 * server can proxy it without colliding with client routes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { isDatabaseReachable } from './db.js';
import * as repo from './repository.js';
import { appointmentStartMs } from './mappers.js';
import { isVisitStatus, canTransitionVisit } from './visitStatus.js';
import { validateFhirBundle } from './fhirValidate.js';
import { generateTotpSecret, isMfaRequired, totpUri, verifyTotpStep } from './totp.js';
import { decryptField, encryptField } from './crypto.js';
import {
  ALLOWED_MODULES,
  authRequired,
  clearSessionCookie,
  getDummyPasswordHash,
  hashPassword,
  isValidAvatarDataUrl,
  isValidModuleList,
  optionalSession,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  setSessionCookie,
  signSession,
  toSafeUser,
  verifyPassword,
} from './auth.js';
import {
  canAccessTab,
  clinicalRequired,
  isPatientScope,
  staffModule,
  subjectFromSession,
  tabRequired,
} from './rbac.js';
import {
  getS2SStatus,
  isS2SLanguage,
  translateSpeechTurn,
  validateS2SPayload,
} from './s2s.js';

const app = express();

// Do not advertise the server stack in every response.
app.disable('x-powered-by');

// Behind the bundled nginx exactly one proxy hop fronts the API. TRUST_PROXY
// tells Express to read the client address from X-Forwarded-* so rate limits
// and the audit trail key on the real client — with a hop count, not `true`,
// so a client-supplied X-Forwarded-For is never trusted (nginx replaces it).
// Left unset for direct exposures (req.ip is then the socket peer).
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
}

// 4mb covers the base64-encoded in-visit attachment uploads (capped at ~1.5MB
// raw in the route itself); every other route stays well under it.
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

// Baseline security headers (helmet-equivalent, dependency-free). The clinical
// UI must not be framable (clickjacking / UI redress on sign-note actions) and
// must not run third-party script. The two Google Fonts hosts are the single
// deliberate style/font exception (see index.html); everything else stays
// same-origin. HSTS is only advertised over TLS.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  // The clinical console must not be embedded, opened as an opener, or read
  // cross-origin. CORP also stops other origins from pulling API responses.
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('X-Permitted-Cross-Domain-Policies', 'none');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: https:; media-src 'self' blob:; connect-src 'self' ws: wss:; " +
      "font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  );
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// Clinical API responses must never land in shared caches.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// CSRF defense-in-depth. Session cookies are SameSite=Lax, but a same-site
// attacker (a compromised subdomain or an XSS in a neighbouring app) can still
// ride them. Every unsafe API request must therefore come from this origin:
// browsers stamp Origin/Sec-Fetch-Site on cross-origin writes, and a
// non-browser client can be allow-listed explicitly with ALLOWED_ORIGINS.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean)
);
app.use('/api', (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  // `same-site` is not `same-origin`: it covers a different port or a sibling
  // subdomain, either of which can ride a SameSite=Lax cookie. Unsafe API
  // traffic must be same-origin (or a non-browser `none` navigation). The
  // Origin-host fallback below remains for clients that omit Sec-Fetch-Site.
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.status(403).json({ error: 'Cross-site request refused.' });
  }
  const origin = req.get('origin');
  if (!origin) return next(); // non-browser client: cookie auth still applies
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return res.status(403).json({ error: 'Cross-site request refused.' });
  }
  const normalized = `${parsed.protocol}//${parsed.host}`;
  // Compare the authority exactly (host and port). The bundled nginx proxy
  // forwards the browser-facing authority in X-Forwarded-Host; direct
  // requests use Host. ALLOWED_ORIGINS covers a separately hosted frontend or
  // a native client.
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim().toLowerCase();
  const requestHost = (forwardedHost || String(req.get('host') || '')).toLowerCase();
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  const requestProto = (forwardedProto || req.protocol || '').toLowerCase();
  const sameOrigin = parsed.protocol === `${requestProto}:`
    && parsed.host.toLowerCase() === requestHost;
  if (!sameOrigin && !ALLOWED_ORIGINS.has(normalized)) {
    return res.status(403).json({ error: 'Cross-site request refused.' });
  }
  return next();
});

// In-house sliding-window rate limiter (no dependency): protects CPU-bound
// endpoints such as login (bcrypt) from burst abuse. Counts attempts per key
// over `windowMs`; replies 429 with Retry-After when `max` is exceeded.
// Authenticated endpoints key on the session user id when present so one
// account cannot exhaust another account's budget.
const createRateLimiter = ({ windowMs, max, key = (req) => req.ip || 'unknown' }) => {
  const hits = new Map();
  // Periodic sweep drops expired windows so the map stays small under load.
  // unref'd: it never holds the process open on its own.
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [bucket, stamps] of hits) {
      const fresh = stamps.filter((t) => t > cutoff);
      if (fresh.length === 0) hits.delete(bucket);
      else hits.set(bucket, fresh);
    }
  }, windowMs);
  if (typeof timer.unref === 'function') timer.unref();
  const limiter = (req, res, next) => {
    const bucket = key(req);
    const now = Date.now();
    const stamps = (hits.get(bucket) || []).filter((t) => t > now - windowMs);
    if (stamps.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Please retry shortly.' });
    }
    stamps.push(now);
    hits.set(bucket, stamps);
    next();
  };
  // Lets a route clear a bucket after a proven success (e.g. a valid login),
  // so only failed attempts count against the account's budget.
  limiter.reset = (bucket) => hits.delete(bucket);
  return limiter;
};

const loginLimiter = createRateLimiter({
  windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS || 60000),
  // 50-pair bursts sign in ~100 sessions inside the ramp window (plus the
  // parallel test files). Bcrypt is CPU-bound, so this still bounds abuse —
  // it just stops punishing a legitimate clinic-wide login burst.
  max: Number(process.env.LOGIN_RATE_MAX || 300),
});

// A distributed brute-force attack can stay under every per-IP budget while
// hammering one account from many hosts. This bucket follows the account
// instead: failed attempts count, and a successful sign-in clears it (see the
// login route). Casing/whitespace are normalised because the database lookup
// is case-insensitive.
const loginAccountKey = (req) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  return `login-account:${username || req.ip || 'unknown'}`;
};
const loginAccountLimiter = createRateLimiter({
  windowMs: Number(process.env.LOGIN_ACCOUNT_RATE_WINDOW_MS || 60000),
  max: Number(process.env.LOGIN_ACCOUNT_RATE_MAX || 20),
  key: loginAccountKey,
});

// Transcript writes: generous for a human in a live visit, bounded so a
// signed-in client cannot flood an encounter record. Env-tunable for the
// 50-pair tier (see .env.example).
const messageLimiter = createRateLimiter({
  windowMs: Number(process.env.CHAT_RATE_WINDOW_MS || 60000),
  max: Number(process.env.CHAT_RATE_MAX || 120),
});

// Transcript reads are the live-sync ticker (3s per open room): 50 pairs =
// 100 users x 1 read/3s ≈ 33 reads/s ≈ 2,000/min clinic-wide, so the budget
// must clear legitimate polling with headroom while bounding a runaway tab.
const transcriptReadLimiter = createRateLimiter({
  windowMs: Number(process.env.TRANSCRIPT_READ_RATE_WINDOW_MS || 60000),
  max: Number(process.env.TRANSCRIPT_READ_RATE_MAX || 120),
});

// WebRTC signaling is chatty while a room is live: 1.5s poll + 10s heartbeat
// per participant = ~45 req/min per user. 50 pairs need the per-account budget
// below to hold steady state; bursts (ICE trickle at join) ride the same
// bucket. Env-tunable; keyed per account so one room cannot starve another.
const signalLimiter = createRateLimiter({
  windowMs: Number(process.env.SIGNAL_RATE_WINDOW_MS || 60000),
  max: Number(process.env.SIGNAL_RATE_MAX || 200),
  key: (req) => `signal:${req.user?.id ?? req.ip}`,
});

// TOTP verification: a 6-digit code space is small, so brute-force attempts
// are bounded per IP exactly like login.
const mfaLimiter = createRateLimiter({
  windowMs: Number(process.env.MFA_RATE_WINDOW_MS || 60000),
  max: Number(process.env.MFA_RATE_MAX || 10),
});

// Self-service password change re-hashes with bcrypt cost 12 — CPU-bound, so
// bursts are bounded per account.
const passwordLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  key: (req) => `password:${req.user?.id ?? req.ip}`,
});

// Bookings, consultation requests, referrals, guest invites and in-visit
// attachments each insert a row a signed-in client can repeat without bound:
// nothing else in those routes caps them, so one account (or a script holding
// a stolen cookie) can grow the clinical tables and flood the staff inbox
// indefinitely. They share one generous per-account budget — ordinary human
// use is a handful of writes per visit.
const phiWriteLimiter = createRateLimiter({
  windowMs: Number(process.env.PHI_WRITE_RATE_WINDOW_MS || 60000),
  max: Number(process.env.PHI_WRITE_RATE_MAX || 60),
  key: (req) => `phi-write:${req.user?.id ?? req.ip}`,
});

// Audit/notification writes are low-volume in human use; bounded per account
// so a compromised session cannot flood the compliance trail or the feed.
const auditLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  key: (req) => `audit:${req.user?.id ?? req.ip}`,
});
const notificationLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  key: (req) => `notification:${req.user?.id ?? req.ip}`,
});

// WebRTC signaling is chatty while a room is live (heartbeats + ICE trickle)
// but must not become an unbounded write channel. Budget sized for 50 pairs
// (see the signalLimiter above); this alias keeps the original route binding
// name stable.
const signalWriteLimiter = signalLimiter;

// Voice-bridge turns carry base64 audio (a few seconds per turn): one turn
// every ~2s is generous for push-to-talk captions; bursts are refused with
// 429 so a runaway tab cannot bill the Crane endpoint.
const s2sLimiter = createRateLimiter({
  windowMs: Number(process.env.S2S_RATE_WINDOW_MS || 60000),
  max: Number(process.env.S2S_RATE_MAX || 30),
  key: (req) => `s2s:${req.user?.id ?? req.ip}`,
});

/**
 * Masks a client IP for the audit trail: the first three octets (IPv4) or
 * hextets (IPv6) are kept, the rest is dropped. Stamped by the server from the
 * request itself — the client can neither supply nor spoof it.
 */
const maskIp = (rawIp) => {
  const ip = String(rawIp || '').replace(/^::ffff:/, '');
  if (!ip) return 'unknown';
  if (ip.includes(':')) {
    const groups = ip.split(':').filter(Boolean);
    return `${groups.slice(0, 3).join(':') || ':'}::*`;
  }
  const octets = ip.split('.');
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.${octets[2]}.*`;
  return 'unknown';
};

/** Mirrors the audit_logs.action ENUM in schema.sql. */
const AUDIT_ACTIONS = new Set([
  'VIEW_RECORD',
  'EXPORT_FHIR',
  'EXPORT_PDF',
  'START_CONSULTATION',
  'SIGN_SOAP_NOTE',
  'ISSUE_PRESCRIPTION',
  'REQUEST_REFILL',
  'MFA_VERIFIED',
  'REQUEST_CONSULTATION',
  'CHECK_IN',
  'CANCEL_VISIT',
  'S2S_CONSENT',
  'S2S_TURN',
]);

/**
 * Actions a patient session may record. Patients legitimately audit their own
 * reads/exports/visit actions; staff-only clinical acts (signing, prescribing)
 * are refused so the trail cannot be salted with forged clinical events.
 */
const PATIENT_AUDIT_ACTIONS = new Set([
  'VIEW_RECORD',
  'EXPORT_FHIR',
  'EXPORT_PDF',
  'START_CONSULTATION',
  'REQUEST_REFILL',
  'MFA_VERIFIED',
  'REQUEST_CONSULTATION',
  'CHECK_IN',
  'CANCEL_VISIT',
  'S2S_CONSENT',
  'S2S_TURN',
]);

/** Opaque id shape for client-supplied row keys (ids reach SQL as values only). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const isSafeId = (value) => typeof value === 'string' && ID_PATTERN.test(value);

/** WebRTC control-plane verbs the room relay accepts. */
const SIGNAL_KINDS = new Set(['join', 'ping', 'offer', 'answer', 'candidate', 'bye']);
const MAX_SIGNAL_PAYLOAD_BYTES = 256 * 1024;
const MAX_SDP_LENGTH = 200 * 1024;

/** Guest roles for the visit roster (mirrors visit_guests.role). */
const GUEST_ROLES = new Set(['Family', 'Translator', 'Specialist', 'Observer']);

// Opt-in request logging for local development: API_LOG=1 npm run server
if (process.env.API_LOG === '1') {
  app.use((req, res, next) => {
    res.on('finish', () => console.log(`[medzone-api] ${req.method} ${req.originalUrl} -> ${res.statusCode}`));
    next();
  });
}

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const missing = (body, fields) => fields.filter((f) => body?.[f] === undefined || body?.[f] === null);

/**
 * Tele-visit room references the client may hold: MED-ZONE-<code>. Enforced at
 * booking and again at room admission, so a visit can never carry an arbitrary
 * room label into the consultation room.
 */
const ROOM_CODE_PATTERN = /^MED-ZONE-[A-Z0-9]{3,20}$/;
const isRoomCode = (value) => typeof value === 'string' && ROOM_CODE_PATTERN.test(value);

const APPOINTMENT_TYPES = ['Virtual Consultation', 'Follow-Up', 'Specialist Review', 'Prescription Refill'];

/**
 * Every tab a staff read can legitimately proceed from. Used by the
 * staffModule gates on endpoints that are chart-scoped for patients: without
 * them a staff account stripped of every module could still read the whole
 * clinic through the list endpoints its UI no longer shows.
 */
const STAFF_TABS = ['dashboard', 'followups', 'appointments', 'contacts', 'availability'];

// ---------------------------------------------------------------------------
// RBAC helpers (policy in server/rbac.js, mirrored by src/lib/rbac.ts)
// ---------------------------------------------------------------------------

/**
 * Resolves the caller's RBAC subject from the database on every request.
 *
 * The session token proves identity; role, module grants and the chart link are
 * read fresh so an admin change (revoke a module, unlink a chart, demote a
 * role) applies to the caller's next request. Must run after authRequired or
 * optionalSession has populated req.user.
 *
 * 50-pair note: this runs on EVERY authenticated request (signaling polls at
 * 1.5s x 100 users = ~70 user lookups/s). The cache below holds a user row for
 * a few seconds — revokes still land within SESSION_SUBJECT_TTL_MS instead of
 * on the literal next request, which the RBAC comment tolerates for this
 * throughput tier. Set SESSION_SUBJECT_TTL_MS=0 to disable.
 */
const SESSION_SUBJECT_TTL_MS = Math.max(
  0,
  Number(process.env.SESSION_SUBJECT_TTL_MS ?? 5000)
);
const subjectRowCache = new Map();
/** Drops a cached row after a write (password rotation) so it applies at once. */
const invalidateSubjectRow = (userId) => subjectRowCache.delete(userId);
const getCachedUserRow = async (userId) => {
  const now = Date.now();
  if (SESSION_SUBJECT_TTL_MS > 0) {
    const hit = subjectRowCache.get(userId);
    if (hit && now - hit.at < SESSION_SUBJECT_TTL_MS) return hit.row;
  }
  const row = await repo.getUserById(userId);
  if (SESSION_SUBJECT_TTL_MS > 0 && row) {
    subjectRowCache.set(userId, { at: now, row });
    if (subjectRowCache.size > 2000) {
      const oldest = subjectRowCache.keys().next();
      if (!oldest.done) subjectRowCache.delete(oldest.value);
    }
  }
  return row;
};
const sessionSubject = wrap(async (req, _res, next) => {
  if (!req.user) return next();
  const row = await getCachedUserRow(req.user.id);
  if (!row) {
    return _res.status(401).json({ error: 'Session account no longer exists.' });
  }
  // A password change/reset bumps users.token_version. Tokens minted before
  // that rotation carry an older epoch and are refused here, so a stolen
  // cookie cannot outlive the credential it was issued for. A token minted
  // before this feature existed has no `tv` claim and maps to epoch 0.
  if (Number(req.user.tv ?? 0) !== Number(row.tokenVersion ?? 0)) {
    clearSessionCookie(_res);
    return _res.status(401).json({
      error: 'Your session has expired. Please sign in again.',
      code: 'SESSION_REVOKED',
    });
  }
  // Keep the fresh row alongside the derived policy subject: routes that must
  // stamp an actor name (e.g. the encrypted transcript) read it from here,
  // never from the request body.
  req.subjectRow = row;
  req.subject = subjectFromSession(row);
  return next();
});

/** RBAC subject of the caller; a signed-out request has none. */
const subjectOf = (req) => req.subject ?? null;

/**
 * Endpoints a session must reach before it can satisfy the second factor:
 * enrollment, verification, session state and sign-out.
 */
const MFA_EXEMPT_PATHS = new Set([
  '/api/mfa/status',
  '/api/mfa/enroll',
  '/api/mfa/verify',
  '/api/mfa/revoke',
  '/api/logout',
  '/api/me',
]);

/**
 * Second-factor gate.
 *
 * When the deployment requires MFA, a password-only session must not reach
 * clinical data. Two refusals, deliberately distinct:
 *  - the account has no enrolled authenticator → MFA_ENROLLMENT_REQUIRED, so
 *    enabling the policy cannot be sidestepped by not enrolling;
 *  - it has one, but this session never proved it → MFA_REQUIRED until
 *    POST /api/mfa/verify re-signs the cookie.
 * A request with no session is not gated (the endpoint either refuses it or
 * serves the public shell).
 */
const requireMfa = (req, res, next) => {
  if (!isMfaRequired() || !req.user || MFA_EXEMPT_PATHS.has(req.path)) return next();
  // `subjectRow` is the mapped row (boolean authenticator state), never the raw
  // SQL row: the encrypted secret has no business on the request object.
  if (!req.subjectRow?.mfaEnrolled && !req.subjectRow?.mfaPending) {
    return res.status(403).json({
      error: 'Set up an authenticator app to continue.',
      code: 'MFA_ENROLLMENT_REQUIRED',
    });
  }
  if (req.user?.mfa === true) return next();
  return res.status(403).json({ error: 'Multi-factor verification required.', code: 'MFA_REQUIRED' });
};

/** authRequired + a fresh RBAC subject + MFA gate, as one middleware list. */
const authed = [authRequired, sessionSubject, requireMfa];

/**
 * Admin-only guard. Reads the freshly resolved subject rather than the token,
 * so removing admin rights takes effect on the next request.
 */
const adminOnly = (req, res, next) => {
  if (!req.subject?.isAdmin) {
    return res.status(403).json({ error: 'Admin privileges required.' });
  }
  return next();
};

/**
 * Chart selector for a read. Returns the caller's own patient id for a patient
 * session (or the no-chart sentinel when the account has no chart linked), and
 * null for staff/anonymous callers, who read the clinic-wide set.
 */
const chartScope = (req) => {
  const subject = subjectOf(req);
  return isPatientScope(subject) ? subject.patientId ?? repo.NO_CHART : null;
};

/**
 * Provider scope for a staff read. A clinician login bound to a provider reads
 * only that provider's visits and patients (the doctor who was booked); a
 * clinician with no provider link is a covering/supervising account and keeps
 * the clinic-wide read, as do administrators.
 */
const providerScope = (req) => {
  const subject = subjectOf(req);
  // An administrator keeps the clinic-wide read even if the user row also
  // carries a provider binding.
  if (!subject || subject.isAdmin || isPatientScope(subject)) return null;
  return subject.providerId ?? null;
};

/**
 * Object-level authorization for a bound clinician. Covering clinicians and
 * administrators have no provider scope and keep the clinic-wide read; a bound
 * clinician may only reach a visit booked with their provider or one they
 * claimed from the shared waiting room.
 */
const canStaffAccessAppointment = (req, row) => {
  const providerId = providerScope(req);
  if (!providerId) return true;
  return row.provider_id === providerId
    || Number(row.claimed_by_user_id) === Number(req.user?.id);
};

const canStaffAccessChart = async (req, patientId) => {
  const providerId = providerScope(req);
  if (!providerId) return true;
  return repo.providerCanAccessPatient(providerId, req.user?.id, patientId);
};

/** Unknown and out-of-panel charts look the same to a bound clinician. */
const chartNotFound = (res) => res.status(404).json({ error: 'No patient record found' });

/**
 * Staff write guard: the session must satisfy the tab policy the UI rendered
 * against. Mirrors Ottehr's shared role groups so a hidden screen is not the
 * only control.
 */
const staffTab = (tab) => (req, res, next) => {
  const subject = subjectOf(req);
  if (!subject || !canAccessTab(subject, tab)) {
    return res.status(403).json({ error: `Your account cannot access the ${tab} module.` });
  }
  return next();
};

/**
 * Tele-visit participation policy shared by the room routes.
 *
 * The session is the only input: a patient may act on a visit on their own
 * chart, staff must hold the schedule (appointments) or visits (followups)
 * module. Replies 404 (unknown visit) / 403 (not a participant) and returns
 * null when the visit must not be reached; otherwise returns the raw row so
 * the caller can inspect the visit state before admitting the room.
 */
const visitForParticipant = async (req, res) => {
  const row = await repo.getAppointmentRow(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Appointment not found' });
    return null;
  }
  const subject = subjectOf(req);
  if (isPatientScope(subject)) {
    if (row.patient_id !== subject.patientId) {
      res.status(403).json({ error: 'This visit belongs to another patient.' });
      return null;
    }
  } else if (!canAccessTab(subject, 'appointments') && !canAccessTab(subject, 'followups')) {
    res.status(403).json({ error: 'Your account cannot access tele-visits.' });
    return null;
  } else if (!canStaffAccessAppointment(req, row)) {
    // A bound clinician must not discover or reach another provider's visit
    // by id; the shared waiting room is reached through an explicit claim.
    res.status(404).json({ error: 'Appointment not found' });
    return null;
  }
  return row;
};

app.get('/api/health', wrap(async (_req, res) => {
  const dbReachable = await isDatabaseReachable();
  res.status(dbReachable ? 200 : 503).json({
    status: dbReachable ? 'ok' : 'unavailable',
    database: dbReachable ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
}));

// ---------------------------------------------------------------------------
// S2S voice bridge (Crane AI Labs first, opt-in per visit per user)
// ---------------------------------------------------------------------------

/**
 * Capability probe for the consultation-room toggle. Authenticated (visit
 * membership is checked on the turn/consent routes); carries no secrets.
 */
app.get('/api/s2s/status', authed, wrap(async (_req, res) => {
  res.json(getS2SStatus());
}));

/**
 * Explicit per-visit consent. The body carries `{ enabled, sourceLang,
 * targetLang }`; identity comes from the session and the visit must belong
 * to the caller. Recorded as a content-free audit event (enabled/langs only,
 * never any transcript).
 */
app.post('/api/appointments/:id/s2s/consent', authed, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  const enabled = req.body?.enabled === true;
  const sourceLang = String(req.body?.sourceLang || '').trim();
  const targetLang = String(req.body?.targetLang || '').trim();
  if (!isS2SLanguage(sourceLang) || !isS2SLanguage(targetLang) || sourceLang === targetLang) {
    return res.status(400).json({ error: 'A valid sourceLang and a different targetLang are required.' });
  }
  await repo.createAuditLog({
    id: `s2s-consent-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    timestamp: new Date().toISOString(),
    userRole: isPatientScope(subjectOf(req)) ? 'patient' : 'clinician',
    userName: String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255),
    action: 'S2S_CONSENT',
    details: `Voice translation ${enabled ? 'enabled' : 'disabled'} for visit (${sourceLang}→${targetLang}).`,
    targetMrn: undefined,
    ipMasked: maskIp(req.ip),
    status: 'VERIFIED_HIPAA',
  });
  return res.json({ ok: true, enabled, sourceLang, targetLang });
}));

/**
 * One S2S turn: base64 mic audio -> Crane STT -> MT -> TTS. Participant-gated
 * (visitForParticipant), rate-limited, audio EPHEMERAL (never persisted).
 * Only metadata is audited (langs + engine + char counts, never content).
 */
app.post('/api/appointments/:id/s2s/translate', authed, s2sLimiter, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  if (row.status !== 'in-progress') {
    return res.status(409).json({ error: 'Voice translation needs a live visit — join the room first.' });
  }
  const { audioBase64, mimeType, sourceLang, targetLang } = req.body ?? {};
  const problems = validateS2SPayload({ audioBase64, sourceLang, targetLang });
  if (problems.length) return res.status(400).json({ error: problems.join(' ') });
  const result = await translateSpeechTurn({
    audioBase64, mimeType: String(mimeType || 'audio/webm'), sourceLang, targetLang,
  });
  if (!result.ok) {
    const status = result.status === 400 ? 400 : (result.status ?? 502);
    return res.status(status).json({ error: result.error, engine: result.engine ?? null });
  }
  // Content-free usage audit: proves the bridge ran without storing PHI.
  try {
    await repo.createAuditLog({
      id: `s2s-turn-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      timestamp: new Date().toISOString(),
      userRole: isPatientScope(subjectOf(req)) ? 'patient' : 'clinician',
      userName: String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255),
      action: 'S2S_TURN',
      details: `Voice turn ${sourceLang}→${targetLang} via ${result.engine} (${result.transcript.length}→${result.translation.length} chars).`,
      targetMrn: undefined,
      ipMasked: maskIp(req.ip),
      status: 'VERIFIED_HIPAA',
    });
  } catch {
    // Audit failure must not break live captions.
  }
  return res.json(result);
}));

/**
 * The client's hydration read.
 *
 * A patient session receives its own chart only; staff sessions receive the
 * clinic; a signed-out caller receives the public shell (provider directory)
 * with every clinical collection empty. Nothing here is decided by the URL —
 * the session cookie is the only input (HCW@Home ownership-policy parity).
 */
app.get('/api/bootstrap', optionalSession, sessionSubject, staffModule(...STAFF_TABS), requireMfa, wrap(async (req, res) => {
  if (!req.user) {
    return res.json({
      patient: null,
      patients: [],
      providers: await repo.getProviders(),
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
    });
  }
  res.json(await repo.getBootstrap({
    patientId: chartScope(req),
    providerId: providerScope(req),
    userId: req.user?.id ?? null,
  }));
}));

app.get('/api/patient', authed, staffModule(...STAFF_TABS), wrap(async (req, res) => {
  const subject = subjectOf(req);
  let patientId = chartScope(req);
  if (!isPatientScope(subject)) {
    const requested = typeof req.query.patientId === 'string' ? req.query.patientId.trim() : '';
    patientId = requested || null;
    if (patientId && !(await canStaffAccessChart(req, patientId))) {
      return chartNotFound(res);
    }
  }
  const patient = await repo.getPatient(patientId);
  if (!patient) return chartNotFound(res);
  res.json(patient);
}));

/**
 * Recorded vitals telemetry for a chart, newest last.
 *
 * Replaces the former client-side synthetic ticker: a patient session reads
 * its own chart only (asking for another chart is refused, never silently
 * swapped), staff must name the chart the encounter belongs to.
 */
app.get('/api/vitals', authed, staffModule('followups', 'appointments', 'contacts'), wrap(async (req, res) => {
  const subject = subjectOf(req);
  let patientId;
  if (isPatientScope(subject)) {
    if (!subject.patientId) return res.json({ patientId: null, readings: [] });
    const requested = typeof req.query.patientId === 'string' ? req.query.patientId : '';
    if (requested && requested !== subject.patientId) {
      return res.status(403).json({ error: 'Patients may only read their own chart.' });
    }
    patientId = subject.patientId;
  } else {
    patientId = typeof req.query.patientId === 'string' ? req.query.patientId.trim() : '';
    if (!patientId) return res.status(400).json({ error: 'patientId is required.' });
    if (!(await canStaffAccessChart(req, patientId))) {
      return chartNotFound(res);
    }
  }
  const readings = await repo.getVitalsReadings(patientId, req.query.limit);
  res.json({ patientId, readings });
}));

/**
 * Server-side structural validation of a FHIR R4 bundle (the interoperability
 * document the client generated). Read-only: nothing is persisted.
 */
app.post('/api/fhir/validate', authed, wrap(async (req, res) => {
  const bundle = req.body?.bundle;
  if (bundle === undefined || bundle === null) {
    return res.status(400).json({ error: 'A bundle to validate is required.' });
  }
  res.json(validateFhirBundle(bundle));
}));

app.get('/api/providers', wrap(async (_req, res) => {
  res.json(await repo.getProviders());
}));

app.get('/api/appointments', authed, staffModule('appointments', 'followups'), wrap(async (req, res) => {
  res.json(await repo.getAppointments(chartScope(req), providerScope(req), req.user?.id));
}));

/**
 * Scheduling rules mirrored with the client
 * (src/lib/bookingValidation.ts, src/lib/visitWindow.ts): a start tolerates a
 * minute of clock skew, and a patient's room opens 15 minutes before it.
 */
const BOOKING_PAST_SKEW_MS = 60_000;
const JOIN_WINDOW_MINUTES = 15;

/** Booking: staff need the schedule module, a patient books their own chart. */
app.post('/api/appointments', authed, phiWriteLimiter, wrap(async (req, res) => {
  const subject = subjectOf(req);
  if (isPatientScope(subject)) {
    if (!subject.patientId || req.body?.patientId !== subject.patientId) {
      return res.status(403).json({ error: 'Patients may only book visits on their own chart.' });
    }
  } else if (!canAccessTab(subject, 'appointments')) {
    return res.status(403).json({ error: 'Your account cannot access the appointments module.' });
  }
  // date/time are the wall-clock labels stored next to the absolute instant;
  // without them the insert would bind undefined and surface as a 500.
  const required = ['id', 'patientId', 'providerId', 'date', 'time', 'scheduledStart', 'type', 'status', 'roomCode', 'encryptedSessionKey'];
  const absent = missing(req.body, required);
  if (absent.length) return res.status(400).json({ error: `Missing required fields: ${absent.join(', ')}` });
  if (!isSafeId(req.body.id) || !isSafeId(req.body.patientId) || !isSafeId(req.body.providerId)) {
    return res.status(400).json({ error: 'id, patientId, and providerId must be opaque identifiers.' });
  }
  if (!isPatientScope(subject)) {
    const boundProviderId = providerScope(req);
    if (boundProviderId) {
      if (req.body.providerId !== boundProviderId) {
        return res.status(403).json({ error: 'You can only schedule visits with your own provider.' });
      }
      if (!(await canStaffAccessChart(req, req.body.patientId))) {
        return chartNotFound(res);
      }
    }
  }
  // Chart and provider identity are looked up server-side. A booking body can
  // choose which chart and doctor, never what those records say.
  const patient = await repo.getPatient(req.body.patientId);
  if (!patient) {
    return res.status(400).json({ error: 'Unknown patient chart.' });
  }
  const provider = (await repo.getProviders()).find((candidate) => candidate.id === req.body.providerId);
  if (!provider) {
    return res.status(400).json({ error: 'Unknown provider.' });
  }
  // The visit's room is part of its security envelope: reject unknown visit
  // types, non-visit statuses, malformed room references, and an absent
  // session key instead of storing a visit the room can never admit.
  if (!APPOINTMENT_TYPES.includes(req.body.type)) {
    return res.status(400).json({ error: `type must be one of: ${APPOINTMENT_TYPES.join(', ')}` });
  }
  if (req.body.status !== 'scheduled') {
    return res.status(400).json({
      error: 'New visits must be scheduled. Use the visit status route to check in.',
      code: 'NOT_SCHEDULED',
    });
  }
  if (!isRoomCode(req.body.roomCode)) {
    return res.status(400).json({ error: 'roomCode must be a MedZone room reference (MED-ZONE-…).' });
  }
  if (typeof req.body.encryptedSessionKey !== 'string' || !req.body.encryptedSessionKey.trim()) {
    return res.status(400).json({ error: 'encryptedSessionKey is required for the visit room.' });
  }
  // The schedule is validated last, once the visit is known to be well-formed:
  // an unreadable or past start is refused outright, and an instant already
  // held by the same provider or chart is a 409 so the client can offer the
  // next free time.
  const scheduledStartMs = Date.parse(req.body.scheduledStart);
  if (!Number.isFinite(scheduledStartMs)) {
    return res.status(400).json({ error: 'scheduledStart must be a valid instant.', code: 'INVALID_START' });
  }
  if (scheduledStartMs < Date.now() - BOOKING_PAST_SKEW_MS) {
    return res.status(400).json({ error: 'That time is in the past — choose a future slot.', code: 'PAST_START' });
  }
  if (await repo.findSlotClash(req.body.scheduledStart, req.body.providerId, req.body.patientId)) {
    return res.status(409).json({ error: 'That time was just taken. Choose another slot.', code: 'SLOT_TAKEN' });
  }
  const appointment = {
    ...req.body,
    status: 'scheduled',
    patientName: patient.name,
    patientMrn: patient.mrn,
    patientAge: patient.age,
    patientGender: patient.gender,
    providerName: provider.name,
    providerTitle: provider.title,
    providerSpecialty: provider.specialty,
    providerAvatar: provider.avatarUrl || '',
    triagePriority: ['routine', 'urgent', 'priority'].includes(req.body.triagePriority)
      ? req.body.triagePriority
      : 'routine',
    reasonForVisit:
      typeof req.body.reasonForVisit === 'string' && req.body.reasonForVisit.trim()
        ? req.body.reasonForVisit
        : 'General consultation',
  };
  res.status(201).json(await repo.createAppointment(appointment));
}));

/**
 * Visit transitions (check-in / cancel / wrap-up). Staff drive the schedule
 * board; a patient may only move their own visit.
 */
app.patch('/api/appointments/:id/status', authed, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  if (!isVisitStatus(req.body?.status)) {
    return res.status(400).json({ error: 'status must be scheduled, in-progress, completed, or cancelled' });
  }
  const updated = await repo.updateAppointmentStatus(row.id, req.body.status, { canTransitionVisit });
  if (!updated) return res.status(404).json({ error: 'Appointment not found' });
  res.json(updated);
}));

/**
 * Tele-visit admission: opens (or rejoins) the encrypted consultation room.
 *
 * The room is only ever entered through this route. It proves the caller is a
 * participant, refuses a visit that has already closed, and moves a scheduled
 * visit into `in-progress` through the same state machine as check-in. The
 * response is the server's appointment record — room code and session key
 * included — so the client joins with what the backend actually holds and
 * never with a forged local copy.
 */
app.post('/api/appointments/:id/consultation', authed, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  if (row.status === 'completed' || row.status === 'cancelled') {
    return res.status(409).json({ error: 'This visit has ended — the room can no longer be opened.' });
  }
  if (!isRoomCode(row.room_code)) {
    return res.status(409).json({ error: 'This visit has no valid tele-visit room.' });
  }
  // A patient may only enter from 15 minutes before the start — the same
  // window the dashboard shows (src/lib/visitWindow.ts). Staff pick up whoever
  // is waiting, so they are never gated.
  const startMs = appointmentStartMs(row);
  if (isPatientScope(subjectOf(req)) && startMs !== null && Date.now() < startMs - JOIN_WINDOW_MINUTES * 60_000) {
    return res.status(409).json({
      error: `This room opens ${JOIN_WINDOW_MINUTES} minutes before the visit starts.`,
      code: 'JOIN_WINDOW_CLOSED',
    });
  }
  const admitted = await repo.updateAppointmentStatus(row.id, 'in-progress', { canTransitionVisit });
  if (!admitted) {
    return res.status(409).json({ error: 'This visit cannot be opened in its current state.' });
  }
  res.json(admitted);
}));

app.get('/api/prescriptions', authed, staffModule('availability', 'followups', 'appointments'), wrap(async (req, res) => {
  res.json(await repo.getPrescriptions(chartScope(req), providerScope(req), req.user?.id));
}));

/** Issuing a prescription is a clinical act: the meds module and its roles. */
app.post('/api/prescriptions', authed, tabRequired('availability'), wrap(async (req, res) => {
  const required = ['id', 'patientId', 'medicationName', 'dosage', 'route', 'status'];
  const absent = missing(req.body, required);
  if (absent.length) return res.status(400).json({ error: `Missing required fields: ${absent.join(', ')}` });
  if (!isSafeId(req.body.id) || !isSafeId(req.body.patientId)) {
    return res.status(400).json({ error: 'id and patientId must be opaque identifiers.' });
  }
  // Check panel membership before revealing whether the chart exists, so an
  // out-of-panel id and a nonexistent id are indistinguishable to a bound
  // clinician.
  if (!(await canStaffAccessChart(req, req.body.patientId))) {
    return chartNotFound(res);
  }
  const patient = await repo.getPatient(req.body.patientId);
  if (!patient) {
    return res.status(400).json({ error: 'Unknown patient chart.' });
  }
  if (!['active', 'refill-requested', 'completed'].includes(req.body.status)) {
    return res.status(400).json({ error: 'status must be active, refill-requested, or completed' });
  }
  const prescription = {
    ...req.body,
    patientName: patient.name,
    prescribingDoctor: String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255),
    prescribedDate: new Date().toISOString().slice(0, 10),
  };
  res.status(201).json(await repo.createPrescription(prescription));
}));

/** Refill requests and dose logging are patient self-service on their own rx. */
app.patch('/api/prescriptions/:id', authed, wrap(async (req, res) => {
  const subject = subjectOf(req);
  const patch = req.body ?? {};
  const target = await repo.getPrescriptionRow(req.params.id);
  if (isPatientScope(subject)) {
    if (!target || !subject.patientId || target.patient_id !== subject.patientId) {
      return res.status(403).json({ error: 'This prescription belongs to another patient.' });
    }
    // Patients drive exactly two writes: the refill request and dose logging.
    // Status may only move to `refill-requested` — a patient cannot reactivate
    // a completed course, and the prescribed refill count stays staff-only.
    const patientFields = new Set(['status', 'next_dose_minutes', 'adherence_percentage']);
    const illegal = Object.keys(patch).filter((key) => !patientFields.has(key));
    if (illegal.length) {
      return res.status(400).json({ error: `Patients cannot update: ${illegal.join(', ')}` });
    }
    if (patch.status !== undefined && patch.status !== 'refill-requested') {
      return res.status(400).json({ error: 'Patients may only request a refill.' });
    }
  } else {
    if (!canAccessTab(subject, 'availability')) {
      return res.status(403).json({ error: 'Your account cannot access the meds module.' });
    }
    if (!target || !(await canStaffAccessChart(req, target.patient_id))) {
      return res.status(404).json({ error: 'Prescription not found' });
    }
  }
  const updated = await repo.updatePrescription(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Prescription not found or no updatable fields supplied' });
  res.json(updated);
}));

// The audit trail is a staff/compliance surface, not patient-facing data.
app.get('/api/audit-logs', authed, clinicalRequired, wrap(async (req, res) => {
  res.json(await repo.getAuditLogs(200, providerScope(req), req.user?.id));
}));

/**
 * Any signed-in account may record an audited action. Identity fields are
 * stamped server-side from the session and the request itself — a caller can
 * neither claim another name/role nor supply its own masked IP. Patients are
 * limited to patient-legitimate actions and their entries are anchored to
 * their own chart's MRN, so the clinical trail cannot be salted.
 */
app.post('/api/audit-logs', authed, auditLimiter, wrap(async (req, res) => {
  const { action, details, targetMrn } = req.body || {};
  if (!AUDIT_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'A valid audit action is required.' });
  }
  if (typeof details !== 'string' || !details.trim()) {
    return res.status(400).json({ error: 'Audit details are required.' });
  }
  const subject = subjectOf(req);
  const patientScope = isPatientScope(subject);
  if (patientScope && !PATIENT_AUDIT_ACTIONS.has(action)) {
    return res.status(403).json({ error: 'Patients cannot record that clinical action.' });
  }
  const entry = {
    // The id is an opaque client key when supplied (dedup), otherwise minted.
    id: typeof req.body?.id === 'string' && isSafeId(req.body.id) ? req.body.id : `aud-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    userRole: req.subjectRow?.role === 'patient' ? 'patient' : 'clinician',
    userName: req.subjectRow?.displayName ?? req.user?.username ?? 'unknown',
    action,
    details: details.trim().slice(0, 2000),
    // A patient entry always targets the session's own chart, resolved from
    // the database — never the request body.
    targetMrn: patientScope
      ? await repo.getPatientMrn(subject.patientId)
      : (typeof targetMrn === 'string' && targetMrn ? targetMrn.slice(0, 32) : null),
    ipMasked: maskIp(req.ip),
    status: 'VERIFIED_HIPAA',
  };
  res.status(201).json(await repo.createAuditLog(entry));
}));

// The notification feed is a clinic-operations surface. Patient sessions
// receive an empty feed (see getBootstrap) and their local alerts stay local:
// they can neither read, forge into, nor dismiss the clinic's feed.
const NOTIFICATION_TYPES = new Set(['medication', 'appointment', 'security', 'clinical']);

app.get('/api/notifications', authed, clinicalRequired, wrap(async (_req, res) => {
  res.json(await repo.getNotifications());
}));

app.post('/api/notifications', authed, clinicalRequired, notificationLimiter, wrap(async (req, res) => {
  const required = ['id', 'title', 'message', 'type', 'timestamp'];
  const absent = missing(req.body, required);
  if (absent.length) return res.status(400).json({ error: `Missing required fields: ${absent.join(', ')}` });
  if (!isSafeId(req.body.id)) {
    return res.status(400).json({ error: 'Notification id must be an opaque identifier.' });
  }
  if (!NOTIFICATION_TYPES.has(req.body.type)) {
    return res.status(400).json({ error: 'Unknown notification type.' });
  }
  if (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.length > 200) {
    return res.status(400).json({ error: 'A notification title (1-200 characters) is required.' });
  }
  if (typeof req.body.message !== 'string' || !req.body.message.trim() || req.body.message.length > 2000) {
    return res.status(400).json({ error: 'A notification message (1-2000 characters) is required.' });
  }
  res.status(201).json(await repo.createNotification(req.body));
}));

app.patch('/api/notifications/:id/read', authed, clinicalRequired, wrap(async (req, res) => {
  await repo.markNotificationRead(req.params.id);
  res.status(204).end();
}));

app.post('/api/notifications/read-all', authed, clinicalRequired, wrap(async (_req, res) => {
  await repo.markAllNotificationsRead();
  res.status(204).end();
}));

/**
 * Consultation transcript.
 *
 * Reads follow the visit: only its participants (the patient on the chart, or
 * staff with the schedule/visits module) can pull the ciphertext. The
 * transcript is read-only history once a visit closes.
 */
app.get('/api/appointments/:id/messages', authed, transcriptReadLimiter, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  return res.json(await repo.getChatMessages(row.id));
}));

/** Longest transcript message the clinical record accepts. */
const MAX_MESSAGE_CHARS = 4000;

/**
 * Transcript writes are bound to the live encounter: only participants may
 * post, only while the visit is in progress, and the sender identity is
 * stamped from the session — a request body can never claim to be someone
 * else.
 *
 * The body carries the message text; the server encrypts it with the
 * deployment PHI key before it reaches MySQL (see server/crypto.js). The
 * browser holds no transcript key, so a stored dump cannot be decrypted from
 * the visit id, and TLS is the only place the plaintext travels.
 */
app.post('/api/appointments/:id/messages', authed, messageLimiter, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  if (row.status !== 'in-progress') {
    return res.status(409).json({ error: 'The transcript accepts messages only while the visit is in progress.' });
  }

  const { id, text } = req.body ?? {};
  const invalid = [];
  if (!isSafeId(id)) invalid.push('id');
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_MESSAGE_CHARS) invalid.push('text');
  if (invalid.length) {
    return res.status(400).json({
      error: `Invalid message fields: ${invalid.join(', ')} (text must be 1-${MAX_MESSAGE_CHARS} characters).`,
    });
  }

  const subject = subjectOf(req);
  const senderRole = isPatientScope(subject) ? 'patient' : 'clinician';
  const senderName = String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255);
  const message = {
    id: id.trim(),
    appointmentId: row.id,
    senderRole,
    senderName,
    // The encounter clock is the server's: a client cannot backdate or
    // post-date a clinical message by supplying its own timestamp.
    timestamp: new Date().toISOString(),
    text: text.trim(),
  };
  res.status(201).json(await repo.createChatMessage(message));
}));

// ---------------------------------------------------------------------------
// Tele-visit room control plane: guests + WebRTC signaling
// ---------------------------------------------------------------------------

/**
 * Guest roster for a live visit (family / translator / specialist invites).
 * Owned by the visit so both participants see the same list across reloads;
 * only participants of the visit may read or change it.
 */
app.get('/api/appointments/:id/guests', authed, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  return res.json(await repo.getVisitGuests(row.id));
}));

app.post('/api/appointments/:id/guests', authed, phiWriteLimiter, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  if (row.status !== 'scheduled' && row.status !== 'in-progress') {
    return res.status(409).json({ error: 'Guests cannot be added to a closed visit.' });
  }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 128) {
    return res.status(400).json({ error: 'A guest name (1-128 characters) is required.' });
  }
  if (!GUEST_ROLES.has(req.body?.role)) {
    return res.status(400).json({ error: 'A valid guest role is required.' });
  }
  const guest = {
    id: `guest-${randomUUID()}`,
    appointmentId: row.id,
    name,
    role: req.body.role,
    invitedBy: String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255),
    createdAt: new Date().toISOString(),
  };
  res.status(201).json(await repo.createVisitGuest(guest));
}));

app.delete('/api/appointments/:id/guests/:guestId', authed, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  const removed = await repo.deleteVisitGuest(row.id, req.params.guestId);
  if (!removed) return res.status(404).json({ error: 'Guest not found on this visit.' });
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// HCW@Home parity: patient invite links, shared waiting room, attachments,
// anonymised statistics
// ---------------------------------------------------------------------------

/** Invitation link channels a clinician can share (mirrors visit_invites.channel). */
const INVITE_CHANNELS = new Set(['link', 'sms', 'email', 'whatsapp']);
const INVITE_TTL_HOURS = Math.max(1, Number(process.env.INVITE_TTL_HOURS || 72));

/**
 * Mints a single-click patient invitation link for a visit (HCW@Home "invite
 * patient in seconds by SMS, Email or WhatsApp"). Any participant may issue
 * one; re-issuing supersedes the visit's previous links so a leaked token has
 * at most a short life. The token is opaque and carries no chart data.
 */
app.post('/api/appointments/:id/invite', authed, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  if (row.status === 'completed' || row.status === 'cancelled') {
    return res.status(409).json({ error: 'A closed visit cannot be re-invited.' });
  }
  const channel = INVITE_CHANNELS.has(req.body?.channel) ? req.body.channel : 'link';
  const token = randomBytes(24).toString('base64url');
  const now = Date.now();
  const invite = {
    token,
    appointmentId: row.id,
    channel,
    createdBy: String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_TTL_HOURS * 3600_000).toISOString(),
    revoked: false,
  };
  await repo.revokeVisitInvites(row.id);
  await repo.createVisitInvite(invite);
  res.status(201).json({ ...invite, joinPath: `/join/${encodeURIComponent(token)}` });
}));

/**
 * Public invite resolution for the join landing page.
 *
 * Deliberately PHI-free: it names the visit type, the clinician and the
 * scheduled time so an invited person can recognise the visit, but never the
 * patient, the chart or the room secret. The link only helps an authenticated
 * participant reach the lobby; it is not itself an access grant.
 */
app.get('/api/invites/:token', optionalSession, wrap(async (req, res) => {
  const invite = await repo.getVisitInviteRow(req.params.token);
  const expired = invite ? Date.parse(invite.expires_at) <= Date.now() : true;
  if (!invite || invite.revoked || expired) {
    return res.status(404).json({ error: 'This invitation link is no longer valid.', valid: false });
  }
  const row = await repo.getAppointmentRow(invite.appointment_id);
  if (!row) return res.status(404).json({ error: 'This invitation link is no longer valid.', valid: false });
  const closed = row.status === 'completed' || row.status === 'cancelled';
  res.json({
    valid: !closed,
    appointmentId: row.id,
    type: row.type,
    providerName: row.provider_name,
    providerSpecialty: row.provider_specialty,
    scheduledStart: row.scheduled_start_utc,
    status: row.status,
    expiresAt: invite.expires_at,
  });
}));

/**
 * Shared waiting room: every checked-in visit, whoever it is booked with, so
 * any available clinician can pick up a waiting patient (HCW@Home "waiting
 * rooms dispatched across several doctors").
 */
app.get('/api/waiting-room', authed, clinicalRequired, wrap(async (_req, res) => {
  res.json(await repo.getWaitingRoom());
}));

/** Claims a waiting visit for the calling clinician; the first claim wins. */
app.post('/api/waiting-room/:id/claim', authed, clinicalRequired, wrap(async (req, res) => {
  const claimed = await repo.claimWaitingVisit(req.params.id, {
    userId: req.user.id,
    name: String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255),
  });
  if (!claimed) {
    return res.status(409).json({ error: 'This visit is no longer waiting or is already claimed.' });
  }
  res.json(claimed);
}));

/** In-visit attachment exchange (HCW@Home "send attachment or image"). */
const MAX_ATTACHMENT_BYTES = 1_500_000;
const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

app.get('/api/appointments/:id/attachments', authed, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  return res.json(await repo.getVisitAttachments(row.id));
}));

app.post('/api/appointments/:id/attachments', authed, phiWriteLimiter, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  if (row.status !== 'in-progress') {
    return res.status(409).json({ error: 'Attachments can only be shared during a live visit.' });
  }
  const { id, fileName, mimeType, contentBase64 } = req.body ?? {};
  if (typeof id !== 'string' || !ATTACHMENT_ID_PATTERN.test(id)) {
    return res.status(400).json({ error: 'id must be an opaque identifier.' });
  }
  const name = typeof fileName === 'string' ? fileName.trim() : '';
  if (!name || name.length > 255) {
    return res.status(400).json({ error: 'A file name (1-255 characters) is required.' });
  }
  const mime = typeof mimeType === 'string' && mimeType.trim() ? mimeType.trim().slice(0, 128) : 'application/octet-stream';
  if (typeof contentBase64 !== 'string' || !contentBase64 || !BASE64_PATTERN.test(contentBase64)) {
    return res.status(400).json({ error: 'A base64-encoded file body is required.' });
  }
  const sizeBytes = Math.floor((contentBase64.length * 3) / 4);
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    return res.status(413).json({ error: `Attachments must be ${MAX_ATTACHMENT_BYTES} bytes or fewer.` });
  }
  const subject = subjectOf(req);
  const attachment = {
    id,
    appointmentId: row.id,
    senderId: req.user.id,
    senderRole: isPatientScope(subject) ? 'patient' : 'clinician',
    senderName: String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255),
    fileName: name,
    mimeType: mime,
    sizeBytes,
    content: contentBase64,
    createdAt: new Date().toISOString(),
  };
  res.status(201).json(await repo.createVisitAttachment(attachment));
}));

/** Anonymised clinic statistics for the operations console (admins only). */
app.get('/api/stats', authed, adminOnly, wrap(async (_req, res) => {
  res.json(await repo.getClinicStats());
}));

/**
 * WebRTC signaling relay.
 *
 * Participants exchange SDP offers/answers, ICE candidates and presence
 * heartbeats while the visit is in progress. The API only forwards opaque
 * control payloads — media flows peer-to-peer and never touches the server —
 * and identity is stamped from the session, so one participant cannot spoof
 * the other's signals.
 */
app.post('/api/appointments/:id/signals', authed, signalLimiter, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  if (row.status !== 'in-progress') {
    return res.status(409).json({ error: 'The visit is not in progress.' });
  }
  const { kind, payload } = req.body ?? {};
  if (!SIGNAL_KINDS.has(kind)) {
    return res.status(400).json({ error: 'Unknown signaling kind.' });
  }
  if (payload !== undefined && payload !== null) {
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_SIGNAL_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Signal payload is too large.' });
    }
    if ((kind === 'offer' || kind === 'answer')) {
      if (typeof payload?.sdp !== 'string' || !payload.sdp || payload.sdp.length > MAX_SDP_LENGTH) {
        return res.status(400).json({ error: 'A valid session description is required.' });
      }
    }
    if (kind === 'candidate' && (typeof payload?.candidate !== 'object' || payload.candidate === null)) {
      return res.status(400).json({ error: 'A valid ICE candidate is required.' });
    }
  }
  const subject = subjectOf(req);
  await repo.insertRoomSignal({
    appointmentId: row.id,
    senderId: req.user.id,
    senderRole: isPatientScope(subject) ? 'patient' : 'clinician',
    senderName: String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255),
    kind,
    payload: payload ?? null,
  });
  // The relay is short-lived by design: heartbeats and ICE trickle in faster
  // than this window, so nothing a live room needs is pruned.
  await repo.pruneRoomSignals(row.id);
  res.status(201).json({ ok: true });
}));

app.get('/api/appointments/:id/signals', authed, signalLimiter, wrap(async (req, res) => {
  const row = await visitForParticipant(req, res);
  if (!row) return undefined;
  if (row.status !== 'in-progress') {
    return res.status(409).json({ error: 'The visit is not in progress.' });
  }
  const afterId = Number(req.query.after) || 0;
  const [signals, presence] = await Promise.all([
    repo.getRoomSignalsSince(row.id, afterId),
    repo.getRoomPresence(row.id, req.user.id),
  ]);
  const latestId = signals.length ? signals[signals.length - 1].id : afterId;
  res.json({
    latestId,
    signals,
    // The other participants seen in the heartbeat window: the client shows
    // "connected" from this, never from stale local state.
    presence: presence.map((signal) => ({
      senderId: signal.senderId,
      senderRole: signal.senderRole,
      senderName: signal.senderName,
      kind: signal.kind,
      at: signal.createdAt,
    })),
  });
}));

app.get('/api/soap-note', authed, staffModule('followups', 'appointments'), wrap(async (req, res) => {
  const appointmentId =
    typeof req.query.appointmentId === 'string' ? req.query.appointmentId.trim() : '';
  if (!isPatientScope(subjectOf(req)) && appointmentId) {
    const row = await repo.getAppointmentRow(appointmentId);
    if (!row || !canStaffAccessAppointment(req, row)) {
      return res.status(404).json({ error: 'No SOAP note recorded' });
    }
  }
  const note = await repo.getSoapNote(chartScope(req), appointmentId || null);
  if (!note) return res.status(404).json({ error: 'No SOAP note recorded' });
  res.json(note);
}));

/**
 * Signing/updating a note is clinical charting: the visits module and its
 * roles. Two integrity rules are enforced here, not in the client:
 *  - a signed note is locked — further writes are refused so a signature
 *    cannot be silently overwritten while keeping its signer;
 *  - the signer/mtime are stamped from the session and the server clock, so
 *    a request body can neither claim another clinician signed nor backdate.
 */
app.put('/api/soap-note', authed, tabRequired('followups'), wrap(async (req, res) => {
  const required = ['subjective', 'objective', 'assessment', 'plan'];
  const absent = missing(req.body, required);
  if (absent.length) return res.status(400).json({ error: `Missing required fields: ${absent.join(', ')}` });
  const appointmentId =
    typeof req.body?.appointmentId === 'string' ? req.body.appointmentId.trim() : '';
  if (appointmentId && !isSafeId(appointmentId)) {
    return res.status(400).json({ error: 'appointmentId must be an opaque identifier.' });
  }
  if (appointmentId) {
    const row = await repo.getAppointmentRow(appointmentId);
    if (!row || !canStaffAccessAppointment(req, row)) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
  } else if (providerScope(req)) {
    // The legacy chart-less singleton is not a safe write target for a bound
    // clinician: every note they author must be tied to one of their visits.
    return res.status(400).json({ error: 'Select a visit before saving this note.' });
  }
  const existing = await repo.getSoapNoteMeta(appointmentId || null);
  if (existing?.is_signed) {
    return res.status(409).json({ error: 'This note is signed and can no longer be edited.' });
  }
  const signing = req.body?.isSigned === true;
  const note = {
    ...req.body,
    appointmentId: appointmentId || undefined,
    // The signer is the session's own identity; an unsigned autosave clears it.
    signedBy: signing
      ? String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255)
      : null,
    lastUpdated: new Date().toISOString(),
  };
  res.json(await repo.upsertSoapNote(note, appointmentId || null));
}));

/** The follow-up chart is a staff view (patients hold no visits module). */
app.get('/api/follow-up', authed, tabRequired('followups'), wrap(async (req, res) => {
  let rows = await repo.getFollowUps();
  // A clinician bound to a provider reads only their own panel. The chart
  // picker and the bootstrap already apply that scope; the single-chart
  // endpoint must not hand a bound clinician another doctor's follow-up just
  // because it sorts first in the clinic-wide table.
  const providerId = providerScope(req);
  if (providerId) {
    const panel = new Set((await repo.getProviderPatients(providerId, req.user?.id)).map((p) => p.id));
    rows = rows.filter((row) => row.patientId && panel.has(row.patientId));
  }
  // The FollowUpDetailView renders one chart; the list endpoint serves the
  // directory loader. Return the first chart (or null) so the shape matches
  // FollowUpDetail instead of an array.
  res.json(rows[0] ?? null);
}));

app.patch('/api/follow-up/:id/status', authed, tabRequired('followups'), wrap(async (req, res) => {
  const { status } = req.body ?? {};
  if (status !== 'Active' && status !== 'Closed' && status !== 'Pending') {
    return res.status(400).json({ error: 'status must be Active, Closed, or Pending' });
  }
  // Closing another panel's follow-up is refused the same way an unknown id
  // is, so a bound clinician cannot probe the clinic by id.
  const providerId = providerScope(req);
  if (providerId) {
    const panel = new Set((await repo.getProviderPatients(providerId, req.user?.id)).map((p) => p.id));
    const target = (await repo.getFollowUps()).find((row) => row.id === req.params.id);
    if (!target || !target.patientId || !panel.has(target.patientId)) {
      return res.status(404).json({ error: 'Follow-up not found' });
    }
  }
  const updated = await repo.updateFollowUpStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Follow-up not found' });
  res.json(updated);
}));

// ---------------------------------------------------------------------------
// Auth & user management (RBAC, elgon parity)
// ---------------------------------------------------------------------------

app.post('/api/login', loginLimiter, loginAccountLimiter, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const row = await repo.getUserWithHashByUsername(String(username).trim());
  if (!row) {
    // Equalize timing with a real bcrypt comparison so login latency does not
    // reveal whether the username exists (account enumeration).
    await verifyPassword(String(password), await getDummyPasswordHash());
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  const ok = await verifyPassword(String(password), row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });
  // A proven credential clears this account's failed-attempt budget, so only
  // failures accumulate there.
  loginAccountLimiter.reset(loginAccountKey(req));
  // A fresh login always starts with the MFA claim cleared.
  setSessionCookie(res, signSession(row, { mfaVerified: false }));
  res.json({ ...toSafeUser(row), mfaVerified: false, mfaRequired: isMfaRequired() });
}));

app.post('/api/logout', wrap(async (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
}));

/**
 * Authenticator state for the signed-in account.
 *
 * `required` is the deployment policy, `enrolled` is whether this account
 * holds a secret, `verified` is whether THIS session proved it. The secret
 * itself is never returned here.
 */
app.get('/api/mfa/status', authed, wrap(async (req, res) => {
  res.json({
    required: isMfaRequired(),
    enrolled: req.subjectRow?.mfaEnrolled === true,
    // A secret is stored but no code from it has been accepted yet.
    pending: req.subjectRow?.mfaPending === true,
    verified: req.user?.mfa === true,
  });
}));

/**
 * Starts (or rotates) this account's authenticator.
 *
 * Requires the current password: a stolen session must not be able to attach
 * its own device and keep access after the owner rotates the password. The new
 * secret is returned once for the authenticator app, stored encrypted with the
 * PHI key, and the session is demoted to unverified until a code generated
 * from that secret is presented.
 */
app.post('/api/mfa/enroll', authed, passwordLimiter, wrap(async (req, res) => {
  const { currentPassword } = req.body || {};
  if (!currentPassword) {
    return res.status(400).json({ error: 'Current password is required to enroll an authenticator.' });
  }
  const row = await repo.getUserRowById(req.user.id);
  if (!row) return res.status(401).json({ error: 'Session account no longer exists.' });
  if (!(await verifyPassword(String(currentPassword), row.password_hash))) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  const secret = generateTotpSecret();
  await repo.setUserMfaSecret(req.user.id, encryptField(secret));
  invalidateSubjectRow(req.user.id);
  setSessionCookie(res, signSession(row, { mfaVerified: false }));
  res.status(201).json({
    secret,
    otpauthUrl: totpUri({ secret, accountName: row.username }),
    enrolled: false,
    verified: false,
  });
}));

/**
 * Server-side MFA verification against THIS account's secret.
 *
 * The secret never leaves the server; a successful check re-signs the session
 * cookie with the `mfa` claim so the verified state survives reloads (and
 * stays per-session rather than per-browser). Fails closed: an account with no
 * enrolled authenticator cannot verify.
 *
 * Single-use (RFC 6238 §5.2): the matched 30-second step is burned in
 * users.mfa_last_step, a single conditional UPDATE. That ledger lives in the
 * shared row, so a replayed code is refused by every API worker and survives a
 * restart — unlike the in-process map this replaced.
 */
app.post('/api/mfa/verify', authed, mfaLimiter, wrap(async (req, res) => {
  const code = String(req.body?.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the 6-digit code from your authenticator app.' });
  }
  const row = await repo.getUserRowById(req.user.id);
  if (!row) return res.status(401).json({ error: 'Session account no longer exists.' });
  if (!row.mfa_secret) {
    return res.status(409).json({
      error: 'No authenticator is enrolled for this account.',
      code: 'MFA_NOT_ENROLLED',
    });
  }
  // An unreadable secret (rotated PHI key) behaves like no enrollment: the
  // account re-enrolls instead of being locked out by a 500.
  const step = verifyTotpStep(code, decryptField(row.mfa_secret));
  if (step === null) {
    return res.status(401).json({ error: 'Invalid or expired code.' });
  }
  if (!(await repo.consumeMfaStep(req.user.id, step))) {
    return res.status(401).json({
      error: 'That code has already been used. Enter the next one from your authenticator.',
      code: 'MFA_CODE_REUSED',
    });
  }
  await repo.activateUserMfa(req.user.id);
  invalidateSubjectRow(req.user.id);
  const fresh = (await repo.getUserRowById(req.user.id)) ?? row;
  setSessionCookie(res, signSession(fresh, { mfaVerified: true }));
  res.json({ mfaVerified: true, enrolled: true });
}));

app.post('/api/mfa/revoke', authed, wrap(async (req, res) => {
  const row = await repo.getUserRowById(req.user.id);
  if (!row) return res.status(401).json({ error: 'Session account no longer exists.' });
  setSessionCookie(res, signSession(row, { mfaVerified: false }));
  res.json({ mfaVerified: false });
}));

app.get('/api/me', authed, wrap(async (req, res) => {
  const user = await repo.getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  res.json({ ...user, mfaVerified: req.user.mfa === true, mfaRequired: isMfaRequired() });
}));

/**
 * Self-service password change. Requires the current password (a stolen or
 * shared session cannot silently rotate the account away from its owner) and
 * enforces the same length policy as account administration.
 */
app.post('/api/change-password', authed, passwordLimiter, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword) {
    return res.status(400).json({ error: 'Current password is required.' });
  }
  const row = await repo.getUserRowById(req.user.id);
  if (!row) return res.status(401).json({ error: 'Session account no longer exists.' });
  const ok = await verifyPassword(String(currentPassword), row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
  if (!newPassword || String(newPassword).length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
  }
  if (String(newPassword).length > PASSWORD_MAX_LENGTH) {
    return res.status(400).json({ error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` });
  }
  await repo.updateUserPasswordHash(req.user.id, await hashPassword(String(newPassword)));
  // The rotation invalidated every session, including this one. Re-issue the
  // caller's cookie at the new epoch so they stay signed in while every other
  // device is signed out.
  invalidateSubjectRow(req.user.id);
  const freshRow = await repo.getUserRowById(req.user.id);
  if (freshRow) {
    setSessionCookie(res, signSession(freshRow, { mfaVerified: req.user.mfa === true }));
  }
  res.json({ ok: true });
}));

app.get('/api/users', authed, adminOnly, wrap(async (_req, res) => {
  res.json(await repo.getAllUsers());
}));

app.post('/api/users', authed, adminOnly, wrap(async (req, res) => {
  const {
    username,
    displayName,
    password,
    modules,
    isAdmin,
    role,
    patientId: patientIdInput,
    providerId: providerIdInput,
    avatarUrl: avatarUrlInput,
  } = req.body || {};
  if (!username || !String(username).trim()) {
    return res.status(400).json({ error: 'Username is required.' });
  }
  if (avatarUrlInput !== undefined && !isValidAvatarDataUrl(avatarUrlInput)) {
    return res.status(400).json({ error: 'Avatar must be a JPEG, PNG, or WebP image under 512 KB.' });
  }
  if (!password || String(password).length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
  }
  if (String(password).length > PASSWORD_MAX_LENGTH) {
    return res.status(400).json({ error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` });
  }
  if (!isValidModuleList(modules) || modules.length === 0) {
    return res.status(400).json({ error: 'Select at least one valid module.' });
  }
  const validRoles = ['patient', 'clinician', 'admin'];
  const userRole = validRoles.includes(role) ? role : 'patient';
  const existing = await repo.getUserWithHashByUsername(String(username).trim());
  if (existing) {
    return res.status(409).json({ error: `Username "${String(username).trim()}" already exists.` });
  }
  const patientId = typeof patientIdInput === 'string' && patientIdInput.trim() ? patientIdInput.trim() : null;
  // A provider binding makes a clinician account the doctor who was booked, so
  // the schedule scopes to their own patients. Ignored for patient accounts.
  const providerId =
    userRole === 'patient'
      ? null
      : typeof providerIdInput === 'string' && providerIdInput.trim()
        ? providerIdInput.trim()
        : null;
  const user = await repo.createUserRow({
    username: String(username).trim(),
    displayName: displayName && String(displayName).trim() ? String(displayName).trim() : String(username).trim(),
    passwordHash: await hashPassword(String(password)),
    modules: modules.filter((m) => ALLOWED_MODULES.includes(m)),
    isAdmin: !!isAdmin || userRole === 'admin',
    role: userRole,
    patientId,
    providerId,
    avatarUrl: typeof avatarUrlInput === 'string' ? avatarUrlInput : '',
  });
  res.status(201).json(user);
}));

app.patch('/api/users/:id', authed, adminOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  const { modules, isAdmin, role, patientId, providerId, avatarUrl } = req.body || {};
  const target = await repo.getUserById(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  // Validate every field before applying anything, so a rejected value cannot
  // leave a half-applied update behind.
  if (modules !== undefined && (!isValidModuleList(modules) || modules.length === 0)) {
    return res.status(400).json({ error: 'Select at least one valid module.' });
  }
  const validRoles = ['patient', 'clinician', 'admin'];
  if (role !== undefined && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be patient, clinician, or admin.' });
  }
  if (avatarUrl !== undefined && !isValidAvatarDataUrl(avatarUrl)) {
    return res.status(400).json({ error: 'Avatar must be a JPEG, PNG, or WebP image under 512 KB.' });
  }
  if (id === req.user.id && isAdmin === false) {
    return res.status(400).json({ error: 'You cannot remove your own admin status.' });
  }
  if (id === req.user.id && role !== undefined && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot change your own admin role.' });
  }
  // Last-admin safeguard: the clinic must never be locked out of administration
  // because a second admin demoted or deleted the only one left.
  const demotesAdmin = (isAdmin === false && target.isAdmin) || (role !== undefined && role !== 'admin' && target.isAdmin);
  if (demotesAdmin && (await repo.countAdmins()) <= 1) {
    return res.status(400).json({ error: 'This is the only administrator — promote another account first.' });
  }

  if (patientId !== undefined) {
    await repo.updateUserPatient(id, patientId ? String(patientId).trim() : null);
  }

  if (providerId !== undefined) {
    await repo.updateUserProvider(id, providerId ? String(providerId).trim() : null);
  }

  if (avatarUrl !== undefined) {
    await repo.updateUserAvatar(id, typeof avatarUrl === 'string' ? avatarUrl : '');
  }

  if (modules !== undefined) {
    await repo.updateUserModules(id, modules.filter((m) => ALLOWED_MODULES.includes(m)));
  }

  if (isAdmin !== undefined) {
    await repo.updateUserAdmin(id, !!isAdmin);
  }

  if (role !== undefined) {
    await repo.updateUserRole(id, role);
    if (role === 'admin') await repo.updateUserAdmin(id, true);
  }

  res.json(await repo.getUserById(id));
}));

app.post('/api/users/:id/reset-password', authed, adminOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
  }
  if (String(newPassword).length > PASSWORD_MAX_LENGTH) {
    return res.status(400).json({ error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` });
  }
  const target = await repo.getUserById(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  await repo.updateUserPasswordHash(id, await hashPassword(String(newPassword)));
  // The reset bumps the target's token epoch: sign their sessions out now
  // rather than letting a cached row keep them alive for the cache TTL.
  invalidateSubjectRow(id);
  res.json({ ok: true });
}));

/**
 * Clears an account's authenticator so a locked-out user (lost or replaced
 * device) can enroll again. Administrator-only: it removes a factor, so it is
 * never something a session can do for itself.
 */
app.post('/api/users/:id/reset-mfa', authed, adminOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  const target = await repo.getUserById(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  await repo.clearUserMfa(id);
  invalidateSubjectRow(id);
  res.json({ ok: true });
}));

app.delete('/api/users/:id', authed, adminOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  const target = await repo.getUserById(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.isAdmin && (await repo.countAdmins()) <= 1) {
    return res.status(400).json({ error: 'This is the only administrator — promote another account first.' });
  }
  await repo.deleteUserRow(id);
  invalidateSubjectRow(id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Consultant notes: clinician-authored notes the patient downloads as PDF.
// PHI (title/body) is AES-256-GCM encrypted at rest, like soap notes.
// ---------------------------------------------------------------------------

/** A patient downloads their own clinician notes; staff read the clinic set. */
app.get('/api/consultant-notes', authed, staffModule('contacts'), wrap(async (req, res) => {
  res.json(await repo.getConsultantNotes(chartScope(req), providerScope(req), req.user?.id));
}));

/**
 * Authoring a consultant note is clinical charting (records module + roles).
 * The note's author is the session's own identity — a request body can claim
 * neither another clinician's name nor role.
 */
app.post('/api/consultant-notes', authed, tabRequired('contacts'), wrap(async (req, res) => {
  const required = ['id', 'patientId', 'title', 'body'];
  const absent = missing(req.body, required);
  if (absent.length) return res.status(400).json({ error: `Missing required fields: ${absent.join(', ')}` });
  if (!isSafeId(req.body.id) || !isSafeId(req.body.patientId)) {
    return res.status(400).json({ error: 'id and patientId must be opaque identifiers.' });
  }
  // Panel membership is checked before chart existence, so a bound clinician
  // cannot distinguish a foreign id from a nonexistent one.
  if (!(await canStaffAccessChart(req, req.body.patientId))) {
    return chartNotFound(res);
  }
  const patient = await repo.getPatient(req.body.patientId);
  if (!patient) {
    return res.status(400).json({ error: 'Unknown patient chart.' });
  }
  const note = {
    ...req.body,
    patientName: patient.name,
    patientMrn: patient.mrn,
    authorName: String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255),
    authorRole: 'clinician',
    createdAt: new Date().toISOString(),
  };
  res.status(201).json(await repo.createConsultantNote(note));
}));

// ---------------------------------------------------------------------------
// Consultation requests: patient-submitted visit requests triaged by the
// care team (HCW@Home "consultation request form" parity).
// ---------------------------------------------------------------------------

app.get('/api/consultation-requests', authed, staffModule('contacts', 'followups'), wrap(async (req, res) => {
  res.json(await repo.getConsultationRequests(chartScope(req), providerScope(req), req.user?.id));
}));

/** A patient submits requests for their own chart; staff file them too. */
app.post('/api/consultation-requests', authed, phiWriteLimiter, wrap(async (req, res) => {
  const subject = subjectOf(req);
  if (isPatientScope(subject)) {
    if (!subject.patientId || req.body?.patientId !== subject.patientId) {
      return res.status(403).json({ error: 'Patients may only file requests for their own chart.' });
    }
  } else if (!canAccessTab(subject, 'contacts') && !canAccessTab(subject, 'followups')) {
    return res.status(403).json({ error: 'Your account cannot file consultation requests.' });
  }
  const required = ['id', 'patientId', 'topic', 'preferredDate', 'details', 'contact'];
  const absent = missing(req.body, required);
  if (absent.length) return res.status(400).json({ error: `Missing required fields: ${absent.join(', ')}` });
  if (!isSafeId(req.body.id) || !isSafeId(req.body.patientId)) {
    return res.status(400).json({ error: 'id and patientId must be opaque identifiers.' });
  }
  if (!isPatientScope(subject) && !(await canStaffAccessChart(req, req.body.patientId))) {
    return chartNotFound(res);
  }
  const patient = await repo.getPatient(req.body.patientId);
  if (!patient) {
    return res.status(400).json({ error: 'Unknown patient chart.' });
  }
  const request = {
    ...req.body,
    patientName: patient.name,
    patientMrn: patient.mrn,
    patientAge: patient.age,
    patientGender: patient.gender,
    // A new request is always untriaged; only the staff status route may
    // review it, and it stamps the reviewer from the session.
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date().toISOString(),
  };
  res.status(201).json(await repo.createConsultationRequest(request));
}));

// Triage is a staff action; the reviewer is stamped from the session unless the
// operator names one explicitly (the test harness files triage as "API Tester").
app.patch('/api/consultation-requests/:id/status', authed, tabRequired('contacts'), wrap(async (req, res) => {
  const { status } = req.body ?? {};
  if (status !== 'accepted' && status !== 'declined') {
    return res.status(400).json({ error: 'status must be accepted or declined' });
  }
  const target = await repo.getConsultationRequestRow(req.params.id);
  if (!target || !(await canStaffAccessChart(req, target.patient_id))) {
    return res.status(404).json({ error: 'Consultation request not found' });
  }
  // The reviewer is the session's own identity. A request body can never
  // attribute a triage decision to another clinician.
  const reviewedBy = String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255);
  const updated = await repo.updateConsultationRequestStatus(req.params.id, status, reviewedBy);
  if (!updated) return res.status(404).json({ error: 'Consultation request not found' });
  res.json(updated);
}));

// ---------------------------------------------------------------------------
// Specialist referrals (both directions): clinician refers the patient to a
// specialty/provider, or the patient requests a specialty referral. Shared
// triage inbox: pending -> accepted/declined, accepted -> completed.
// ---------------------------------------------------------------------------

app.get('/api/referrals', authed, staffModule('contacts'), wrap(async (req, res) => {
  res.json(await repo.getReferrals(chartScope(req), providerScope(req), req.user?.id));
}));

/** Clinicians refer patients; a patient may request a referral for their own
 * chart (source: 'patient'). The creator is stamped from the session; anything
 * else is refused. */
app.post('/api/referrals', authed, phiWriteLimiter, wrap(async (req, res) => {
  const subject = subjectOf(req);
  if (isPatientScope(subject)) {
    if (!subject.patientId || req.body?.patientId !== subject.patientId || req.body?.source !== 'patient') {
      return res.status(403).json({ error: 'Patients may only request referrals for their own chart.' });
    }
  } else if (!canAccessTab(subject, 'contacts')) {
    return res.status(403).json({ error: 'Your account cannot create referrals.' });
  }
  const required = ['id', 'patientId', 'specialty', 'reason', 'priority', 'source'];
  const absent = missing(req.body, required);
  if (absent.length) return res.status(400).json({ error: `Missing required fields: ${absent.join(', ')}` });
  if (req.body.priority !== 'routine' && req.body.priority !== 'urgent') {
    return res.status(400).json({ error: 'priority must be routine or urgent' });
  }
  if (req.body.source !== 'clinician' && req.body.source !== 'patient') {
    return res.status(400).json({ error: 'source must be clinician or patient' });
  }
  if (!isSafeId(req.body.id) || !isSafeId(req.body.patientId)) {
    return res.status(400).json({ error: 'id and patientId must be opaque identifiers.' });
  }
  if (!isPatientScope(subject) && !(await canStaffAccessChart(req, req.body.patientId))) {
    return chartNotFound(res);
  }
  const patient = await repo.getPatient(req.body.patientId);
  if (!patient) {
    return res.status(400).json({ error: 'Unknown patient chart.' });
  }
  const referral = {
    ...req.body,
    patientName: patient.name,
    patientMrn: patient.mrn,
    patientAge: patient.age,
    patientGender: patient.gender,
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date().toISOString(),
    createdBy: String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255),
  };
  res.status(201).json(await repo.createReferral(referral));
}));

// Triage is a staff action; the reviewer is stamped from the session.
app.patch('/api/referrals/:id/status', authed, tabRequired('contacts'), wrap(async (req, res) => {
  const { status } = req.body ?? {};
  if (status !== 'accepted' && status !== 'declined' && status !== 'completed') {
    return res.status(400).json({ error: 'status must be accepted, declined, or completed' });
  }
  const target = await repo.getReferralRow(req.params.id);
  if (!target || !(await canStaffAccessChart(req, target.patient_id))) {
    return res.status(404).json({ error: 'Referral not found' });
  }
  const reviewer = String(req.subjectRow?.displayName || req.subjectRow?.username || 'Unknown').slice(0, 255);
  const updated = await repo.updateReferralStatus(req.params.id, status, reviewer);
  if (!updated) return res.status(404).json({ error: 'Referral not found or illegal status transition' });
  res.json(updated);
}));

// Serve the production build when it exists, so one process hosts API + SPA.
const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // Honors framework errors (malformed JSON body = 400, payload too large =
  // 413, …) instead of masking every failure as a 500.
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status >= 500) console.error('[medzone-api]', err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : 'Request rejected.' });
});

export default app;
