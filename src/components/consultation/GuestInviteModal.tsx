/**

 *
 * The roster is owned by the visit server-side (GET/POST/DELETE /guests) so
 * both participants see the same list; the invite link is a plain room
 * reference the guest opens to reach the same visit.
 */
import React, { useState } from 'react';
import { UserPlus, Link2, Copy, Check, X, Trash2 } from 'lucide-react';
import type { VisitGuest } from '../../types';

interface RoomGuest {
  name: string;
  role: VisitGuest['role'];
}

interface GuestInviteModalProps {
  open: boolean;
  onClose: () => void;
  roomCode: string;
  guests: RoomGuest[];
  guestsError?: string | null;
  onAddGuest: (guest: RoomGuest) => void | Promise<void>;
  onRemoveGuest: (index: number) => void | Promise<void>;
}

const GUEST_ROLES: RoomGuest['role'][] = ['Family', 'Translator', 'Specialist', 'Observer'];

export const GuestInviteModal: React.FC<GuestInviteModalProps> = ({
  open,
  onClose,
  roomCode,
  guests,
  guestsError,
  onAddGuest,
  onRemoveGuest,
}) => {
  const [guestName, setGuestName] = useState('');
  const [guestRole, setGuestRole] = useState<RoomGuest['role']>('Family');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const inviteLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}#/join/${encodeURIComponent(roomCode)}`
      : `room:${roomCode}`;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = guestName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await onAddGuest({ name, role: guestRole });
      setGuestName('');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        `Join my MedZone visit (room ${roomCode}): ${inviteLink}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard unavailable (permissions/iframe) — the link stays visible.
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-teal-700" />
            <h3 className="font-bold text-base text-slate-900">Invite</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <form onSubmit={handleAdd} className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="text"
              value={guestName}
              onChange={e => setGuestName(e.target.value)}
              placeholder="Name…"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none"
            />
            <select
              value={guestRole}
              onChange={e => setGuestRole(e.target.value as RoomGuest['role'])}
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-slate-900 focus:border-teal-600 focus:outline-none"
              title="Guest role"
            >
              {GUEST_ROLES.map(role => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!guestName.trim()}
              className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-40 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>

          <div>
            <p className="font-semibold text-slate-700 mb-2">
              Guests ({guests.length})
            </p>
            {guests.length === 0 ? (
              <p className="text-slate-400">No guests yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {guests.map((guest, index) => (
                  <li
                    key={`${guest.name}-${index}`}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5"
                  >
                    <span className="font-medium text-slate-800">
                      {guest.name}
                      <span className="ml-2 text-[10px] font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                        {guest.role}
                      </span>
                    </span>
                    <button
                      onClick={() => onRemoveGuest(index)}
                      className="text-slate-400 hover:text-rose-600 cursor-pointer"
                      title="Remove guest"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700 mb-1.5">
              <Link2 className="w-3.5 h-3.5 text-teal-700" />
              <span>Room link</span>
            </div>
            <p className="font-mono text-[11px] text-slate-600 break-all">{inviteLink}</p>
            <button
              onClick={handleCopy}
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Invite'}</span>
            </button>
          </div>

          <p className="text-[11px] text-slate-400">
            Clears when the visit ends.
          </p>
        </div>
      </div>
    </div>
  );
};
