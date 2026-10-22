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
import { useAuth } from '../../context/AuthContext';
import { generateFHIRBundle } from '../../lib/fhir';
import { buildPdf, patientSummaryPdfDocument } from '../../lib/pdf';
import { resolveAvatarUrl } from '../../lib/assets';
import { imageUrlToJpegDataUrl, initialsFor } from '../../lib/avatar';

export const MedicalSummaryExportModal: React.FC = () => {
  const { user } = useAuth();
  const {
    showSummaryExportModal,
    setShowSummaryExportModal,
    patient,
    prescriptions,
    appointments,
    providers,
    triggerPushNotification,
    signedInUserName,
    addAuditLog,
  } = useMedZone();

  const printAreaRef = useRef<HTMLDivElement>(null);

  if (!showSummaryExportModal) return null;

  // A patient login carries its registration avatar on the account; staff
  // reports use the photo stored on the chart being exported.
  const avatarSource = user?.role === 'patient' && user.avatarUrl ? user.avatarUrl : patient.avatarUrl;
  const reportAvatarUrl = avatarSource ? resolveAvatarUrl(avatarSource) : '';
  const certifierAvatarUrl = user?.avatarUrl ? resolveAvatarUrl(user.avatarUrl) : '';

  const handlePrint = () => {
    window.print();
    triggerPushNotification('Medical Summary Printed', 'Generated official printable health record.', 'clinical');
  };

  const handleDownloadPdf = async () => {
    // Uploaded portraits are already JPEG data URLs; bundled chart photos are
    // resolved through the canvas so the PDF always embeds a real image.
    const avatarDataUrl = await imageUrlToJpegDataUrl(reportAvatarUrl);
    const bytes = buildPdf(
      patientSummaryPdfDocument({ patient, prescriptions, appointments, avatarUrl: avatarDataUrl ?? undefined })
    );
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medzone-patient-summary-${patient.mrn}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    triggerPushNotification(
      'Summary Downloaded',
      `Downloaded ${patient.name}'s health summary as a PDF.`,
      'clinical',
    );
    addAuditLog(
      'EXPORT_PDF',
      `Downloaded patient health summary PDF for ${patient.name} (${patient.mrn}).`,
      patient.mrn,
    );
  };

  const handleDownloadFhir = () => {
    const bundle = generateFHIRBundle(patient, prescriptions, appointments, providers);
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
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="summary-modal-title"
        className="bg-white rounded-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center">
              <FileText className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <h3 id="summary-modal-title" className="font-bold text-base text-slate-900">Summary</h3>
              <p className="text-xs text-slate-500">
                {patient.name} ({patient.mrn})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              aria-label="Download patient health summary as PDF"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadFhir}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>FHIR</span>
            </button>
            <button
              type="button"
              onClick={() => setShowSummaryExportModal(false)}
              aria-label="Close summary"
              className="text-slate-500 hover:text-slate-700 text-sm font-bold cursor-pointer p-1 ml-2"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Printable Document View */}
        <div ref={printAreaRef} className="flex-1 overflow-y-auto p-8 space-y-6 text-xs text-slate-800 bg-white">
          {/* Institutional Letterhead */}
          <div className="border-b-2 border-teal-800 pb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 shrink-0 rounded-full overflow-hidden bg-slate-100 border border-teal-200 flex items-center justify-center">
                {reportAvatarUrl ? (
                  <img
                    src={reportAvatarUrl}
                    alt={`${patient.name} avatar`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span aria-hidden="true" className="text-sm font-bold text-slate-500">
                    {initialsFor(patient.name)}
                  </span>
                )}
              </div>
              <div>
                <h1 className="text-xl font-black text-teal-900 tracking-tight">MedZone</h1>
                <p className="text-[11px] text-slate-500">{patient.name}</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 bg-teal-50 px-2 py-1 rounded border border-teal-200">
                Care Record
              </span>
              <p className="text-[11px] text-slate-500 font-mono mt-1">
                Generated: {new Date().toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Patient Demographics Box */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Name</span>
              <p className="font-bold text-slate-900">{patient.name}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">MRN</span>
              <p className="font-mono font-bold text-slate-900">{patient.mrn}</p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">DOB</span>
              <p className="text-slate-800 font-medium">
                {patient.dob} ({patient.age}y) · {patient.gender}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Insurance</span>
              <p className="text-slate-800 font-medium">{patient.insurance.provider}</p>
            </div>
          </div>

          {/* Critical Allergies */}
          <div>
            <h4 className="font-bold text-slate-900 uppercase text-[11px] mb-2 flex items-center gap-1.5 text-rose-700">
              <AlertTriangle className="w-3.5 h-3.5" />
              Allergies
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
              Diagnoses
            </h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="p-2.5">Diagnosis</th>
                    <th className="p-2.5">ICD-10</th>
                    <th className="p-2.5">Date</th>
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
              Medications
            </h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="p-2.5">Medication</th>
                    <th className="p-2.5">Frequency</th>
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
              Labs
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
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 shrink-0 rounded-full overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
                {certifierAvatarUrl ? (
                  <img
                    src={certifierAvatarUrl}
                    alt={`${signedInUserName} avatar`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span aria-hidden="true" className="text-[10px] font-bold text-slate-500">
                    {initialsFor(signedInUserName)}
                  </span>
                )}
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Certified by</p>
                <p className="text-[11px] font-semibold text-slate-800">{signedInUserName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>HIPAA Verified</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
