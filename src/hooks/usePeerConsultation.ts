/**
 * Real peer-to-peer media for a tele-visit room (WebRTC).
 *
 * Signaling travels through the authenticated REST relay
 * (POST/GET /api/appointments/:id/signals): the clinician offers, the patient
 * answers, ICE trickles both ways, and join/ping rows double as the presence
 * channel. Polls are short while the room is open and stop with it. Media
 * flows directly between browsers and never touches the server.
 *
 * Nothing here fabricates a connection: `peerPresent`, `connectionState` and
 * `remoteStream` reflect signaling and RTCPeerConnection state only. When the
 * peer is absent or negotiation fails, the room keeps its avatar view and
 * explains itself instead of pretending a stream is live.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomSignal, UserRole } from '../types';
import { fetchRoomSignals, postRoomSignal } from '../lib/api';

const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

/**
 * Public STUN suffices for host/srflx candidates in dev and on a LAN.
 * Production deployments behind symmetric NAT should add a TURN server via
 * VITE_WEBRTC_ICE_SERVERS (comma-separated URLs).
 */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

const resolveIceServers = (): RTCIceServer[] => {
  const raw = viteEnv?.VITE_WEBRTC_ICE_SERVERS;
  if (!raw) return DEFAULT_ICE_SERVERS;
  const urls = raw
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  return urls.length ? [{ urls }] : DEFAULT_ICE_SERVERS;
};

const POLL_MS = 1500;
const POLL_JITTER_MS = 600;
const HEARTBEAT_MS = 10000;

export interface UsePeerConsultationOptions {
  /** Visit whose signaling relay carries this session's messages. */
  appointmentId: string | null;
  /** Session user id; signals stamped with it are the caller's own. */
  selfId: number | null;
  role: UserRole;
  /** Local camera/mic stream (may be null when permissions were refused). */
  localStream: MediaStream | null;
}

export interface UsePeerConsultationResult {
  /** Remote participant's media, once tracks arrive. */
  remoteStream: MediaStream | null;
  /** True while the other participant's heartbeats are fresh. */
  peerPresent: boolean;
  peerName: string | null;
  connectionState: RTCPeerConnectionState | 'idle';
  /** Set while the signaling relay cannot be reached. */
  signalError: string | null;
  /**
   * Swaps the outbound video track (screen share / restore). Pass the camera
   * track to go back; null to send nothing.
   */
  setOutboundVideoTrack: (track: MediaStreamTrack | null) => void;
  /**
   * Swaps the outbound audio track; used when the microphone only becomes
   * available after the peer connection was already created.
   */
  setOutboundAudioTrack: (track: MediaStreamTrack | null) => void;
}

