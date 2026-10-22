/**
 * MedZone auth types & module registry (mirrors the elgon RBAC pattern).
 *
 * ModuleKey matches the MedZone sidebar tab ids so per-user grants map
 * directly onto the navigation: dashboard, followups, contacts,
 * appointments, availability.
 */

/** Sidebar module keys that can be granted per user. */
export type ModuleKey = 'dashboard' | 'followups' | 'contacts' | 'appointments' | 'availability';

/** Clinical role of an account; drives the dashboard and the tab policy. */
export type Role = 'patient' | 'clinician' | 'admin';

/**
 * Shell tabs. Every tab is gated by src/lib/rbac.ts (role AND module grant);
 * `users` is admin-only and never appears in a module grant.
 */
export type TabId =
  | 'dashboard'
  | 'followups'
  | 'appointments'
  | 'contacts'
  | 'availability'
  | 'users';

export interface ModuleMeta {
  key: ModuleKey;
  label: string;
  description: string;
}

/** Central registry of every module in the application. */
export const MODULES: ModuleMeta[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'Overview & metrics' },
  { key: 'followups', label: 'Follow-ups / Consultations', description: 'Manage follow-ups' },
  { key: 'contacts', label: 'Contacts', description: 'Patient directory' },
  { key: 'appointments', label: 'Appointments', description: 'Calendar schedule' },
  { key: 'availability', label: 'Availability', description: 'Working hours' },
];

/**
 * A MedZone user account. Records live in MySQL and are managed through the
 * backend API, so there are no hardcoded credentials in the client source —
 * the initial administrator is seeded from environment variables at startup.
 *
 * `role` drives which dashboard renders after login: patient, clinician,
 * or admin. `isAdmin` additionally gates the user-management module.
 */
export interface ManagedUser {
  id: number;
  username: string;
  displayName: string;
  /** Registration avatar as a JPEG/PNG/WebP data URL; empty when none. */
  avatarUrl: string;
  modules: ModuleKey[];
  isAdmin: boolean;
  role: Role;
  /**
   * Chart this account belongs to. Patient logins are bound to one patient
   * row, so the API can scope every read to their own record; staff accounts
   * carry null and read the whole clinic.
   */
  patientId: string | null;
  /**
   * Provider this clinician practises as. A clinician bound to a provider sees
   * only the patients who booked with them; an unbound clinician (covering) and
   * administrators see the whole clinic.
   */
  providerId: string | null;
  /**
   * Whether THIS session passed server-side MFA verification (TOTP checked by
   * the API, recorded as a claim in the session cookie). False after a fresh
   * login until a code is verified; never a client-side assumption.
   */
  mfaVerified?: boolean;
  /** Whether the deployment requires a second factor for this account. */
  mfaRequired?: boolean;
  /** A confirmed authenticator is enrolled for this account. */
  mfaEnrolled?: boolean;
  createdAt: string;
}
