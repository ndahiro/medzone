/**
 * MedZone user management view (mirrors the elgon UserManagement component).
 * Admin-only: register users, grant per-module access, toggle admin status,
 * reset passwords, and delete accounts. Self-demotion and self-deletion are
 * blocked both here and server-side.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, UserPlus, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { MODULES, type ManagedUser, type ModuleKey } from '../../types/auth';
import { createUser, deleteUser, getAllUsers } from '../../lib/auth';
import { resetUserPassword, updateUserAdmin, updateUserModules, updateUserPatient, updateUserRole } from '../../lib/auth';
import {
  ACCEPT_ATTRIBUTE,
  avatarFileToDataUrl,
  initialsFor,
  MAX_AVATAR_FILE_BYTES,
  validateAvatarFile,
} from '../../lib/avatar';

const ROLE_OPTIONS: Array<{ value: ManagedUser['role']; label: string; hint: string }> = [
  { value: 'patient', label: 'Patient', hint: 'Patient dashboard' },
  { value: 'clinician', label: 'Clinician', hint: 'Clinician dashboard' },
  { value: 'admin', label: 'Admin', hint: 'Everything' },
];

export const UserManagementView: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [selectedModules, setSelectedModules] = useState<ModuleKey[]>(['dashboard']);
  const [newUserRole, setNewUserRole] = useState<ManagedUser['role']>('patient');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [resetTarget, setResetTarget] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [patientId, setPatientId] = useState('');
  const [chartTarget, setChartTarget] = useState<number | null>(null);
  const [chartInput, setChartInput] = useState('');

  const refresh = useCallback(async () => {
    try {
      setUsers(await getAllUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);


  const toggleModule = (key: ModuleKey) => {
    setSelectedModules(prev => (prev.includes(key) ? prev.filter(m => m !== key) : [...prev, key]));
  };

  const hasModule = (u: ManagedUser, key: ModuleKey) => (u.modules || []).includes(key);

  const toggleUserModule = async (u: ManagedUser, key: ModuleKey) => {
    setError(null);
    setSuccess(null);
    try {
      const next = hasModule(u, key) ? (u.modules || []).filter(m => m !== key) : [...(u.modules || []), key];
      if (next.length === 0) throw new Error('Each user must keep at least one module.');
      await updateUserModules(u.id, next);
      setSuccess(`Updated module access for ${u.username}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update modules.');
    }
  };

  const handleAvatarFile = async (file: File | undefined) => {
    setAvatarError(null);
    if (!file) return;
    const problem = validateAvatarFile(file);
    if (problem) {
      setAvatarError(problem);
      return;
    }
    setAvatarBusy(true);
    try {
      setAvatarUrl(await avatarFileToDataUrl(file));
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not read that image.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleRegister = async () => {
    setError(null);
    setSuccess(null);
    setAvatarError(null);
    try {
      if (!username.trim()) throw new Error('Username is required.');
      if (password.length < 12) throw new Error('Password must be at least 12 characters.');
      if (selectedModules.length === 0) throw new Error('Select at least one module.');
      await createUser(
        username.trim(),
        displayName.trim() || username.trim(),
        password,
        selectedModules,
        makeAdmin || newUserRole === 'admin',
        newUserRole,
        newUserRole === 'patient' ? patientId.trim() || null : null,
        avatarUrl,
      );
      setUsername('');
      setDisplayName('');
      setAvatarUrl('');
      setPassword('');
      setPatientId('');
      setSelectedModules(['dashboard']);
      setNewUserRole('patient');
      setMakeAdmin(false);
      setSuccess('User registered.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register user.');
    }
  };

  const handleAdminToggle = async (u: ManagedUser) => {
    if (u.username === currentUser?.username) {
      setError('You cannot change your own admin status.');
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      await updateUserAdmin(u.id, !u.isAdmin);
      setSuccess(`Admin status updated for ${u.username}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update admin status.');
    }
  };

  const handleRoleChange = async (u: ManagedUser, next: ManagedUser['role']) => {
    if (u.username === currentUser?.username) {
      setError('You cannot change your own role.');
      return;
    }
    if (u.role === next) return;
    setError(null);
    setSuccess(null);
    try {
      await updateUserRole(u.id, next);
      setSuccess(`Role updated for ${u.username}: ${next}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role.');
    }
  };

  const handleDelete = async (id: number, uname: string) => {
    if (uname === currentUser?.username) {
      setError('You cannot delete your own account.');
      return;
    }
    if (!confirm(`Delete user "${uname}"?`)) return;
    setError(null);
    setSuccess(null);
    try {
      await deleteUser(id);
      setSuccess('User deleted.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user.');
    }
  };

  const handleLinkChart = async (id: number) => {
    setError(null);
    setSuccess(null);
    try {
      const target = users.find(u => u.id === id);
      if (!target) throw new Error('User not found.');
      const next = chartInput.trim() || null;
      await updateUserPatient(id, next);
      setSuccess(next ? `Chart ${next} linked to ${target.username}.` : `Chart unlinked from ${target.username}.`);
      setChartTarget(null);
      setChartInput('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update chart link.');
    }
  };

  const handleReset = async (id: number) => {
    setError(null);
    setSuccess(null);
    try {
      if (resetPassword.length < 12) throw new Error('New password must be at least 12 characters.');
      const target = users.find(u => u.id === id);
      if (!target) throw new Error('User not found.');
      await resetUserPassword(id, resetPassword);
      setSuccess(`Password reset for ${target.username}.`);
      setResetTarget(null);
      setResetPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password.');
    }
  };

  if (loading) return <div className="text-sm text-slate-500">Loading users…</div>;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200/70 flex items-center justify-center">
          <Users className="w-4 h-4 text-teal-700" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900">Users</h2>
        </div>
      </div>
      {error && (
        <div role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div role="status" aria-live="polite" className="mt-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {success}
        </div>
      )}
      <div className="grid lg:grid-cols-5 gap-5 mt-5">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm h-fit">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-teal-700" /> New User
          </h3>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name (optional)" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              aria-label={avatarUrl ? 'Change profile photo' : 'Upload profile photo'}
              className="relative w-14 h-14 shrink-0 rounded-full overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-500 text-sm font-bold cursor-pointer group"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Selected profile avatar" className="w-full h-full object-cover" />
              ) : (
                <span aria-hidden="true">{initialsFor(displayName || username || 'New user')}</span>
              )}
              <span className="absolute inset-0 bg-slate-900/35 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-4 h-4" />
              </span>
            </button>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-700">Profile photo <span className="font-normal text-slate-400">(optional)</span></p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                JPEG, PNG or WebP up to {Math.round(MAX_AVATAR_FILE_BYTES / 1024)} KB. Shown on reports.
              </p>
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarBusy}
                  className="text-[10px] font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50 cursor-pointer"
                >
                  {avatarBusy ? 'Preparing…' : avatarUrl ? 'Choose another' : 'Upload photo'}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => { setAvatarUrl(''); setAvatarError(null); }}
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 hover:text-red-700 cursor-pointer"
                  >
                    <X className="w-3 h-3" /> Remove
                  </button>
                )}
              </div>
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void handleAvatarFile(file);
              }}
            />
          </div>
          {avatarError && (
            <p role="alert" className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
              {avatarError}
            </p>
          )}
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (min 12 characters)" autoComplete="new-password" minLength={12} required className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" />
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-2">Account type</p>
            <div className="grid grid-cols-3 gap-1.5">
              {ROLE_OPTIONS.map(r => (
                <button key={r.value} type="button" onClick={() => setNewUserRole(r.value)} title={r.hint} className={newUserRole === r.value ? 'px-2 py-2 rounded-xl border text-xs cursor-pointer bg-teal-800 border-teal-800 text-white font-semibold' : 'px-2 py-2 rounded-xl border text-xs cursor-pointer bg-slate-50 border-slate-200 text-slate-600'}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {newUserRole === 'patient' && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">Patient chart ID</p>
              <input
                value={patientId}
                onChange={e => setPatientId(e.target.value)}
                placeholder="e.g. the patient's chart id"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Links the login to the chart it may read. Leave blank to link later.
              </p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-2">Modules</p>
            <div className="grid grid-cols-1 gap-1.5">
              {MODULES.map(m => {
                const checked = selectedModules.includes(m.key);
                return (
                  <button key={m.key} type="button" onClick={() => toggleModule(m.key)} className={checked ? 'text-left px-3 py-2 rounded-xl border text-xs cursor-pointer bg-teal-50 border-teal-600 text-teal-900 font-semibold' : 'text-left px-3 py-2 rounded-xl border text-xs cursor-pointer bg-slate-50 border-slate-200 text-slate-600'}>
                    <span className="font-semibold">{checked ? '✓ ' : ''}{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={makeAdmin} onChange={e => setMakeAdmin(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600" />
            Administrator
          </label>
          <button onClick={() => void handleRegister()} className="w-full px-4 py-2.5 rounded-xl bg-teal-800 hover:bg-teal-700 text-white text-sm font-semibold cursor-pointer">Add User</button>
        </div>
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm overflow-x-auto h-fit">
          <h3 className="font-bold text-sm text-slate-900 mb-3">System Users <span className="text-slate-400 font-medium">({users.length})</span></h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-left text-[11px] uppercase tracking-wide border-b border-slate-100">
                <th className="py-2 pr-4 font-semibold">User</th>
                <th className="py-2 pr-4 font-semibold">Role</th>
                <th className="py-2 pr-4 font-semibold">Access</th>
                <th className="py-2 pr-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-slate-100/80 align-top last:border-0">
                  <td className="py-3 pr-4">
                    <div className="flex items-start gap-2.5">
                      {u.avatarUrl ? (
                        <img
                          src={u.avatarUrl}
                          alt={`${u.displayName} avatar`}
                          className="w-9 h-9 shrink-0 rounded-full object-cover border border-slate-200"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="w-9 h-9 shrink-0 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center border border-slate-200"
                        >
                          {initialsFor(u.displayName || u.username)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="text-slate-900 font-semibold text-[13px]">{u.displayName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{u.username}</div>
                        {u.role === 'patient' && (
                          <div className="mt-1.5">
                            <div className="text-[10px] text-slate-400">
                              Chart: <span className="font-mono text-slate-600">{u.patientId ?? 'not linked'}</span>
                            </div>
                            {chartTarget === u.id ? (
                              <div className="mt-1 flex gap-1.5">
                                <input
                                  value={chartInput}
                                  onChange={e => setChartInput(e.target.value)}
                                  placeholder="Chart ID"
                                  className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-[11px] w-28 focus:outline-none focus:ring-2 focus:ring-teal-600"
                                />
                                <button onClick={() => void handleLinkChart(u.id)} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-600 text-white cursor-pointer">Save</button>
                                <button onClick={() => setChartTarget(null)} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-600 cursor-pointer">Cancel</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setChartTarget(u.id); setChartInput(u.patientId ?? ''); }}
                                className="mt-0.5 text-[10px] font-semibold text-teal-700 hover:text-teal-800 cursor-pointer"
                              >
                                {u.patientId ? 'Change chart' : 'Link chart'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <select value={u.role ?? 'patient'} onChange={e => void handleRoleChange(u, e.target.value as ManagedUser['role'])} disabled={u.username === currentUser?.username} title={u.username === currentUser?.username ? 'You cannot change your own role' : 'Change dashboard role'} className="text-[11px] font-semibold px-1.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 disabled:opacity-40 cursor-pointer">
                      <option value="patient">Patient</option>
                      <option value="clinician">Clinician</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button onClick={() => void handleAdminToggle(u)} disabled={u.username === currentUser?.username} className={u.isAdmin ? 'mt-1 block text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 disabled:opacity-40 cursor-pointer' : 'mt-1 block text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500 disabled:opacity-40 cursor-pointer'}>
                      {u.isAdmin ? 'Admin ✓' : 'Make admin'}
                    </button>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {MODULES.map(m => (
                        <button key={m.key} onClick={() => void toggleUserModule(u, m.key)} title={'Toggle ' + m.label} className={hasModule(u, m.key) ? 'text-[10px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer bg-teal-50 border-teal-600 text-teal-800' : 'text-[10px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer bg-slate-50 border-slate-200 text-slate-400'}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <button onClick={() => { setResetTarget(u.id); setResetPassword(''); }} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-600 mr-1.5 cursor-pointer">Reset PW</button>
                    <button onClick={() => void handleDelete(u.id, u.username)} disabled={u.username === currentUser?.username} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-red-50 text-red-700 disabled:opacity-40 cursor-pointer">Delete</button>
                    {resetTarget === u.id && (
                      <div className="mt-2 flex gap-1.5">
                        <input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="New password" autoComplete="new-password" minLength={12} required className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-[11px] w-28 focus:outline-none focus:ring-2 focus:ring-teal-600" />
                        <button onClick={() => void handleReset(u.id)} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-600 text-white cursor-pointer">Save</button>
                        <button onClick={() => setResetTarget(null)} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-600 cursor-pointer">Cancel</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

