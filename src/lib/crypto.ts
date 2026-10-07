/**
 * MedZone HIPAA Cryptographic Subsystem
 * Implements 256-bit AES-GCM Authenticated Encryption using standard Web Crypto API.
 */

const DEFAULT_SECRET = 'MedZone-HIPAA-Enterprise-EHR-Master-Salt-2026';

// Helper to convert buffer to Hex string
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to convert Hex string back to Uint8Array
export function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Derive a CryptoKey from a passphrase
async function deriveAesGcmKey(secret: string = DEFAULT_SECRET): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const salt = encoder.encode('MedZone-Salt-Vector-512');

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
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
  fingerprint: string;
  algorithm: string;
  timestamp: string;
}

/**
 * Encrypts sensitive health information (PHI) using AES-GCM 256-bit
 */
export async function encryptPHI(plainText: string, customSecret?: string): Promise<EncryptedPayload> {
  try {
    const key = await deriveAesGcmKey(customSecret);
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit recommended IV for GCM
    const encoded = new TextEncoder().encode(plainText);

    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      encoded
    );

    // Compute key fingerprint (SHA-256 of IV + secret)
    const fpBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(bufferToHex(iv.buffer) + (customSecret || DEFAULT_SECRET))
    );

    return {
      cipherHex: bufferToHex(encryptedBuffer),
      ivHex: bufferToHex(iv.buffer),
      fingerprint: bufferToHex(fpBuffer).slice(0, 16).toUpperCase(),
      algorithm: 'AES-256-GCM',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error('Encryption failed:', err);
    throw new Error('HIPAA Encryption Pipeline error');
  }
}

/**
 * Decrypts sensitive health information (PHI) using AES-GCM 256-bit
 */
export async function decryptPHI(
  cipherHex: string,
  ivHex: string,
  customSecret?: string
): Promise<string> {
  try {
    const key = await deriveAesGcmKey(customSecret);
    const iv = hexToBuffer(ivHex);
    const encryptedBytes = hexToBuffer(cipherHex);

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer as ArrayBuffer,
      },
      key,
      encryptedBytes.buffer as ArrayBuffer
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    console.warn('Decryption failed, returning sanitized ciphertext placeholder:', err);
    return '[Encrypted Health Data - Cipher Verification Required]';
  }
}
