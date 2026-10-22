/**
 * PHI write budget.
 *
 * Bookings, consultation requests, referrals, guest invites and in-visit
 * attachments each insert a row a signed-in client can repeat without bound:
 * nothing else in those routes caps them, so one account (or a script holding
 * a stolen cookie) can grow the clinical tables and flood the staff inbox
 * indefinitely. They share one per-account budget, which must refuse the
 * request with 429 once it is spent while leaving ordinary human use alone.
 *
 * The budget is env-tunable at boot, so this file lowers it to 2 instead of
 * hammering the real 60/min ceiling.
 */
import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.PHI_WRITE_RATE_MAX = '2';
process.env.PHI_WRITE_RATE_WINDOW_MS = '60000';

const { default: app } = await import('../server/app.js');
const { closePool, query } = await import('../server/db.js');

const PREFIX = 'test-rl-';
let server;
let base;
let cookie;

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

const request = (index) =>
  fetch(`${base}/api/consultation-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      id: `${PREFIX}cr-${Date.now()}-${index}`,
      patientId: 'pat-001',
      topic: 'Write budget probe',
      preferredDate: '2026-12-01',
      details: 'Rate limit fixture',
      contact: 'ahmed@example.test',
    }),
  });

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await login('patient.demo', 'Patient123');
});

after(async () => {
  await query('DELETE FROM consultation_requests WHERE id LIKE ?', [`${PREFIX}%`]);
  await new Promise((resolve) => server.close(resolve));
  await closePool();
});

test('a spent write budget refuses further PHI writes with 429', async () => {
  const first = await request(1);
  assert.equal(first.status, 201, 'the first write is within budget');
  const second = await request(2);
  assert.equal(second.status, 201, 'the second write is within budget');

  const third = await request(3);
  assert.equal(third.status, 429, 'the third write exceeds the budget');
  assert.ok(third.headers.get('retry-after'), '429 must say when to retry');
});
