/**
 * Join-window rule (client half): a patient can only enter the tele-visit room
 * from 15 minutes before the scheduled start. The patient dashboard uses this
 * to disable "Join / Rejoin" with an explanation instead of letting the server
 * refuse an early click (which it does — see tests/booking-rules.test.js).
 * Staff sessions are not gated; they pick up whoever is waiting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOIN_WINDOW_MINUTES, canJoinVisit, joinWindowOpensAt } from '../src/lib/visitWindow';
import type { Appointment } from '../src/types';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const at = (ms: number) => new Date(ms).toISOString();
const minutesFromNow = (minutes: number) => at(NOW + minutes * 60 * 1000);
const visit = (startInMinutes: number, status: Appointment['status'] = 'scheduled') => ({
  status,
  scheduledStart: minutesFromNow(startInMinutes),
});

test('the join window is 15 minutes', () => {
  assert.equal(JOIN_WINDOW_MINUTES, 15);
});

test('a visit hours away cannot be entered yet', () => {
  assert.equal(canJoinVisit(visit(6 * 60), NOW), false);
});

test('a visit inside the window can be entered', () => {
  assert.equal(canJoinVisit(visit(10), NOW), true);
  assert.equal(canJoinVisit(visit(JOIN_WINDOW_MINUTES), NOW), true, 'the window opens at exactly 15 minutes');
});

test('one minute before the window is still closed', () => {
  assert.equal(canJoinVisit(visit(JOIN_WINDOW_MINUTES + 1), NOW), false);
});

test('a checked-in visit hours early still waits for the window', () => {
  assert.equal(canJoinVisit(visit(2 * 60, 'in-progress'), NOW), false);
});

test('a visit that already started can be rejoined', () => {
  assert.equal(canJoinVisit(visit(-5), NOW), true);
  assert.equal(canJoinVisit(visit(-120, 'in-progress'), NOW), true);
});

test('closed visits are never joinable', () => {
  assert.equal(canJoinVisit(visit(-5, 'completed'), NOW), false);
  assert.equal(canJoinVisit(visit(-5, 'cancelled'), NOW), false);
});

test('an unparseable start is treated as not yet joinable', () => {
  assert.equal(canJoinVisit({ status: 'scheduled', scheduledStart: 'someday' }, NOW), false);
  assert.equal(joinWindowOpensAt('someday'), null);
});
