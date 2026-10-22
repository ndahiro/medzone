/**
 * MedZone backend - application-layer PHI field encryption.
 *
 * Free-text clinical narrative (SOAP notes) is encrypted with AES-256-GCM
 * before it reaches MySQL, using a PBKDF2-HMAC-SHA-256 (600,000 iteration) key
 * derived from PHI_ENCRYPTION_KEY. Plaintext PHI is never written to disk.
 *
 * The payload is a self-describing string:
 *   v1:<iterations>:<saltHex>:<ivHex>:<authTagHex>:<cipherHex>
 * so the key-derivation parameters travel with the ciphertext.
 */
import crypto from 'node:crypto';
import { isPlaceholderSecret } from './auth.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit IV, NIST SP 800-38D
const SALT_BYTES = 16; // 128-bit per-record salt
const ITERATIONS = 600_000;
const VERSION = 'v1';

/**
 * Constant KDF salt for the visit transcript key.
 *
 * Chart narrative is one row per visit, so a per-record salt costs one PBKDF2
 * derivation. A transcript is dozens of rows: at 600k iterations a per-record
 * salt would spend ~100ms per message (ten seconds to reopen a 100-message
 * visit). Every message therefore shares one derived key. That is safe here
 * because the salt only protects against precomputation across records, while
 * GCM's hard requirement — a unique IV per message — is still met by a fresh
 * 96-bit random IV on every encrypt.
 */
const TRANSCRIPT_SALT = crypto
  .createHash('sha256')
  .update('medzone-transcript-v1')
  .digest()
  .subarray(0, SALT_BYTES);

const DEV_FALLBACK_SECRET = 'medzone-dev-phi-key-change-me';

export function getPhiSecret() {
  const configured = process.env.PHI_ENCRYPTION_KEY?.trim();
  const isProduction = process.env.NODE_ENV === 'production';
  if (configured && !isPlaceholderSecret(configured)) {
    if (isProduction && configured.length < 32) {
      throw new Error('PHI_ENCRYPTION_KEY must be at least 32 characters in production.');
    }
    return configured;
  }
  if (isProduction) {
    throw new Error(
      'PHI_ENCRYPTION_KEY must be set in production and must be a real secret. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return DEV_FALLBACK_SECRET;
}

// Bounded derived-key cache. Every bootstrap decrypts the same rows, and a
// 600k-iteration PBKDF2 is ~100ms of blocked event loop per field — a
// 500-user burst would serialize minutes of CPU on one process. Caching
// (secret, iterations, salt) -> key turns repeat reads into a Map lookup.
// Same trust boundary: this process already holds the secret, and entries
// are raw keys only, evicted FIFO past the cap. Size is env-tunable; a
// non-numeric value falls back to the default instead of disabling the bound.
const rawKeyCacheMax = Number(process.env.PHI_KEY_CACHE_MAX || 1000);
const KEY_CACHE_MAX =
  Number.isFinite(rawKeyCacheMax) && rawKeyCacheMax >= 1 ? Math.floor(rawKeyCacheMax) : 1000;
const keyCache = new Map();

function deriveKey(secret, saltHex, iterations) {
  // The secret itself never becomes a map key; a SHA-256 fingerprint scopes
  // entries per secret without storing or leaking it.
  const secretId = crypto.createHash('sha256').update(String(secret)).digest('hex');
  const cacheKey = `${iterations}:${saltHex}:${secretId}`;
  const hit = keyCache.get(cacheKey);
  if (hit) return hit;
  const key = crypto.pbkdf2Sync(secret, Buffer.from(saltHex, 'hex'), Number(iterations), KEY_BYTES, 'sha256');
  if (keyCache.size >= KEY_CACHE_MAX) {
    const oldest = keyCache.keys().next();
    if (!oldest.done) keyCache.delete(oldest.value);
  }
  keyCache.set(cacheKey, key);
  return key;
}

/** Encrypts one value under a caller-supplied KDF salt. */
function encryptWithSalt(plaintext, salt, secret) {
  const iv = crypto.randomBytes(IV_BYTES);
  const key = crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_BYTES, 'sha256');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    ITERATIONS,
    salt.toString('hex'),
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

/** Encrypts a value, returning a null passthrough for empty input. */
export function encryptField(plaintext, secret = getPhiSecret()) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  return encryptWithSalt(plaintext, crypto.randomBytes(SALT_BYTES), secret);
}

/**
 * Encrypts one visit-transcript message at rest.
 *
 * The key is derived from the server-only PHI_ENCRYPTION_KEY, so a browser
 * never holds one and a database dump cannot be decrypted from a visit id (the
 * former client-side key was derived from exactly that). The payload keeps the
 * same self-describing `v1:` envelope as every other PHI column, so decryption
 * goes through decryptField and its derived-key cache.
 */
export function encryptTranscript(plaintext, secret = getPhiSecret()) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  return encryptWithSalt(plaintext, TRANSCRIPT_SALT, secret);
}

/** Decrypts a value produced by encryptField; tolerates legacy plaintext. */
export function decryptField(payload, secret = getPhiSecret()) {
  if (payload === null || payload === undefined) return null;
  const value = String(payload);
  if (!value.startsWith(`${VERSION}:`)) return value; // already plaintext
  try {
    const [, iterations, saltHex, ivHex, tagHex, cipherHex] = value.split(':');
    const key = deriveKey(secret, saltHex, iterations);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    // A row encrypted under a rotated secret (or a truncated seed value)
    // must not 500 the whole notes list — surface a placeholder instead.
    return '[unreadable: encrypted under a different key]';
  }
}

/**
 * Decrypts a transcript payload. Same `v1:` envelope as encryptField, so the
 * derived-key cache is shared and a whole transcript costs one PBKDF2.
 */
export const decryptTranscript = (payload, secret = getPhiSecret()) =>
  decryptField(payload, secret);

