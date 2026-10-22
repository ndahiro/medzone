import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Activity,
  FileText,
  MessageSquare,
  Languages,
  Lock,
  Send,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Pill,
  ChevronRight,
  ChevronLeft,
  UserPlus,
  LayoutGrid,
  MonitorUp,
  UserX,
  Wifi,
  Paperclip,
  Download,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useLiveVitals } from '../../context/VitalsContext';
import { useVisitCall } from '../../hooks/useVisitCall';
import { useSpeechBridge } from '../../hooks/useSpeechBridge';
import { VisitLobby } from './VisitLobby';
import { VisitStage } from './VisitStage';
import { VoiceBridgePanel } from './VoiceBridgePanel';
import { soundManager } from '../../lib/audio';
import { GuestInviteModal } from './GuestInviteModal';
import type { VisitGuest } from '../../types';

export const ConsultationRoom: React.FC = () => {
  const {
    activeConsultation,
    endConsultation,
    leaveConsultationRoom,
    role,
    patient,
    soapNotes,
    updateSoapNotes,
    signSoapNotes,
    chatMessages,
    sendConsultationMessage,
    issuePrescription,
    attachments,
    shareAttachment,
  } = useMedZone();
  const { t } = useLanguage();
  const liveVitals = useLiveVitals();
  const { user } = useAuth();

  // Shared call state: one media acquisition, real WebRTC peer, server
  // guests, and pre-join gating. The room renders from this — never from
  // parallel getUserMedia calls or locally invented streams.
  const call = useVisitCall({
    appointmentId: activeConsultation?.id ?? null,
    role,
    patientId: activeConsultation?.patientId ?? null,
  });
  const {
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
    phase,
    joinWithDevices,
    remoteStream,
    peerPresent,
    peerName,
    connectionState,
    signalError,
    guests,
    guestsError,
    addGuest,
    removeGuest,
  } = call;

  const selfId = user?.id ?? null;
  void selfId;

  // Opt-in S2S voice bridge: per-user consent, Crane-first captions.
  const speech = useSpeechBridge({
    appointmentId: activeConsultation?.id ?? null,
    live: phase === 'live',
  });

  // Layout drawers + call chrome
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stageLayout, setStageLayout] = useState<'speaker' | 'grid'>('speaker');

  // Layout drawers
  const [sideDrawer, setSideDrawer] = useState<'notes' | 'chat' | 'vitals' | 'files' | 'voice' | null>(
    role === 'clinician' ? 'notes' : 'chat'
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showRxModal, setShowRxModal] = useState(false);
  const [chatInput, setChatInput] = useState('');
  // Guest invite dialog visibility; the roster itself lives in useVisitCall.
  const [showGuestModal, setShowGuestModal] = useState(false);
  // Render only the recent transcript window; the server returns each read
  // already decrypted for this participant.
  const visibleMessages = useMemo(
    () => (chatMessages.length > 100 ? chatMessages.slice(-100) : chatMessages),
    [chatMessages]
  );

  // New Rx form state — blank; nothing is pre-filled from sample data.
  const [newRxName, setNewRxName] = useState('');
  const [newRxDose, setNewRxDose] = useState('');
  const [newRxFreq, setNewRxFreq] = useState('');
  const [newRxQty, setNewRxQty] = useState(30);
  const [newRxRefills, setNewRxRefills] = useState(0);
  const [newRxInstructions, setNewRxInstructions] = useState('');
  const [newRxPharmacy, setNewRxPharmacy] = useState('');

  // Video Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);

  // Call timer: counts up from the moment the live phase starts.
  useEffect(() => {
    if (phase !== 'live') return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // Animated ECG Waveform on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let step = 0;
    const width = canvas.width;
    const height = canvas.height;
    const points: number[] = new Array(width).fill(height / 2);

    const renderECG = () => {
      step = (step + 2) % width;

      // Generate ECG P-Q-R-S-T curve periodically
      const cyclePos = step % 80;
      let yVal = height / 2;

      if (cyclePos >= 10 && cyclePos <= 16) {
        // P-wave
        yVal -= Math.sin(((cyclePos - 10) / 6) * Math.PI) * 6;
      } else if (cyclePos === 24) {
        // Q-drop
        yVal += 4;
      } else if (cyclePos >= 25 && cyclePos <= 28) {
        // R-spike
        yVal -= 24;
        if (cyclePos === 26) {
          soundManager.playVitalsPulse();
        }
      } else if (cyclePos >= 29 && cyclePos <= 32) {
        // S-drop
        yVal += 8;
      } else if (cyclePos >= 42 && cyclePos <= 52) {
        // T-wave
        yVal -= Math.sin(((cyclePos - 42) / 10) * Math.PI) * 9;
      }

      points[step] = yVal;

      // Draw background & grid
      ctx.fillStyle = '#090D16';
      ctx.fillRect(0, 0, width, height);

      // Faint ECG grid lines
      ctx.strokeStyle = 'rgba(15, 118, 110, 0.15)';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 15) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw ECG wave
      ctx.beginPath();
      ctx.strokeStyle = '#10B981'; // Medical green
      ctx.lineWidth = 2;
      ctx.shadowColor = '#10B981';
      ctx.shadowBlur = 4;

      for (let i = 0; i < width; i++) {
        if (i === 0) {
          ctx.moveTo(i, points[i]);
        } else {
          // Leave gap right ahead of current scan head
          if (Math.abs(i - step) < 6) {
            ctx.moveTo(i, points[i]);
          } else {
            ctx.lineTo(i, points[i]);
          }
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      animationFrameId = requestAnimationFrame(renderECG);
    };

    renderECG();

    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // In-call prescription confirmation banner (declared before effects that use it).
  const [rxSent, setRxSent] = useState(false);

  // Auto-dismiss the e-prescription confirmation banner.
  useEffect(() => {
    if (!rxSent) return;
    const t = setTimeout(() => setRxSent(false), 5000);
    return () => clearTimeout(t);
  }, [rxSent]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, sideDrawer]);

  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim()) return;
    const txt = chatInput;
    setChatInput('');
    await sendConsultationMessage(txt);
  }, [chatInput, sendConsultationMessage]);

  // File/image share: the picked file is read and POSTed by the context, so
  // the shared file is one the backend actually holds for both participants.
  const handleAttachmentPicked = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      await shareAttachment(file);
    },
    [shareAttachment]
  );

  const handleIssuePrescription = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRxName.trim() || !newRxDose.trim()) return;
    issuePrescription(
      newRxName,
      newRxDose,
      'Oral',
      newRxFreq,
      Number(newRxQty) || 1,
      Number(newRxRefills) || 0,
      newRxInstructions,
      newRxPharmacy
    );
    setShowRxModal(false);
    setRxSent(true);
    soundManager.playNotificationChime();
  };

  const formatElapsed = (total: number) => {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Mic / camera toggles delegate to the shared call state (single stream).
  const toggleAudio = useCallback(() => {
    setAudioMuted(audioEnabled);
  }, [audioEnabled, setAudioMuted]);

  const toggleVideo = useCallback(() => {
    setVideoMuted(videoEnabled);
  }, [videoEnabled, setVideoMuted]);

  // Fullscreen toggle on the call area; Esc key stays in sync via listener.
  // A blocked request is a no-op — the room stays usable in-window.
  const toggleFullScreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await roomRef.current?.requestFullscreen();
        setIsFullScreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullScreen(false);
      }
    } catch {
      // Fullscreen blocked (iframe permissions) — stay in-window.
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullScreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (!activeConsultation) return null;

  const counterpartName =
    role === 'patient' ? activeConsultation.providerName : activeConsultation.patientName;
  const localLabel = role === 'patient' ? patient.name || 'Patient' : activeConsultation.providerName;
  const remoteLabel = counterpartName;
  const remoteAvatar =
    role === 'patient' ? activeConsultation.providerAvatar : patient.avatarUrl;
  const localAvatar =
    role === 'patient' ? patient.avatarUrl : activeConsultation.providerAvatar;

  return (
    <div ref={roomRef} className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col font-sans overflow-hidden">
      {/* Pre-join lobby: no peer connection until the operator joins. */}
      <VisitLobby
        open={phase === 'lobby'}
        roomCode={activeConsultation.roomCode}
        counterpartName={counterpartName}
        acquiring={acquiring}
        mediaError={mediaError}
        onJoin={joinWithDevices}
        onCancel={leaveConsultationRoom}
      />
      {/* Top Consultation Room Header */}
      <header className="h-14 bg-slate-900/90 border-b border-slate-800 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-100 tracking-tight">
                {activeConsultation.type} · Room {activeConsultation.roomCode}
              </span>
              <span className="flex items-center gap-1 text-[11px] font-mono text-teal-400 bg-teal-950/80 px-2 py-0.5 rounded border border-teal-800">
                <Lock className="w-3 h-3" />
                <span>AES-256-GCM encrypted</span>
              </span>
              <span className="text-[11px] font-mono text-slate-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700 tabular-nums">
                {formatElapsed(elapsedSeconds)}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {role === 'patient'
                ? `Consulting with ${activeConsultation.providerName} (${activeConsultation.providerSpecialty})`
                : `Patient: ${activeConsultation.patientName} (${activeConsultation.patientMrn}) · Age ${activeConsultation.patientAge}`}
            </p>
          </div>
        </div>

        {/* Live Vitals Telemetry Quick Bar — recorded chart data only */}
        <div className="hidden lg:flex items-center gap-6 px-4 py-1.5 bg-slate-950/70 rounded-lg border border-slate-800 text-xs font-mono tabular-nums">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="text-slate-400">HR:</span>
            <span className="text-emerald-400 font-bold">{liveVitals.reading?.heartRate ?? '—'}</span>
            <span className="text-[10px] text-slate-500">bpm</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">BP:</span>
            <span className="text-cyan-400 font-bold">
              {liveVitals.reading ? `${liveVitals.reading.systolic}/${liveVitals.reading.diastolic}` : '—'}
            </span>
            <span className="text-[10px] text-slate-500">mmHg</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">SpO2:</span>
            <span className="text-teal-400 font-bold">{liveVitals.reading ? `${liveVitals.reading.spo2}%` : '—'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Resp:</span>
            <span className="text-slate-200 font-bold">{liveVitals.reading?.respiratoryRate ?? '—'}</span>
            <span className="text-[10px] text-slate-500">rpm</span>
          </div>
          {liveVitals.error && <span className="text-[10px] text-amber-400 font-sans">vitals offline</span>}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {role === 'clinician' && (
            <button
              onClick={() => setShowRxModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-700 hover:bg-teal-600 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Pill className="w-3.5 h-3.5" />
              <span>New Rx</span>
            </button>
          )}

          <button
            onClick={() => setSideDrawer(sideDrawer === 'notes' ? null : 'notes')}
            className={`p-2 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 ${
              sideDrawer === 'notes'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Notes"
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">SOAP</span>
          </button>

          <button
            onClick={() => setSideDrawer(sideDrawer === 'chat' ? null : 'chat')}
            className={`p-2 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 ${
              sideDrawer === 'chat'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Chat"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Chat</span>
          </button>

          <button
            onClick={() => setSideDrawer(sideDrawer === 'voice' ? null : 'voice')}
            className={`p-2 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 ${
              sideDrawer === 'voice'
                ? 'bg-teal-700 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="Voice translation (Luganda, Acholi, …)"
          >
            <Languages className="w-4 h-4" />
            <span className="hidden sm:inline">Voice{speech.enabled ? ' ●' : ''}</span>
          </button>

          <button
            onClick={() => setShowGuestModal(true)}
            className="p-2 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 text-slate-400 hover:text-white hover:bg-slate-800"
            title="Invite guest"
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Invite{guests.length > 0 ? ` (${guests.length})` : ''}</span>
          </button>

          <button
            onClick={() => void toggleFullScreen()}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Video & Content Grid: live WebRTC stage (never stock photos) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Main Video Screen */}
        <div className="flex-1 relative bg-slate-950 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <VisitStage
              localStream={localStream}
              remoteStream={remoteStream}
              screenStream={screenStream}
              isScreenSharing={isScreenSharing}
              videoEnabled={videoEnabled}
              audioEnabled={audioEnabled}
              peerPresent={peerPresent}
              peerName={peerName}
              signalError={signalError}
              connectionState={connectionState}
              localLabel={localLabel}
              remoteLabel={remoteLabel}
              localAvatar={localAvatar}
              remoteAvatar={remoteAvatar}
              layout={stageLayout}
            />
            {/* STAGE-REPLACE-MARKER */}
            {(mediaError || shareError || signalError) && phase === 'live' && (
              <div className="mt-3 flex items-start gap-2 max-w-2xl bg-amber-500/95 text-slate-950 px-3 py-2 rounded-xl text-[11px] font-semibold shadow-lg">
                <Wifi className="w-4 h-4 shrink-0 mt-px" />
                <span>{mediaError ?? shareError ?? signalError}</span>
              </div>
            )}
            {isScreenSharing && (
              <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-teal-300">
                <MonitorUp className="w-4 h-4" />
                <span>Sharing your screen — click Share again to stop</span>
              </div>
            )}
            {rxSent && (
              <div className="mt-3 flex items-center gap-2 bg-emerald-600/95 px-4 py-1.5 rounded-full text-xs font-semibold shadow-lg w-fit">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>E-Prescription signed &amp; transmitted</span>
              </div>
            )}
            <div className="mt-4 hidden md:flex flex-col bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl p-2.5 shadow-2xl w-64">
              <div className="flex items-center justify-between mb-1.5 text-[11px] font-mono text-slate-300">
                <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <Activity className="w-3.5 h-3.5 animate-pulse" /> Lead II ECG
                </span>
                <span className="text-slate-400">{liveVitals.reading ? `${liveVitals.reading.heartRate} BPM` : '— BPM'}</span>
              </div>
              <canvas
                ref={canvasRef}
                width={240}
                height={60}
                className="w-full h-14 rounded bg-slate-950 border border-slate-900"
              />
              <span className="mt-1 text-[10px] text-slate-500">
                {liveVitals.reading ? 'Recorded rhythm · illustrative trace' : 'No recorded vitals for this chart'}
              </span>
            </div>
          </div>

          {/* Bottom Floating Call Control Bar */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-3 bg-slate-900/90 backdrop-blur-md px-5 py-3 rounded-2xl border border-slate-700/80 shadow-2xl z-30">
            {/* Audio Toggle */}
            <button
              onClick={() => void toggleAudio()}
              className={`p-3 rounded-full transition-colors cursor-pointer ${
                audioEnabled
                  ? 'bg-slate-800 hover:bg-slate-700 text-white'
                  : 'bg-rose-600 hover:bg-rose-500 text-white'
              }`}
              title={audioEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
            >
              {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>

            {/* Video Toggle */}
            <button
              onClick={() => toggleVideo()}
              className={`p-3 rounded-full transition-colors cursor-pointer ${
                videoEnabled
                  ? 'bg-slate-800 hover:bg-slate-700 text-white'
                  : 'bg-rose-600 hover:bg-rose-500 text-white'
              }`}
              title={videoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
            >
              {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>

            {/* Screen Share Toggle */}
            <button
              onClick={() => void toggleScreenShare()}
              className={`p-3 rounded-full transition-colors cursor-pointer ${
                isScreenSharing
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white'
              }`}
              title="Share screen"
            >
              <MonitorUp className="w-5 h-5" />
            </button>

            {/* Layout Toggle */}
            <button
              onClick={() => setStageLayout(prev => (prev === 'speaker' ? 'grid' : 'speaker'))}
              className="p-3 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title={stageLayout === 'speaker' ? 'Grid view' : 'Speaker view'}
            >
              <LayoutGrid className="w-5 h-5" />
            </button>

            {/* End Call Button */}
            <button
              onClick={endConsultation}
              className="px-6 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider rounded-full shadow-lg flex items-center gap-2 transition-all cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Leave</span>
            </button>
          </div>
        </div>

        {/* Side Drawer: SOAP Notes / Encrypted Chat */}
        {sideDrawer && (
          <aside className="w-80 sm:w-96 bg-slate-900 border-l border-slate-800 flex flex-col z-40 transition-all shrink-0">
            {/* Drawer Tabs */}
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 bg-slate-950/60">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSideDrawer('notes')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    sideDrawer === 'notes'
                      ? 'bg-slate-800 text-teal-400'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  SOAP Charting
                </button>
                <button
                  onClick={() => setSideDrawer('chat')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    sideDrawer === 'chat'
                      ? 'bg-slate-800 text-teal-400'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Encrypted Chat
                </button>
                <button
                  onClick={() => setSideDrawer('files')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    sideDrawer === 'files'
                      ? 'bg-slate-800 text-teal-400'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Files{attachments.length > 0 ? ` (${attachments.length})` : ''}
                </button>
                <button
                  onClick={() => setSideDrawer('voice')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    sideDrawer === 'voice'
                      ? 'bg-slate-800 text-teal-400'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Voice{speech.enabled ? ' ●' : ''}
                </button>
              </div>
              <button
                onClick={() => setSideDrawer(null)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer p-1"
                title="Collapse"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Content: SOAP Notes */}
            {sideDrawer === 'notes' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                    Clinical Encounter Notes
                  </span>
                  {soapNotes.isSigned ? (
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800 flex items-center gap-1 font-mono">
                      <CheckCircle2 className="w-3 h-3" /> Signed
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800 font-mono">
                      Draft In Progress
                    </span>
                  )}
                </div>

                {/* S - Subjective */}
                <div>
                  <label className="block text-[11px] font-semibold text-teal-400 mb-1">
                    S · Subjective (Patient Complaints)
                  </label>
                  <textarea
                    rows={3}
                    disabled={role === 'patient' || soapNotes.isSigned}
                    value={soapNotes.subjective}
                    onChange={e => updateSoapNotes({ subjective: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-teal-500 leading-relaxed resize-none disabled:opacity-75"
                  />
                </div>

                {/* O - Objective */}
                <div>
                  <label className="block text-[11px] font-semibold text-teal-400 mb-1">
                    O · Objective (Observations &amp; Vitals)
                  </label>
                  <textarea
                    rows={3}
                    disabled={role === 'patient' || soapNotes.isSigned}
                    value={soapNotes.objective}
                    onChange={e => updateSoapNotes({ objective: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-teal-500 leading-relaxed resize-none disabled:opacity-75"
                  />
                </div>

                {/* A - Assessment */}
                <div>
                  <label className="block text-[11px] font-semibold text-teal-400 mb-1">
                    A · Assessment (Diagnoses &amp; ICD-10)
                  </label>
                  <textarea
                    rows={2}
                    disabled={role === 'patient' || soapNotes.isSigned}
                    value={soapNotes.assessment}
                    onChange={e => updateSoapNotes({ assessment: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-teal-500 leading-relaxed resize-none disabled:opacity-75"
                  />
                </div>

                {/* P - Plan */}
                <div>
                  <label className="block text-[11px] font-semibold text-teal-400 mb-1">
                    P · Plan (Therapy &amp; Follow-up)
                  </label>
                  <textarea
                    rows={3}
                    disabled={role === 'patient' || soapNotes.isSigned}
                    value={soapNotes.plan}
                    onChange={e => updateSoapNotes({ plan: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-teal-500 leading-relaxed resize-none disabled:opacity-75"
                  />
                </div>

                {/* Signing Footer */}
                {role === 'clinician' && !soapNotes.isSigned && (
                  <button
                    onClick={signSoapNotes}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Sign</span>
                  </button>
                )}

                {soapNotes.isSigned && (
                  <p className="text-[10px] text-slate-400 text-center font-mono">
                    Digitally signed by {soapNotes.signedBy} at {soapNotes.lastUpdated}
                  </p>
                )}
              </div>
            )}

            {/* Drawer Content: Shared files & images (HCW@Home parity) */}
            {sideDrawer === 'files' && (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                <div className="p-2.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400 font-mono">{t('attachments.title')}</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 px-2.5 py-1.5 text-[11px] font-bold text-white cursor-pointer"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>{t('attachments.share')}</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleAttachmentPicked}
                  />
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
                  {attachments.length === 0 ? (
                    <p className="text-slate-500">{t('attachments.empty')}</p>
                  ) : (
                    attachments.map(att => (
                      <div key={att.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-200">{att.fileName}</p>
                            <p className="text-[10px] text-slate-500">
                              {att.senderName} · {Math.max(1, Math.round(att.sizeBytes / 1024))} KB
                            </p>
                          </div>
                          <a
                            href={`data:${att.mimeType};base64,${att.content}`}
                            download={att.fileName}
                            className="shrink-0 text-slate-400 hover:text-white cursor-pointer"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                        {att.mimeType.startsWith('image/') && (
                          <img
                            src={`data:${att.mimeType};base64,${att.content}`}
                            alt={att.fileName}
                            className="mt-2 max-h-48 w-full rounded-lg object-contain bg-black/40"
                          />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Drawer Content: Voice translation (Crane AI Labs first) */}
            {sideDrawer === 'voice' && (
              <div className="flex-1 overflow-y-auto p-4">
                <VoiceBridgePanel bridge={speech} live={phase === 'live'} />
              </div>
            )}

            {/* Drawer Content: Encrypted Chat */}
            {sideDrawer === 'chat' && (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                <div className="p-2.5 bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 flex items-center gap-1.5 font-mono">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Channel: Encrypted via Web Crypto AES-GCM</span>
                </div>

                {/* Messages List */}
                <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
                  {chatMessages.length > visibleMessages.length && (
                    <p className="text-center text-[10px] text-slate-500 font-mono">
                      Showing recent {visibleMessages.length} of {chatMessages.length} messages
                    </p>
                  )}
                  {visibleMessages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        msg.senderRole === role ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-0.5">
                        <span className="font-semibold text-slate-300">{msg.senderName}</span>
                        <span>·</span>
                        <span>{msg.timestamp}</span>
                      </div>
                      <div
                        className={`p-3 rounded-xl max-w-[85%] leading-relaxed ${
                          msg.senderRole === role
                            ? 'bg-teal-700 text-white rounded-br-none'
                            : 'bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700'
                        }`}
                      >
                        <p>{msg.text}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Message Input */}
                <div className="p-3 border-t border-slate-800 bg-slate-950 flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleSendMessage(); }}
                    placeholder="Message…"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
                  />
                  <button
                    onClick={() => void handleSendMessage()}
                    disabled={!chatInput.trim()}
                    className="p-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* In-Call Issue E-Prescription Modal */}
      {showRxModal && (
        <div className="fixed inset-0 z-60 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Pill className="w-5 h-5 text-teal-400" />
                <h3 className="font-bold text-base">In-Call Electronic Prescription</h3>
              </div>
              <button
                onClick={() => setShowRxModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleIssuePrescription} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Medication Name</label>
                  <input
                    type="text"
                    required
                    value={newRxName}
                    onChange={e => setNewRxName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Dosage</label>
                  <input
                    type="text"
                    required
                    value={newRxDose}
                    onChange={e => setNewRxDose(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:border-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Frequency</label>
                <input
                  type="text"
                  required
                  value={newRxFreq}
                  onChange={e => setNewRxFreq(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:border-teal-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Quantity (tablets)</label>
                  <input
                    type="number"
                    min="1"
                    value={newRxQty}
                    onChange={e => setNewRxQty(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Refills Allowed</label>
                  <input
                    type="number"
                    min="0"
                    max="11"
                    value={newRxRefills}
                    onChange={e => setNewRxRefills(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:border-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Patient Instructions</label>
                <textarea
                  rows={2}
                  value={newRxInstructions}
                  onChange={e => setNewRxInstructions(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:border-teal-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Fulfillment Pharmacy</label>
                <input
                  type="text"
                  value={newRxPharmacy}
                  onChange={e => setNewRxPharmacy(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:border-teal-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowRxModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-lg shadow-md cursor-pointer"
                >
                  Sign &amp; Transmit to Pharmacy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Guest invitations (family / translator / specialist, server roster) */}
      <GuestInviteModal
        open={showGuestModal}
        onClose={() => setShowGuestModal(false)}
        roomCode={activeConsultation.roomCode}
        guests={guests.map(g => ({ name: g.name, role: g.role }))}
        guestsError={guestsError}
        onAddGuest={async guest => {
          await addGuest(guest.name, guest.role);
        }}
        onRemoveGuest={async index => {
          const target = guests[index];
          if (target) await removeGuest(target.id);
        }}
      />
    </div>
  );
};
