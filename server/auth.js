/**
 * MedZone backend - authentication & user management.
 *
 * Mirrors the elgon/cdrpro RBAC pattern: JWT session cookie (httpOnly),
 * bcrypt password hashes in MySQL, per-user module grants, admin-only
 * user administration. No credentials are hardcoded; the initial
 * administrator is seeded from environment variables (see seed.js).
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
const TOKEN_NAME = 'medzone_token';
const TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const DEV_FALLBACK_SECRET = 'medzone-dev-secret-change-me';

/** MedZone sidebar modules that can be granted per user. */
export const ALLOWED_MODULES = ['dashboard', 'followups', 'contacts', 'appointments', 'availability'];

/** Password policy for every account created, reset or changed through the API. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Registration portraits are stored as data URLs in the users row. The client
 * downscales them to a square JPEG; the cap here is a server-side backstop so
 * an oversized payload cannot bloat sessions and user listings.
 */
export const AVATAR_DATA_URL_MAX_LENGTH = 700_000;

/** Empty (no portrait) or a supported image data URL under the size cap. */
export const isValidAvatarDataUrl = (value) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (typeof value === 'string' &&
    value.length <= AVATAR_DATA_URL_MAX_LENGTH &&
    /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value));

/**
 * True for values that only look like secrets: the documented .env
 * placeholders (MY_…_CHANGE_ME) and the built-in development constants. These
 * must never protect a production deployment.
 */
export const isPlaceholderSecret = (value) =>
  typeof value === 'string' && /change[-_]?me|^MY_|placeholder|example/i.test(value);

export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === 'production';
  if (secret && !isPlaceholderSecret(secret)) {
    if (isProduction && secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production.');
    }
    return secret;
  }
  if (isProduction) {
    throw new Error(
      'JWT_SECRET environment variable is required in production and must be a real secret. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  // Development fallback so `npm run server` works out of the box. Production
  // never reaches this line, and a placeholder .env value falls back here too.
  return DEV_FALLBACK_SECRET;
};

let dummyHashPromise;
/**
 * A bcrypt comparison target used when a username is unknown, so login latency
 * does not reveal whether an account exists (timing-based enumeration).
 */
export const getDummyPasswordHash = () => {
  dummyHashPromise ??= bcrypt.hash('medzone-login-timing-equalizer', 12);
  return dummyHashPromise;
};

export const hashPassword = (plain) => bcrypt.hash(plain, 12);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export const isValidModuleList = (modules) =>
  Array.isArray(modules) && modules.every((m) => ALLOWED_MODULES.includes(m));

/**
 * Session token.
 *
 * Identity only — no role, module grants or chart link. Those are re-read from
 * the database on every request (see sessionSubject in app.js) so an admin
 * change takes effect on the caller's next request instead of up to 12 hours
 * later when the token happens to expire. A stale token must never be able to
 * keep reading a chart the clinic has since unlinked.
 *
 * The single non-identity claim is `mfa`: it records that THIS session passed
 * a server-side TOTP check (POST /api/mfa/verify re-signs the cookie). It
 * defaults to false, so a fresh login — or a token issued before MFA existed —
 * can never present itself as verified.
 */
export const signSession = (user, { mfaVerified = false } = {}) =>
  jwt.sign(
    {
      id: user.id,
      username: user.username,
      isAdmin: user.is_admin === 1 || user.is_admin === true,
      mfa: mfaVerified === true,
      // Session epoch: a password change/reset bumps users.token_version, and
      // sessionSubject refuses any token whose epoch no longer matches.
      tv: Number(user.token_version ?? 0) || 0,
    },
    getJwtSecret(),
    { expiresIn: '12h' }
  );

/**
 * Cookie options shared by set and clear so the clearing Set-Cookie always
 * matches the cookie that was written (httpOnly/SameSite/Path/Secure).
 */
const sessionCookieOptions = (res) => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  // Secure is set when the request itself arrived over TLS (directly or via a
  // trusted X-Forwarded-Proto behind the bundled nginx), or when explicitly
  // forced with COOKIE_SECURE=true. Plain-HTTP localhost dev keeps working.
  secure: res.req?.secure === true || process.env.COOKIE_SECURE === 'true',
});

export const setSessionCookie = (res, token) => {
  res.cookie(TOKEN_NAME, token, { ...sessionCookieOptions(res), maxAge: TOKEN_MAX_AGE_MS });
};

export const clearSessionCookie = (res) => {
  res.clearCookie(TOKEN_NAME, sessionCookieOptions(res));
};

/** Parses the modules JSON column (mysql2 may return object or string). */
export const parseModules = (value) => {
  if (Array.isArray(value)) return value.filter((m) => ALLOWED_MODULES.includes(m));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((m) => ALLOWED_MODULES.includes(m)) : [];
    } catch {
      return [];
    }
  }
  return [];
};

/** Safe user shape sent to the client (never includes the password hash). */
export const toSafeUser = (row) => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  modules: parseModules(row.modules),
  isAdmin: row.is_admin === 1 || row.is_admin === true,
  role: row.role === 'clinician' || row.role === 'admin' || row.role === 'patient' ? row.role : 'patient',
  patientId: row.patient_id ?? null,
  providerId: row.provider_id ?? null,
  avatarUrl: row.avatar_url ?? '',
  // Whether this account has an authenticator enrolled. Never the secret.
  mfaEnrolled: Boolean(row.mfa_enrolled_at),
  createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
});

/** Rejects requests without a valid session cookie. */
export const authRequired = (req, res, next) => {
  const token = req.cookies?.[TOKEN_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    req.user = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
    next();
  } catch {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
};

/**
 * Attaches req.user when a valid session cookie is present, but never rejects.
 *
 * Used by routes that serve both signed-in and signed-out callers: the guard
 * decides how much data the request may see (a patient session reads its own
 * chart, anonymous callers read none).
 */
export const optionalSession = (req, _res, next) => {
  const token = req.cookies?.[TOKEN_NAME];
  if (token) {
    try {
      req.user = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
    } catch {
      req.user = undefined;
    }
  }
  next();
};

/**
 * Admin gating lives in server/app.js (adminOnly) because it reads the RBAC
 * subject resolved from the database per request, not the token claims.
 */
