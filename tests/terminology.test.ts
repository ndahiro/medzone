/**
 * Booking instant contract: a display date/time pair is a local wall-clock
 * promise. "4:00 PM" means 4 PM where the visit happens — the resulting FHIR
 * instant must decode back to that same local clock reading, not to 4 PM UTC
 * (which shifts the appointment hours away from what the user picked).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFhirDateTime } from '../src/lib/terminology';

test('anchors the wall clock to the host timezone, not UTC', () => {
  const instant = toFhirDateTime('2026-12-04', '4:00 PM');
  assert.equal(instant, new Date(2026, 11, 4, 16, 0, 0, 0).toISOString());

  const rendered = new Date(instant);
  assert.equal(rendered.getFullYear(), 2026);
  assert.equal(rendered.getMonth(), 11);
  assert.equal(rendered.getDate(), 4);
  assert.equal(rendered.getHours(), 16);
  assert.equal(rendered.getMinutes(), 0);
});

test('handles noon and midnight on the 12-hour clock', () => {
  const noon = new Date(toFhirDateTime('2026-12-04', '12:30 PM'));
  assert.equal(noon.getHours(), 12);
  assert.equal(noon.getMinutes(), 30);

  const midnight = new Date(toFhirDateTime('2026-12-04', '12:00 AM'));
  assert.equal(midnight.getDate(), 4);
  assert.equal(midnight.getHours(), 0);
  assert.equal(midnight.getMinutes(), 0);
});

test('an unparseable date still yields a valid instant rather than an invalid one', () => {
  const before = Date.now();
  const instant = toFhirDateTime('not-a-date', '4:00 PM');
  assert.ok(Number.isFinite(Date.parse(instant)), 'fallback must be a parseable instant');
  assert.ok(Date.parse(instant) >= before - 1000, 'fallback must be current, not the epoch');
});
