/**
 * Patient-view regression guard.
 *
 * The API already scopes every read (see server-api.test.js): a patient session
 * receives its own chart and nothing else, and the RBAC tables are pinned by
 * rbac.test.js. This guards the other half of "a patient sees what they are
 * meant to see" — the shell must choose the patient surfaces from the session
 * role, never from a browser-stored preference, so a patient login can never
 * render the clinician or admin dashboard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

test('the dashboard is chosen from the session role, not a stored preference', () => {
  const app = read('src/App.tsx');
  assert.ok(
    app.includes("effectiveRole === 'admin' ? ("),
    'the admin dashboard must be gated on the session role',
  );
  assert.ok(
    app.includes("effectiveRole === 'clinician' ? ("),
    'the clinician dashboard must be gated on the session role',
  );
  assert.ok(app.includes('<PatientDashboard />'), 'patients get the patient dashboard');
  assert.ok(
    !app.includes('dashboardRole'),
    'the dispatch must not consult a separately tracked UI role',
  );
  assert.ok(!app.includes('setRole'), 'the shell must not switch roles');
});

test('the UI role is derived from the session account, never persisted', () => {
  const ctx = read('src/context/MedZoneContext.tsx');
  assert.ok(
    ctx.includes("user?.role === 'clinician' || user?.role === 'admin' ? 'clinician' : 'patient'"),
    'the role must follow the signed-in account',
  );
  assert.ok(
    !ctx.includes('UI_PREF_PREFIX}role'),
    'the role must never be written to localStorage',
  );
  assert.ok(!ctx.includes('setRole'), 'the role is not user-settable');
});

test('no component offers a role switch to the signed-in account', () => {
  const nav = read('src/components/layout/AppSidebar.tsx');
  assert.ok(!nav.includes('setRole'), 'the sidebar must not offer a patient/clinician switch');
  assert.ok(
    nav.includes('user.role'),
    'the sidebar derives its policy from the session account',
  );
});
