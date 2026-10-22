import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  Video,
  User,
  CheckCircle2,
  AlertCircle,
  Plus,
  Stethoscope,
  Filter,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { Appointment } from '../../types';
import { PatientChartPicker } from '../clinician/PatientChartPicker';

export const AppointmentsView: React.FC = () => {
  const {
    role,
    patient,
    appointments,
    startConsultation,
    bookAppointment,
    checkInAppointment,
    cancelAppointment,
    providers,
  } = useMedZone();

  const [filterStatus, setFilterStatus] = useState<'all' | 'scheduled' | 'completed'>('all');
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  // Modal form — blank by default; adopt the first backend provider on load.
  const [selectedProvId, setSelectedProvId] = useState('');
  const [bookDate, setBookDate] = useState('');
  const [bookTime, setBookTime] = useState('');
  const [bookType, setBookType] = useState<Appointment['type']>('Virtual Consultation');
  const [bookReason, setBookReason] = useState('');

  useEffect(() => {
    if (!selectedProvId && providers.length > 0) setSelectedProvId(providers[0].id);
  }, [selectedProvId, providers]);

  const filteredAppointments = useMemo(
    () => appointments.filter(a => {
      if (filterStatus === 'all') return true;
      return a.status === filterStatus;
    }),
    [appointments, filterStatus]
  );

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvId || !bookDate || !bookTime || !bookReason.trim()) return;
    // The form stays open on refusal so the operator can retry.
    const booked = await bookAppointment(selectedProvId, bookDate, bookTime, bookType, bookReason);
    if (!booked) return;
    setShowScheduleModal(false);
    setBookReason('');
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Quiet minimal header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="mz-h1">Schedule</h1>
          <p className="mz-sub mt-1">Upcoming visits, all in one calm list.</p>
        </div>

        <div className="flex items-center gap-2">
          <PatientChartPicker />
          {/* Quiet filter */}
          <div className="flex items-center p-1 bg-white border border-[#e8eef0] rounded-full text-xs">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-1 font-semibold rounded-full transition-colors cursor-pointer ${
                filterStatus === 'all' ? 'bg-[#16232b] text-white' : 'text-[#7b8a94]'
              }`}
            >
              All ({appointments.length})
            </button>
            <button
              onClick={() => setFilterStatus('scheduled')}
              className={`px-3 py-1 font-semibold rounded-full transition-colors cursor-pointer ${
                filterStatus === 'scheduled' ? 'bg-[#16232b] text-white' : 'text-[#7b8a94]'
              }`}
            >
              Upcoming
            </button>
            <button
              onClick={() => setFilterStatus('completed')}
              className={`px-3 py-1 font-semibold rounded-full transition-colors cursor-pointer ${
                filterStatus === 'completed' ? 'bg-[#16232b] text-white' : 'text-[#7b8a94]'
              }`}
            >
              Completed
            </button>
          </div>

          <button
            onClick={() => setShowScheduleModal(true)}
            className="mz-btn-primary !py-2 !text-xs flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Book Visit</span>
          </button>
        </div>
      </div>

      {/* Appointments List */}
      {filteredAppointments.length === 0 && (
        <p className="text-xs text-slate-400 bg-white rounded-2xl border border-slate-200/90 p-6 text-center">
          No visits.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredAppointments.map(apt => (
          <div
            key={apt.id}
            className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <img
                    src={apt.providerAvatar}
                    alt={apt.providerName}
                    className="w-12 h-12 rounded-xl object-cover ring-1 ring-slate-200"
                  />
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">{apt.providerName}</h3>
                    <p className="text-xs text-slate-500">{apt.providerSpecialty}</p>
                    <p className="text-[10px] text-teal-700 font-medium">{apt.type}</p>
                  </div>
                </div>

                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                    apt.status === 'scheduled'
                      ? 'bg-teal-50 text-teal-800 border border-teal-200'
                      : apt.status === 'in-progress'
                        ? 'bg-emerald-600 text-white border border-emerald-600'
                        : apt.status === 'cancelled'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {apt.status === 'in-progress' ? 'waiting' : apt.status}
                </span>
              </div>

              <div className="mt-4 p-3 bg-slate-50 rounded-xl space-y-1.5 text-xs text-slate-600">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 font-medium text-slate-800">
                    <Calendar className="w-3.5 h-3.5 text-teal-600" />
                    {apt.date}
                  </span>
                  <span className="flex items-center gap-1 font-mono font-bold text-slate-900">
                    <Clock className="w-3.5 h-3.5 text-teal-600" />
                    {apt.time}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                  {apt.patientName} ({apt.patientMrn})
                </p>
                <p className="text-[11px] text-slate-500">
                  {apt.reasonForVisit}
                </p>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-[10px] font-mono text-slate-400">Room: {apt.roomCode}</span>
              {apt.status === 'scheduled' || apt.status === 'in-progress' ? (
                <div className="flex items-center gap-2">
                  {apt.status === 'scheduled' && role === 'patient' && (
                    <button
                      onClick={() => void checkInAppointment(apt.id)}
                      className="px-3 py-2 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs rounded-lg transition-colors cursor-pointer"
                    >
                      Check In
                    </button>
                  )}
                  {(apt.status === 'scheduled' || apt.status === 'in-progress') && (
                    <button
                      onClick={() => void cancelAppointment(apt.id)}
                      className="px-2 py-2 text-slate-400 hover:text-rose-600 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={() => startConsultation(apt)}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>Join</span>
                  </button>
                </div>
              ) : apt.status === 'cancelled' ? (
                <span className="text-[11px] text-rose-500 font-semibold">Cancelled</span>
              ) : (
                <span className="text-[11px] text-slate-500 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Done
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Book Visit Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="font-bold text-base text-slate-900">Book Visit</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {patient.id ? `Booking for ${patient.name} (${patient.mrn})` : 'Select a patient chart first.'}
                </p>
              </div>
              <button
                onClick={() => setShowScheduleModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAppointment} className="space-y-4 text-xs">
              <div>
                  <label className="block font-semibold text-slate-700 mb-1">Clinician</label>
                <select
                  value={selectedProvId}
                  onChange={e => setSelectedProvId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:border-teal-600"
                >
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.specialty} ({p.consultationFee > 0 ? `$${p.consultationFee}` : 'Free'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={bookDate}
                    onChange={e => setBookDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Time</label>
                  <input
                    type="text"
                    required
                    value={bookTime}
                    onChange={e => setBookTime(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 font-mono"
                  />
                </div>
              </div>

              <div>
                  <label className="block font-semibold text-slate-700 mb-1">Reason</label>
                <textarea
                  rows={3}
                  required
                  value={bookReason}
                  onChange={e => setBookReason(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 resize-none"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg cursor-pointer shadow-xs"
                >
                  Confirm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
