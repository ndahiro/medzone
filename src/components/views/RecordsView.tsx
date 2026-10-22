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
import { PatientChartPicker } from '../clinician/PatientChartPicker';

export const RecordsView: React.FC = () => {
  const {
    patient,
    prescriptions,
    setShowFhirModal,
    setShowSummaryExportModal,
  } = useMedZone();

  return (
    <div className="space-y-5 pb-12">
      {/* Quiet minimal header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="mz-h1">
              Health Record
            </h1>
            <span className="text-xs font-mono font-bold bg-[#e9f4f6] text-[#0e8aa0] px-2 py-0.5 rounded-full border border-[#cde7ec]">
              {patient.mrn}
            </span>
          </div>
          <p className="mz-sub mt-1">Conditions, labs, and vitals — calmly in one place.</p>
        </div>

        <div className="flex items-center gap-2">
          <PatientChartPicker />
          <button
            onClick={() => setShowFhirModal(true)}
            className="mz-btn-quiet !py-2 !text-xs flex items-center gap-1.5"
          >
            <FileCode2 className="w-4 h-4 text-[#0e8aa0]" />
            <span>FHIR</span>
          </button>
          <button
            onClick={() => setShowSummaryExportModal(true)}
            className="mz-btn-primary !py-2 !text-xs flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Allergies — soft quiet banner */}
      <div className="mz-card p-5 !border-[#fbe9b7] !bg-[#fffaeb]">
        <div className="flex items-center gap-2 text-rose-800 font-bold text-sm mb-3">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
          <span>Allergies</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {patient.allergies.map((alg, idx) => (
            <div
              key={idx}
              className="bg-white p-3 rounded-xl border border-rose-200 flex items-center justify-between text-xs"
            >
              <div>
                <p className="font-bold text-rose-900">{alg.substance}</p>
                <p className="text-rose-700 text-[11px] mt-0.5">{alg.reaction}</p>
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
            <h3 className="font-bold text-slate-900 text-sm">Conditions</h3>
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
                  <p className="text-[11px] text-slate-500 mt-1">{c.diagnosedDate}</p>
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
            <h3 className="font-bold text-slate-900 text-sm">Labs</h3>
            <span className="text-xs text-slate-400 font-mono">LOINC</span>
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
            <h3 className="font-bold text-slate-900 text-sm">Vitals</h3>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono tabular-nums text-xs">
            <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-sans text-[11px]">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="px-3">BP</th>
                  <th className="px-3">HR</th>
                  <th className="px-3">SpO2</th>
                  <th className="px-3">Temp</th>
                  <th className="px-3">Resp</th>
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
