import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  Video,
  Pill,
  Activity,
  Plus,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  FileDown,
  ShieldCheck,
  ChevronRight,
  BellRing,
  HeartPulse,
  Droplets,
  Stethoscope,
  Info,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { Appointment } from '../../types';

export const PatientDashboard: React.FC = () => {
  const {
    patient,
    appointments,
    prescriptions,
    providers,
    startConsultation,
    bookAppointment,
    markDoseTaken,
    requestRefill,
    triggerPushNotification,
    setShowSummaryExportModal,
    setShowFhirModal,
  } = useMedZone();

  // Booking Modal State
  const [showBookModal, setShowBookModal] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState(providers[0]?.id || '');
  const [bookingDate, setBookingDate] = useState('2026-10-15');
  const [bookingTime, setBookingTime] = useState('10:00 AM');
  const [bookingType, setBookingType] = useState<Appointment['type']>('Virtual Consultation');
  const [bookingReason, setBookingReason] = useState('Routine health evaluation and medication review');

  const selectedProvider = providers.find(p => p.id === selectedProviderId) || providers[0];
  const upcomingAppointments = appointments.filter(a => a.status === 'scheduled');

  const handleBookingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    bookAppointment(selectedProviderId, bookingDate, bookingTime, bookingType, bookingReason);
    setShowBookModal(false);
  };

  const requestBrowserNotificationPermission = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        triggerPushNotification(
          'Push Notifications Active',
          'You will receive real-time alerts for appointments and prescription dose schedules.',
          'security'
        );
      } else {
        triggerPushNotification(
          'In-App Notifications Active',
          'In-app alerts are active for all medication schedules and visits.',
          'security'
        );
      }
    } else {
      triggerPushNotification(
        'In-App Notifications Active',
        'In-app alerts are active for all medication schedules and visits.',
        'security'
      );
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Patient Welcome Hero Banner */}
      <section className="bg-white rounded-2xl border border-slate-200/90 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4">
            <img
              src={patient.avatarUrl}
              alt={patient.name}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover ring-2 ring-teal-600/30 shadow-md shrink-0"
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  Welcome back, {patient.name}
                </h1>
                <span className="text-xs font-mono bg-teal-50 text-teal-800 px-2 py-0.5 rounded border border-teal-200 font-semibold">
                  {patient.mrn}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                {patient.gender} · Age {patient.age} · Blood {patient.bloodType} · Coverage:{' '}
                <span className="font-medium text-slate-700">{patient.insurance.provider}</span>
              </p>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  HIPAA End-to-End Encrypted Portal
                </span>
                <span>·</span>
                <span>Primary Clinic: San Francisco General Tele-Health</span>
              </div>
            </div>
          </div>

          {/* Quick Actions Header CTAs */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowBookModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold shadow-xs hover:shadow-md transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Book Virtual Consultation</span>
            </button>
            <button
              onClick={() => setShowSummaryExportModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold border border-slate-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileDown className="w-4 h-4 text-slate-600" />
              <span>Export Medical Summary</span>
            </button>
          </div>
        </div>
      </section>

      {/* Main Grid: Consultations & Medications */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Upcoming Virtual Consultations (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Video className="w-5 h-5 text-teal-700" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                Upcoming Virtual Consultations
              </h2>
            </div>
            <button
              onClick={() => setShowBookModal(true)}
              className="text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer flex items-center gap-1"
            >
              <span>+ New Visit</span>
            </button>
          </div>

          {upcomingAppointments.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-8 text-center">
              <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-700">No upcoming consultations</p>
              <p className="text-xs text-slate-500 mt-1">
                Schedule a virtual tele-visit with one of our certified medical specialists.
              </p>
              <button
                onClick={() => setShowBookModal(true)}
                className="mt-4 px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Schedule Appointment
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {upcomingAppointments.map(apt => (
                <div
                  key={apt.id}
                  className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-teal-300 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <img
                        src={apt.providerAvatar}
                        alt={apt.providerName}
                        className="w-13 h-13 rounded-xl object-cover ring-1 ring-slate-200 shrink-0"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">
                            {apt.providerName}
                          </span>
                          <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200/60">
                            {apt.type}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{apt.providerSpecialty}</p>

                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-600 font-medium">
                          <span className="flex items-center gap-1 text-slate-700">
                            <Calendar className="w-3.5 h-3.5 text-teal-600" />
                            {apt.date}
                          </span>
                          <span>·</span>
                          <span className="flex items-center gap-1 text-slate-700 font-mono">
                            <Clock className="w-3.5 h-3.5 text-teal-600" />
                            {apt.time}
                          </span>
                          <span>·</span>
                          <span className="text-[11px] font-mono text-slate-400">
                            Room: {apt.roomCode}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Join Visit CTA */}
                    <div className="flex sm:flex-col items-center sm:items-end justify-between shrink-0 gap-2">
                      <button
                        onClick={() => startConsultation(apt)}
                        className="w-full sm:w-auto px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Video className="w-4 h-4" />
                        <span>Join Video Visit</span>
                      </button>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Session Key Verified
                      </span>
                    </div>
                  </div>

                  {apt.reasonForVisit && (
                    <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 bg-slate-50/50 p-2.5 rounded-lg">
                      <span className="font-semibold text-slate-700">Reason for visit: </span>
                      {apt.reasonForVisit}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Biometrics & Recent Labs Section */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-teal-700" />
                <h3 className="font-bold text-slate-900 text-sm">Recent Vitals &amp; Biometrics</h3>
              </div>
              <button
                onClick={() => setShowFhirModal(true)}
                className="text-xs text-teal-700 hover:text-teal-800 font-medium cursor-pointer"
              >
                Inspect FHIR Observations →
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                  <HeartPulse className="w-3.5 h-3.5 text-rose-500" />
                  <span>Heart Rate</span>
                </div>
                <p className="text-xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                  74 <span className="text-xs font-normal text-slate-500">bpm</span>
                </p>
                <p className="text-[10px] text-emerald-600 font-medium mt-0.5">● Normal Sinus</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                  <Activity className="w-3.5 h-3.5 text-cyan-600" />
                  <span>Blood Pressure</span>
                </div>
                <p className="text-xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                  128/82 <span className="text-xs font-normal text-slate-500">mmHg</span>
                </p>
                <p className="text-[10px] text-slate-500 font-medium mt-0.5">Pre-Hypertensive</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                  <Droplets className="w-3.5 h-3.5 text-teal-600" />
                  <span>Oxygen (SpO2)</span>
                </div>
                <p className="text-xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                  98% <span className="text-xs font-normal text-slate-500">room air</span>
                </p>
                <p className="text-[10px] text-emerald-600 font-medium mt-0.5">● Optimal</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                  <Droplets className="w-3.5 h-3.5 text-amber-600" />
                  <span>HbA1c Lab</span>
                </div>
                <p className="text-xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                  6.4% <span className="text-xs font-normal text-slate-500">glycated</span>
                </p>
                <p className="text-[10px] text-amber-600 font-medium mt-0.5">● Managed T2D</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Active Prescriptions & Push Reminders (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pill className="w-5 h-5 text-teal-700" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                Active Regimens &amp; Refills
              </h2>
            </div>
            <button
              onClick={() => triggerPushNotification('Medication Check', 'Next dose due soon.', 'medication')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 flex items-center gap-1 cursor-pointer"
              title="Test push alert"
            >
              <BellRing className="w-3.5 h-3.5" />
              <span>Test Push</span>
            </button>
          </div>

          {/* Active Medication Cards */}
          <div className="space-y-4">
            {prescriptions.map(rx => (
              <div
                key={rx.id}
                className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">{rx.medicationName}</h3>
                    <p className="text-xs text-slate-600 font-medium mt-0.5">
                      {rx.dosage} · {rx.route} · {rx.frequency}
                    </p>
                  </div>
                  {rx.status === 'refill-requested' ? (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      Refill Pending
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Active
                    </span>
                  )}
                </div>

                {/* Instructions */}
                <p className="text-[11px] text-slate-500 mt-2 bg-slate-50 p-2 rounded-lg">
                  {rx.instructions}
                </p>

                {/* Refills & Dose Status */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-xs">
                  <div>
                    <span className="text-slate-400 text-[11px]">Refills Remaining: </span>
                    <span className="font-bold font-mono text-slate-800">
                      {rx.remainingRefills} / {rx.totalRefills}
                    </span>
                  </div>

                  {/* Adherence Rate */}
                  <div className="text-right">
                    <span className="text-slate-400 text-[11px]">Adherence: </span>
                    <span className="font-bold font-mono text-teal-700">
                      {rx.adherencePercentage}%
                    </span>
                  </div>
                </div>

                {/* Dose Actions */}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => markDoseTaken(rx.id)}
                    className="flex-1 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                    <span>Log Dose Taken</span>
                  </button>

                  <button
                    onClick={() => requestRefill(rx.id)}
                    disabled={rx.status === 'refill-requested'}
                    className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3 text-slate-500" />
                    <span>Refill</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Push Notification & Reminder Enrollment Banner */}
          <div className="bg-gradient-to-br from-teal-900 to-slate-900 text-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-600/30 border border-teal-500/40 flex items-center justify-center shrink-0">
                <BellRing className="w-5 h-5 text-teal-300" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-sm">Automated Push Reminders</h4>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Never miss an appointment or scheduled medication dose. Receive instant browser
                  push notifications and SMS confirmations.
                </p>
                <button
                  onClick={requestBrowserNotificationPermission}
                  className="mt-3 px-3.5 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs rounded-lg transition-colors cursor-pointer"
                >
                  Enable Real-Time Alerts
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Booking Modal */}
      {showBookModal && (
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-teal-700" />
                <h3 className="font-bold text-base text-slate-900">
                  Schedule Virtual Tele-Consultation
                </h3>
              </div>
              <button
                onClick={() => setShowBookModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleBookingSubmit} className="space-y-4 text-xs">
              {/* Select Specialist */}
              <div>
                <label className="block font-semibold text-slate-700 mb-2">
                  Select Certified Medical Specialist
                </label>
                <div className="space-y-2">
                  {providers.map(prov => (
                    <div
                      key={prov.id}
                      onClick={() => setSelectedProviderId(prov.id)}
                      className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                        selectedProviderId === prov.id
                          ? 'border-teal-600 bg-teal-50/50 ring-1 ring-teal-600'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={prov.avatarUrl}
                          alt={prov.name}
                          className="w-11 h-11 rounded-lg object-cover ring-1 ring-slate-200"
                        />
                        <div>
                          <p className="font-bold text-slate-900">{prov.name}</p>
                          <p className="text-[11px] text-slate-500">{prov.specialty}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                            ★ {prov.rating} ({prov.reviewsCount} reviews) · {prov.hospital}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-teal-800 text-sm font-mono">
                          ${prov.consultationFee}
                        </span>
                        <p className="text-[10px] text-slate-400">Covered by Insurance</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Consultation Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Consultation Type
                  </label>
                  <select
                    value={bookingType}
                    onChange={e => setBookingType(e.target.value as Appointment['type'])}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-teal-600"
                  >
                    <option value="Virtual Consultation">Virtual Consultation</option>
                    <option value="Follow-Up">Follow-Up Review</option>
                    <option value="Specialist Review">Specialist Urgent Review</option>
                    <option value="Prescription Refill">Prescription Refill Visit</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={bookingDate}
                    onChange={e => setBookingDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-teal-600"
                  />
                </div>
              </div>

              {/* Time Slots */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Available Slots</label>
                <div className="flex flex-wrap gap-2">
                  {selectedProvider.availableTimes.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setBookingTime(t)}
                      className={`px-3 py-1.5 rounded-lg font-mono text-xs cursor-pointer border ${
                        bookingTime === t
                          ? 'bg-teal-700 text-white border-teal-700 font-bold'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Symptoms / Reason */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Reason for Consultation / Symptoms
                </label>
                <textarea
                  rows={3}
                  required
                  value={bookingReason}
                  onChange={e => setBookingReason(e.target.value)}
                  placeholder="Describe your current symptoms or reason for visit..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-teal-600 resize-none"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBookModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg shadow-sm cursor-pointer"
                >
                  Confirm &amp; Encrypt Appointment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
