/**
 * Visit video stage: local preview + remote peer + screen share.
 * Remote video renders only from the WebRTC MediaStream — when the peer is
 * absent or negotiation fails the stage keeps the avatar view and explains
 * itself instead of pretending a stream is live (Zoom-clone layout, honest
 * clinical signaling).
 */
import React, { useEffect, useRef } from 'react';
import { MicOff, MonitorUp, Signal } from 'lucide-react';

interface VisitStageProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  screenStream: MediaStream | null;
  isScreenSharing: boolean;
  videoEnabled: boolean;
  audioEnabled: boolean;
  peerPresent: boolean;
  peerName: string | null;
  signalError: string | null;
  connectionState: string;
  localLabel: string;
  remoteLabel: string;
  localAvatar: string;
  remoteAvatar: string;
  layout: 'speaker' | 'grid';
}

const attach = (el: HTMLVideoElement | null, stream: MediaStream | null) => {
  if (!el) return;
  if (el.srcObject !== stream) el.srcObject = stream;
  if (stream) void el.play().catch(() => {});
};

export const VisitStage: React.FC<VisitStageProps> = (props) => {
  const { localStream, remoteStream, screenStream, isScreenSharing } = props;
  const { videoEnabled, audioEnabled, peerPresent, peerName, signalError } = props;
  const { connectionState, localLabel, remoteLabel, localAvatar, remoteAvatar, layout } = props;
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const shareRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { attach(localRef.current, localStream); }, [localStream]);
  useEffect(() => { attach(remoteRef.current, remoteStream); }, [remoteStream]);
  useEffect(() => { attach(shareRef.current, screenStream); }, [screenStream]);

  const showRemote = Boolean(remoteStream) && peerPresent;
  const connTone =
    connectionState === 'connected' ? 'text-emerald-400 border-emerald-800 bg-emerald-950/70'
    : connectionState === 'connecting' || connectionState === 'new' ? 'text-amber-300 border-amber-800 bg-amber-950/60'
    : connectionState === 'idle' ? 'text-slate-400 border-slate-700 bg-slate-900/70'
    : 'text-rose-300 border-rose-800 bg-rose-950/60';

  return (
    <div className={layout === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'flex flex-col gap-4'}>
      {isScreenSharing && screenStream && (
        <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-teal-800 aspect-video">
          <video ref={shareRef} autoPlay playsInline className="w-full h-full object-contain" />
          <span className="absolute top-3 left-3 flex items-center gap-1.5 text-[11px] font-bold text-teal-300 bg-slate-950/80 px-2.5 py-1 rounded-full border border-teal-800">
            <MonitorUp className="w-3.5 h-3.5" /> Screen share · {localLabel}
          </span>
        </div>
      )}
      <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video">
        {videoEnabled && localStream ? (
          <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400">
            {localAvatar ? (
              <img src={localAvatar} alt={localLabel} className="w-20 h-20 rounded-full object-cover border-2 border-slate-700" />
            ) : (
              <span className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center text-xl font-bold text-slate-300">
                {localLabel.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="text-xs font-semibold">{videoEnabled ? 'Starting camera…' : 'Camera off'}</span>
          </div>
        )}
        <span className="absolute bottom-3 left-3 text-[11px] font-semibold text-white bg-slate-950/75 px-2.5 py-1 rounded-full border border-slate-700 flex items-center gap-1.5">
          {localLabel} (you)
          {!audioEnabled && <MicOff className="w-3 h-3 text-rose-400" />}
        </span>
      </div>
      <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video">
        {showRemote ? (
          <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400 px-6 text-center">
            {remoteAvatar ? (
              <img src={remoteAvatar} alt={remoteLabel} className="w-20 h-20 rounded-full object-cover border-2 border-slate-700" />
            ) : (
              <span className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center text-xl font-bold text-slate-300">
                {remoteLabel.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="text-xs font-semibold">{peerName ?? remoteLabel}</span>
            <span className="text-[11px] text-slate-500">
              {signalError ?? (peerPresent ? `Connecting peer (${connectionState})…` : 'Waiting for the other participant to join…')}
            </span>
          </div>
        )}
        <span className="absolute bottom-3 left-3 text-[11px] font-semibold text-white bg-slate-950/75 px-2.5 py-1 rounded-full border border-slate-700">
          {peerName ?? remoteLabel}
        </span>
        <span className={`absolute top-3 right-3 flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${connTone}`}>
          <Signal className="w-3 h-3" /> {connectionState}
        </span>
      </div>
    </div>
  );
};
