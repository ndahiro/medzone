import React, { useEffect, useState } from 'react';
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
  FileText,
  ShieldCheck,
  ChevronRight,
  BellRing,
  HeartPulse,
  Droplets,
  Stethoscope,
  Info,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { canJoinVisit, JOIN_WINDOW_MINUTES } from '../../lib/visitWindow';
import { Appointment } from '../../types';

export const PatientDashboard: React.FC = () => {
  const { t } = useLanguage();
  const {
    patient,
    appointments,
    prescriptions,
    providers,
    consultantNotes,
    startConsultation,
    bookAppointment,
    checkInAppointment,
    cancelAppointment,
    markDoseTaken,
    requestRefill,
    triggerPushNotification,
    setShowSummaryExportModal,
    setShowFhirModal,
  } = useMedZone();

  // The chart this login is bound to. Null means the clinic has not linked the
  // account yet — the API then returns no chart data at all (fail closed).
  const { user } = useAuth();
  const chartLinked = Boolean(user?.patientId);

  // Booking Modal State
  const [showBookModal, setShowBookModal] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState(providers[0]?.id || '');
  // Blank by default: a booking the patient submits must be their own words and
  // their own date, never a prefilled sample.
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('10:00 AM');
  const [bookingType, setBookingType] = useState<Appointment['type']>('Virtual Consultation');
  const [bookingReason, setBookingReason] = useState('');

  // Admission is time-gated (src/lib/visitWindow.ts): re-evaluate the join
  // buttons on a slow tick so a visit becomes joinable without navigation.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Providers arrive with the backend bootstrap, after this component's first
  // render — adopt the first one once they load so the picker is never left on
  // a stale blank id when the patient opens the booking form.
  useEffect(() => {
    if (!selectedProviderId && providers.length > 0) setSelectedProviderId(providers[0].id);
  }, [selectedProviderId, providers]);

  const selectedProvider = providers.find(p => p.id === selectedProviderId) || providers[0];
  // Checked-in visits stay on the dashboard so the patient can rejoin after a
  // refresh; a room that is merely scheduled is also joinable.
  const upcomingAppointments = appointments.filter(
    a => a.status === 'scheduled' || a.status === 'in-progress'
  );

  // The patient's own chart, exactly as the API returned it: the newest vitals
  // reading (server orders by recorded_at ascending) and the newest lab result
  // (server orders by result_date descending). No fabricated readings — when
  // the chart has none the card says so.
  const latestVitals = patient.vitalsHistory.at(-1) ?? null;
  const latestLab = patient.recentLabs[0] ?? null;
  const labTone =
    latestLab?.status === 'critical'
      ? 'text-rose-600'
      : latestLab?.status === 'abnormal'
        ? 'text-amber-600'
        : 'text-emerald-600';

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // A booking needs a chart to land on. Without one the API refuses the
    // write, so the form never opens for an unlinked login (see chartLinked).
    if (!chartLinked) return;
    // Refused bookings leave the form open for a retry.
    const booked = await bookAppointment(selectedProviderId, bookingDate, bookingTime, bookingType, bookingReason);
    if (!booked) return;
    setShowBookModal(false);
  };

  // Booking requires a chart the visit can land on; an unlinked login gets the
  // explanatory banner above instead of a form whose submit the API refuses.
  const openBookModal = () => {
    if (!chartLinked) return;
    setShowBookModal(true);
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
      {/* An account with no chart binding receives no clinical data from the
          API, so say why instead of showing a silently empty portal. */}
      {!chartLinked && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-xs text-amber-900">
          <p className="font-semibold">No medical record is linked to this login.</p>
          <p className="mt-1 leading-relaxed">
            Your account is not bound to a patient chart, so visits, medications and results
            cannot be shown. Ask the clinic to link your record to your login.
          </p>
        </div>
      )}

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
                  {t('portal.welcome')}, {patient.name}
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
                  {t('portal.hipaa')}
                </span>
                <span>·</span>
                <span>Tele-health visits with your care team</span>
              </div>
            </div>
          </div>

          {/* Quick Actions Header CTAs */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={openBookModal}
              disabled={!chartLinked}
              title={chartLinked ? undefined : 'No patient chart is linked to this login'}
              className="flex items-center gap-2 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-xs hover:shadow-md transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>{t('portal.book')}</span>
            </button>
            <button
              onClick={() => setShowSummaryExportModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold border border-slate-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileDown className="w-4 h-4 text-slate-600" />
              <span>{t('portal.export')}</span>
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
                {t('portal.upcoming')}
              </h2>
            </div>
            <button
              onClick={openBookModal}
              disabled={!chartLinked}
              className="text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:text-slate-300 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1"
            >
              <span>+ New Visit</span>
            </button>
          </div>

          {upcomingAppointments.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-8 text-center">
              <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-700">{t('portal.noUpcoming')}</p>
              <p className="text-xs text-slate-500 mt-1">
                {t('portal.noUpcomingHint')}
              </p>
              <button
                onClick={openBookModal}
                disabled={!chartLinked}
                className="mt-4 px-4 py-2 bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                {t('portal.schedule')}
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

                    {/* Visit actions: check in, start or rejoin, cancel */}
                    <div className="flex sm:flex-col items-stretch sm:items-end justify-between shrink-0 gap-2">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded border text-center ${
                          apt.status === 'in-progress'
                            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                            : 'text-teal-800 bg-teal-50 border-teal-200'
                        }`}
                      >
                        {apt.status === 'in-progress' ? 'Checked in' : 'Scheduled'}
                      </span>
                      {apt.status === 'scheduled' && (
                        <button
                          onClick={() => void checkInAppointment(apt.id)}
                          className="w-full sm:w-auto px-4 py-2 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs rounded-xl border border-teal-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Check in</span>
                        </button>
                      )}
                      <button
                        onClick={() => void startConsultation(apt)}
                        disabled={!canJoinVisit(apt, now)}
                        className={`w-full sm:w-auto px-5 py-2.5 font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 ${
                          canJoinVisit(apt, now)
                            ? 'bg-emerald-700 hover:bg-emerald-800 hover:shadow-md text-white cursor-pointer'
                            : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        <Video className="w-4 h-4" />
                        <span>{apt.status === 'in-progress' ? 'Rejoin visit' : t('portal.join')}</span>
                      </button>
                      {!canJoinVisit(apt, now) && (
                        <span className="text-[10px] text-slate-400 font-medium text-center">
                          Opens {JOIN_WINDOW_MINUTES} minutes before the start
                        </span>
                      )}
                      <button
                        onClick={() => void cancelAppointment(apt.id)}
                        className="text-[10px] text-slate-400 hover:text-rose-600 font-semibold cursor-pointer"
                      >
                        Cancel visit
                      </button>
                    </div>
                  </div>

                  {apt.reasonForVisit && (
                    <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 bg-slate-50/50 p-2.5 rounded-lg">
                      <span className="font-semibold text-slate-700">{t('portal.reason')}: </span>
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
                <h3 className="font-bold text-slate-900 text-sm">{t('portal.vitals')}</h3>
              </div>
              <button
                onClick={() => setShowFhirModal(true)}
                className="text-xs text-teal-700 hover:text-teal-800 font-medium cursor-pointer"
              >
                Inspect FHIR Observations →
              </button>
            </div>

            {latestVitals || latestLab ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {latestVitals && (
                  <>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                        <HeartPulse className="w-3.5 h-3.5 text-rose-500" />
                        <span>Heart Rate</span>
                      </div>
                      <p className="text-xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                        {latestVitals.heartRate} <span className="text-xs font-normal text-slate-500">bpm</span>
                      </p>
                      <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                        {latestVitals.respiratoryRate} breaths/min
                      </p>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                        <Activity className="w-3.5 h-3.5 text-cyan-600" />
                        <span>Blood Pressure</span>
                      </div>
                      <p className="text-xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                        {latestVitals.systolic}/{latestVitals.diastolic}{' '}
                        <span className="text-xs font-normal text-slate-500">mmHg</span>
                      </p>
                      <p className="text-[10px] text-teal-700 font-medium mt-0.5">
                        {new Date(latestVitals.timestamp).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                        <Droplets className="w-3.5 h-3.5 text-teal-600" />
                        <span>Oxygen (SpO2)</span>
                      </div>
                      <p className="text-xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                        {latestVitals.spo2}% <span className="text-xs font-normal text-slate-500">room air</span>
                      </p>
                      <p className="text-[10px] text-emerald-600 font-medium mt-0.5">
                        {latestVitals.temperature}&deg;F</p>
                    </div>
                  </>
                )}

                {latestLab && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                      <Droplets className="w-3.5 h-3.5 text-amber-600" />
                      <span className="truncate">{latestLab.testName}</span>
                    </div>
                    <p className="text-xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                      {latestLab.value}{' '}
                      <span className="text-xs font-normal text-slate-500">{latestLab.unit}</span>
                    </p>
                    <p className={`text-[10px] font-medium mt-0.5 ${labTone}`}>
                      ● {latestLab.status} · ref {latestLab.referenceRange}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                No vitals or lab results are recorded on your chart yet.
              </p>
            )}
          </div>
        </div>

        {/* Right Column: Active Prescriptions & Push Reminders (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pill className="w-5 h-5 text-teal-700" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                {t('portal.meds')}
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
                    onClick={() => void markDoseTaken(rx.id)}
                    className="flex-1 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                    <span>{t('portal.logDose')}</span>
                  </button>

                  <button
                    onClick={() => void requestRefill(rx.id)}
                    disabled={rx.status === 'refill-requested'}
                    className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3 text-slate-500" />
                    <span>{t('portal.refill')}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Clinician-authored care notes for this chart (read-only). */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-teal-700" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Care notes</h2>
            </div>
            {consultantNotes.length === 0 ? (
              <p className="text-xs text-slate-500">
                No care notes have been shared with you yet. Notes written by your care team
                during a visit appear here.
              </p>
            ) : (
              <div className="space-y-3">
                {consultantNotes.map(note => (
                  <div key={note.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">{note.title}</p>
                      <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                        {new Date(note.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {note.authorName} · {note.authorRole}
                    </p>
                    <p className="text-xs text-slate-700 mt-2 whitespace-pre-line leading-relaxed">
                      {note.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
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
                  notifications for visits and medications.
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
                        <span className="font-bold text-emerald-700 text-sm">
                          {prov.consultationFee > 0 ? `$${prov.consultationFee}` : 'Free'}
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
                  {(selectedProvider?.availableTimes ?? []).map(t => (
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
