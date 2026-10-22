/**
 * Booking rules, client half.
 *
 * The server is the final authority (see server/app.js POST /api/appointments),
 * but checking locally first means a wrong choice gets an immediate, specific
 * answer instead of an opaque write failure: past instants and slots already
 * held by the same provider or on the same patient's chart are refused before
 * the request leaves the browser.
 */
import type { Appointment } from '../types';

/** Clock-skew tolerance: a start up to a minute "ago" is still acceptable. */
const BOOKING_PAST_SKEW_MS = 60_000;

export type BookingCheck =
  | { ok: true }
  | { ok: false; code: 'INVALID_TIME' | 'PAST' | 'SLOT_TAKEN'; message: string };

/** Visit states that occupy a time slot. */
const OCCUPYING_STATUSES: ReadonlySet<Appointment['status']> = new Set(['scheduled', 'in-progress']);

type BookableVisit = Pick<Appointment, 'providerId' | 'patientId' | 'status' | 'scheduledStart'>;

export function validateBooking(
  candidate: { scheduledStart: string; providerId: string; patientId: string },
  existing: BookableVisit[],
  now: number = Date.now(),
): BookingCheck {
  const startMs = Date.parse(candidate.scheduledStart);
  if (!Number.isFinite(startMs)) {
    return { ok: false, code: 'INVALID_TIME', message: 'Pick a valid date and time for the visit.' };
  }
  if (startMs < now - BOOKING_PAST_SKEW_MS) {
    return { ok: false, code: 'PAST', message: 'That time is in the past — choose a future slot.' };
  }
  const clash = existing.some(
    visit =>
      OCCUPYING_STATUSES.has(visit.status) &&
      Date.parse(visit.scheduledStart) === startMs &&
      (visit.providerId === candidate.providerId || visit.patientId === candidate.patientId),
  );
  if (clash) {
    return {
      ok: false,
      code: 'SLOT_TAKEN',
      message: 'That time was just taken. Choose another slot.',
    };
  }
  return { ok: true };
}
