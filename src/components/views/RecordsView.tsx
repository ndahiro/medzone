import React from 'react';
import {
  FileText,
  AlertTriangle,
  HeartPulse,
  Pill,
  Download,
  FileCode2,
  ShieldCheck,
  User,
  Activity,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';

export const RecordsView: React.FC = () => {
  const {
    patient,
    prescriptions,
    setShowFhirModal,
    setShowSummaryExportModal,
  } = useMedZone();

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Integrated Electronic Health Record (EHR)
            </h1>
            <span className="text-xs font-mono font-bold bg-teal-50 text-teal-800 px-2 py-0.5 rounded border border-teal-200">
              {patient.mrn}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Official longitudinal clinical record, diagnostic findings, and verified allergy profiles.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFhirModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs cursor-pointer border border-slate-200"
          >
            <FileCode2 className="w-4 h-4 text-teal-700" />
            <span>FHIR R4 Inspector</span>
          </button>
          <button
            onClick={() => setShowSummaryExportModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export Summary</span>
          </button>
        </div>
      </div>

      {/* Allergies Critical Banner */}
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 text-rose-800 font-bold text-sm mb-3">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
          <span>Documented Patient Allergies &amp; Severe Reactions</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {patient.allergies.map((alg, idx) => (
            <div
              key={idx}
              className="bg-white p-3 rounded-xl border border-rose-200 flex items-center justify-between text-xs"
            >
              <div>
                <p className="font-bold text-rose-900">{alg.substance}</p>
                <p className="text-rose-700 text-[11px] mt-0.5">Reaction: {alg.reaction}</p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-100 px-2 py-0.5 rounded">
                {alg.severity}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Grid: Diagnoses & Diagnostic Labs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Conditions */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 text-sm">Chronic Conditions &amp; Diagnoses</h3>
            <span className="text-xs text-slate-400 font-mono">ICD-10-CM</span>
          </div>
          <div className="space-y-2.5">
            {patient.conditions.map(c => (
              <div
                key={c.id}
                className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{c.name}</span>
                    <span className="font-mono text-[10px] bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded">
                      {c.icd10}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Diagnosed: {c.diagnosedDate}</p>
                </div>
                <span className="text-[10px] font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 uppercase">
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Diagnostic Labs */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 text-sm">Recent Diagnostic Laboratory Results</h3>
            <span className="text-xs text-slate-400 font-mono">LOINC Standard</span>
          </div>
          <div className="space-y-2.5">
            {patient.recentLabs.map(lab => (
              <div
                key={lab.id}
                className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs font-mono"
              >
                <div>
                  <p className="font-bold text-slate-900 font-sans">{lab.testName}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {lab.date} · Range: {lab.referenceRange}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900">
                    {lab.value} <span className="text-[11px] font-normal text-slate-500">{lab.unit}</span>
                  </p>
                  <span
                    className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded font-sans ${
                      lab.status === 'abnormal'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {lab.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Longitudinal Vitals Log */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-teal-700" />
            <h3 className="font-bold text-slate-900 text-sm">Longitudinal Clinical Vitals Trend</h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">Biometric Telemetry</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono tabular-nums text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-sans text-[11px]">
                <th className="py-2.5 px-3">Date &amp; Time</th>
                <th className="px-3">Blood Pressure</th>
                <th className="px-3">Heart Rate</th>
                <th className="px-3">Oxygen (SpO2)</th>
                <th className="px-3">Temperature</th>
                <th className="px-3">Respiratory Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {patient.vitalsHistory.map((v, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-sans text-slate-600">
                    {new Date(v.timestamp).toLocaleString()}
                  </td>
                  <td className="px-3 font-bold text-slate-900">
                    {v.systolic}/{v.diastolic} mmHg
                  </td>
                  <td className="px-3">{v.heartRate} bpm</td>
                  <td className="px-3 text-emerald-600 font-bold">{v.spo2}%</td>
                  <td className="px-3">{v.temperature}°F</td>
                  <td className="px-3">{v.respiratoryRate} rpm</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
