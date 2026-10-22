/**
 * Booking & admission rules, end to end.
 *
 * The server is the final authority for the scheduling rules the client also
 * checks (src/lib/bookingValidation.ts, src/lib/visitWindow.ts):
 *  - a visit cannot be booked with an unreadable or past start;
 *  - one instant cannot be held twice by the same provider or on the same
 *    chart while a live visit occupies it;
 *  - a patient cannot enter the tele-visit room before the 15-minute join
 *    window opens. Staff pick up whoever is waiting and are never gated.
 *
 * Disposable rows carry a `test-apt-rules-` id and are removed in `after`.
 * Successful bookings probe forward a minute per refusal so the seeded
 * schedule and suites running in parallel cannot turn the schedule itself
 * into a flaky assertion.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import app from '../server/app.js';
import { closePool, query } from '../server/db.js';

let server;
let base;
let staffCookie;
let patientCookie;
let template;
let otherPatients;
let otherProviders;

/** Signs in and returns the session cookie header value. */
const login = async (username, password) => {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `${username} must be able to sign in`);
  const raw = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  assert.ok(raw, 'login must set a session cookie');
  return raw.split(';')[0];
};

/** fetch() bound to a session cookie. */
const asUser = cookie => (path, init = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });

const jsonInit = body => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

const minutesFromNow = minutes => new Date(Date.now() + minutes * 60_000).toISOString();

/** A complete booking payload modelled on a seeded visit. */
const bookingFor = ({
  id,
  patientId = template.patientId,
  providerId = template.providerId,
  scheduledStart,
}) => ({
  ...template,
  id,
  patientId,
  providerId,
  scheduledStart,
  status: 'scheduled',
  reasonForVisit: 'Created by the booking-rules test.',
});

const postBooking = (cookie, booking) => asUser(cookie)('/api/appointments', jsonInit(booking));

/**
 * Books a visit, stepping one minute forward on each refusal, so a slot the
 * seed data (or a parallel suite) already holds does not fail the booking
 * itself — only the rule under test decides the outcome. Returns the booking
 * that landed.
 */
const bookAt = async (cookie, { id, patientId, providerId, startMs, attempts = 12 }) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const booking = bookingFor({
      id,
      patientId,
      providerId,
      scheduledStart: new Date(startMs + attempt * 61_000).toISOString(),
    });
    const response = await postBooking(cookie, booking);
    if (response.status === 201) return booking;
    assert.equal(response.status, 409, `booking ${id} failed unexpectedly (${response.status})`);
  }
  return assert.fail(`no free slot for ${id} after ${attempts} attempts`);
};

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  staffCookie = await login('clinician.demo', 'Clinician123');
  patientCookie = await login('patient.demo', 'Patient123');

  const bootstrap = await (await asUser(staffCookie)('/api/bootstrap')).json();
  template =
    bootstrap.appointments.find(a => a.patientId === 'pat-001') ?? bootstrap.appointments[0];
  assert.ok(template, 'seed data must contain a visit to model the booking on');
  otherPatients = bootstrap.patients.filter(p => p.id !== template.patientId);
  otherProviders = bootstrap.providers.filter(p => p.id !== template.providerId);
  assert.ok(otherPatients.length >= 2, 'the clash checks need two further charts');
  assert.ok(otherProviders.length >= 2, 'the clash checks need two further providers');
});

after(async () => {
  await query('DELETE FROM appointments WHERE id LIKE ?', ['test-apt-rules-%']);
  await new Promise(resolve => server.close(resolve));
  await closePool();
});

test('a start in the past is refused, not stored', async () => {
  const response = await postBooking(
    staffCookie,
    bookingFor({ id: `test-apt-rules-past-${suffix()}`, scheduledStart: minutesFromNow(-10) }),
  );
  assert.equal(response.status, 400, 'a past visit must not be bookable');
  assert.equal((await response.json()).code, 'PAST_START');
});

