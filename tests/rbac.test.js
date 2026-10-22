/**
 * RBAC policy contract.
 *
 * The navigation (src/lib/rbac.ts) and the API guards (server/rbac.js) are two
 * copies of one policy, so this test pins them together: if the tables drift,
 * the UI and the server start disagreeing about who may open what — exactly the
 * failure mode Ottehr's shared role groups exist to prevent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/lib/rbac.ts';
import * as server from '../server/rbac.js';

const SHARED_TABLES = ['TAB_IDS', 'TAB_ROLES', 'TAB_MODULE', 'DEFAULT_TAB_BY_ROLE', 'CLINICAL_ROLES'];

const ALL_MODULES = ['dashboard', 'followups', 'contacts', 'appointments', 'availability'];

test('client and server RBAC tables are identical', () => {
  for (const table of SHARED_TABLES) {
    assert.deepEqual(
      server[table],
      client[table],
      `${table} must match between src/lib/rbac.ts and server/rbac.js`
    );
  }
});

test('a patient is confined to their own dashboard, even with every grant', () => {
  const patient = { role: 'patient', isAdmin: false, modules: ALL_MODULES };
  assert.deepEqual(client.visibleTabs(patient), ['dashboard']);
  assert.equal(client.defaultTabFor(patient), 'dashboard', 'patients land on their own dashboard');
  for (const tab of ['followups', 'appointments', 'contacts', 'availability', 'users']) {
    assert.equal(client.canAccessTab(patient, tab), false, `patient must not open ${tab}`);
  }
});

test('clinical staff open their granted tabs, and never the admin-only tab', () => {
  const clinician = { role: 'clinician', isAdmin: false, modules: ALL_MODULES };
  assert.deepEqual(client.visibleTabs(clinician), [
    'dashboard', 'followups', 'appointments', 'contacts', 'availability',
  ]);
  assert.equal(client.canAccessTab(clinician, 'users'), false, 'user management stays admin-only');
  assert.equal(client.defaultTabFor(clinician), 'followups');
});

test('a missing module grant hides the tab from a clinician', () => {
  const clinician = { role: 'clinician', isAdmin: false, modules: ['followups'] };
  assert.deepEqual(client.visibleTabs(clinician), ['followups']);
  assert.equal(client.canAccessTab(clinician, 'availability'), false);
});

test('an administrator flag opens every tab', () => {
  for (const role of ['patient', 'clinician', 'admin']) {
    const admin = { role, isAdmin: true, modules: [] };
    assert.equal(client.visibleTabs(admin).length, client.TAB_IDS.length, `admin (${role}) sees every tab`);
    assert.equal(client.canAccessTab(admin, 'users'), true);
  }
});

test('an anonymous subject opens nothing and still has a safe landing tab', () => {
  assert.deepEqual(client.visibleTabs(null), []);
  assert.equal(client.canAccessTab(null, 'dashboard'), false);
  assert.equal(client.defaultTabFor(null), 'dashboard');
});

test('every role lands on a tab it may actually open', () => {
  for (const role of ['patient', 'clinician', 'admin']) {
    const subject = { role, isAdmin: false, modules: ALL_MODULES };
    const landing = client.defaultTabFor(subject);
    assert.ok(
      client.visibleTabs(subject).includes(landing),
      `${role} must land on an accessible tab, got ${landing}`
    );
  }
});

test('only patient sessions use the single-chart scope', () => {
  assert.equal(client.isPatientScope({ role: 'patient', isAdmin: false, modules: ALL_MODULES }), true);
  assert.equal(client.isPatientScope({ role: 'clinician', isAdmin: false, modules: ALL_MODULES }), false);
  assert.equal(client.isPatientScope({ role: 'patient', isAdmin: true, modules: ALL_MODULES }), false);
  assert.equal(client.isPatientScope(null), false);
  assert.equal(server.isPatientScope({ role: 'patient', isAdmin: false, modules: [] }), true);
});

test('tabRequired refuses a patient and admits a clinician', () => {
  // The guards decide against req.subject — the subject app.js resolves from
  // the database per request, never the token.
  const run = (guard, subject) => {
    let status = null;
    let nextCalled = false;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    guard({ subject }, res, () => { nextCalled = true; });
    return { status, nextCalled };
  };

  const patient = { role: 'patient', isAdmin: false, modules: ALL_MODULES, patientId: 'pat-001' };
  const clinician = { role: 'clinician', isAdmin: false, modules: ALL_MODULES, patientId: null };

  assert.deepEqual(run(server.tabRequired('followups'), patient), { status: 403, nextCalled: false });
  assert.deepEqual(run(server.tabRequired('followups'), clinician), { status: null, nextCalled: true });
  assert.deepEqual(run(server.clinicalRequired, patient), { status: 403, nextCalled: false });
  assert.deepEqual(run(server.clinicalRequired, clinician), { status: null, nextCalled: true });
  // No resolved subject (e.g. a request that skipped sessionSubject): refused.
  assert.deepEqual(run(server.tabRequired('followups'), null), { status: 403, nextCalled: false });
  assert.deepEqual(run(server.clinicalRequired, undefined), { status: 403, nextCalled: false });
});

test('a user row without RBAC values fails closed', () => {
  // A row with no role/modules (a database migrated from before roles existed)
  // must not be treated as staff.
  const legacy = server.subjectFromSession({ id: 7, username: 'legacy', isAdmin: false });
  assert.equal(legacy.role, 'patient');
  assert.deepEqual(server.visibleTabs(legacy), []);
  assert.equal(server.isPatientScope(legacy), true);
  assert.equal(legacy.patientId, null, 'no chart link means no chart data');
});
