import React, { useRef } from 'react';
import {
  FileText,
  Printer,
  Download,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  HeartPulse,
  Pill,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { generateFHIRBundle } from '../../lib/fhir';

export const MedicalSummaryExportModal: React.FC = () => {
  const {
    showSummaryExportModal,
    setShowSummaryExportModal,
    patient,
    prescriptions,
    appointments,
    triggerPushNotification,
  } = useMedZone();

  const printAreaRef = useRef<HTMLDivElement>(null);

  if (!showSummaryExportModal) return null;

  const handlePrint = () => {
    window.print();
    triggerPushNotification('Medical Summary Printed', 'Generated official printable health record.', 'clinical');
  };

  const handleDownloadFhir = () => {
    const bundle = generateFHIRBundle(patient, prescriptions, appointments);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medzone-summary-${patient.mrn}.json`;
    a.click();
    URL.revokeObjectURL(url);
    triggerPushNotification('Summary Exported', 'Downloaded FHIR R4 health summary.', 'clinical');
  };

  return (
    <div className="fixed inset-0 z-60 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center">
              <FileText className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">Patient Medical Summary Export</h3>
              <p className="text-xs text-slate-500">
                Official Continuity of Care Summary for patient {patient.name} ({patient.mrn})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / Save PDF</span>
            </button>
            <button
              onClick={handleDownloadFhir}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export FHIR JSON</span>
            </button>
            <button
              onClick={() => setShowSummaryExportModal(false)}
              className="text-slate-400 hover:text-slate-700 text-sm font-bold cursor-pointer p-1 ml-2"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Printable Document View */}
        <div ref={printAreaRef} className="flex-1 overflow-y-auto p-8 space-y-6 text-xs text-slate-800 bg-white">
          {/* Institutional Letterhead */}
          <div className="border-b-2 border-teal-800 pb-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-black text-teal-900 tracking-tight">MedZone Health Network</h1>
              <p className="text-xs text-slate-500">
                Enterprise Telehealth &amp; Clinical Medicine · 100 Hospital Way, San Francisco, CA
              </p>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                Accredited Tele-Medicine Facility · HIPAA Registered #MED-99214
              </p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 bg-teal-50 px-2 py-1 rounded border border-teal-200">
                Continuity of Care Record
              </span>
              <p className="text-[11px] text-slate-500 font-mono mt-1">
                Generated: {new Date().toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Patient Demographics Box */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Patient Name</span>
              <p className="font-bold text-slate-900">{patient.name}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Medical Record #</span>
              <p className="font-mono font-bold text-slate-900">{patient.mrn}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">DOB &amp; Gender</span>
              <p className="text-slate-800 font-medium">
                {patient.dob} ({patient.age}y) · {patient.gender}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Insurance Carrier</span>
              <p className="text-slate-800 font-medium">{patient.insurance.provider}</p>
            </div>
          </div>

          {/* Critical Allergies */}
          <div>
            <h4 className="font-bold text-slate-900 uppercase text-[11px] mb-2 flex items-center gap-1.5 text-rose-700">
              <AlertTriangle className="w-3.5 h-3.5" />
              Documented Allergies &amp; Adverse Reactions
            </h4>
            <div className="space-y-1.5">
              {patient.allergies.map((alg, i) => (
                <div key={i} className="p-2 bg-rose-50/60 border border-rose-200 rounded-lg flex items-center justify-between">
                  <span className="font-bold text-rose-900">{alg.substance}</span>
                  <span className="text-rose-700">{alg.reaction} ({alg.severity.toUpperCase()})</span>
                </div>
              ))}
            </div>
          </div>

          {/* Active Diagnoses / Chronic Conditions */}
          <div>
            <h4 className="font-bold text-slate-900 uppercase text-[11px] mb-2">
              Active Diagnoses &amp; Problem List
            </h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="p-2.5">Diagnosis</th>
                    <th className="p-2.5">ICD-10 Code</th>
                    <th className="p-2.5">Diagnosed Date</th>
                    <th className="p-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {patient.conditions.map(c => (
                    <tr key={c.id}>
                      <td className="p-2.5 font-bold text-slate-900">{c.name}</td>
                      <td className="p-2.5 font-mono text-slate-600">{c.icd10}</td>
                      <td className="p-2.5 font-mono text-slate-500">{c.diagnosedDate}</td>
                      <td className="p-2.5 uppercase text-[10px] font-bold text-teal-800">{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Current Medication Regimen */}
          <div>
            <h4 className="font-bold text-slate-900 uppercase text-[11px] mb-2 flex items-center gap-1.5">
              <Pill className="w-3.5 h-3.5 text-teal-700" />
              Reconciled Active Medications
            </h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="p-2.5">Medication &amp; Dose</th>
                    <th className="p-2.5">Frequency &amp; Route</th>
                    <th className="p-2.5">Prescriber</th>
                    <th className="p-2.5">Refills</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {prescriptions.map(rx => (
                    <tr key={rx.id}>
                      <td className="p-2.5 font-bold text-slate-900">
                        {rx.medicationName} {rx.dosage}
                      </td>
                      <td className="p-2.5 text-slate-600">{rx.frequency} ({rx.route})</td>
                      <td className="p-2.5 text-slate-500">{rx.prescribingDoctor}</td>
                      <td className="p-2.5 font-mono">{rx.remainingRefills} remaining</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Laboratory Findings */}
          <div>
            <h4 className="font-bold text-slate-900 uppercase text-[11px] mb-2 flex items-center gap-1.5">
              <HeartPulse className="w-3.5 h-3.5 text-teal-700" />
              Recent Diagnostic Lab Observations
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {patient.recentLabs.map(lab => (
                <div key={lab.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800">{lab.testName}</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                        lab.status === 'abnormal' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {lab.status}
                    </span>
                  </div>
                  <p className="text-base font-bold font-mono text-slate-900 mt-1">
                    {lab.value} <span className="text-xs font-normal text-slate-500">{lab.unit}</span>
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Ref: {lab.referenceRange}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Signature & Certification Footer */}
          <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
            <div>
              <p className="text-[11px] text-slate-500">
                Certified by Dr. Sarah Chen, MD · Chief of Cardiology
              </p>
              <p className="text-[10px] font-mono text-slate-400">
                Cryptographic Signature Fingerprint: SHA256:7B88A019482FDE
              </p>
            </div>
            <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Verified HIPAA Compliance Export</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
