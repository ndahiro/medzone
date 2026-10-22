/**
 * MedZone server-side RFC 6238 Time-Based One-Time Password (TOTP) service.
 *
 * Standards implemented:
 *   - RFC 4226 (HOTP) truncation and dynamic-truncation algorithm
 *   - RFC 4648 §6 Base32 secret encoding (as used by authenticator apps)
 *   - RFC 6238 (TOTP): 30-second time step, 6 digits, HMAC-SHA-1
 *
 * Each account owns its own secret (users.mfa_secret, encrypted at rest with
 * the PHI key), so a code proves possession for that account rather than for
 * the deployment. There is no fallback: an account without an enrolled secret
 * cannot verify, and an unreadable secret is treated as unenrolled.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const PERIOD_SECONDS = 30;
const DEFAULT_SECRET_BYTES = 20; // 160 bits, RFC 4226 §4 recommendation

/**
 * Deployment policy: are signed-in sessions required to hold a second factor?
 *
 * A legacy MFA_TOTP_SECRET still turns enforcement on, but its value no longer
 * verifies anything — the deployment used to share one secret across every
 * account, which meant any holder of it could satisfy MFA for any user.
 */
export const isMfaRequired = () =>
  process.env.MFA_REQUIRED === 'true' ||
  Boolean(String(process.env.MFA_TOTP_SECRET || '').trim());

/** A fresh 160-bit secret in base32, the format authenticator apps accept. */
export function generateTotpSecret(byteLength = DEFAULT_SECRET_BYTES) {
  const raw = randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of raw) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** otpauth:// provisioning URI (QR code or manual entry in the app). */
export function totpUri({ secret, accountName, issuer = 'MedZone' }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Decodes an RFC 4648 §6 base32 string into raw bytes. Throws on any
 * character outside the alphabet so a mistyped secret fails loudly instead
 * of silently validating against a truncated key.
 */
function base32Decode(input) {
  const clean = String(input).replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  if (!clean) throw new Error('Empty base32 secret.');
  let bits = 0;
  let value = 0;
  const output = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/** RFC 4226 HMAC-based one-time password for a single counter value. */
function hotp(key, counter) {
  const counterBytes = Buffer.alloc(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i -= 1) {
    counterBytes[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }

  const signature = createHmac('sha1', key).update(counterBytes).digest();

  // RFC 4226 §5.3 dynamic truncation.
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/**
 * Verifies a submitted token against the account's secret and returns the time
 * step it matched, or null. Accepting a symmetric window tolerates clock drift
 * (RFC 6238 §5.2); the caller burns the returned step in the account's
 * single-use ledger so the same code cannot be used twice. Fails closed when
 * the secret is missing or malformed.
 */
export function verifyTotpStep(token, secretBase32, window = 1) {
  const secret = String(secretBase32 || '').trim();
  if (!secret) return null;
  const normalized = String(token || '').replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(normalized)) return null;

  let key;
  try {
    key = base32Decode(secret);
  } catch {
    return null;
  }

  const currentStep = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const step = currentStep + offset;
    const expected = hotp(key, step);
    const a = Buffer.from(normalized);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return step;
  }
  return null;
}

/** True when the token verifies for this secret (no ledger bookkeeping). */
export function verifyTotp(token, secretBase32, window = 1) {
  return verifyTotpStep(token, secretBase32, window) !== null;
}
