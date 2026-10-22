/**
 * MedZone auth API client (mirrors the elgon authDatabase/authService pattern).
 *
 * Session requests use same-origin cookies (`credentials: 'include'`), so the
 * httpOnly JWT cookie set by /api/login is sent automatically. Unlike the
 * failure-tolerant clinical api.ts client, these calls throw on error because
 * the login and user-admin flows must surface failures to the operator.
 */
import type { ManagedUser, ModuleKey } from '../types/auth';

// `import.meta.env` only exists under the Vite bundler; guarded so this
// client module can also be imported by plain-Node tests.
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const API_BASE = (viteEnv?.VITE_API_URL ?? '').replace(/\/+$/, '');

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (response.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // no JSON body
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const loginUser = (username: string, password: string) =>
  authRequest<ManagedUser>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: username.trim(), password }),
  });

export const logoutUser = () => authRequest<{ ok: boolean }>('/api/logout', { method: 'POST' });

export const getSessionUser = async (): Promise<ManagedUser | null> => {
  try {
    return await authRequest<ManagedUser>('/api/me');
  } catch {
    return null;
  }
};

/**
 * Pushes a TOTP code to the server for verification. Throws with the API's
 * message (unconfigured / invalid / rate-limited) so the UI can explain the
 * refusal instead of failing silently.
 *
 * A successful check re-signs the session cookie with the `mfa` claim, so the
 * verified state survives reloads.
 */
export const verifyMfaCode = (code: string) =>
  authRequest<{ mfaVerified: boolean }>('/api/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

/** Clears the session's MFA verification claim. */
export const revokeMfaSession = () =>
  authRequest<{ mfaVerified: boolean }>('/api/mfa/revoke', { method: 'POST' });

export interface MfaStatus {
  /** Deployment policy: a second factor is required to reach clinical data. */
  required: boolean;
  /** A confirmed authenticator is enrolled for this account. */
  enrolled: boolean;
  /** A secret is stored but no code from it has been accepted yet. */
  pending: boolean;
  /** This session proved the second factor. */
  verified: boolean;
}

export const getMfaStatus = () => authRequest<MfaStatus>('/api/mfa/status');

/**
 * Starts (or rotates) this account's authenticator. The API returns the secret
 * and provisioning URI exactly once; it stores only ciphertext. Requires the
 * current password so a stolen session cannot attach its own device.
 */
export const enrollMfa = (currentPassword: string) =>
  authRequest<{ secret: string; otpauthUrl: string; enrolled: boolean; verified: boolean }>(
    '/api/mfa/enroll',
    { method: 'POST', body: JSON.stringify({ currentPassword }) }
  );

/**
 * Self-service password rotation. The server verifies the current password,
 * bumps the session epoch (signing out other devices), and re-issues this
 * session's cookie so the caller stays signed in.
 */
export const changePassword = (currentPassword: string, newPassword: string) =>
  authRequest<{ ok: boolean }>('/api/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });

// ---------------------------------------------------------------------------
// Admin user management
// ---------------------------------------------------------------------------

export const getAllUsers = () => authRequest<ManagedUser[]>('/api/users');

export const createUser = (
  username: string,
  displayName: string,
  password: string,
  modules: ModuleKey[],
  isAdmin: boolean,
  role: ManagedUser['role'] = 'patient',
  patientId: string | null = null,
  avatarUrl = ''
) =>
  authRequest<ManagedUser>('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username, displayName, password, modules, isAdmin, role, patientId, avatarUrl }),
  });

/**
 * Links (or clears) the patient chart an account owns. The API scopes a
 * patient session to this id, so it is the switch that decides what a patient
 * login is allowed to see; a null value leaves the account with no chart.
 */
export const updateUserPatient = (id: number, patientId: string | null) =>
  authRequest<ManagedUser>(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ patientId }),
  });

export const updateUserModules = (id: number, modules: ModuleKey[]) =>
  authRequest<ManagedUser>(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ modules }),
  });

export const updateUserAdmin = (id: number, isAdmin: boolean) =>
  authRequest<ManagedUser>(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isAdmin }),
  });

export const updateUserRole = (id: number, role: ManagedUser['role']) =>
  authRequest<ManagedUser>(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });

/** Replaces (or clears, with '') an account's registration avatar. */
export const updateUserAvatar = (id: number, avatarUrl: string) =>
  authRequest<ManagedUser>(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ avatarUrl }),
  });

export const resetUserPassword = (id: number, newPassword: string) =>
  authRequest<{ ok: boolean }>(`/api/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });

export const deleteUser = (id: number) =>
  authRequest<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' });