test('an unreadable start is refused instead of silently booking "now"', async () => {
  const response = await postBooking(
    staffCookie,
    bookingFor({ id: `test-apt-rules-bad-${suffix()}`, scheduledStart: 'next tuesday-ish' }),
  );
  assert.equal(response.status, 400, 'a malformed instant must be rejected');
  assert.equal((await response.json()).code, 'INVALID_START');
});

test('an instant held by the same provider or chart is refused', async () => {
  const [patientB, patientD] = otherPatients;
  const [providerB, providerC] = otherProviders;

  // Hold the instant for one pair, far from the window other suites use.
  const held = await bookAt(staffCookie, {
    id: `test-apt-rules-held-${suffix()}`,
    patientId: patientB.id,
    providerId: template.providerId,
    startMs: Date.now() + 26 * 60 * 60_000,
  });
  const start = held.scheduledStart;

  // A different pair coexists at the very same instant: slots are per
  // provider/patient, not globally exclusive. This booking also proves the
  // second chart and provider are free at the instant, which attributes the
  // refusals below to the shared field alone.
  const control = await postBooking(
    staffCookie,
    bookingFor({
      id: `test-apt-rules-ctrl-${suffix()}`,
      patientId: patientD.id,
      providerId: providerB.id,
      scheduledStart: start,
    }),
  );
  assert.equal(control.status, 201, 'an unrelated pair must keep the instant');

  // Same provider, different chart.
  const providerClash = await postBooking(
    staffCookie,
    bookingFor({
      id: `test-apt-rules-prov-${suffix()}`,
      patientId: patientD.id,
      providerId: template.providerId,
      scheduledStart: start,
    }),
  );
  assert.equal(providerClash.status, 409, 'a provider cannot hold two visits at once');
  assert.equal((await providerClash.json()).code, 'SLOT_TAKEN');

  // Same chart, different provider.
  const patientClash = await postBooking(
    staffCookie,
    bookingFor({
      id: `test-apt-rules-pat-${suffix()}`,
      patientId: patientB.id,
      providerId: providerC.id,
      scheduledStart: start,
    }),
  );
  assert.equal(patientClash.status, 409, 'a chart cannot hold two visits at once');
  assert.equal((await patientClash.json()).code, 'SLOT_TAKEN');
});

test('the join window gates patients entering early, never staff', async () => {
  // Hours away: the room is not open yet.
  const early = await bookAt(staffCookie, {
    id: `test-apt-rules-early-${suffix()}`,
    patientId: template.patientId,
    providerId: template.providerId,
    startMs: Date.now() + 120 * 60_000,
  });

  const refused = await asUser(patientCookie)(
    `/api/appointments/${early.id}/consultation`,
    { method: 'POST' },
  );
  assert.equal(refused.status, 409, 'a patient must not enter before the window opens');
  assert.equal((await refused.json()).code, 'JOIN_WINDOW_CLOSED');

  // The same shut visit opens for staff: they pick up whoever is waiting.
  const staffOpened = await asUser(staffCookie)(
    `/api/appointments/${early.id}/consultation`,
    { method: 'POST' },
  );
  assert.equal(staffOpened.status, 200, 'staff are never window-gated');
  assert.equal((await staffOpened.json()).status, 'in-progress');

  // Inside the window the patient-facing route admits.
  const soon = await bookAt(staffCookie, {
    id: `test-apt-rules-soon-${suffix()}`,
    patientId: template.patientId,
    providerId: template.providerId,
    startMs: Date.now() + 10 * 60_000,
    attempts: 4,
  });
  const admitted = await asUser(patientCookie)(
    `/api/appointments/${soon.id}/consultation`,
    { method: 'POST' },
  );
  assert.equal(admitted.status, 200, 'the window is open 15 minutes before the start');
  assert.equal((await admitted.json()).status, 'in-progress');
});
