import React, { useState, useMemo } from 'react';
import {
  FileCode2,
  Download,
  Upload,
  CheckCircle2,
  Copy,
  Layers,
  FileSpreadsheet,
  Check,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { generateFHIRBundle, generateHL7Message } from '../../lib/fhir';
import { validateFhirBundle as apiValidateFhirBundle } from '../../lib/api';
import type { FhirValidationResult } from '../../types';

export const FHIRInteroperabilityModal: React.FC = () => {
  const {
    showFhirModal,
    setShowFhirModal,
    patient,
    prescriptions,
    appointments,
    providers,
    triggerPushNotification,
  } = useMedZone();

  const [activeFormat, setActiveFormat] = useState<'fhir-json' | 'hl7-v2' | 'resources'>('fhir-json');
  const [copied, setCopied] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  // Result of the last server-side validation. Null means "not validated (or
  // not yet)" — the UI never claims a validity the API did not return.
  const [validation, setValidation] = useState<FhirValidationResult | null>(null);

  const fhirBundle = useMemo(
    () => generateFHIRBundle(patient, prescriptions, appointments, providers),
    [patient, prescriptions, appointments, providers]
  );

  const hl7Message = useMemo(
    () => generateHL7Message(patient, appointments),
    [patient, appointments]
  );

  if (!showFhirModal) return null;

  const jsonString = JSON.stringify(fhirBundle, null, 2);

  const handleCopy = () => {
    const textToCopy = activeFormat === 'hl7-v2' ? hl7Message : jsonString;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (activeFormat === 'hl7-v2') {
      const blob = new Blob([hl7Message], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `medzone-hl7-${patient.mrn}.hl7`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `medzone-fhir-r4-${patient.mrn}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
    triggerPushNotification('Health Record Exported', 'Downloaded standardized interoperability document.', 'clinical');
  };

  /**
   * Server-side validation: the bundle is posted to POST /api/fhir/validate
   * and whatever it returns — valid, or the concrete findings — is shown.
   * When the backend is unreachable the modal says so instead of asserting
   * a validity that was never checked.
   */
  const handleValidate = async () => {
    setValidating(true);
    setImportStatus('Validating against the server-side FHIR validator…');
    try {
      const result = await apiValidateFhirBundle(fhirBundle);
      if (!result) {
        setValidation(null);
        setImportStatus(null);
        triggerPushNotification(
          'Validation Unavailable',
          'The interoperability service could not be reached — the bundle was not validated.',
          'clinical',
        );
        return;
      }
      setValidation(result);
      const errors = result.issues.filter((issue) => issue.severity === 'error').length;
      const warnings = result.issues.length - errors;
      setImportStatus(
        result.valid
          ? `Valid FHIR R4 bundle — ${result.resourceCount} resources checked${warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''}.`
          : `Validation failed — ${errors} error${errors === 1 ? '' : 's'} found. See findings below.`,
      );
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fhir-modal-title"
        className="bg-white rounded-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center">
              <FileCode2 className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="fhir-modal-title" className="font-bold text-base text-slate-900">
                  Interoperability
                </h3>
                <span className="text-[10px] font-mono font-bold bg-teal-50 text-teal-800 px-2 py-0.5 rounded border border-teal-200">
                  FHIR R4
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowFhirModal(false)}
            aria-label="Close interoperability panel"
            className="text-slate-500 hover:text-slate-700 text-sm font-bold cursor-pointer p-1"
          >
            ✕
          </button>
        </div>

        {/* Action Controls & Format Selector */}
        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-white shrink-0 text-xs">
          {/* Format Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setActiveFormat('fhir-json')}
              className={`px-3 py-1.5 font-semibold rounded-md transition-all cursor-pointer ${
                activeFormat === 'fhir-json'
                  ? 'bg-white text-teal-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              JSON
            </button>
            <button
              onClick={() => setActiveFormat('resources')}
              className={`px-3 py-1.5 font-semibold rounded-md transition-all cursor-pointer ${
                activeFormat === 'resources'
                  ? 'bg-white text-teal-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Resources ({fhirBundle.entry.length})
            </button>
            <button
              onClick={() => setActiveFormat('hl7-v2')}
              className={`px-3 py-1.5 font-semibold rounded-md transition-all cursor-pointer ${
                activeFormat === 'hl7-v2'
                  ? 'bg-white text-teal-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              HL7 v2
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleValidate()}
              disabled={validating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {validating ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>{validating ? 'Validating…' : 'Validate'}</span>
            </button>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>

        {/* Validation Notification Banner — reflects the server's verdict, 
            never a fabricated success. */}
        {importStatus && (
          <div
            className={`border-b px-6 py-2.5 text-xs font-medium flex items-center gap-2 ${
              validation && !validation.valid
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : validation?.valid
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            {validation && !validation.valid ? (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : validation?.valid ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <RefreshCw className="w-4 h-4 text-amber-600 shrink-0 animate-spin" />
            )}
            <span>{importStatus}</span>
          </div>
        )}

        {/* Concrete findings from the validator */}
        {validation && validation.issues.length > 0 && (
          <div className="border-b border-slate-100 bg-white px-6 py-3 max-h-40 overflow-y-auto shrink-0">
            <ul className="space-y-1.5">
              {validation.issues.map((issue, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs">
                  <span
                    className={`mt-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                      issue.severity === 'error'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    {issue.severity}
                  </span>
                  <span className="text-slate-700">
                    <span className="font-mono text-[11px] text-slate-500">{issue.path}</span>{' '}
                    {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-900 font-mono text-xs text-slate-200">
          {activeFormat === 'fhir-json' && (
            <pre className="text-[11px] leading-relaxed overflow-x-auto text-teal-300 font-mono">
              {jsonString}
            </pre>
          )}

          {activeFormat === 'hl7-v2' && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-slate-400 font-sans text-xs">
                <span className="font-bold text-slate-200">HL7 v2 segments</span>
              </div>
              <pre className="text-[12px] leading-loose overflow-x-auto text-emerald-400 font-mono whitespace-pre-wrap bg-slate-950 p-4 rounded-xl border border-slate-800">
                {hl7Message}
              </pre>
            </div>
          )}

          {activeFormat === 'resources' && (
            <div className="space-y-3 font-sans">
              <div className="text-slate-400 text-xs mb-3">
                {fhirBundle.entry.length} resources:
              </div>
              {fhirBundle.entry.map((ent, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex items-start justify-between text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-teal-400 font-mono text-sm">
                        {ent.resource.resourceType}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        id: {ent.resource.id}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 font-mono">
                      {ent.fullUrl}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded border font-mono ${
                      !validation
                        ? 'text-slate-500 bg-slate-900 border-slate-700'
                        : validation.valid
                          ? 'text-emerald-400 bg-emerald-950/80 border-emerald-800'
                          : 'text-amber-400 bg-amber-950/80 border-amber-800'
                    }`}
                  >
                    {!validation ? 'NOT VALIDATED' : validation.valid ? 'VALIDATED' : 'SEE FINDINGS'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50 text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-2">
            {validation?.valid ? (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Bundle validated by the server ({validation.resourceCount} resources)</span>
              </>
            ) : validation ? (
              <>
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Validation findings present — review before sharing</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 text-slate-400" />
                <span>Not yet validated — run Validate before sharing</span>
              </>
            )}
          </div>
          <button
            onClick={() => setShowFhirModal(false)}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
