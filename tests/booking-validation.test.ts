/**
 * Booking rules (client half): a chosen slot is checked before the visit is
 * sent to the server, so a patient gets an instant, specific answer instead of
 * a generic write failure. The server enforces the same rules for races and
 * for any caller that skips the client (see tests/booking-rules.test.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBooking } from '../src/lib/bookingValidation';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const at = (ms: number) => new Date(ms).toISOString();

const visit = (overrides: Record<string, unknown> = {}) => ({
  id: 'apt-x',
  providerId: 'prov-001',
  patientId: 'pat-001',
  status: 'scheduled' as const,
  scheduledStart: at(NOW + 24 * 60 * 60 * 1000),
  ...overrides,
});

test('rejects an unparseable start', () => {
  const result = validateBooking(
    { scheduledStart: 'not-a-time', providerId: 'prov-001', patientId: 'pat-001' },
    [],
    NOW,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_TIME');
});

test('rejects a start well in the past', () => {
  const result = validateBooking(
    { scheduledStart: at(NOW - 2 * 60 * 60 * 1000), providerId: 'prov-001', patientId: 'pat-001' },
    [],
    NOW,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PAST');
});

test('tolerates clock skew of under a minute', () => {
  const result = validateBooking(
    { scheduledStart: at(NOW - 30 * 1000), providerId: 'prov-001', patientId: 'pat-001' },
    [],
    NOW,
  );
  assert.deepEqual(result, { ok: true });
});

test('refuses a slot the same provider already holds', () => {
  const start = at(NOW + 24 * 60 * 60 * 1000);
  const result = validateBooking(
    { scheduledStart: start, providerId: 'prov-001', patientId: 'pat-002' },
    [visit({ providerId: 'prov-001', patientId: 'pat-001', scheduledStart: start })],
    NOW,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SLOT_TAKEN');
});

test('refuses a slot the same patient already holds with another clinician', () => {
  const start = at(NOW + 24 * 60 * 60 * 1000);
  const result = validateBooking(
    { scheduledStart: start, providerId: 'prov-002', patientId: 'pat-001' },
    [visit({ providerId: 'prov-001', patientId: 'pat-001', status: 'in-progress', scheduledStart: start })],
    NOW,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SLOT_TAKEN');
});

test('a cancelled or completed visit frees its slot', () => {
  const start = at(NOW + 24 * 60 * 60 * 1000);
  for (const status of ['cancelled', 'completed'] as const) {
    const result = validateBooking(
      { scheduledStart: start, providerId: 'prov-001', patientId: 'pat-001' },
      [visit({ status, scheduledStart: start })],
      NOW,
    );
    assert.deepEqual(result, { ok: true }, `${status} visits must not block the slot`);
  }
});

test('a visit at a different time does not block the slot', () => {
  const result = validateBooking(
    { scheduledStart: at(NOW + 24 * 60 * 60 * 1000), providerId: 'prov-001', patientId: 'pat-001' },
    [visit({ scheduledStart: at(NOW + 48 * 60 * 60 * 1000) })],
    NOW,
  );
  assert.deepEqual(result, { ok: true });
});
