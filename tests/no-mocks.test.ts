/**
 * Static regression guard: the client must never reintroduce hardcoded mock
 * data. Scans the src/ tree for the mock module, seed records, and persona
 * strings that must come from the backend instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), 'src');

const walk = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    })
    .filter(file => /\.tsx?$/.test(file));

const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');

const bannedIdentityStrings = [
  'Ahmed Benali',
  'MRN-849201',
  'pat-001',
  'James Miller',
  'Dr. Sarah Chen',
  'Dr. Sophie Martin',
  'Sophie Martin',
  'Marcus Rivera',
  'NPI: 1892019482',
];

test('src/data/mockData.ts no longer exists', () => {
  assert.equal(fs.existsSync(path.join(SRC, 'data', 'mockData.ts')), false);
});

test('no src file imports the mock module', () => {
  const offenders = walk(SRC)
    .filter(file => fs.readFileSync(file, 'utf8').includes('data/mockData'))
    .map(file => path.relative(SRC, file));
  assert.deepEqual(offenders, []);
});

test('no hardcoded seed identities remain anywhere in src/', () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const banned of bannedIdentityStrings) {
      if (text.includes(banned)) offenders.push(`${path.relative(SRC, file)}: ${banned}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('MedZoneContext has no mock fallbacks, seed transcript, or INITIAL_ data', () => {
  const text = read('context/MedZoneContext.tsx');
  for (const banned of ['INITIAL_', 'buildSeedMessages', 'PROVIDERS', 'mockData']) {
    assert.ok(!text.includes(banned), `MedZoneContext still contains ${banned}`);
  }
  assert.ok(text.includes('snapshotFromBootstrap'), 'hydration must use the backend snapshot');
  assert.ok(text.includes('setIsHydrated(true)'), 'bootstrap completion must be signalled');
  assert.ok(text.includes('await apiCreateConsultantNote('), 'notes must be POSTed before local state');
});

test('FollowUpDetailView is driven entirely by backend context', () => {
  const text = read('components/followup/FollowUpDetailView.tsx');
  for (const banned of ['INITIAL_FOLLOW_UP', 'CURRENT_PRACTITIONER', '#CC2026', 'data/mockData']) {
    assert.ok(!text.includes(banned), `FollowUpDetailView still contains ${banned}`);
  }
  assert.ok(text.includes('visibleAppointments.map'), 'appointment cards must render from context');
  assert.ok(text.includes('followUp.practitioner.name'), 'practitioner identity must come from the record');
  assert.ok(text.includes('followUp.patient.name'), 'patient identity must come from the record');
});

test('shell gates rendering until the backend bootstrap settles', () => {
  const text = read('App.tsx');
  assert.ok(text.includes('isHydrated'), 'App must gate on isHydrated');
  assert.ok(text.includes('Loading clinical records'), 'a hydration splash must exist');
});
