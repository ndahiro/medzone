/**
 * Staff chart selector.
 *
 * The bootstrap returns a `patients[]` directory for staff sessions (and no
 * singleton chart). This control is the only way a clinician moves the station
 * from one chart to another; the context's `patient` then resolves to the
 * selected row so records, meds, booking and the visit room all agree on which
 * patient they are looking at.
 */
import React from 'react';
import { Users } from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';

export const PatientChartPicker: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { role, patients, patient, selectPatient } = useMedZone();

  // A patient session is bound to one chart; the directory is a staff tool.
  if (role !== 'clinician' || patients.length === 0) return null;

  return (
    <label
      className={`inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs ${className}`}
    >
      <Users className="w-3.5 h-3.5 text-teal-700 shrink-0" />
      <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] whitespace-nowrap">
        Patient chart
      </span>
      <select
        value={patient.id}
        onChange={e => selectPatient(e.target.value)}
        className="max-w-[220px] bg-transparent font-semibold text-slate-800 outline-none cursor-pointer"
        aria-label="Select patient chart"
      >
        <option value="">Select a patient…</option>
        {patients.map(p => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.mrn}
          </option>
        ))}
      </select>
    </label>
  );
};
