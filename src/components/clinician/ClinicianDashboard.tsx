import React, { useEffect, useState } from 'react';
import {
  Video,
  FileText,
  Pill,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  UserCheck,
  Search,
  Plus,
  FileCode2,
  Calendar,
  Sparkles,
  Link2,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { useLanguage } from '../../context/LanguageContext';
import { Appointment, Prescription } from '../../types';
import { MinimalHeader } from '../layout/Minimal';
import { EmptyState, MinimalCard, OutlineButton } from '../layout/MinimalParts';
import { PatientInviteModal } from '../consultation/PatientInviteModal';
import { PatientChartPicker } from './PatientChartPicker';

export const ClinicianDashboard: React.FC = () => {
  const {
    patient,
    patients,
    selectPatient,
    appointments,
    prescriptions,
    startConsultation,
    issuePrescription,
    setShowFhirModal,
    setShowComplianceModal,
    setShowSummaryExportModal,
    waitingRoom: clinicWaitingRoom,
    refreshWaitingRoom,
    claimWaitingVisit,
  } = useMedZone();
  const { t } = useLanguage();
  const chartPrescriptions = prescriptions.filter(rx => rx.patientId === patient.id);

  // Patient invitation link dialog (HCW@Home parity).
  const [inviteTarget, setInviteTarget] = useState<Appointment | null>(null);

  // The shared, clinic-wide queue: poll it while the station is open so a
  // patient who checks in with any doctor appears for whoever is free.
  // Jittered so 50 open stations do not pulse the endpoint together.
  useEffect(() => {
    void refreshWaitingRoom();
    const intervalMs = 15000 + Math.floor(Math.random() * 5000);
    const timer = setInterval(() => void refreshWaitingRoom(), intervalMs);
    return () => clearInterval(timer);
  }, [refreshWaitingRoom]);

  // Active EHR Tab in clinician station
  const [activeEhrTab, setActiveEhrTab] = useState<'overview' | 'labs' | 'meds' | 'diagnoses'>('overview');
  const [showIssueRxModal, setShowIssueRxModal] = useState(false);

  // E-Rx Form
  const [medName, setMedName] = useState('');
  const [dosage, setDosage] = useState('');
  const [route, setRoute] = useState<Prescription['route']>('Oral');
  const [freq, setFreq] = useState('Once daily');
  const [qty, setQty] = useState(30);
  const [refills, setRefills] = useState(2);
  const [instructions, setInstructions] = useState('');
  const [pharmacy, setPharmacy] = useState('Walgreens Pharmacy #4190 (Mission St, SF)');
  const [allergyWarning, setAllergyWarning] = useState<string | null>(null);

  // Check drug allergy automatically
  const handleMedNameChange = (val: string) => {
    setMedName(val);
    const lower = val.toLowerCase();
    const hasPenicillinAllergy = patient.allergies.some(a =>
      a.substance.toLowerCase().includes('penicillin') || a.substance.toLowerCase().includes('amoxicillin')
    );

    if (hasPenicillinAllergy && (lower.includes('penicillin') || lower.includes('amox') || lower.includes('ampicillin'))) {
      setAllergyWarning(`CRITICAL ALLERGY ALERT: Patient has documented severe allergy to ${val} (${patient.allergies[0].reaction}).`);
    } else {
      setAllergyWarning(null);
    }
  };

  const handleIssueRxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The form stays open on refusal so the prescriber can retry.
    const issued = await issuePrescription(medName, dosage, route, freq, Number(qty), Number(refills), instructions, pharmacy);
    if (!issued) return;
    setShowIssueRxModal(false);
    setMedName('');
    setDosage('');
    setInstructions('');
  };

  // Visit queue split by status: checked-in patients are the waiting room.
  const waitingRoom = appointments.filter(a => a.status === 'in-progress');
  const scheduledQueue = appointments.filter(a => a.status === 'scheduled');

  return (
    <div className="mz-page">
      <MinimalHeader
        title="Clinician station"
        subtitle="Today's visits at a glance"
        actions={
          <>
            <PatientChartPicker />
            <button
              onClick={() => setShowIssueRxModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#0e8aa0] hover:bg-[#0b6e81] text-white rounded-xl text-[12.5px] font-semibold shadow-[0_4px_14px_rgba(14,138,160,0.35)] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New e-prescription</span>
            </button>
            <button
              onClick={() => setShowFhirModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-[#eef7f8] text-[#0e7d90] rounded-xl text-[12.5px] font-semibold border border-[#cfe6ea] transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileCode2 className="w-4 h-4" />
              <span className="hidden sm:inline">FHIR / HL7</span>
            </button>
          </>
        }
      />

      <MinimalCard
        title={t('waiting.title')}
        subtitle={`${clinicWaitingRoom.length} waiting · ${scheduledQueue.length} scheduled · shared across the clinic`}
        icon={<Video className="h-[18px] w-[18px]" strokeWidth={1.8} />}
      >
        {clinicWaitingRoom.length === 0 ? (
          <EmptyState
            icon={<Video className="w-7 h-7" strokeWidth={1.5} />}
            title={t('waiting.empty')}
            hint="Checked-in patients appear here with their room code."
          />
        ) : (
          <ul className="divide-y divide-[#eef3f4]">
            {clinicWaitingRoom.map(apt => (
              <li key={apt.id} className="px-6 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#16232b] truncate">
                    {apt.patientName}
                  </p>
                  <p className="text-[12.5px] text-[#7b8a94] truncate">
                    {apt.type} · room {apt.roomCode} · {apt.time} · {apt.providerName}
                  </p>
                  {apt.claimedBy && (
                    <p className="text-[11.5px] text-teal-700 truncate">
                      {t('waiting.claimedBy')} {apt.claimedBy}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!apt.claimedBy && (
                    <button
                      onClick={() => void claimWaitingVisit(apt.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-[#cfe6ea] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#0e7d90] hover:bg-[#eef7f8] cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      {t('waiting.claim')}
                    </button>
                  )}
                  <OutlineButton label="Start visit" onClick={() => startConsultation(apt)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </MinimalCard>

      {/* Main Grid: Triage Queue & Patient Chart (High Density) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Today's Consultation Queue (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-teal-700" />
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                Today's Virtual Appointment Queue
              </h2>
            </div>
            <span className="text-xs font-semibold font-mono text-slate-500">
              {appointments.length} scheduled
            </span>
          </div>

          <div className="space-y-3">
            {appointments.map(apt => (
              <div
                key={apt.id}
                onClick={() => selectPatient(apt.patientId)}
                className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs hover:border-teal-400 transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{apt.patientName}</span>
                      <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        {apt.patientMrn}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {apt.patientGender} · Age {apt.patientAge} · Blood{' '}
                      {patients.find(p => p.id === apt.patientId)?.bloodType ?? '—'}
                    </p>
                  </div>

                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                      apt.triagePriority === 'priority'
                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {apt.triagePriority}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-3 text-xs text-slate-600 font-medium">
                  <span className="flex items-center gap-1 font-mono text-slate-800">
                    <Clock className="w-3.5 h-3.5 text-teal-600" />
                    {apt.time} ({apt.date})
                  </span>
                  <span>·</span>
                  <span className="text-teal-700">{apt.type}</span>
                </div>

                <p className="text-xs text-slate-600 mt-2 bg-slate-50 p-2 rounded-lg">
                  <span className="font-semibold text-slate-700">Chief Complaint: </span>
                  {apt.reasonForVisit}
                </p>

                {/* Launch Button */}
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-400">Room: {apt.roomCode}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setInviteTarget(apt)}
                      className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-lg border border-slate-200 flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Link2 className="w-3.5 h-3.5 text-teal-700" />
                      <span>Invite</span>
                    </button>
                    <button
                      onClick={() => startConsultation(apt)}
                      className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>Launch Tele-Visit</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Longitudinal Patient Health Record (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
            {/* Patient Header Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <img
                  src={patient.avatarUrl}
                  alt={patient.name}
                  className="w-12 h-12 rounded-xl object-cover ring-1 ring-slate-200"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-base">{patient.name}</h3>
                    <span className="text-xs font-mono text-teal-800 bg-teal-50 px-2 py-0.5 rounded font-semibold">
                      {patient.mrn}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    DOB: {patient.dob} ({patient.age}y) · {patient.gender} · {patient.phone}
                  </p>
                </div>
              </div>

              {/* Quick Summary Action */}
              <button
                onClick={() => setShowSummaryExportModal(true)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Print Clinical Summary
              </button>
            </div>

            {/* Documented Allergies Critical Box */}
            <div className="mt-4 p-3 bg-rose-50/70 border border-rose-200 rounded-xl">
              <div className="flex items-center gap-2 mb-1.5 text-rose-800 font-bold text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Documented Clinical Allergies (Adverse Drug Reactions)</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {patient.allergies.map((alg, i) => (
                  <span
                    key={i}
                    className="bg-white text-rose-900 border border-rose-200 px-2.5 py-1 rounded-md font-medium"
                  >
                    <span className="font-bold">{alg.substance}:</span> {alg.reaction} (
                    <span className="uppercase text-[10px] text-rose-600 font-semibold">{alg.severity}</span>)
                  </span>
                ))}
              </div>
            </div>

            {/* EHR Tabs Bar */}
            <div className="flex items-center gap-2 mt-5 border-b border-slate-200 pb-2">
              <button
                onClick={() => setActiveEhrTab('overview')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  activeEhrTab === 'overview'
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Overview &amp; Vitals
              </button>
              <button
                onClick={() => setActiveEhrTab('labs')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  activeEhrTab === 'labs'
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Diagnostic Labs ({patient.recentLabs.length})
              </button>
              <button
                onClick={() => setActiveEhrTab('meds')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  activeEhrTab === 'meds'
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Medications ({chartPrescriptions.length})
              </button>
              <button
                onClick={() => setActiveEhrTab('diagnoses')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  activeEhrTab === 'diagnoses'
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ICD-10 Problems
              </button>
            </div>

            {/* Tab 1: Overview & Vitals */}
            {activeEhrTab === 'overview' && (
              <div className="pt-4 space-y-4 text-xs">
                <div>
                  <h4 className="font-bold text-slate-800 mb-2">Longitudinal Vitals Log</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 font-sans text-[11px]">
                          <th className="py-2">Recorded At</th>
                          <th>BP (mmHg)</th>
                          <th>HR (bpm)</th>
                          <th>SpO2</th>
                          <th>Temp</th>
                          <th>Resp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {patient.vitalsHistory.map((vit, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-2 font-sans text-slate-600">
                              {new Date(vit.timestamp).toLocaleDateString()}
                            </td>
                            <td className="font-bold text-slate-900">
                              {vit.systolic}/{vit.diastolic}
                            </td>
                            <td>{vit.heartRate}</td>
                            <td>{vit.spo2}%</td>
                            <td>{vit.temperature}°F</td>
                            <td>{vit.respiratoryRate} rpm</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="pt-2">
                  <h4 className="font-bold text-slate-800 mb-2 font-sans">Insurance &amp; Billing Entity</h4>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between font-sans">
                    <div>
                      <p className="font-bold text-slate-900">{patient.insurance.provider}</p>
                      <p className="text-slate-500 font-mono text-[11px]">
                        Policy: {patient.insurance.policyNumber} · Group: {patient.insurance.groupNumber}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Verified Eligible
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Diagnostic Labs */}
            {activeEhrTab === 'labs' && (
              <div className="pt-4 space-y-3">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-sans text-[11px]">
                      <th className="py-2">Lab Test</th>
                      <th>Category</th>
                      <th>Observed Value</th>
                      <th>Reference Range</th>
                      <th>Result Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {patient.recentLabs.map(lab => (
                      <tr key={lab.id} className="hover:bg-slate-50">
                        <td className="py-2.5 font-bold font-sans text-slate-900">{lab.testName}</td>
                        <td className="font-sans text-slate-500">{lab.category}</td>
                        <td className="font-bold">
                          {lab.value} <span className="text-slate-500 font-normal">{lab.unit}</span>
                        </td>
                        <td className="text-slate-500">{lab.referenceRange}</td>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-sans font-semibold uppercase ${
                              lab.status === 'abnormal'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            {lab.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tab 3: Active Medications */}
            {activeEhrTab === 'meds' && (
              <div className="pt-4 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-500 font-medium">Reconciled Medication Profile</span>
                  <button
                    onClick={() => setShowIssueRxModal(true)}
                    className="text-xs font-bold text-teal-700 hover:text-teal-800 cursor-pointer"
                  >
                    + Add New E-Rx
                  </button>
                </div>
                {chartPrescriptions.map(rx => (
                  <div
                    key={rx.id}
                    className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{rx.medicationName}</span>
                        <span className="text-[10px] font-mono text-teal-700 bg-teal-50 px-1.5 py-0.2 rounded">
                          {rx.dosage} · {rx.route}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{rx.instructions}</p>
                      <p className="text-[10px] text-slate-400 mt-1 font-mono">
                        Prescribed: {rx.prescribedDate} by {rx.prescribingDoctor}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-mono font-bold text-slate-700">
                        {rx.remainingRefills} refills left
                      </span>
                      <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                        {rx.adherencePercentage}% adherence
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tab 4: ICD-10 Problems */}
            {activeEhrTab === 'diagnoses' && (
              <div className="pt-4 space-y-3">
                {patient.conditions.map(cond => (
                  <div
                    key={cond.id}
                    className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{cond.name}</span>
                        <span className="font-mono text-[11px] bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">
                          ICD-10: {cond.icd10}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Recorded Date: {cond.diagnosedDate}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 uppercase">
                      {cond.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Patient invitation link (HCW@Home parity) */}
      <PatientInviteModal
        open={inviteTarget !== null}
        appointment={inviteTarget}
        onClose={() => setInviteTarget(null)}
      />

      {/* E-Prescription Modal */}
      {showIssueRxModal && (
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <Pill className="w-5 h-5 text-teal-700" />
                <h3 className="font-bold text-base text-slate-900">
                  Electronic Prescription Order (Surescripts Gateway)
                </h3>
              </div>
              <button
                onClick={() => setShowIssueRxModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleIssueRxSubmit} className="space-y-4 text-xs">
              {allergyWarning && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-800 font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                  <span>{allergyWarning}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Medication Name (RxNorm)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Amlodipine, Lisinopril..."
                    value={medName}
                    onChange={e => handleMedNameChange(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-teal-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Dosage &amp; Strength</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 5mg, 10mg..."
                    value={dosage}
                    onChange={e => setDosage(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-teal-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Route</label>
                  <select
                    value={route}
                    onChange={e => setRoute(e.target.value as Prescription['route'])}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-teal-600"
                  >
                    <option value="Oral">Oral (PO)</option>
                    <option value="Sublingual">Sublingual (SL)</option>
                    <option value="Inhalation">Inhalation</option>
                    <option value="Topical">Topical</option>
                    <option value="Subcutaneous">Subcutaneous (SC)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Frequency</label>
                  <input
                    type="text"
                    required
                    value={freq}
                    onChange={e => setFreq(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-teal-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Quantity (Units)</label>
                  <input
                    type="number"
                    min="1"
                    value={qty}
                    onChange={e => setQty(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-teal-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Refills Authorized</label>
                  <input
                    type="number"
                    min="0"
                    max="11"
                    value={refills}
                    onChange={e => setRefills(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-teal-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Sig / Patient Directions</label>
                <textarea
                  rows={2}
                  required
                  placeholder="e.g. Take 1 tablet daily in the morning with full glass of water..."
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-teal-600 resize-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Fulfillment Pharmacy</label>
                <input
                  type="text"
                  value={pharmacy}
                  onChange={e => setPharmacy(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-teal-600"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowIssueRxModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Digitally Sign &amp; Authorize</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
