/**
 * MedZone RBAC policy — server copy.
 *
 * Mirrors src/lib/rbac.ts. Kept dependency-free so plain Node and the Express
 * routes can import it without the Vite client bundle. Update both files
 * together; tests/rbac.test.js fails when the tables disagree.
 *
 * Why a mirror instead of trusting the UI: Ottehr shares its role groups
 * between navigation and endpoints because a screen the UI hides is not access
 * control. Here the API re-checks the same table on every gated route, and
 * patient sessions are scoped to their own chart (the HCW@Home ownership
 * policy: isConsultationOwner, isDoctor, ...).
 */

/** Every tab the shell can render, in sidebar order. */
export const TAB_IDS = [
  'dashboard',
  'followups',
  'appointments',
  'contacts',
  'availability',
  'users',
];

/** Roles allowed to open each tab — mirrors TAB_ROLES in src/lib/rbac.ts. */
export const TAB_ROLES = {
  dashboard: ['patient', 'clinician', 'admin'],
  followups: ['clinician', 'admin'],
  appointments: ['clinician', 'admin'],
  contacts: ['clinician', 'admin'],
  availability: ['clinician', 'admin'],
  users: ['admin'],
};

/** Module grant a tab requires, or null when the tab is role-gated only. */
export const TAB_MODULE = {
  dashboard: 'dashboard',
  followups: 'followups',
  appointments: 'appointments',
  contacts: 'contacts',
  availability: 'availability',
  users: null,
};

/** Where each role lands after login. */
export const DEFAULT_TAB_BY_ROLE = {
  patient: 'dashboard',
  clinician: 'followups',
  admin: 'followups',
};

/** Roles that hold a clinical (staff) scope: the whole clinic's records. */
export const CLINICAL_ROLES = ['clinician', 'admin'];

export const isRole = (value) =>
  value === 'patient' || value === 'clinician' || value === 'admin';

/**
 * The subject the guards decide against. app.js resolves it from the database
 * on every request (sessionSubject) so role, grants and the chart link cannot
 * go stale inside a 12h token; a request without one is refused.
 */
export const guardSubject = (req) => req.subject ?? null;

export const roleAllowsTab = (role, tab) => (TAB_ROLES[tab] ?? []).includes(role);

/**
 * Session subject for a policy check.
 *
 * A token minted before `role` existed (or a hand-made cookie) carries no role;
 * that fails closed as a patient with no grants rather than opening staff data.
 */
export const subjectFromSession = (session) => ({
  role: isRole(session?.role) ? session.role : 'patient',
  isAdmin: session?.isAdmin === true,
  modules: Array.isArray(session?.modules) ? session.modules : [],
  patientId: typeof session?.patientId === 'string' ? session.patientId : null,
  // Provider a clinician practises as. A bound clinician's reads are scoped to
  // that provider's patients; an unbound clinician (covering/supervising) and
  // administrators keep the clinic-wide scope.
  providerId: typeof session?.providerId === 'string' ? session.providerId : null,
});

export const canAccessTab = (subject, tab) => {
  if (!subject) return false;
  // An administrator flag grants every module (mirrors adminRequired on the
  // API), whatever clinical role the account carries.
  if (subject.isAdmin) return true;
  if (!roleAllowsTab(subject.role, tab)) return false;
  const required = TAB_MODULE[tab];
  if (!required) return false;
  return (subject.modules ?? []).includes(required);
};

export const visibleTabs = (subject) => TAB_IDS.filter((tab) => canAccessTab(subject, tab));

export const defaultTabFor = (subject) => {
  if (!subject) return 'dashboard';
  const preferred = DEFAULT_TAB_BY_ROLE[subject.role] ?? 'dashboard';
  if (canAccessTab(subject, preferred)) return preferred;
  return visibleTabs(subject)[0] ?? 'dashboard';
};

/** Patient sessions read exactly one chart; staff roles read the clinic. */
export const isPatientScope = (subject) =>
  !!subject && subject.role === 'patient' && !subject.isAdmin;

/**
 * Express guard for a tab-backed endpoint: the caller's session must satisfy
 * the same policy the UI used to render the screen. Must run after
 * authRequired, which populates req.user from the session JWT.
 */
export const tabRequired = (tab) => (req, res, next) => {
  const subject = guardSubject(req);
  if (!canAccessTab(subject, tab)) {
    return res.status(403).json({ error: `Your account cannot access the ${tab} module.` });
  }
  return next();
};

/** Express guard for clinical-staff-only endpoints (no per-user grant needed). */
export const clinicalRequired = (req, res, next) => {
  const subject = guardSubject(req);
  if (!subject || !CLINICAL_ROLES.includes(subject.role)) {
    return res.status(403).json({ error: 'Clinical staff privileges required.' });
  }
  return next();
};

/** True when the subject holds a module grant (administrators hold them all). */
export const hasModule = (subject, module) =>
  !!subject && (subject.isAdmin === true || (subject.modules ?? []).includes(module));

/**
 * Express guard for reads that are chart-scoped for patients but module-gated
 * for staff: a patient session passes (the route scopes the read to its own
 * chart), while a staff session must hold at least one of the listed modules.
 * Without this, a staff account stripped of every module could still read the
 * whole clinic through the list endpoints its UI no longer shows.
 */
export const staffModule = (...tabs) => (req, res, next) => {
  const subject = guardSubject(req);
  if (!subject) return next(); // authRequired already refused; anonymous has nothing to read
  if (isPatientScope(subject)) return next();
  if (tabs.some((tab) => canAccessTab(subject, tab))) return next();
  return res.status(403).json({ error: `Your account cannot access the ${tabs[0]} module.` });
};
