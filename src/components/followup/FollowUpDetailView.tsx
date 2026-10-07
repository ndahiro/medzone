import React, { useState } from 'react';
import {
  ArrowLeft,
  Edit2,
  FileDown,
  X,
  Video,
  List,
  Calendar as CalendarIcon,
  Clock,
  Mic,
  MicOff,
  VideoOff,
  Share2,
  MessageSquare,
  PhoneOff,
  Maximize2,
  Minimize2,
  Send,
  Lock,
  CheckCircle2,
  User,
  Users,
  ChevronDown,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import {
  INITIAL_FOLLOW_UP,
  CURRENT_PRACTITIONER,
} from '../../data/mockData';
import doctorVideoFeedImg from '../../assets/images/doctor_video_feed_1791378183189.jpg';
import patientVideoFeedImg from '../../assets/images/patient_video_feed_1791378196252.jpg';
import sophieMartinAvatarImg from '../../assets/images/avatar_sophie_martin_1791378206234.jpg';

export const FollowUpDetailView: React.FC = () => {
  const {
    setShowSummaryExportModal,
    setShowComplianceModal,
    triggerPushNotification,
    chatMessages,
    sendConsultationMessage,
    liveVitals,
  } = useMedZone();

  // View toggles
  const [appointmentViewMode, setAppointmentViewMode] = useState<'list' | 'calendar' | 'timeline'>('list');
  const [appointmentFilter, setAppointmentFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming');

  // Video call overlay state (starts open by default to match the PDF screenshot!)
  const [isVideoCallActive, setIsVideoCallActive] = useState<boolean>(true);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isVideoMuted, setIsVideoMuted] = useState<boolean>(false);
  const [isScreenShared, setIsScreenShared] = useState<boolean>(false);
  const [isVideoExpanded, setIsVideoExpanded] = useState<boolean>(false);

  // Chat message input
  const [messageText, setMessageText] = useState<string>('');

  const followUp = INITIAL_FOLLOW_UP;

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;
    const txt = messageText;
    setMessageText('');
    await sendConsultationMessage(txt);
  };

  const handleCloseFollowUp = () => {
    triggerPushNotification(
      'Follow-up Status Updated',
      'Follow-up #CC2026-042 marked as closed in clinical archive.',
      'clinical'
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 min-h-screen overflow-x-hidden relative">
      {/* 1. TOP HEADER BAR: Back Arrow & Follow-up Details Breadcrumb & User Profile */}
      <header className="h-16 bg-white border-b border-slate-200/90 px-6 sm:px-8 flex items-center justify-between shrink-0 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            title="Back to follow-ups"
          >
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
              Follow-up Details
            </h1>
            <p className="text-[11px] text-slate-400 leading-none">
              View &amp; edit follow-up details
            </p>
          </div>
        </div>

        {/* Right User Profile Pill (Sophie Martin - SM) */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 pl-2 py-1 pr-1 bg-white hover:bg-slate-50 rounded-full border border-slate-200/80 transition-colors cursor-pointer shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
            <span className="text-xs font-semibold text-slate-800 hidden sm:inline">
              {CURRENT_PRACTITIONER.name}
            </span>
            <div className="w-7 h-7 rounded-full bg-teal-800 text-white font-bold text-xs flex items-center justify-center shadow-xs">
              {CURRENT_PRACTITIONER.initials}
            </div>
          </div>
        </div>
      </header>

      {/* 2. MAIN 2-COLUMN WORKSPACE: Details (Left 70%) & Messages (Right 30%) */}
      <div className="flex-1 p-6 sm:p-8 grid grid-cols-1 xl:grid-cols-12 gap-6 max-w-[1600px] w-full mx-auto">
        {/* LEFT COLUMN: Main Follow-Up Details & Appointments (8 cols on XL) */}
        <div className="xl:col-span-8 space-y-6">
          {/* Main Card: Follow-up Information */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 sm:p-7 shadow-xs">
            {/* Title Row with Status & Action Buttons */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                    {followUp.title}
                  </h2>
                  <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                    {followUp.code}
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                    {followUp.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Created on {followUp.createdDate}
                </p>
              </div>

              {/* Action Buttons: Edit, Export PDF, Close Follow-up */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() =>
                    triggerPushNotification('Edit Mode', 'Follow-up parameters unlocked for clinical editing.', 'clinical')
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-2xs transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                  <span>Edit</span>
                </button>

                <button
                  onClick={() => setShowSummaryExportModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-2xs transition-colors cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5 text-slate-500" />
                  <span>Export PDF</span>
                </button>

                <button
                  onClick={handleCloseFollowUp}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50/50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg border border-rose-200 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5 text-rose-600" />
                  <span>Close Follow-up</span>
                </button>
              </div>
            </div>

            {/* Description Text */}
            <div className="py-4">
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {followUp.description}
              </p>
            </div>

            {/* 3 Profile Cards Row: CREATED BY | PRACTITIONER | PATIENT */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              {/* Card 1: CREATED BY */}
              <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                  CREATED BY
                </span>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-teal-800 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
                    {followUp.createdBy.initials}
                  </div>
                  <div className="overflow-hidden">
                    <span className="text-xs font-bold text-slate-800 block">Me</span>
                    <span className="text-[11px] text-slate-500 block truncate">
                      {followUp.createdBy.email}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: PRACTITIONER */}
              <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                  PRACTITIONER
                </span>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-teal-800 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
                    {followUp.practitioner.initials}
                  </div>
                  <div className="overflow-hidden">
                    <span className="text-xs font-bold text-slate-800 block">Me</span>
                    <span className="text-[11px] text-slate-500 block truncate">
                      {followUp.practitioner.email}
                    </span>
                  </div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-200/50">
                  <span className="text-[9px] font-bold text-slate-400 uppercase block">
                    PRACTITIONER GROUP
                  </span>
                  <span className="text-xs font-semibold text-slate-700 block mt-0.5">
                    {followUp.practitioner.group}
                  </span>
                </div>
              </div>

              {/* Card 3: PATIENT */}
              <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                  PATIENT
                </span>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-slate-700 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
                    {followUp.patient.initials}
                  </div>
                  <div className="overflow-hidden">
                    <span className="text-xs font-bold text-slate-800 block">
                      {followUp.patient.name}
                    </span>
                    <span className="text-[11px] text-slate-500 block truncate">
                      {followUp.patient.email}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section: Appointments (2) */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 sm:p-7 shadow-xs">
            {/* Header with View Tabs & Status Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                Appointments (2)
              </h3>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                {/* View switcher: List | Calendar | Timeline */}
                <div className="flex items-center p-0.5 bg-slate-100 rounded-lg">
                  <button
                    onClick={() => setAppointmentViewMode('list')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                      appointmentViewMode === 'list'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    List
                  </button>
                  <button
                    onClick={() => setAppointmentViewMode('calendar')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                      appointmentViewMode === 'calendar'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Calendar
                  </button>
                  <button
                    onClick={() => setAppointmentViewMode('timeline')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                      appointmentViewMode === 'timeline'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Timeline
                  </button>
                </div>

                {/* Status Filter: Upcoming | Past | All */}
                <div className="flex items-center p-0.5 bg-slate-100 rounded-lg">
                  <button
                    onClick={() => setAppointmentFilter('upcoming')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                      appointmentFilter === 'upcoming'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Upcoming
                  </button>
                  <button
                    onClick={() => setAppointmentFilter('past')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                      appointmentFilter === 'past'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Past
                  </button>
                  <button
                    onClick={() => setAppointmentFilter('all')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                      appointmentFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    All
                  </button>
                </div>
              </div>
            </div>

            {/* Appointment Cards List */}
            <div className="space-y-4 pt-4">
              {/* Appointment Card 1 (March 26) */}
              <div className="p-4 sm:p-5 rounded-xl border border-slate-200/90 hover:border-teal-300 transition-colors bg-white">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  {/* Left: Date Badge + Title + Schedule */}
                  <div className="flex items-start gap-4">
                    {/* Date Block */}
                    <div className="w-13 h-13 rounded-xl bg-slate-100 flex flex-col items-center justify-center shrink-0 border border-slate-200/60 text-slate-800">
                      <span className="text-lg font-black leading-none">26</span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">
                        Mar
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-bold text-sm text-slate-900">
                          Prescription renewal teleconsultation
                        </h4>
                        <span className="text-[10px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200/80 flex items-center gap-1">
                          <Video className="w-2.5 h-2.5 text-teal-700" />
                          <span>Video</span>
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 font-medium">
                        Thursday, March 26, 2026 — 4:00 PM
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Happened on Mar 26, 2026 · 4:00 PM
                      </p>
                    </div>
                  </div>

                  {/* Right: Launch video toggle */}
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      onClick={() => setIsVideoCallActive(true)}
                      className="px-3.5 py-1.5 bg-teal-800 hover:bg-teal-900 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>{isVideoCallActive ? 'Call In-Progress' : 'Join Video Call'}</span>
                    </button>
                  </div>
                </div>

                {/* Participants row */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs">
                  <span className="text-[11px] font-bold text-slate-400 uppercase">
                    Participants (2):
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-slate-700 text-white text-[9px] font-bold flex items-center justify-center">
                      AB
                    </div>
                    <span className="font-semibold text-slate-800">Ahmed Benali</span>
                    <span className="text-[10px] text-slate-400">(Patient)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-teal-800 text-white text-[9px] font-bold flex items-center justify-center">
                      SM
                    </div>
                    <span className="font-semibold text-slate-800">Me</span>
                    <span className="text-[10px] text-slate-400">(Practitioner)</span>
                  </div>
                </div>
              </div>

              {/* Appointment Card 2 (April 15) */}
              <div className="p-4 sm:p-5 rounded-xl border border-slate-200/90 hover:border-slate-300 transition-colors bg-white">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-13 h-13 rounded-xl bg-slate-100 flex flex-col items-center justify-center shrink-0 border border-slate-200/60 text-slate-800">
                      <span className="text-lg font-black leading-none">15</span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">
                        Apr
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-bold text-sm text-slate-900">
                          Post-renewal glycemic checkup &amp; lab review
                        </h4>
                        <span className="text-[10px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200/80 flex items-center gap-1">
                          <Video className="w-2.5 h-2.5 text-teal-700" />
                          <span>Video</span>
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 font-medium">
                        Wednesday, April 15, 2026 — 2:30 PM
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Scheduled for next month
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                      Upcoming
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs">
                  <span className="text-[11px] font-bold text-slate-400 uppercase">
                    Participants (2):
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-slate-700 text-white text-[9px] font-bold flex items-center justify-center">
                      AB
                    </div>
                    <span className="font-semibold text-slate-800">Ahmed Benali</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-teal-800 text-white text-[9px] font-bold flex items-center justify-center">
                      SM
                    </div>
                    <span className="font-semibold text-slate-800">Me</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Messages Channel (4 cols on XL) */}
        <div className="xl:col-span-4 flex flex-col">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs flex-1 flex flex-col overflow-hidden min-h-[580px]">
            {/* Messages Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
              <h3 className="font-bold text-base text-slate-900">Messages</h3>
              <span className="text-[11px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                1 participant
              </span>
            </div>

            {/* Messages Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3.5 text-xs">
              {/* Event Banner: Sophie Martin joined */}
              <div className="text-center my-2">
                <span className="inline-block text-[11px] text-slate-500 bg-slate-100/90 px-3 py-1 rounded-full border border-slate-200/60 font-mono">
                  12:24 · Sophie Martin (practitioner) joined the meeting
                </span>
              </div>

              {/* Chat bubbles */}
              {chatMessages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.senderRole === 'clinician' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-0.5">
                    <span className="font-semibold text-slate-600">{msg.senderName}</span>
                    <span>·</span>
                    <span>{msg.timestamp}</span>
                  </div>
                  <div
                    className={`p-3 rounded-xl max-w-[90%] leading-relaxed ${
                      msg.senderRole === 'clinician'
                        ? 'bg-teal-800 text-white rounded-br-none shadow-xs'
                        : 'bg-slate-100 text-slate-800 rounded-bl-none border border-slate-200'
                    }`}
                  >
                    <p>{msg.plainText}</p>
                    <div className="mt-1 flex items-center gap-1 text-[9px] opacity-75 font-mono">
                      <Lock className="w-2.5 h-2.5" />
                      <span>AES-256-GCM encrypted</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center gap-2 shrink-0"
            >
              <input
                type="text"
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                placeholder="Write a message..."
                className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-600 shadow-2xs"
              />
              <button
                type="submit"
                disabled={!messageText.trim()}
                className="p-2 bg-teal-800 hover:bg-teal-900 disabled:opacity-40 text-white rounded-lg transition-colors cursor-pointer shrink-0 shadow-2xs"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* 3. FLOATING DOCKED VIDEO CALL WINDOW (EXACTLY AS IN THE PDF SCREENSHOT!) */}
      {isVideoCallActive && (
        <div
          className={`fixed z-50 transition-all duration-200 select-none ${
            isVideoExpanded
              ? 'inset-4 sm:inset-10 z-50'
              : 'bottom-6 right-6 sm:bottom-8 sm:right-8 w-[92vw] sm:w-[500px] md:w-[560px] h-[340px] sm:h-[360px]'
          }`}
        >
          <div className="w-full h-full bg-slate-950 rounded-2xl overflow-hidden shadow-2xl border-2 border-slate-700/90 flex flex-col ring-1 ring-black/40">
            {/* Dual Video Stream Canvas (Left: Doctor, Right: Patient) */}
            <div className="flex-1 grid grid-cols-2 gap-1.5 p-1.5 bg-slate-950 min-h-0 overflow-hidden">
              {/* Doctor Video Feed (Left) */}
              <div className="relative rounded-xl overflow-hidden bg-slate-900 w-full h-full flex items-center justify-center">
                {!isVideoMuted ? (
                  <img
                    src={doctorVideoFeedImg}
                    alt="Dr. Marcus Rivera / Practitioner"
                    className="w-full h-full object-cover block"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-500 w-full h-full">
                    <VideoOff className="w-8 h-8 mb-1 text-slate-600" />
                    <span className="text-[11px] font-medium">Video Off</span>
                  </div>
                )}
                {/* Doctor Overlay Tag */}
                <div className="absolute bottom-2 left-2 bg-slate-950/75 backdrop-blur-xs px-2 py-0.5 rounded text-[10px] text-white flex items-center gap-1.5 font-medium border border-white/10 shadow-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Dr. Marcus Rivera, MD</span>
                </div>
              </div>

              {/* Patient Video Feed (Right) */}
              <div className="relative rounded-xl overflow-hidden bg-slate-900 w-full h-full flex items-center justify-center">
                <img
                  src={patientVideoFeedImg}
                  alt="Patient Video Feed"
                  className="w-full h-full object-cover block"
                />
                {/* Patient Overlay Tag */}
                <div className="absolute bottom-2 left-2 bg-slate-950/75 backdrop-blur-xs px-2 py-0.5 rounded text-[10px] text-white flex items-center gap-1.5 font-medium border border-white/10 shadow-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Ahmed Benali (Patient)</span>
                </div>
              </div>
            </div>

            {/* Video Call Controls Bar (Inside floating call frame) */}
            <div className="h-14 bg-slate-950 border-t border-slate-800/90 px-4 flex items-center justify-between shrink-0">
              {/* Live Vitals Telemetry Badge */}
              <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums text-slate-300">
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>HR {liveVitals.heartRate}</span>
                </span>
                <span className="text-cyan-400 hidden sm:inline">
                  BP {liveVitals.systolic}/{liveVitals.diastolic}
                </span>
              </div>

              {/* Core Call Action Buttons */}
              <div className="flex items-center gap-2">
                {/* Mic Mute Toggle */}
                <button
                  onClick={() => setIsAudioMuted(!isAudioMuted)}
                  className={`p-2.5 rounded-xl transition-colors cursor-pointer ${
                    isAudioMuted
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                  title={isAudioMuted ? 'Unmute' : 'Mute'}
                >
                  {isAudioMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                {/* Video Mute Toggle */}
                <button
                  onClick={() => setIsVideoMuted(!isVideoMuted)}
                  className={`p-2.5 rounded-xl transition-colors cursor-pointer ${
                    isVideoMuted
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                  title={isVideoMuted ? 'Enable Camera' : 'Disable Camera'}
                >
                  {isVideoMuted ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                </button>

                {/* Screen Share */}
                <button
                  onClick={() => setIsScreenShared(!isScreenShared)}
                  className={`p-2.5 rounded-xl transition-colors cursor-pointer ${
                    isScreenShared
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                  title="Share Screen"
                >
                  <Share2 className="w-4 h-4" />
                </button>

                {/* End Call Button */}
                <button
                  onClick={() => setIsVideoCallActive(false)}
                  className="p-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md transition-colors cursor-pointer"
                  title="Leave Consultation"
                >
                  <PhoneOff className="w-4 h-4" />
                </button>
              </div>

              {/* Expand / Minimize Window */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsVideoExpanded(!isVideoExpanded)}
                  className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                  title={isVideoExpanded ? 'Minimize View' : 'Maximize View'}
                >
                  {isVideoExpanded ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => setIsVideoCallActive(false)}
                  className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Close Floating Window"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
