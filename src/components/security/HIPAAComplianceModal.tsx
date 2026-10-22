import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Lock,
  KeyRound,
  FileCheck,
  CheckCircle2,
  Cpu,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { encryptPHI, decryptPHI } from '../../lib/crypto';
import { changePassword, enrollMfa, getMfaStatus, type MfaStatus } from '../../lib/auth';

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

  // Per-account authenticator enrollment: `enrollment` holds the one-time
  // secret the server returned, so the user can add it before confirming.
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [enrollPassword, setEnrollPassword] = useState('');
  const [enrollError, setEnrollError] = useState('');
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUrl: string } | null>(null);

  // Live Crypto Sandbox State
  const [samplePlain, setSamplePlain] = useState('');
  const [cipherResult, setCipherResult] = useState<{
    cipherHex: string;
    ivHex: string;
    saltHex: string;
    fingerprint: string;
    iterations: number;
    decryptedText: string;
  } | null>(null);
  const [isEncrypting, setIsEncrypting] = useState(false);

  // Self-service password rotation. The API re-issues this session's cookie,
  // so the caller stays signed in while every other device is signed out.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordState, setPasswordState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [passwordMessage, setPasswordMessage] = useState('');

  useEffect(() => {
    if (!showComplianceModal) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowComplianceModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showComplianceModal, setShowComplianceModal]);

  // Enrollment state is the account's, not the browser's: read it from the API
  // whenever the modal opens.
  useEffect(() => {
    if (!showComplianceModal) return undefined;
    let cancelled = false;
    void getMfaStatus()
      .then(status => {
        if (!cancelled) setMfaStatus(status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [showComplianceModal, mfaVerified]);

  if (!showComplianceModal) return null;

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordMessage('');
    if (newPassword.length < 12) {
      setPasswordState('error');
      setPasswordMessage('Use at least 12 characters for the new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordState('error');
      setPasswordMessage('The new passwords do not match.');
      return;
    }
    setPasswordState('saving');
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordState('saved');
      setPasswordMessage('Password updated. Other sessions have been signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordState('error');
      setPasswordMessage(err instanceof Error ? err.message : 'Could not change the password.');
    }
  };

  const handleTestEncryption = async () => {
    setIsEncrypting(true);
    try {
      const enc = await encryptPHI(samplePlain);
      const dec = await decryptPHI(enc.cipherHex, enc.ivHex, enc.saltHex);
      setCipherResult({
        cipherHex: enc.cipherHex,
        ivHex: enc.ivHex,
        saltHex: enc.saltHex,
        fingerprint: enc.fingerprint,
        iterations: enc.iterations,
        decryptedText: dec,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsEncrypting(false);
    }
  };

  const handleEnrollMfa = async (event: React.FormEvent) => {
    event.preventDefault();
    setEnrollError('');
    try {
      const result = await enrollMfa(enrollPassword);
      setEnrollment({ secret: result.secret, otpauthUrl: result.otpauthUrl });
      setEnrollPassword('');
      setMfaError(false);
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : 'Could not start enrollment.');
    }
  };

  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await verifyMfa(totpInput);
    if (!success) {
      setMfaError(true);
      return;
    }
    setMfaError(false);
    setTotpInput('');
    setEnrollment(null);
    void getMfaStatus()
      .then(setMfaStatus)
      .catch(() => undefined);
  };

  return (
    <div className="fixed inset-0 z-60 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="security-modal-title"
        className="bg-white rounded-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="security-modal-title" className="font-bold text-base text-slate-900">
                  Security
                </h3>
                <span className="text-[10px] font-mono font-bold bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">
                  AES-GCM
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowComplianceModal(false)}
            aria-label="Close security panel"
            className="text-slate-500 hover:text-slate-700 text-sm font-bold cursor-pointer p-1"
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
                <span>Encryption</span>
              </div>
            </div>

            <div className="p-3.5 bg-teal-50/60 border border-teal-200 rounded-xl">
              <div className="flex items-center gap-2 text-teal-800 font-bold">
                <KeyRound className="w-4 h-4 text-teal-600" />
                <span>MFA</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1">
                {mfaVerified
                  ? 'Verified'
                  : mfaStatus?.enrolled
                    ? 'Enrolled — verify this session'
                    : mfaStatus?.required
                      ? 'Required — set up'
                      : 'Not set up'}
              </p>
            </div>

            <div className="p-3.5 bg-cyan-50/60 border border-cyan-200 rounded-xl">
              <div className="flex items-center gap-2 text-cyan-800 font-bold">
                <FileCheck className="w-4 h-4 text-cyan-600" />
                <span>Audit Trail</span>
              </div>
            </div>
          </div>

          {/* MFA Management Section */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-teal-700" />
                <h4 className="font-bold text-slate-900 text-sm">MFA</h4>
              </div>
              {mfaVerified ? (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> On
                </span>
              ) : (
                <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                  Off
                </span>
              )}
            </div>

            {mfaVerified ? (
              <div className="flex items-center justify-between text-xs">
                <p className="text-slate-600">
                  Session protected — verified by the server.
                </p>
                <button
                  onClick={() => void revokeMfa()}
                  className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg cursor-pointer transition-colors"
                >
                  Re-verify
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {/* No authenticator yet: enroll one for THIS account. The key
                    is shown once, then only a code confirms it. */}
                {!mfaStatus?.enrolled && !mfaStatus?.pending && !enrollment && (
                  <form onSubmit={handleEnrollMfa} className="space-y-2">
                    <p className="text-[11px] text-slate-600">
                      {mfaStatus?.required
                        ? 'This deployment requires a second factor. Enroll an authenticator app to continue.'
                        : 'Add an authenticator app to protect this account.'}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="password"
                        value={enrollPassword}
                        onChange={e => setEnrollPassword(e.target.value)}
                        autoComplete="current-password"
                        placeholder="Current password"
                        className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-900 text-sm focus:border-teal-600"
                      />
                      <button
                        type="submit"
                        className="px-4 py-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg cursor-pointer"
                      >
                        Set up authenticator
                      </button>
                    </div>
                    {enrollError && (
                      <span className="text-xs text-rose-600 font-medium">{enrollError}</span>
                    )}
                  </form>
                )}

                {enrollment && (
                  <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-teal-900">
                      Add this key to your authenticator app, then enter the 6-digit code below.
                    </p>
                    <p className="font-mono text-[11px] text-slate-800 break-all select-all">
                      {enrollment.secret}
                    </p>
                    <p className="font-mono text-[10px] text-slate-500 break-all select-all">
                      {enrollment.otpauthUrl}
                    </p>
                  </div>
                )}

                {(mfaStatus?.enrolled || mfaStatus?.pending || enrollment) && (
                  <form onSubmit={handleVerifyTotp} className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="Code"
                      value={totpInput}
                      onChange={e => setTotpInput(e.target.value)}
                      className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 font-mono text-center tracking-widest text-slate-900 text-sm focus:border-teal-600"
                    />
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg cursor-pointer"
                    >
                      Verify
                    </button>
                    {mfaError && (
                      <span className="text-xs text-rose-600 font-medium">
                        Code refused — see notifications for the reason
                      </span>
                    )}
                  </form>
                )}

                <p className="text-[11px] text-slate-500">
                  6-digit code from your authenticator app. Each code is single-use, and the secret
                  never reaches this browser.
                </p>
              </div>
            )}
          </div>

          {/* Password rotation — signs out every other session. */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="w-4 h-4 text-teal-700" />
              <h4 className="font-bold text-slate-900 text-sm">Password</h4>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Changing your password signs out every other device. This session stays signed in.
            </p>
            <form onSubmit={handleChangePassword} className="space-y-2.5">
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="block text-[11px] font-semibold text-slate-600">
                  Current password
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-900 text-xs focus:outline-none focus:border-teal-600"
                  />
                </label>
                <label className="block text-[11px] font-semibold text-slate-600">
                  New password
                  <input
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={12}
                    required
                    className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-900 text-xs focus:outline-none focus:border-teal-600"
                  />
                </label>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Confirm new password
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={12}
                    required
                    className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-900 text-xs focus:outline-none focus:border-teal-600"
                  />
                </label>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p
                  role="status"
                  aria-live="polite"
                  className={`text-[11px] ${
                    passwordState === 'error'
                      ? 'text-rose-700'
                      : passwordState === 'saved'
                        ? 'text-emerald-700'
                        : 'text-slate-500'
                  }`}
                >
                  {passwordMessage || 'At least 12 characters.'}
                </p>
                <button
                  type="submit"
                  disabled={passwordState === 'saving'}
                  className="px-4 py-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-bold rounded-lg cursor-pointer shrink-0"
                >
                  {passwordState === 'saving' ? 'Updating…' : 'Update password'}
                </button>
              </div>
            </form>
          </div>

          {/* Live Web Crypto AES-GCM Sandbox */}
          <div className="bg-slate-900 text-slate-100 rounded-xl p-5 border border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-teal-400" />
                <h4 className="font-bold text-white text-sm">
                  Cipher Sandbox
                </h4>
              </div>
              <span className="text-[10px] font-mono text-slate-400">window.crypto.subtle</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Text
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={samplePlain}
                    onChange={e => setSamplePlain(e.target.value)}
                    placeholder="Text…"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                  <button
                    type="button"
                    onClick={handleTestEncryption}
                    disabled={isEncrypting || !samplePlain.trim()}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-lg transition-colors cursor-pointer shrink-0"
                  >
                    {isEncrypting ? '…' : 'Encrypt'}
                  </button>
                </div>
              </div>

              {cipherResult && (
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2 text-[11px] font-mono">
                  <div>
                    <span className="text-teal-400 font-bold">Ciphertext: </span>
                    <p className="text-slate-300 break-all select-all">{cipherResult.cipherHex}</p>
                  </div>
                  <div>
                    <span className="text-cyan-400 font-bold">IV: </span>
                    <span className="text-slate-300">{cipherResult.ivHex}</span>
                  </div>
                  <div>
                    <span className="text-cyan-400 font-bold">Salt: </span>
                    <span className="text-slate-300">{cipherResult.saltHex}</span>
                  </div>
                  <div>
                    <span className="text-emerald-400 font-bold">Fingerprint: </span>
                    <span className="text-slate-300">{cipherResult.fingerprint}</span>
                  </div>
                  <div>
                    <span className="text-amber-400 font-bold">KDF: </span>
                    <span className="text-slate-300">
                      PBKDF2-HMAC-SHA-256 · {cipherResult.iterations.toLocaleString()} iterations
                    </span>
                  </div>
                  <div className="pt-1 border-t border-slate-800">
                    <span className="text-slate-400 font-bold font-sans">Decrypted: </span>
                    <span className="text-emerald-300 font-sans">{cipherResult.decryptedText}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* HIPAA Tamper-Evident Audit Trail Table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-slate-900 text-sm">Audit Trail</h4>
              <span className="text-[11px] text-slate-500 font-mono">
                {auditLogs.length} events
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left font-mono tabular-nums text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-sans text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Time</th>
                    <th className="px-3">Actor</th>
                    <th className="px-3">Action</th>
                    <th className="px-3">Details</th>
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
            <span>Encrypted</span>
          </div>
          <button
            type="button"
            onClick={() => setShowComplianceModal(false)}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