export function usePeerConsultation({
  appointmentId,
  selfId,
  role,
  localStream,
}: UsePeerConsultationOptions): UsePeerConsultationResult {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerPresent, setPeerPresent] = useState(false);
  const [peerName, setPeerName] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | 'idle'>('idle');
  const [signalError, setSignalError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const cursorRef = useRef(0);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const audioSenderRef = useRef<RTCRtpSender | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const outboundVideoRef = useRef<MediaStreamTrack | null>(null);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const offeredRef = useRef(false);
  const negotiatingRef = useRef(false);
  const peerAvailableRef = useRef(false);
  const pollingRef = useRef(false);
  const disposedRef = useRef(false);
  const settleFailedRef = useRef<(() => void) | null>(null);

  // The clinician's session offers; the patient's answers. Deterministic, so
  // no glare handling is needed.
  const isOfferer = role !== 'patient';

  localStreamRef.current = localStream;

  const tearDownPeer = useCallback(() => {
    const pc = pcRef.current;
    pcRef.current = null;
    audioSenderRef.current = null;
    videoSenderRef.current = null;
    pendingCandidatesRef.current = [];
    offeredRef.current = false;
    negotiatingRef.current = false;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Already closed.
      }
    }
    setRemoteStream(null);
    setConnectionState('idle');
  }, []);

  const ensurePeer = useCallback((): RTCPeerConnection | null => {
    if (!appointmentId) return null;
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({ iceServers: resolveIceServers() });
    pcRef.current = pc;

    // Stable m-line layout on both sides: audio first, then video. Track
    // availability is decoupled from negotiation, so a party without a camera
    // still receives the other side's video (replaceTrack fills in later).
    const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    audioSenderRef.current = audioTransceiver.sender;
    videoSenderRef.current = videoTransceiver.sender;
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
    void audioTransceiver.sender
      .replaceTrack(localStreamRef.current?.getAudioTracks()[0] ?? null)
      .catch(() => {});
    void videoTransceiver.sender
      .replaceTrack(outboundVideoRef.current ?? cameraTrack)
      .catch(() => {});

    pc.onicecandidate = (event) => {
      if (event.candidate && appointmentId) {
        void postRoomSignal(appointmentId, 'candidate', { candidate: event.candidate.toJSON() });
      }
    };
    pc.ontrack = (event) => {
      setRemoteStream((prev) => {
        const next = prev ?? new MediaStream();
        if (!next.getTracks().some((track) => track.id === event.track.id)) {
          next.addTrack(event.track);
        }
        return next;
      });
    };
    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      if (pc.connectionState === 'failed') settleFailedRef.current?.();
    };
    return pc;
  }, [appointmentId]);

  /** Applies the desired outbound video track (camera, screen share, none). */
  const setOutboundVideoTrack = useCallback((track: MediaStreamTrack | null) => {
    outboundVideoRef.current = track;
    void videoSenderRef.current?.replaceTrack(track).catch(() => {});
  }, []);

  const setOutboundAudioTrack = useCallback((track: MediaStreamTrack | null) => {
    void audioSenderRef.current?.replaceTrack(track).catch(() => {});
  }, []);

  // Camera/mic acquisition and teardown become the default outbound tracks;
  // a screen-share override is applied explicitly through
  // setOutboundVideoTrack and survives unrelated media changes.
  useEffect(() => {
    setOutboundAudioTrack(localStream?.getAudioTracks()[0] ?? null);
    setOutboundVideoTrack(localStream?.getVideoTracks()[0] ?? null);
  }, [localStream, setOutboundAudioTrack, setOutboundVideoTrack]);

  const flushPendingCandidates = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of queued) {
      await pc.addIceCandidate(candidate).catch(() => {});
    }
  }, []);

  const startOffer = useCallback(async () => {
    if (!appointmentId || disposedRef.current) return;
    if (offeredRef.current || negotiatingRef.current) return;
    const pc = ensurePeer();
    if (!pc || pc.signalingState !== 'stable') return;
    negotiatingRef.current = true;
    offeredRef.current = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (pc.localDescription?.sdp) {
        await postRoomSignal(appointmentId, 'offer', {
          type: 'offer',
          sdp: pc.localDescription.sdp,
        });
      }
    } catch {
      offeredRef.current = false;
    } finally {
      negotiatingRef.current = false;
    }
  }, [appointmentId, ensurePeer]);

  const handleSignal = useCallback(
    async (signal: RoomSignal) => {
      if (!appointmentId || disposedRef.current) return;
      if (selfId != null && signal.senderId === selfId) return;
      const pc = ensurePeer();
      if (!pc) return;

      if (signal.kind === 'offer') {
        if (isOfferer) return;
        if (pc.signalingState !== 'stable') return;
        const sdp = (signal.payload as { sdp?: string } | null)?.sdp;
        if (!sdp) return;
        negotiatingRef.current = true;
        try {
          await pc.setRemoteDescription({ type: 'offer', sdp });
          await flushPendingCandidates(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (pc.localDescription?.sdp) {
            await postRoomSignal(appointmentId, 'answer', {
              type: 'answer',
              sdp: pc.localDescription.sdp,
            });
          }
        } catch {
          // The offerer will retry after a connection failure.
        } finally {
          negotiatingRef.current = false;
        }
        return;
      }

      if (signal.kind === 'answer') {
        if (!isOfferer || pc.signalingState !== 'have-local-offer') return;
        const sdp = (signal.payload as { sdp?: string } | null)?.sdp;
        if (!sdp) return;
        await pc.setRemoteDescription({ type: 'answer', sdp }).catch(() => {});
        await flushPendingCandidates(pc);
        return;
      }

      if (signal.kind === 'candidate') {
        const candidate = (signal.payload as { candidate?: RTCIceCandidateInit | null } | null)
          ?.candidate;
        if (!candidate) return;
        if (pc.remoteDescription?.type) {
          await pc.addIceCandidate(candidate).catch(() => {});
        } else {
          // Candidates can outrun the SDP; hold them until it lands.
          pendingCandidatesRef.current.push(candidate);
        }
        return;
      }

      if (signal.kind === 'bye') {
        tearDownPeer();
        setPeerPresent(false);
      }
    },
    [appointmentId, ensurePeer, flushPendingCandidates, isOfferer, selfId, tearDownPeer],
  );

  // Connection failures are retried from the offering side: tear the dead
  // peer down and offer again while the other participant is still present.
  useEffect(() => {
    settleFailedRef.current = () => {
      if (disposedRef.current || !peerAvailableRef.current) return;
      tearDownPeer();
      if (isOfferer) void startOffer();
    };
    return () => {
      settleFailedRef.current = null;
    };
  }, [isOfferer, startOffer, tearDownPeer]);

  // Signaling poll loop: exchange SDP/ICE and read presence while the room is
  // open. Hidden tabs keep polling (a suspended tab would otherwise look gone
  // to the other participant within the heartbeat window). The interval is
  // jittered per room so 50 pairs do not pulse the relay on the same beat;
  // back-to-back polls never overlap (pollingRef) and a slow relay stretches
  // the next beat instead of stacking requests.
  useEffect(() => {
    if (!appointmentId || selfId == null) return;
    disposedRef.current = false;

    const poll = async () => {
      if (pollingRef.current || disposedRef.current) return;
      pollingRef.current = true;
      try {
        const page = await fetchRoomSignals(appointmentId, cursorRef.current);
        if (disposedRef.current) return;
        if (!page) {
          setSignalError('Secure signaling relay unavailable — retrying.');
          return;
        }
        setSignalError(null);
        if (page.latestId > cursorRef.current) cursorRef.current = page.latestId;

        const others = page.presence.filter((entry) => entry.senderId !== selfId);
        peerAvailableRef.current = others.length > 0;
        setPeerPresent(others.length > 0);
        if (others[0]) setPeerName(others[0].senderName);

        for (const signal of page.signals) {
          await handleSignal(signal);
        }

        if (peerAvailableRef.current && isOfferer && !offeredRef.current) {
          await startOffer();
        }
      } finally {
        pollingRef.current = false;
      }
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    const schedule = () => {
      const jitter = Math.floor(Math.random() * POLL_JITTER_MS);
      timer = setInterval(() => void poll(), POLL_MS + jitter);
    };
    void poll();
    schedule();
    return () => {
      disposedRef.current = true;
      if (timer) clearInterval(timer);
    };
  }, [appointmentId, handleSignal, isOfferer, selfId, startOffer]);

  // Presence heartbeats + graceful departure. `pagehide` uses keepalive so the
  // final `bye` still flushes while the page unloads.
  useEffect(() => {
    if (!appointmentId) return;
    const heartbeat = () => {
      void postRoomSignal(appointmentId, 'ping');
    };
    void postRoomSignal(appointmentId, 'join');
    const timer = setInterval(heartbeat, HEARTBEAT_MS);
    const onPageHide = () => {
      void postRoomSignal(appointmentId, 'bye', null, { keepalive: true });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') heartbeat();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisible);
      void postRoomSignal(appointmentId, 'bye', null, { keepalive: true });
      tearDownPeer();
      cursorRef.current = 0;
      setPeerPresent(false);
      setPeerName(null);
      setSignalError(null);
    };
  }, [appointmentId, tearDownPeer]);

  return {
    remoteStream,
    peerPresent,
    peerName,
    connectionState,
    signalError,
    setOutboundVideoTrack,
    setOutboundAudioTrack,
  };
}
