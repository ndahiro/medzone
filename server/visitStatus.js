/**
 * MedZone visit state machine — server copy (Ottehr-inspired).
 *
 * Kept dependency-free so plain Node and the
 * Express routes can import it without the Vite client bundle. Update both
 * files together.
 */
const VISIT_STATUSES = ['scheduled', 'in-progress', 'completed', 'cancelled'];

const TRANSITIONS = {
  scheduled: ['in-progress', 'cancelled'],
  'in-progress': ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function isVisitStatus(value) {
  return typeof value === 'string' && VISIT_STATUSES.includes(value);
}

export function canTransitionVisit(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
