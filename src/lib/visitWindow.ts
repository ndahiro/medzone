/**
 * Tele-visit join window, client half.
 *
 * A patient can enter the room from 15 minutes before the scheduled start
 * (and any time after it, for late joins and reconnects). The patient
 * dashboard disables the Join/Rejoin button until then so the rule is visible
 * instead of arriving as a server refusal; the server enforces the same window
 * (see server/app.js POST /api/appointments/:id/consultation).
 */
import type { Appointment } from '../types';

export const JOIN_WINDOW_MINUTES = 15;

/** The instant the room opens, or null when the start time is unreadable. */
export function joinWindowOpensAt(scheduledStart: string): number | null {
  const startMs = Date.parse(scheduledStart);
  return Number.isFinite(startMs) ? startMs - JOIN_WINDOW_MINUTES * 60_000 : null;
}

export function canJoinVisit(
  visit: Pick<Appointment, 'status' | 'scheduledStart'>,
  now: number = Date.now(),
): boolean {
  if (visit.status !== 'scheduled' && visit.status !== 'in-progress') return false;
  const opensAt = joinWindowOpensAt(visit.scheduledStart);
  return opensAt !== null && now >= opensAt;
}
