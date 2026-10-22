/**
 * Pre-join lobby: preview, mic level, speaker test, explicit join choice.
 * The peer connection never opens before this gate — the lobby is
 * local-only, and joining without devices is an explicit operator decision.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Camera, Mic, Volume2, Video, PhoneOff, X } from 'lucide-react';
import { soundManager } from '../../lib/audio';
import type { JoinMode } from '../../hooks/useVisitCall';

interface VisitLobbyProps {
  open: boolean;
  roomCode: string;
  counterpartName: string;
  acquiring: boolean;
  mediaError: string | null;
  onJoin: (mode: JoinMode) => Promise<boolean>;
  onCancel: () => void;
}

export const VisitLobby: React.FC<VisitLobbyProps> = (props: VisitLobbyProps) => {
  const { open, roomCode, counterpartName, acquiring, mediaError, onJoin, onCancel } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [speakerOk, setSpeakerOk] = useState(false);
  const [joining, setJoining] = useState<JoinMode | null>(null);
  return (
    <LobbyBody
      open={open}
      roomCode={roomCode}
      counterpartName={counterpartName}
      acquiring={acquiring}
      mediaError={mediaError ?? previewError}
      joining={joining}
      setJoining={setJoining}
      speakerOk={speakerOk}
      setSpeakerOk={setSpeakerOk}
      videoRef={videoRef}
      meterRef={meterRef}
      previewError={previewError}
      setPreviewError={setPreviewError}
      onJoin={onJoin}
      onCancel={onCancel}
    />
  );
};

interface LobbyBodyProps extends VisitLobbyProps {
  joining: JoinMode | null;
  setJoining: (mode: JoinMode | null) => void;
  speakerOk: boolean;
  setSpeakerOk: (ok: boolean) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  meterRef: React.RefObject<HTMLDivElement | null>;
  previewError: string | null;
  setPreviewError: (msg: string | null) => void;
  mediaError: string | null;
}

const LobbyBody: React.FC<LobbyBodyProps> = ({
  open, roomCode, counterpartName, acquiring, mediaError, joining, setJoining,
  speakerOk, setSpeakerOk, videoRef, meterRef, previewError, setPreviewError, onJoin, onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let raf = 0;
    let analyser: AnalyserNode | null = null;
    let audioCtx: AudioContext | null = null;
    let videoTrack: MediaStream | null = null;
    let micTrack: MediaStream | null = null;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setPreviewError('Media devices are not available in this browser.');
        return;
      }
      try {
        const video = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) { video.getTracks().forEach(t => t.stop()); return; }
        videoTrack = video;
        if (videoRef.current) {
          videoRef.current.srcObject = video;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setPreviewError('Camera blocked — you can still join audio-only.');
      }
      try {
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { audio.getTracks().forEach(t => t.stop()); return; }
        micTrack = audio;
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(audio);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const draw = () => {
          if (cancelled || !analyser) return;
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i += 2) {
            const v = Math.abs(data[i] - 128) / 128;
            if (v > peak) peak = v;
          }
          if (meterRef.current) meterRef.current.style.width = `${Math.min(100, Math.round(peak * 160))}%`;
          raf = requestAnimationFrame(draw);
        };
        draw();
      } catch { /* Mic blocked — meter stays flat. */ }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      videoTrack?.getTracks().forEach(t => t.stop());
      micTrack?.getTracks().forEach(t => t.stop());
      void audioCtx?.close().catch(() => {});
    };
  }, [open, videoRef, meterRef, setPreviewError]);

  if (!open) return null;
  const doJoin = async (mode: JoinMode) => {
    setJoining(mode);
    try { await onJoin(mode); } finally { setJoining(null); }
  };
  const busy = acquiring || joining !== null;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl text-slate-100">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div>
            <h3 className="font-bold text-base">Ready to join?</h3>
            <p className="text-xs text-slate-400 mt-0.5">Room {roomCode} · with {counterpartName}</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white cursor-pointer" title="Leave">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="rounded-xl overflow-hidden bg-slate-950 aspect-video border border-slate-800">
          {previewError ? (
            <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 px-6 text-center">{previewError}</div>
          ) : (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
          )}
        </div>
        <div className="mt-4 space-y-3 text-xs">
          <div>
            <div className="flex items-center gap-2 font-semibold text-slate-300 mb-1.5">
              <Mic className="w-3.5 h-3.5 text-teal-400" />
              <span>Microphone level</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div ref={meterRef} className="h-full bg-teal-500 rounded-full" style={{ width: '0%' }} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-center gap-2 font-semibold text-slate-300">
              <Volume2 className="w-4 h-4 text-teal-400" />
              <span>Speaker {speakerOk && <span className="text-emerald-400 font-normal">· ok</span>}</span>
            </div>
            <button
              onClick={() => { soundManager.playNotificationChime(); setSpeakerOk(true); }}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg cursor-pointer"
            >
              Test
            </button>
          </div>
          {mediaError && (
            <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 shrink-0" />
              {mediaError}
            </p>
          )}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button onClick={() => void doJoin('full')} disabled={busy} className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl cursor-pointer">
              <Video className="w-4 h-4" />
              {joining === 'full' ? 'Joining…' : 'Join'}
            </button>
            <button onClick={() => void doJoin('audio-only')} disabled={busy} className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl cursor-pointer">
              <Mic className="w-4 h-4" />
              {joining === 'audio-only' ? 'Joining…' : 'Audio only'}
            </button>
            <button onClick={() => void doJoin('no-devices')} disabled={busy} className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-bold rounded-xl cursor-pointer">
              <PhoneOff className="w-4 h-4" />
              Listen only
            </button>
          </div>
          <p className="text-[11px] text-slate-500 text-center">Nothing is recorded before you join.</p>
        </div>
      </div>
    </div>
  );
};
