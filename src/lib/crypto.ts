/**
 * MedZone browser-side AES-256-GCM helper (self-test and local encryption).
 *
 * AES-256-GCM over the Web Crypto API with PBKDF2-HMAC-SHA-256 key
 * derivation: a fresh 96-bit IV and 128-bit salt per record, 600,000
 * iterations (OWASP ASVS 5.2.2 / NIST SP 800-132).
 *
 * Key selection:
 *   1. an explicit per-call secret (the only way a payload is portable);
 *   2. a random, in-memory secret for this browser session (lost on reload).
 *
 * There is deliberately no key in the bundle and no key derived from a record
 * identifier. The previous fallback keyed chat to the visit id, which is public
 * — anyone holding a stored transcript and the id could read it.
 *
 * Visit transcripts are therefore not encrypted here: the API encrypts each
 * message at rest with the server-only PHI_ENCRYPTION_KEY before MySQL sees it
 * (server/crypto.js, encryptTranscript). A browser cannot hold a shared PHI key
 * without publishing it in the bundle, so the server owns that key and the
 * client receives plaintext over TLS for the visits the caller may read.
 */

/** OWASP-recommended minimum for PBKDF2-HMAC-SHA-256 (2023+). */
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // 96-bit IV, recommended for GCM

// Helper to convert buffer to Hex string
function bufferToHex(buffer: ArrayBuffer | ArrayBufferView): string {
  const view = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  return Array.from(view)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to convert Hex string back to Uint8Array
function hexToBuffer(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

let ephemeralSecret: string | null = null;

export interface PhiEncryptionOptions {
  /** Explicit key material; outranks the deployment environment secret. */
  secret?: string;
}

/**
 * Resolves the encryption secret. Never falls back to a hardcoded value or to a
 * record identifier: without an explicit secret the helper uses a random key
 * that lives only in this browser session, so a payload encrypted here cannot
 * be read back by anyone else.
 */
function resolveSecret(options: PhiEncryptionOptions = {}): string {
  if (options.secret) return options.secret;

  if (!ephemeralSecret) {
    ephemeralSecret = bufferToHex(crypto.getRandomValues(new Uint8Array(32)));
  }
  return ephemeralSecret;
}

/** Derives an AES-GCM key from a secret and a per-record salt (PBKDF2). */
async function deriveAesGcmKey(secret: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedPayload {
  cipherHex: string;
  ivHex: string;
  /** Random per-record PBKDF2 salt; required to re-derive the key. */
  saltHex: string;
  /** SHA-256 tamper-evidence fingerprint over salt + IV + ciphertext. */
  fingerprint: string;
  algorithm: string;
  iterations: number;
  timestamp: string;
}

/**
 * Encrypts a value using AES-256-GCM. Pass `{ secret }` when the payload must
 * be readable by another session or after a reload; without it the key belongs
 * to this browser session only.
 */
export async function encryptPHI(plainText: string, options: PhiEncryptionOptions = {}): Promise<EncryptedPayload> {
  try {
    const secret = resolveSecret(options);
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveAesGcmKey(secret, salt);
    const encoded = new TextEncoder().encode(plainText);

    const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

    // Tamper-evidence fingerprint: SHA-256(salt || iv || ciphertext).
    const authenticated = new Uint8Array(salt.byteLength + iv.byteLength + encryptedBuffer.byteLength);
    authenticated.set(salt, 0);
    authenticated.set(iv, salt.byteLength);
    authenticated.set(new Uint8Array(encryptedBuffer), salt.byteLength + iv.byteLength);
    const fpBuffer = await crypto.subtle.digest('SHA-256', authenticated);

    return {
      cipherHex: bufferToHex(encryptedBuffer),
      ivHex: bufferToHex(iv),
      saltHex: bufferToHex(salt),
      fingerprint: bufferToHex(fpBuffer).slice(0, 16).toUpperCase(),
      algorithm: 'AES-256-GCM',
      iterations: PBKDF2_ITERATIONS,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error('Encryption failed:', err);
    throw new Error('HIPAA Encryption Pipeline error');
  }
}

/**
 * Decrypts sensitive health information (PHI) using AES-256-GCM.
 */
export async function decryptPHI(
  cipherHex: string,
  ivHex: string,
  saltHex: string,
  options: PhiEncryptionOptions = {}
): Promise<string> {
  try {
    const secret = resolveSecret(options);
    const key = await deriveAesGcmKey(secret, hexToBuffer(saltHex));
    const iv = hexToBuffer(ivHex);
    const encryptedBytes = hexToBuffer(cipherHex);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encryptedBytes
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    console.warn('Decryption failed, returning sanitized ciphertext placeholder:', err);
    return '[Encrypted Health Data - Cipher Verification Required]';
  }
}
