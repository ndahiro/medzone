import React, { useMemo, useState, useEffect } from 'react';
import {
  ArrowLeft,
  Edit2,
  FileDown,
  RotateCcw,
  Video,
  Send,
  X,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-03-26" -> "Thursday, March 26, 2026" (timezone-safe local parse). */
const friendlyDate = (isoDate: string): string => {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

const initialsOf = (fullName: string): string =>
  fullName
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

export const FollowUpDetailView: React.FC = () => {
  const {
    setShowSummaryExportModal,
    setShowComplianceModal,
    triggerPushNotification,
    chatMessages,
    sendConsultationMessage,
    appointments,
    startConsultation,
    activeConsultation,
    followUp,
    followUps,
    selectFollowUp,
    closeFollowUp,
    reopenFollowUp,
  } = useMedZone();

  // View toggles
  const [appointmentViewMode, setAppointmentViewMode] = useState<'list' | 'calendar' | 'timeline'>('list');
  const [appointmentFilter, setAppointmentFilter] = useState<'all' | 'upcoming' | 'past'>('all');

  // Chat message input
  const [messageText, setMessageText] = useState<string>('');

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;
    const txt = messageText;
    setMessageText('');
    await sendConsultationMessage(txt);
  };

  // Persisted close/reopen: the context PATCHes the backend first and only
  // updates local state on success, so the status badge survives reloads.
  const [isUpdatingFollowUp, setIsUpdatingFollowUp] = useState<boolean>(false);

  const handleCloseFollowUp = async () => {
    if (!followUp || isUpdatingFollowUp) return;
    setIsUpdatingFollowUp(true);
    try {
      await closeFollowUp();
    } finally {
      setIsUpdatingFollowUp(false);
    }
  };

  const handleReopenFollowUp = async () => {
    if (!followUp || isUpdatingFollowUp) return;
    setIsUpdatingFollowUp(true);
    try {
      await reopenFollowUp();
    } finally {
      setIsUpdatingFollowUp(false);
    }
  };

  // Appointment list straight from the backend store, filtered by the toggle.
  const visibleAppointments = useMemo(
    () => appointments.filter(apt => {
      if (appointmentFilter === 'past') return apt.status === 'completed' || apt.status === 'cancelled';
      if (appointmentFilter === 'upcoming') return apt.status === 'scheduled' || apt.status === 'in-progress';
      return true;
    }),
    [appointments, appointmentFilter]
  );

  // Distinct chat participants, derived from actual messages (not hardcoded).
  const participantCount = useMemo(
    () => Math.max(new Set(chatMessages.map(msg => msg.senderName)).size, 1),
    [chatMessages]
  );

  // Render only the recent transcript window; decryption stays incremental.
  const visibleMessages = useMemo(
    () => (chatMessages.length > 100 ? chatMessages.slice(-100) : chatMessages),
    [chatMessages]
  );

  // No follow-up record: explicit empty state, never a hardcoded fallback.
  if (!followUp) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-slate-50 text-sm text-slate-500">
        <p>No follow-up is assigned to this patient chart.</p>
        {followUps.length > 0 && (
          <select
            value=""
            onChange={e => selectFollowUp(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 cursor-pointer"
            aria-label="Select follow-up"
          >
            <option value="" disabled>Select a follow-up…</option>
            {followUps.map(f => (
              <option key={f.id} value={f.id}>
                {f.patient.name} · {f.code}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-50 min-h-screen overflow-x-hidden relative">
      {/* 1. TOP HEADER BAR: Back Arrow & Follow-up Details Breadcrumb & User Profile */}
      <header className="h-16 bg-white border-b border-slate-200/90 px-6 sm:px-8 flex items-center justify-between shrink-0 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                Follow-up
              </h1>
              {followUps.length > 1 && (
                <select
                  value={followUp.id}
                  onChange={e => selectFollowUp(e.target.value)}
                  className="text-[11px] border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 cursor-pointer"
                  aria-label="Select follow-up"
                >
                  {followUps.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.patient.name} · {f.code}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        {/* Right User Profile Pill (signed-in practitioner) */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 pl-2 py-1 pr-1 bg-white hover:bg-slate-50 rounded-full border border-slate-200/80 transition-colors cursor-pointer shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
            <span className="text-xs font-semibold text-slate-800 hidden sm:inline">
              {followUp.practitioner.name}
            </span>
            <div className="w-7 h-7 rounded-full bg-teal-800 text-white font-bold text-xs flex items-center justify-center shadow-xs">
              {followUp.practitioner.initials}
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
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                      followUp.status === 'Closed'
                        ? 'text-slate-600 bg-slate-100 border-slate-200'
                        : followUp.status === 'Pending'
                          ? 'text-amber-700 bg-amber-50 border-amber-200'
                          : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    }`}
                  >
                    {followUp.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {followUp.createdDate}
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

                {followUp.status === 'Closed' ? (
                  <button
                    onClick={handleReopenFollowUp}
                    disabled={isUpdatingFollowUp}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-2xs transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                    <span>Reopen</span>
                  </button>
                ) : (
                  <button
                    onClick={handleCloseFollowUp}
                    disabled={isUpdatingFollowUp}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50/50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg border border-rose-200 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <X className="w-3.5 h-3.5 text-rose-600" />
                    <span>Close</span>
                  </button>
                )}
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
                Appointments ({visibleAppointments.length})
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

            {/* Appointment Cards List - rendered from the backend appointments store */}
            <div className="space-y-4 pt-4">
              {visibleAppointments.length === 0 ? (
                <p className="text-xs text-slate-400">No appointments.</p>
              ) : (
                visibleAppointments.map(apt => {
                  const [, month, day] = apt.date.split('-');
                  const isPast = apt.status === 'completed' || apt.status === 'cancelled';
                  return (
                    <div
                      key={apt.id}
                      className="p-4 sm:p-5 rounded-xl border border-slate-200/90 hover:border-teal-300 transition-colors bg-white"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        {/* Left: Date Badge + Title + Schedule */}
                        <div className="flex items-start gap-4">
                          <div className="w-13 h-13 rounded-xl bg-slate-100 flex flex-col items-center justify-center shrink-0 border border-slate-200/60 text-slate-800">
                            <span className="text-lg font-black leading-none">{day}</span>
                            <span className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">
                              {MONTH_ABBR[Number(month) - 1] ?? ''}
                            </span>
                          </div>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-bold text-sm text-slate-900">{apt.reasonForVisit}</h4>
                              <span className="text-[10px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200/80 flex items-center gap-1">
                                <Video className="w-2.5 h-2.5 text-teal-700" />
                                <span>Video</span>
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 font-medium">
                              {friendlyDate(apt.date)} — {apt.time}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {apt.date} · {apt.time}
                            </p>
                          </div>
                        </div>

                        {/* Right: status pill (past) or join control (upcoming) */}
                        <div className="shrink-0 flex items-center gap-2">
                          {isPast ? (
                            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                              {apt.status === 'cancelled' ? 'Cancelled' : 'Completed'}
                            </span>
                          ) : (
                            <button
                              onClick={() => startConsultation(apt)}
                              className="px-3.5 py-1.5 bg-teal-800 hover:bg-teal-900 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
                            >
                              <Video className="w-3.5 h-3.5" />
                              <span>
                                {activeConsultation?.id === apt.id ? 'In Call' : 'Join'}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Participants row */}
                      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs">
                        <span className="text-[11px] font-bold text-slate-400 uppercase">
                          With:
                        </span>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-slate-700 text-white text-[9px] font-bold flex items-center justify-center">
                            {initialsOf(apt.patientName)}
                          </div>
                          <span className="font-semibold text-slate-800">{apt.patientName}</span>
                          <span className="text-[10px] text-slate-400">(Patient)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-teal-800 text-white text-[9px] font-bold flex items-center justify-center">
                            {initialsOf(apt.providerName)}
                          </div>
                          <span className="font-semibold text-slate-800">{apt.providerName}</span>
                          <span className="text-[10px] text-slate-400">(Practitioner)</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
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
                {participantCount} participant{participantCount === 1 ? '' : 's'}
              </span>
            </div>

            {/* Messages Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3.5 text-xs">
              {chatMessages.length > visibleMessages.length && (
                <p className="text-center text-[10px] text-slate-400 font-mono">
                  {visibleMessages.length} of {chatMessages.length}
                </p>
              )}
              {/* Chat bubbles */}
              {visibleMessages.map(msg => (
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
                    <p>{msg.text}</p>
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
                placeholder="Message…"
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

    </div>
  );
};
