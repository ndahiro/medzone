/**
 * MedZone role-based access control — the single source of truth for "who may
 * open what", read by the sidebar, the app shell and (mirrored) by the API.
 *
 * Ottehr (masslight/ottehr) keeps its role groups in one shared module for a
 * stated reason: "a page the UI offers but the server refuses is
 * indistinguishable from a broken feature, and the reverse is a gap". MedZone
 * follows that: the navigation and the Express guards read the same tables.
 *
 * HCW@Home (policies: isDoctor, isConsultationOwner, ...) supplies the second
 * half of the model: hiding a tab is not access control, so every read is
 * scoped to the caller — a patient session only ever receives its own chart.
 *
 * Two independent gates decide a tab:
 *   1. role   — what the account is (patient / clinician / admin)
 *   2. module — the per-user grant in users.modules, set by an admin
 * A tab opens only when the role allows it AND the module was granted. `users`
 * is the exception: admin-only, never granted per user.
 *
 * server/rbac.js mirrors this file. Update both together;
 * tests/rbac.test.js fails when the two disagree.
 */
import type { ModuleKey, Role, TabId } from '../types/auth';

/** Every tab the shell can render, in sidebar order. */
export const TAB_IDS: TabId[] = [
  'dashboard',
  'followups',
  'appointments',
  'contacts',
  'availability',
  'users',
];

/**
 * Roles allowed to open each tab — the RBAC core.
 *
 * The patient portal is deliberately narrow: a patient gets their own care
 * hub. The clinic-wide boards (visits, schedule, records directory, meds) list
 * other patients' rows, so they are clinical-staff surfaces.
 */
export const TAB_ROLES: Record<TabId, Role[]> = {
  dashboard: ['patient', 'clinician', 'admin'],
  followups: ['clinician', 'admin'],
  appointments: ['clinician', 'admin'],
  contacts: ['clinician', 'admin'],
  availability: ['clinician', 'admin'],
  users: ['admin'],
};

/** Module grant a tab requires, or null when the tab is role-gated only. */
export const TAB_MODULE: Record<TabId, ModuleKey | null> = {
  dashboard: 'dashboard',
  followups: 'followups',
  appointments: 'appointments',
  contacts: 'contacts',
  availability: 'availability',
  users: null,
};

/** Tab id -> sidebar label. */
export const TAB_LABEL: Record<TabId, string> = {
  dashboard: 'Home',
  followups: 'Visits',
  appointments: 'Schedule',
  contacts: 'Records',
  availability: 'Meds',
  users: 'Users',
};

/**
 * Where each role lands after login. Patients land on their own dashboard, not
 * on the clinical follow-up chart the shell used to open for everyone.
 */
export const DEFAULT_TAB_BY_ROLE: Record<Role, TabId> = {
  patient: 'dashboard',
  clinician: 'followups',
  admin: 'followups',
};

/** Roles that hold a clinical (staff) scope: the whole clinic's records. */
export const CLINICAL_ROLES: Role[] = ['clinician', 'admin'];

/** Subjects a menu decision is made about (a session user, trimmed down). */
export interface RbacSubject {
  role: Role;
  isAdmin: boolean;
  modules: ModuleKey[];
}

export const isRole = (value: unknown): value is Role =>
  value === 'patient' || value === 'clinician' || value === 'admin';

export const isTabId = (value: unknown): value is TabId =>
  typeof value === 'string' && (TAB_IDS as string[]).includes(value);

/** Does the role permit this tab at all (ignoring module grants)? */
export const roleAllowsTab = (role: Role, tab: TabId): boolean =>
  (TAB_ROLES[tab] ?? []).includes(role);

/** Is the tab open for this subject (role AND module grant)? */
export const canAccessTab = (subject: RbacSubject | null, tab: TabId): boolean => {
  if (!subject) return false;
  // An administrator flag grants every module (mirrors adminRequired on the
  // API), whatever clinical role the account carries.
  if (subject.isAdmin) return true;
  if (!roleAllowsTab(subject.role, tab)) return false;
  const required = TAB_MODULE[tab];
  if (!required) return false; // admin-only tab, and this subject is not one
  return (subject.modules ?? []).includes(required);
};

/** Sidebar tabs for a subject, in canonical order. */
export const visibleTabs = (subject: RbacSubject | null): TabId[] =>
  TAB_IDS.filter((tab) => canAccessTab(subject, tab));

/** Landing tab for a role, repaired to whatever the subject may actually open. */
export const defaultTabFor = (subject: RbacSubject | null): TabId => {
  if (!subject) return 'dashboard';
  const preferred = DEFAULT_TAB_BY_ROLE[subject.role] ?? 'dashboard';
  if (canAccessTab(subject, preferred)) return preferred;
  return visibleTabs(subject)[0] ?? 'dashboard';
};

/** Patient sessions read exactly one chart; staff roles read the clinic. */
export const isPatientScope = (subject: RbacSubject | null): boolean =>
  !!subject && subject.role === 'patient' && !subject.isAdmin;
