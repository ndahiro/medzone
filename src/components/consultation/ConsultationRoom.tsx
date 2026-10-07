import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Activity,
  FileText,
  MessageSquare,
  Lock,
  Send,
  CheckCircle2,
  Share2,
  Maximize2,
  Minimize2,
  Pill,
  Sparkles,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { soundManager } from '../../lib/audio';

export const ConsultationRoom: React.FC = () => {
  const {
    activeConsultation,
    endConsultation,
    role,
    patient,
    liveVitals,
    soapNotes,
    updateSoapNotes,
    signSoapNotes,
    chatMessages,
    sendConsultationMessage,
    issuePrescription,
  } = useMedZone();

  // Media states
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [usingRealCamera, setUsingRealCamera] = useState(false);

  // Layout drawers
  const [sideDrawer, setSideDrawer] = useState<'notes' | 'chat' | 'vitals' | null>(
    role === 'clinician' ? 'notes' : 'chat'
  );
  const [showRxModal, setShowRxModal] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [inspectCipherId, setInspectCipherId] = useState<string | null>(null);

  // New Rx form state
  const [newRxName, setNewRxName] = useState('Lisinopril');
  const [newRxDose, setNewRxDose] = useState('20mg');
  const [newRxFreq, setNewRxFreq] = useState('Once daily in morning');
  const [newRxQty, setNewRxQty] = useState(30);
  const [newRxRefills, setNewRxRefills] = useState(3);
  const [newRxInstructions, setNewRxInstructions] = useState('Take 1 tablet daily with water for blood pressure management.');

  // Video Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Setup real camera if permitted
  useEffect(() => {
    let localStream: MediaStream | null = null;

    async function initCamera() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: false,
          });
          localStream = stream;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
            localVideoRef.current.play().catch(() => {});
            setUsingRealCamera(true);
          }
        }
      } catch {
        // Fallback gracefully to high-res synthetic stream
        setUsingRealCamera(false);
      }
    }

    if (videoEnabled) {
      initCamera();
    } else {
      setUsingRealCamera(false);
    }

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [videoEnabled]);

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

  const handleIssuePrescription = (e: React.FormEvent) => {
    e.preventDefault();
    issuePrescription(
      newRxName,
      newRxDose,
      'Oral',
      newRxFreq,
      Number(newRxQty),
      Number(newRxRefills),
      newRxInstructions,
      'Walgreens Pharmacy #4190'
    );
    setShowRxModal(false);
  };

  if (!activeConsultation) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col font-sans overflow-hidden">
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
                <span>AES-256-GCM E2EE</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {role === 'patient'
                ? `Consulting with ${activeConsultation.providerName} (${activeConsultation.providerSpecialty})`
                : `Patient: ${activeConsultation.patientName} (${activeConsultation.patientMrn}) · Age ${activeConsultation.patientAge}`}
            </p>
          </div>
        </div>

        {/* Live Vitals Telemetry Quick Bar */}
        <div className="hidden lg:flex items-center gap-6 px-4 py-1.5 bg-slate-950/70 rounded-lg border border-slate-800 text-xs font-mono tabular-nums">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="text-slate-400">HR:</span>
            <span className="text-emerald-400 font-bold">{liveVitals.heartRate}</span>
            <span className="text-[10px] text-slate-500">bpm</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">BP:</span>
            <span className="text-cyan-400 font-bold">
              {liveVitals.systolic}/{liveVitals.diastolic}
            </span>
            <span className="text-[10px] text-slate-500">mmHg</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">SpO2:</span>
            <span className="text-teal-400 font-bold">{liveVitals.spo2}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Resp:</span>
            <span className="text-slate-200 font-bold">{liveVitals.respiratoryRate}</span>
            <span className="text-[10px] text-slate-500">rpm</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {role === 'clinician' && (
            <button
              onClick={() => setShowRxModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-700 hover:bg-teal-600 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Pill className="w-3.5 h-3.5" />
              <span>Issue E-Rx</span>
            </button>
          )}

          <button
            onClick={() => setSideDrawer(sideDrawer === 'notes' ? null : 'notes')}
            className={`p-2 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 ${
              sideDrawer === 'notes'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title="SOAP Notes Drawer"
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
            title="Encrypted Chat"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Chat</span>
          </button>

          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Video & Content Grid */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Main Video Screen */}
        <div className="flex-1 relative bg-slate-950 flex flex-col items-center justify-center overflow-hidden">
          {/* Primary Participant Video Stream */}
          <div className="w-full h-full relative flex items-center justify-center bg-slate-900">
            {role === 'patient' ? (
              // Patient sees Doctor Video
              <div className="relative w-full h-full flex items-center justify-center">
                <img
                  src={activeConsultation.providerAvatar}
                  alt={activeConsultation.providerName}
                  className="w-full h-full object-cover opacity-90 filter contrast-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-slate-950/40 pointer-events-none" />

                {/* Remote Doctor Label */}
                <div className="absolute bottom-6 left-6 flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-semibold text-slate-100">{activeConsultation.providerName}</span>
                  <span className="text-slate-400">· {activeConsultation.providerSpecialty}</span>
                </div>
              </div>
            ) : (
              // Clinician sees Patient Video
              <div className="relative w-full h-full flex items-center justify-center">
                <img
                  src={patient.avatarUrl}
                  alt={patient.name}
                  className="w-full h-full object-cover opacity-90 filter contrast-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-slate-950/40 pointer-events-none" />

                {/* Remote Patient Label */}
                <div className="absolute bottom-6 left-6 flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-semibold text-slate-100">{patient.name}</span>
                  <span className="text-slate-400">· {patient.mrn}</span>
                </div>
              </div>
            )}

            {/* Picture-in-Picture Local User Video Stream */}
            <div className="absolute top-4 right-4 w-44 sm:w-56 aspect-video bg-slate-800 rounded-xl overflow-hidden border-2 border-slate-700/80 shadow-2xl z-20 group">
              {videoEnabled ? (
                usingRealCamera ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover transform -scale-x-100"
                  />
                ) : (
                  <div className="w-full h-full relative">
                    <img
                      src={role === 'patient' ? patient.avatarUrl : activeConsultation.providerAvatar}
                      alt="Local Feed"
                      className="w-full h-full object-cover filter brightness-95"
                    />
                    <div className="absolute bottom-1 right-2 text-[9px] font-mono bg-black/60 px-1 rounded text-teal-300">
                      Simulated HD
                    </div>
                  </div>
                )
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-500">
                  <VideoOff className="w-6 h-6 mb-1" />
                  <span className="text-[10px]">Camera Muted</span>
                </div>
              )}

              <div className="absolute bottom-1.5 left-2 text-[10px] bg-slate-900/80 px-1.5 py-0.5 rounded text-slate-300 flex items-center gap-1">
                <span>You ({role === 'patient' ? 'Patient' : 'Clinician'})</span>
                {!audioEnabled && <MicOff className="w-2.5 h-2.5 text-rose-400" />}
              </div>
            </div>

            {/* Real-time ECG Telemetry Floating Overlay (Bottom Right) */}
            <div className="absolute bottom-6 right-6 hidden md:flex flex-col bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl p-2.5 shadow-2xl z-10 w-64">
              <div className="flex items-center justify-between mb-1.5 text-[11px] font-mono text-slate-300">
                <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <Activity className="w-3.5 h-3.5 animate-pulse" /> Lead II ECG
                </span>
                <span className="text-slate-400">{liveVitals.heartRate} BPM</span>
              </div>
              <canvas
                ref={canvasRef}
                width={240}
                height={60}
                className="w-full h-14 rounded bg-slate-950 border border-slate-900"
              />
            </div>
          </div>

          {/* Bottom Floating Call Control Bar */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-3 bg-slate-900/90 backdrop-blur-md px-5 py-3 rounded-2xl border border-slate-700/80 shadow-2xl z-30">
            {/* Audio Toggle */}
            <button
              onClick={() => setAudioEnabled(!audioEnabled)}
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
              onClick={() => setVideoEnabled(!videoEnabled)}
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
              onClick={() => setIsScreenSharing(!isScreenSharing)}
              className={`p-3 rounded-full transition-colors cursor-pointer ${
                isScreenSharing
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white'
              }`}
              title="Share Clinical Screen / Chart"
            >
              <Share2 className="w-5 h-5" />
            </button>

            {/* End Call Button */}
            <button
              onClick={endConsultation}
              className="px-6 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider rounded-full shadow-lg flex items-center gap-2 transition-all cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Leave Visit</span>
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
              </div>
              <button
                onClick={() => setSideDrawer(null)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer p-1"
                title="Collapse drawer"
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
                    <span>Cryptographically Sign Encounter</span>
                  </button>
                )}

                {soapNotes.isSigned && (
                  <p className="text-[10px] text-slate-400 text-center font-mono">
                    Digitally signed by {soapNotes.signedBy} at {soapNotes.lastUpdated}
                  </p>
                )}
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
                  {chatMessages.map(msg => (
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
                        <p>{msg.plainText}</p>

                        {/* Cipher inspection affordance */}
                        <button
                          onClick={() =>
                            setInspectCipherId(inspectCipherId === msg.id ? null : msg.id)
                          }
                          className="mt-1.5 text-[10px] text-teal-200/80 hover:text-white flex items-center gap-1 font-mono underline cursor-pointer"
                        >
                          <Lock className="w-2.5 h-2.5" />
                          <span>{inspectCipherId === msg.id ? 'Hide Cipher' : 'Inspect Cipher'}</span>
                        </button>

                        {inspectCipherId === msg.id && (
                          <div className="mt-2 p-2 bg-black/60 rounded text-[9px] font-mono text-teal-300 break-all border border-teal-800/60">
                            <p className="text-slate-400">Cipher Hex:</p>
                            <p>{msg.cipherText}</p>
                            <p className="text-slate-400 mt-1">IV Vector:</p>
                            <p>{msg.ivHex}</p>
                          </div>
                        )}
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
                    onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Type encrypted message..."
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
                  />
                  <button
                    onClick={handleSendMessage}
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
    </div>
  );
};
