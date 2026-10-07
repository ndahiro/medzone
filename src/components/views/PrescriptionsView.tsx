import React, { useState } from 'react';
import {
  Pill,
  Clock,
  CheckCircle2,
  RefreshCw,
  Plus,
  ShieldCheck,
  Building2,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { Prescription } from '../../types';

export const PrescriptionsView: React.FC = () => {
  const {
    role,
    prescriptions,
    markDoseTaken,
    requestRefill,
    issuePrescription,
  } = useMedZone();

  const [showNewRxModal, setShowNewRxModal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'refill-requested'>('all');

  // Form State
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState<Prescription['route']>('Oral');
  const [freq, setFreq] = useState('Once daily');
  const [qty, setQty] = useState(30);
  const [refills, setRefills] = useState(3);
  const [instructions, setInstructions] = useState('');
  const [pharmacy, setPharmacy] = useState('Walgreens Pharmacy #4190');

  const filtered = prescriptions.filter(p => {
    if (filter === 'all') return true;
    return p.status === filter;
  });

  const handleCreateRx = (e: React.FormEvent) => {
    e.preventDefault();
    issuePrescription(name, dose, route, freq, Number(qty), Number(refills), instructions, pharmacy);
    setShowNewRxModal(false);
    setName('');
    setDose('');
    setInstructions('');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Prescription &amp; Medication Management
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Track active clinical regimens, monitor adherence, and coordinate electronic refills.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center p-1 bg-slate-100 rounded-lg text-xs">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 font-semibold rounded-md transition-colors cursor-pointer ${
                filter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              All ({prescriptions.length})
            </button>
            <button
              onClick={() => setFilter('active')}
              className={`px-3 py-1 font-semibold rounded-md transition-colors cursor-pointer ${
                filter === 'active' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setFilter('refill-requested')}
              className={`px-3 py-1 font-semibold rounded-md transition-colors cursor-pointer ${
                filter === 'refill-requested' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Refill Due
            </button>
          </div>

          {role === 'clinician' && (
            <button
              onClick={() => setShowNewRxModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Issue New E-Rx</span>
            </button>
          )}
        </div>
      </div>

      {/* Medication Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map(rx => (
          <div
            key={rx.id}
            className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">{rx.medicationName}</h3>
                  <p className="text-xs text-teal-800 font-mono font-semibold mt-0.5">
                    {rx.dosage} · {rx.route}
                  </p>
                </div>
                {rx.status === 'refill-requested' ? (
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Refill Requested
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Active Regimen
                  </span>
                )}
              </div>

              <div className="mt-3 p-3 bg-slate-50 rounded-xl space-y-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Frequency: </span>
                  <p className="font-medium text-slate-800">{rx.frequency}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Directions: </span>
                  <p className="text-slate-600 leading-relaxed text-[11px]">{rx.instructions}</p>
                </div>
                <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Refills Left:</span>
                  <span className="font-mono font-bold text-slate-800">
                    {rx.remainingRefills} of {rx.totalRefills}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Adherence Score:</span>
                  <span className="font-mono font-bold text-teal-700">
                    {rx.adherencePercentage}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Pharmacy:</span>
                  <span className="text-slate-700 truncate max-w-[150px]">{rx.pharmacy}</span>
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
              <button
                onClick={() => markDoseTaken(rx.id)}
                className="flex-1 py-2 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                <span>Log Dose</span>
              </button>
              <button
                onClick={() => requestRefill(rx.id)}
                disabled={rx.status === 'refill-requested'}
                className="py-2 px-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 text-slate-500" />
                <span>Refill</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Issue Modal */}
      {showNewRxModal && (
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-bold text-base text-slate-900">Issue Electronic Prescription</h3>
              <button
                onClick={() => setShowNewRxModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRx} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Medication Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Dosage</label>
                  <input
                    type="text"
                    required
                    value={dose}
                    onChange={e => setDose(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Route</label>
                  <select
                    value={route}
                    onChange={e => setRoute(e.target.value as Prescription['route'])}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                  >
                    <option value="Oral">Oral (PO)</option>
                    <option value="Sublingual">Sublingual (SL)</option>
                    <option value="Inhalation">Inhalation</option>
                    <option value="Topical">Topical</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Frequency</label>
                  <input
                    type="text"
                    required
                    value={freq}
                    onChange={e => setFreq(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Directions for Use</label>
                <textarea
                  rows={2}
                  required
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 resize-none"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewRxModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg cursor-pointer"
                >
                  Sign &amp; Issue E-Rx
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
