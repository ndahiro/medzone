/**
 * Tele-visit hardening regression guard.
 *
 * The HTTP contract lives in server-api.test.js (room admission, participant
 * checks, server-stamped transcript identity). This file guards the other
 * half: the client must never mint a consultation room from its own copy of an
 * appointment, never write chat into an arbitrary visit, and never linger in a
 * room the backend has closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

test('the room opens only after server admission', () => {
  const ctx = read('src/context/MedZoneContext.tsx');
  assert.ok(
    ctx.includes('apiStartConsultationSession('),
    'startConsultation must ask the API to admit the session',
  );
  assert.ok(
    ctx.includes('if (!admitted)'),
    'a refused admission must not open the room',
  );
  assert.ok(
    ctx.includes('...admitted,') && ctx.includes('resolveAvatarUrl(admitted.providerAvatar)'),
    'the room must join with the server\u2019s record, not the local copy',
  );
  assert.ok(
    !ctx.includes('setActiveConsultation(appointment)'),
    'the client copy of an appointment must never open a room directly',
  );
});

test('the API client posts admission to the visit route', () => {
  const api = read('src/lib/api.ts');
  assert.ok(
    api.includes('/api/appointments/${encodeURIComponent(appointmentId)}/consultation'),
    'admission must POST to /api/appointments/:id/consultation',
  );
  assert.ok(
    api.includes('appointment: null, error'),
    'the admission result must carry the server\u2019s refusal reason',
  );
});

test('transcript writes are bound to the live room', () => {
  const ctx = read('src/context/MedZoneContext.tsx');
  assert.ok(
    !ctx.includes('appointments[0]?.id'),
    'chat must never fall back to an arbitrary appointment',
  );
  assert.ok(
    ctx.includes('Chat is only available inside a live tele-visit room.'),
    'writing outside a room must refuse with an explanation',
  );
  assert.ok(
    ctx.includes('prev.some(m => m.id === saved.id)'),
    'only the server-confirmed message may enter the transcript',
  );
});

test('a remotely ended visit closes the room', () => {
  const ctx = read('src/context/MedZoneContext.tsx');
  assert.ok(
    ctx.includes("activeFresh.status === 'completed' || activeFresh.status === 'cancelled'"),
    'a closed visit must be detected from the server snapshot',
  );
  assert.ok(
    ctx.includes('The other participant ended the visit — the room was closed.'),
    'the room must close with an explanation, not keep the encounter open',
  );
});

test('the server enforces the same policy', () => {
  const app = read('server/app.js');
  assert.ok(
    app.includes("app.post('/api/appointments/:id/consultation'"),
    'the admission route must exist',
  );
  assert.ok(
    app.includes('const visitForParticipant = async (req, res) =>'),
    'room routes share the participant policy',
  );
  assert.ok(
    app.includes("isPatientScope(subject) ? 'patient' : 'clinician'"),
    'sender role must be stamped from the session subject',
  );
  assert.ok(
    app.includes('req.subjectRow?.displayName'),
    'sender name must come from the fresh session row, not the body',
  );
  const repo = read('server/repository.js');
  assert.ok(
    repo.includes('export async function getAppointmentRow'),
    'policy checks need the raw appointment row',
  );
});
