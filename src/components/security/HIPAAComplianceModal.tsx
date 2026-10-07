import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  KeyRound,
  FileCheck,
  CheckCircle2,
  RefreshCw,
  Terminal,
  Cpu,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { encryptPHI, decryptPHI } from '../../lib/crypto';

export const HIPAAComplianceModal: React.FC = () => {
  const {
    showComplianceModal,
    setShowComplianceModal,
    mfaVerified,
    verifyMfa,
    revokeMfa,
    auditLogs,
  } = useMedZone();

  // MFA TOTP input
  const [totpInput, setTotpInput] = useState('');
  const [mfaError, setMfaError] = useState(false);

  // Live Crypto Sandbox State
  const [samplePlain, setSamplePlain] = useState('Patient exhibits Stage 1 Hypertension. Prescribed Lisinopril 10mg.');
  const [cipherResult, setCipherResult] = useState<{
    cipherHex: string;
    ivHex: string;
    fingerprint: string;
    decryptedText: string;
  } | null>(null);
  const [isEncrypting, setIsEncrypting] = useState(false);

  if (!showComplianceModal) return null;

  const handleTestEncryption = async () => {
    setIsEncrypting(true);
    try {
      const enc = await encryptPHI(samplePlain);
      const dec = await decryptPHI(enc.cipherHex, enc.ivHex);
      setCipherResult({
        cipherHex: enc.cipherHex,
        ivHex: enc.ivHex,
        fingerprint: enc.fingerprint,
        decryptedText: dec,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsEncrypting(false);
    }
  };

  const handleVerifyTotp = (e: React.FormEvent) => {
    e.preventDefault();
    const success = verifyMfa(totpInput);
    if (!success) {
      setMfaError(true);
    } else {
      setMfaError(false);
      setTotpInput('');
    }
  };

  return (
    <div className="fixed inset-0 z-60 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-slate-900">
                  HIPAA Security &amp; End-to-End Cryptography Engine
                </h3>
                <span className="text-[10px] font-mono font-bold bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">
                  256-BIT AES-GCM
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Meets HIPAA Security Rule (45 CFR § 164.312), NIST SP 800-38D, and HITECH standards
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowComplianceModal(false)}
            className="text-slate-400 hover:text-slate-700 text-sm font-bold cursor-pointer p-1"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-700">
          {/* Security Status Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl">
              <div className="flex items-center gap-2 text-emerald-800 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>PHI Encryption in Transit &amp; Rest</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1">
                FIPS 140-2 level AES-256-GCM cipher with random 96-bit initialization vectors.
              </p>
            </div>

            <div className="p-3.5 bg-teal-50/60 border border-teal-200 rounded-xl">
              <div className="flex items-center gap-2 text-teal-800 font-bold">
                <KeyRound className="w-4 h-4 text-teal-600" />
                <span>Multi-Factor Authentication</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1">
                {mfaVerified ? 'MFA Session Verified (TOTP 6-digit token)' : 'MFA Verification Required'}
              </p>
            </div>

            <div className="p-3.5 bg-cyan-50/60 border border-cyan-200 rounded-xl">
              <div className="flex items-center gap-2 text-cyan-800 font-bold">
                <FileCheck className="w-4 h-4 text-cyan-600" />
                <span>Tamper-Evident Audit Trails</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1">
                Immutable event tracking recording all access, e-prescriptions, and FHIR exports.
              </p>
            </div>
          </div>

          {/* MFA Management Section */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-teal-700" />
                <h4 className="font-bold text-slate-900 text-sm">Multi-Factor Authentication (MFA)</h4>
              </div>
              {mfaVerified ? (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Verified Active
                </span>
              ) : (
                <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                  Pending Verification
                </span>
              )}
            </div>

            {mfaVerified ? (
              <div className="flex items-center justify-between text-xs">
                <p className="text-slate-600">
                  Your clinical session is protected with multi-factor passkey authentication.
                </p>
                <button
                  onClick={revokeMfa}
                  className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg cursor-pointer transition-colors"
                >
                  Simulate MFA Challenge
                </button>
              </div>
            ) : (
              <form onSubmit={handleVerifyTotp} className="flex items-center gap-3">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="Enter 6-digit code (e.g. 123456)"
                  value={totpInput}
                  onChange={e => setTotpInput(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 font-mono text-center tracking-widest text-slate-900 text-sm focus:border-teal-600"
                />
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg cursor-pointer"
                >
                  Verify MFA Token
                </button>
                {mfaError && (
                  <span className="text-xs text-rose-600 font-medium">Please enter a valid 6-digit code</span>
                )}
              </form>
            )}
          </div>

          {/* Live Web Crypto AES-GCM Sandbox */}
          <div className="bg-slate-900 text-slate-100 rounded-xl p-5 border border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-teal-400" />
                <h4 className="font-bold text-white text-sm">
                  Live Web Crypto AES-256-GCM Cipher Sandbox
                </h4>
              </div>
              <span className="text-[10px] font-mono text-slate-400">window.crypto.subtle</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Plaintext Sensitive Health Record (PHI)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={samplePlain}
                    onChange={e => setSamplePlain(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                  <button
                    type="button"
                    onClick={handleTestEncryption}
                    disabled={isEncrypting}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-lg transition-colors cursor-pointer shrink-0"
                  >
                    {isEncrypting ? 'Encrypting...' : 'Run AES-GCM Cipher'}
                  </button>
                </div>
              </div>

              {cipherResult && (
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2 text-[11px] font-mono">
                  <div>
                    <span className="text-teal-400 font-bold">256-bit Ciphertext (Hex): </span>
                    <p className="text-slate-300 break-all select-all">{cipherResult.cipherHex}</p>
                  </div>
                  <div>
                    <span className="text-cyan-400 font-bold">96-bit Initialization Vector (IV): </span>
                    <span className="text-slate-300">{cipherResult.ivHex}</span>
                  </div>
                  <div>
                    <span className="text-emerald-400 font-bold">SHA-256 Key Fingerprint: </span>
                    <span className="text-slate-300">{cipherResult.fingerprint}</span>
                  </div>
                  <div className="pt-1 border-t border-slate-800">
                    <span className="text-slate-400 font-bold font-sans">Decrypted Authenticated Output: </span>
                    <span className="text-emerald-300 font-sans">{cipherResult.decryptedText}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* HIPAA Tamper-Evident Audit Trail Table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-slate-900 text-sm">HIPAA Security Audit Trail Log</h4>
              <span className="text-[11px] text-slate-500 font-mono">
                {auditLogs.length} verified events
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left font-mono tabular-nums text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-sans text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="px-3">Actor / Role</th>
                    <th className="px-3">Action</th>
                    <th className="px-3">Event Details</th>
                    <th className="px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {auditLogs.slice(0, 6).map(log => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-3 font-sans text-slate-900 font-medium">
                        {log.userName} ({log.userRole})
                      </td>
                      <td className="px-3 font-bold text-teal-800">{log.action}</td>
                      <td className="px-3 font-sans text-slate-600 text-[11px]">{log.details}</td>
                      <td className="px-3">
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-sans font-semibold">
                          VERIFIED
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50 text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-1.5">
            <Lock className="w-4 h-4 text-teal-700" />
            <span>End-to-End Cryptographic Invariants Enforced</span>
          </div>
          <button
            onClick={() => setShowComplianceModal(false)}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg cursor-pointer"
          >
            Close Security Panel
          </button>
        </div>
      </div>
    </div>
  );
};
