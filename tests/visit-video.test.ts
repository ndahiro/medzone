/**
 * Tele-visit video contract (superpowers verification-before-completion):
 * the room renders live WebRTC streams through the shared call state — a
 * pre-join lobby gates the peer connection, the stage shows the remote
 * MediaStream honestly, screen share replaces the outbound track, and guests
 * come from the server roster. Static-image video walls and session-local
 * guest lists must never return.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('the room joins through a pre-join lobby, never straight into signaling', () => {
  const room = read('src/components/consultation/ConsultationRoom.tsx');
  assert.ok(room.includes('VisitLobby'), 'room renders the pre-join lobby');
  assert.ok(room.includes("phase === 'lobby'"), 'lobby gates on the call phase');
  assert.ok(room.includes('joinWithDevices'), 'join flows through the shared call state');

  const hook = read('src/hooks/useVisitCall.ts');
  // Lobby is local-only: signaling starts only after admission to live.
  assert.ok(
    hook.includes("phase === 'live' ? appointmentId : null"),
    'peer signaling must wait for the live phase',
  );
});

test('the stage renders live streams, never a static video wall', () => {
  const room = read('src/components/consultation/ConsultationRoom.tsx');
  assert.ok(room.includes('<VisitStage'), 'room renders the live stage');
  assert.ok(room.includes('remoteStream={remoteStream}'), 'remote stage is the WebRTC stream');
  assert.ok(room.includes('localStream={localStream}'), 'local preview is the shared stream');
  assert.ok(
    !room.includes('doctor_video_feed') && !room.includes('patient_video_feed'),
    'bundled stock video feeds must not drive the room',
  );

  const stage = read('src/components/consultation/VisitStage.tsx');
  assert.ok(stage.includes('remoteStream'), 'stage accepts the remote stream');
  assert.ok(stage.includes('Waiting for the other participant'), 'absent peer is explained honestly');
});

test('screen share replaces the outbound track instead of stopping it', () => {
  const hook = read('src/hooks/useVisitCall.ts');
  assert.ok(hook.includes('getDisplayMedia'), 'screen share uses the display-media picker');
  assert.ok(
    hook.includes('peer.setOutboundVideoTrack(track)'),
    'the screen track must replace the outbound video track',
  );
  assert.ok(hook.includes('track.onended'), 'closing the OS share restores the camera');

  const room = read('src/components/consultation/ConsultationRoom.tsx');
  assert.ok(!room.includes('getDisplayMedia'), 'the room must not run its own share picker');
});

test('guest invites use the server roster, not session-local state', () => {
  const room = read('src/components/consultation/ConsultationRoom.tsx');
  assert.ok(room.includes('addGuest') && room.includes('removeGuest'), 'room uses roster actions');
  assert.ok(!room.includes('setGuests('), 'no session-local guest list may remain');

  const modal = read('src/components/consultation/GuestInviteModal.tsx');
  assert.ok(modal.includes('guestsError'), 'roster failures are surfaced in the modal');
});
