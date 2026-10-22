/**
 * Patient invitation link (HCW@Home "invite patient in seconds by SMS, Email
 * or WhatsApp" parity).
 *
 * A clinician mints an opaque, expiring join token for one visit and shares it
 * through the channel that suits the patient. Opening the link takes an
 * authenticated participant straight into that visit's lobby — one click, no
 * navigation, nothing to install. The link never carries chart data; it only
 * points at the visit.
 */
import React, { useEffect, useState } from 'react';
import { Link2, Copy, Check, X, MessageSquare, Mail, Send } from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { useLanguage } from '../../context/LanguageContext';
import type { Appointment, InviteChannel } from '../../types';

interface PatientInviteModalProps {
  open: boolean;
  onClose: () => void;
  appointment: Appointment | null;
}

const CHANNEL_TEMPLATE = (patientName: string, providerName: string, url: string) =>
  `Join your MedZone video visit${providerName ? ` with ${providerName}` : ''}: ${url}\n\n` +
  `This single-use link is for ${patientName || 'you'}. No app or download needed.`;

export const PatientInviteModal: React.FC<PatientInviteModalProps> = ({ open, onClose, appointment }) => {
  const { createInviteLink } = useMedZone();
  const { t } = useLanguage();
  const [joinUrl, setJoinUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Mint a fresh link whenever the dialog opens for a visit. Re-issuing
  // supersedes the visit's earlier links, so the one on screen is the only
  // valid one.
  useEffect(() => {
    if (!open || !appointment) return;
    let cancelled = false;
    setJoinUrl('');
    setError(null);
    (async () => {
      const invite = await createInviteLink(appointment.id, 'link');
      if (cancelled) return;
      if (!invite) {
        setError('The visit service could not be reached — no link was created.');
        return;
      }
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setJoinUrl(`${origin}${invite.joinPath}`);
      setExpiresAt(invite.expiresAt);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, appointment, createInviteLink]);

  if (!open || !appointment) return null;

  const message = CHANNEL_TEMPLATE(appointment.patientName, appointment.providerName, joinUrl || '…');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked — the link stays visible for manual copy.
    }
  };

  const share = (channel: InviteChannel) => {
    // Re-mint under the chosen channel so the audit trail records how the
    // patient was reached, then open the platform's own share intent.
    void createInviteLink(appointment.id, channel);
    if (!joinUrl) return;
    const text = encodeURIComponent(message);
    if (channel === 'sms') window.location.href = `sms:?&body=${text}`;
    else if (channel === 'email') window.location.href = `mailto:?subject=${encodeURIComponent('Your MedZone visit')}&body=${text}`;
    else if (channel === 'whatsapp') window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener');
  };

  return (
    <div className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <div className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-teal-700" />
            <h3 className="font-bold text-base text-slate-900">{t('invite.title')}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <p className="text-slate-500">{t('invite.share')}</p>
          <p className="text-slate-700">
            <span className="font-semibold">{appointment.patientName}</span> · {appointment.type} ·{' '}
            {appointment.date} {appointment.time}
          </p>

          {error ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{error}</p>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-mono text-[11px] text-slate-600 break-all">{joinUrl || 'Creating link…'}</p>
                <button
                  onClick={copy}
                  disabled={!joinUrl}
                  className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? t('invite.copied') : t('invite.copy')}</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => share('sms')}
                  disabled={!joinUrl}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-2 py-2 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> {t('invite.sms')}
                </button>
                <button
                  onClick={() => share('email')}
                  disabled={!joinUrl}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-2 py-2 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <Mail className="w-3.5 h-3.5" /> {t('invite.email')}
                </button>
                <button
                  onClick={() => share('whatsapp')}
                  disabled={!joinUrl}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-2 font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" /> {t('invite.whatsapp')}
                </button>
              </div>

              {expiresAt && (
                <p className="text-[11px] text-slate-400">
                  Single-use link · expires {new Date(expiresAt).toLocaleString()}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
