/**
 * Shared tele-visit call state (Zoom-clone parity, clinical safety preserved).
 *
 * One hook owns the room's media lifecycle so every surface — local preview,
 * remote stage, screen share, device check, guest roster — reads the same
 * truth: a single getUserMedia acquisition shared with the WebRTC peer hook,
 * real screen-share track replacement, a server-backed guest roster, and
 * pre-join gating (lobby until devices succeed or the operator continues
 * without them). Media never touches the API — only SDP/ICE/presence travel
 * the signaling relay; guest names are visit metadata, never PHI.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePeerConsultation } from './usePeerConsultation';
import { createVisitGuest, deleteVisitGuest, fetchVisitGuests } from '../lib/api';
import type { UserRole, VisitGuest } from '../types';

export type JoinMode = 'full' | 'audio-only' | 'no-devices';
export type CallPhase = 'lobby' | 'live';

export interface UseVisitCallOptions {
  appointmentId: string | null;
  role: UserRole;
  patientId: string | null;
}

const screenTrackOf = (stream: MediaStream | null): MediaStreamTrack | null =>
  stream?.getVideoTracks()[0] ?? null;

export function useVisitCall({ appointmentId, role, patientId }: UseVisitCallOptions) {
  void patientId;
  const { user } = useAuth();
  const selfId = user?.id ?? null;

  // Local media: one acquisition shared with the peer hook.
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [acquiring, setAcquiring] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  localStreamRef.current = localStream;

  // Screen share + join phase.
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CallPhase>('lobby');
  const [joinMode, setJoinMode] = useState<JoinMode | null>(null);

  // Peer connection: no signaling before live admission — lobby is local-only.
  const peer = usePeerConsultation({
    appointmentId: phase === 'live' ? appointmentId : null,
    selfId,
    role,
    localStream,
  });

  // Guest roster: server-owned so both parties see the same list.
  const [guests, setGuests] = useState<VisitGuest[]>([]);
  const [guestsError, setGuestsError] = useState<string | null>(null);

  const stopTracks = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach(track => {
      try {
        track.stop();
      } catch {
        // Already stopped.
      }
    });
  }, []);

  /** One acquisition for camera+mic; partial grants degrade honestly. */
  const acquireDevices = useCallback(
    async (wantVideo: boolean, wantAudio: boolean): Promise<MediaStream | null> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaError('Media devices are not available in this browser.');
        return null;
      }
      setAcquiring(true);
      setMediaError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
          audio: wantAudio ? { echoCancellation: true, noiseSuppression: true } : false,
        });
        if (wantVideo && stream.getVideoTracks().length === 0) {
          setMediaError('Camera unavailable — continuing audio-only.');
          setVideoEnabled(false);
        }
        if (wantAudio && stream.getAudioTracks().length === 0) {
          setMediaError(prev => prev ?? 'Microphone unavailable — you are muted.');
          setAudioEnabled(false);
        }
        setLocalStream(stream);
        return stream;
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        setMediaError(
          name === 'NotAllowedError'
            ? 'Camera/microphone blocked — allow access or join without devices.'
            : 'Camera/microphone unavailable — join audio-only or without devices.'
        );
        return null;
      } finally {
        setAcquiring(false);
      }
    },
    []
  );

  /** Pre-join check from the lobby; resolves true once live starts. */
  const joinWithDevices = useCallback(
    async (mode: JoinMode): Promise<boolean> => {
      setJoinMode(mode);
      if (mode === 'no-devices') {
        setVideoEnabled(false);
        setAudioEnabled(false);
        setPhase('live');
        return true;
      }
      const stream = await acquireDevices(mode === 'full', true);
      if (!stream) return false;
      if (mode === 'audio-only') {
        stream.getVideoTracks().forEach(t => {
          try {
            t.stop();
          } catch {
            // Already stopped.
          }
        });
        setVideoEnabled(false);
        setLocalStream(new MediaStream(stream.getAudioTracks()));
      }
      setPhase('live');
      return true;
    },
    [acquireDevices]
  );

  const setVideoMuted = useCallback(
    (muted: boolean) => {
      const stream = localStreamRef.current;
      if (!stream) {
        setVideoEnabled(!muted);
        return;
      }
      if (muted) {
        stream.getVideoTracks().forEach(t => {
          t.enabled = false;
        });
        setVideoEnabled(false);
        return;
      }
      const live = stream.getVideoTracks().find(t => t.readyState === 'live');
      if (live) {
        live.enabled = true;
        setVideoEnabled(true);
        return;
      }
      void acquireDevices(true, false).then(next => {
        if (!next) return;
        const video = next.getVideoTracks()[0] ?? null;
        const audio = stream.getAudioTracks();
        setLocalStream(new MediaStream([...(video ? [video] : []), ...audio]));
        setVideoEnabled(Boolean(video));
        next.getAudioTracks().forEach(t => {
          try {
            t.stop();
          } catch {
            // Already stopped.
          }
        });
      });
    },
    [acquireDevices]
  );

  const setAudioMuted = useCallback(
    (muted: boolean) => {
      const stream = localStreamRef.current;
      stream?.getAudioTracks().forEach(t => {
        t.enabled = !muted;
      });
      setAudioEnabled(!muted);
      if (!muted && (!stream || stream.getAudioTracks().length === 0)) {
        void acquireDevices(false, true).then(next => {
          if (!next) return;
          const mic = next.getAudioTracks()[0] ?? null;
          const video = stream?.getVideoTracks() ?? [];
          if (mic) {
            setLocalStream(new MediaStream([...video, mic]));
            setAudioEnabled(true);
          }
          next.getVideoTracks().forEach(t => {
            try {
              t.stop();
            } catch {
              // Already stopped.
            }
          });
        });
      }
    },
    [acquireDevices]
  );

  const stopScreenShare = useCallback(() => {
    setScreenStream(prev => {
      stopTracks(prev);
      return null;
    });
    const camera = localStreamRef.current?.getVideoTracks()[0] ?? null;
    peer.setOutboundVideoTrack(videoEnabled ? camera : null);
    setIsScreenSharing(false);
  }, [peer, stopTracks, videoEnabled]);

  /** Real screen share: replaces the outbound video track (Zoom parity). */
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopScreenShare();
      return;
    }
    setShareError(null);
    if (!navigator.mediaDevices || !('getDisplayMedia' in navigator.mediaDevices)) {
      setShareError('Screen sharing is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screenTrackOf(stream);
      if (!track) {
        stopTracks(stream);
        return;
      }
      setScreenStream(stream);
      peer.setOutboundVideoTrack(track);
      setIsScreenSharing(true);
      track.onended = () => stopScreenShare();
    } catch {
      // Picker cancelled — stay in camera mode silently.
    }
  }, [isScreenSharing, peer, stopScreenShare, stopTracks]);

  const refreshGuests = useCallback(async () => {
    if (!appointmentId || phase !== 'live') return;
    const rows = await fetchVisitGuests(appointmentId);
    if (!rows) {
      setGuestsError('Guest roster unavailable — the visit service could not be reached.');
      return;
    }
    setGuestsError(null);
    setGuests(rows);
  }, [appointmentId, phase]);

  useEffect(() => {
    void refreshGuests();
  }, [refreshGuests]);

  const addGuest = useCallback(
    async (name: string, guestRole: VisitGuest['role']): Promise<boolean> => {
      if (!appointmentId) return false;
      const created = await createVisitGuest(appointmentId, { name, role: guestRole });
      if (!created) {
        setGuestsError('Invite not recorded — the visit service could not be reached.');
        return false;
      }
      setGuestsError(null);
      setGuests(prev => (prev.some(g => g.id === created.id) ? prev : [...prev, created]));
      return true;
    },
    [appointmentId]
  );

  const removeGuest = useCallback(
    async (guestId: string): Promise<boolean> => {
      if (!appointmentId) return false;
      const ok = await deleteVisitGuest(appointmentId, guestId);
      if (!ok) {
        setGuestsError('Guest not removed — the visit service could not be reached.');
        return false;
      }
      setGuests(prev => prev.filter(g => g.id !== guestId));
      return true;
    },
    [appointmentId]
  );

  useEffect(
    () => () => {
      stopTracks(localStreamRef.current);
      setScreenStream(prev => {
        stopTracks(prev);
        return null;
      });
    },
    [stopTracks]
  );

  return {
    localStream,
    videoEnabled,
    audioEnabled,
    mediaError,
    acquiring,
    setVideoMuted,
    setAudioMuted,
    isScreenSharing,
    screenStream,
    shareError,
    toggleScreenShare,
    stopScreenShare,
    phase,
    joinMode,
    joinWithDevices,
    ...peer,
    guests,
    guestsError,
    refreshGuests,
    addGuest,
    removeGuest,
  };
}

