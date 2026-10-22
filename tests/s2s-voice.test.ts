/**
 * S2S voice-bridge contract (Crane AI Labs first, opt-in per visit per user).
 * Static verification: the room exposes a voice drawer backed by the speech
 * hook, the server proxies ephemeral audio behind participant checks, and
 * nothing persists transcripts or raw audio.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

test('room exposes an opt-in voice drawer for patients and consultants', () => {
  const room = read('src/components/consultation/ConsultationRoom.tsx');
  assert.ok(room.includes('VoiceBridgePanel'), 'room mounts the voice panel');
  assert.ok(room.includes("sideDrawer === 'voice'"), 'voice is a drawer like chat/notes');
  assert.ok(room.includes('useSpeechBridge'), 'drawer is backed by the speech hook');
  assert.ok(room.includes('speech.enabled'), 'header reflects opt-in state');
});

test('speech hook captures push-to-talk audio and degrades honestly', () => {
  const hook = read('src/hooks/useSpeechBridge.ts');
  assert.ok(hook.includes('MediaRecorder'), 'turns capture mic audio');
  assert.ok(hook.includes('postS2STurn'), 'turns travel the authenticated API');
  assert.ok(hook.includes('postS2SConsent'), 'opt-in posts explicit consent');
  assert.ok(hook.includes('webkitSpeechRecognition') || hook.includes('SpeechRecognition'), 'offline fallback uses on-device captions');
  assert.ok(hook.includes('speechSynthesis'), 'missing TTS leg falls back to browser speech');
});

test('voice panel is consent-gated with a Uganda-first language catalogue', () => {
  const panel = read('src/components/consultation/VoiceBridgePanel.tsx');
  assert.ok(panel.includes('toggleEnabled'), 'panel toggles per-user consent');
  const hook = read('src/hooks/useSpeechBridge.ts');
  // The catalogue now lives in one shared module (src/lib/localLanguages.ts)
  // so the client and the server cannot drift apart; the hook consumes it.
  const catalogue = read('src/lib/localLanguages.ts');
  for (const code of ['lg', 'ach', 'nyn', 'teo', 'lgs', 'lgg']) {
    assert.ok(catalogue.includes(`'${code}'`), `catalogue covers ${code}`);
  }
  assert.ok(
    hook.includes('localLanguages'),
    'the speech hook must consume the shared local-language catalogue',
  );
  const s2s = read('server/s2s.js');
  assert.ok(s2s.includes('crane-nemo-asr-1.2'), 'Crane NeMo ASR 1.2 is the default STT model');
});

test('server proxies ephemeral audio behind participant checks, never storage', () => {
  const app = read('server/app.js');
  assert.ok(app.includes('/api/s2s/status'), 'capability probe exists');
  assert.ok(app.includes('/api/appointments/:id/s2s/consent'), 'per-visit consent route exists');
  assert.ok(app.includes('/api/appointments/:id/s2s/translate'), 'turn route exists');
  assert.ok(app.includes('visitForParticipant(req, res)'), 'turns are participant-gated');
  assert.ok(app.includes('S2S_CONSENT') && app.includes('S2S_TURN'), 'consent + turns are audited');
  const s2s = read('server/s2s.js');
  assert.ok(!s2s.includes('INSERT INTO') && !s2s.includes('writeFile'), 'S2S module never persists audio or transcripts');
  assert.ok(s2s.includes('CRANE_ASR_URL'), 'Crane endpoint is env-configured, never hardcoded');
});
