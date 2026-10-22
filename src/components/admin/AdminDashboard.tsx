/**
 * MedZone admin dashboard.
 *
 * Rendered when a user with role 'admin' opens the Dashboard tab. Summarises
 * the clinical operation (appointments, prescriptions, audit posture) and
 * surfaces user-administration shortcuts. User CRUD itself lives in the
 * User Management tab.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Pill, ShieldCheck, Users, Video, UserCog, Activity, BarChart3, Paperclip, Link2 } from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';
import { useAuth } from '../../context/AuthContext';
import { fetchClinicStats } from '../../lib/api';
import type { ClinicStats } from '../../types';

interface AdminDashboardProps {
  onOpenUsers: () => void;
  onLaunchCall: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onOpenUsers, onLaunchCall }) => {
  const { appointments, prescriptions, auditLogs, notifications, consultationRequests } = useMedZone();
  const { user } = useAuth();

  // Anonymised clinic statistics (HCW@Home parity): aggregate counts computed
  // server-side. No chart identifier or free text crosses this boundary.
  const [clinicStats, setClinicStats] = useState<ClinicStats | null>(null);
  useEffect(() => {
    let active = true;
    void fetchClinicStats().then(stats => {
      if (active && stats) setClinicStats(stats);
    });
    return () => {
      active = false;
    };
  }, []);

  const analytics = useMemo(() => {
    const todayCount = appointments.filter(a => a.status === 'scheduled').length;
    const activeRx = prescriptions.filter(p => p.status === 'active').length;
    const flagged = auditLogs.filter(l => l.status === 'FLAGGED').length;
    const unread = notifications.filter(n => !n.read).length;
    const waitingNow = appointments.filter(a => a.status === 'in-progress').length;
    const pendingRequests = consultationRequests.filter(r => r.status === 'pending').length;
    const byStatus = (['scheduled', 'in-progress', 'completed', 'cancelled'] as const).map(status => ({
      label: status === 'in-progress' ? 'waiting' : status,
      count: appointments.filter(a => a.status === status).length,
    }));
    const totalVisits = appointments.length || 1;
    const completedVisits = appointments.filter(a => a.status === 'completed').length;
    const completionRate = Math.round((completedVisits / totalVisits) * 100);
    const byType = Array.from(
      appointments.reduce((acc, a) => acc.set(a.type, (acc.get(a.type) ?? 0) + 1), new Map<string, number>()),
    );
    const maxTypeCount = Math.max(1, ...byType.map(([, count]) => count));
    const avgAdherence = prescriptions.length === 0
      ? 0
      : Math.round(prescriptions.reduce((sum, rx) => sum + rx.adherencePercentage, 0) / prescriptions.length);
    const auditByAction = Array.from(
      auditLogs.reduce((acc, log) => acc.set(log.action, (acc.get(log.action) ?? 0) + 1), new Map<string, number>()),
    ).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxAuditCount = Math.max(1, ...auditByAction.map(([, count]) => count));
    return {
      todayCount, activeRx, flagged, unread, waitingNow, pendingRequests,
      byStatus, totalVisits, completionRate, byType, maxTypeCount,
      avgAdherence, auditByAction, maxAuditCount,
    };
  }, [appointments, prescriptions, auditLogs, notifications, consultationRequests]);

  const {
    todayCount, activeRx, flagged, unread, waitingNow, pendingRequests,
    byStatus, totalVisits, completionRate, byType, maxTypeCount,
    avgAdherence, auditByAction, maxAuditCount,
  } = analytics;

  const stats = [
    { label: 'Scheduled', value: todayCount, icon: Calendar, tint: 'bg-teal-50 text-teal-700 border-teal-200/70' },
    { label: 'Waiting', value: waitingNow, icon: Video, tint: 'bg-emerald-50 text-emerald-700 border-emerald-200/70' },
    { label: 'Requests', value: pendingRequests, icon: Users, tint: 'bg-sky-50 text-sky-700 border-sky-200/70' },
    { label: 'Prescriptions', value: activeRx, icon: Pill, tint: 'bg-sky-50 text-sky-700 border-sky-200/70' },
    { label: 'Flagged', value: flagged, icon: ShieldCheck, tint: 'bg-amber-50 text-amber-700 border-amber-200/70' },
    { label: 'Unread', value: unread, icon: Activity, tint: 'bg-violet-50 text-violet-700 border-violet-200/70' },
  ];

  return (
    <div className="space-y-8 pb-12">
      <section className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-md border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-amber-500/20 border-2 border-amber-400/40 flex items-center justify-center text-amber-300 shrink-0">
              <span className="text-xl sm:text-2xl font-black">AD</span>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight">MedZone Operations Console</h1>
                <span className="text-xs font-mono bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded border border-amber-400/30 font-semibold">ADMINISTRATOR</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                {user?.displayName ?? 'Administrator'} · Full access
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={onOpenUsers} className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap">
              <UserCog className="w-4 h-4" /><span>Manage Users</span>
            </button>
            <button onClick={onLaunchCall} className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl text-xs font-semibold border border-slate-700 cursor-pointer whitespace-nowrap">
              <Video className="w-4 h-4 text-teal-400" /><span>Launch Visit</span>
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className={`rounded-2xl border p-4 ${s.tint}`}>
            <s.icon className="w-5 h-5 mb-2" />
            <div className="text-2xl font-black tabular-nums">{s.value}</div>
            <div className="text-xs font-semibold opacity-80">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Anonymized operational analytics — counts and rates only. */}
      <section className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-teal-700" />
          <h2 className="text-sm font-bold text-slate-900">Analytics</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5 text-xs">
          <div>
            <h3 className="font-bold text-slate-700 mb-2">By status</h3>
            <div className="space-y-2">
              {byStatus.map(s => (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-slate-600 capitalize">{s.label}</span>
                    <span className="font-mono font-bold text-slate-800 tabular-nums">{s.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal-600"
                      style={{ width: `${Math.round((s.count / totalVisits) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              <p className="text-slate-500 pt-1">
                Completion: <span className="font-bold text-slate-800">{completionRate}%</span>
              </p>
            </div>
          </div>
          <div>
            <h3 className="font-bold text-slate-700 mb-2">By type</h3>
            <div className="space-y-2">
              {byType.length === 0 && <p className="text-slate-400">No visits recorded.</p>}
              {byType.map(([type, count]) => (
                <div key={type}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-slate-600">{type}</span>
                    <span className="font-mono font-bold text-slate-800 tabular-nums">{count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-sky-600"
                      style={{ width: `${Math.round((count / maxTypeCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              <p className="text-slate-500 pt-1">
                Adherence: <span className="font-bold text-slate-800">{avgAdherence}%</span>
              </p>
            </div>
          </div>
          <div>
            <h3 className="font-bold text-slate-700 mb-2">Top actions</h3>
            <div className="space-y-2">
              {auditByAction.length === 0 && <p className="text-slate-400">No audit events.</p>}
              {auditByAction.map(([action, count]) => (
                <div key={action}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-slate-600 font-mono text-[11px]">{action}</span>
                    <span className="font-mono font-bold text-slate-800 tabular-nums">{count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{ width: `${Math.round((count / maxAuditCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Anonymised clinic statistics — aggregates only, no PHI. */}
      <section className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-teal-700" />
          <h2 className="text-sm font-bold text-slate-900">Anonymised statistics</h2>
          <span className="text-[10px] font-mono text-slate-400">aggregate · no PHI</span>
        </div>
        {!clinicStats ? (
          <p className="text-xs text-slate-400">Loading clinic statistics…</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              { label: 'Total visits', value: clinicStats.totalVisits },
              { label: 'Completion rate', value: `${clinicStats.completionRate}%` },
              { label: 'Waiting now', value: clinicStats.byStatus.inProgress },
              { label: 'Active prescriptions', value: clinicStats.activePrescriptions },
              { label: 'Pending requests', value: clinicStats.pendingConsultationRequests },
              { label: 'Referrals pending', value: clinicStats.referrals.pending },
              { label: 'Audit events', value: clinicStats.auditEvents },
              { label: 'Providers', value: clinicStats.providers },
              { label: 'Abnormal labs', value: clinicStats.labs.abnormal + clinicStats.labs.critical },
              { label: 'Invites issued', value: clinicStats.invitesIssued },
              { label: 'Files shared', value: clinicStats.attachmentsShared },
            ].map(metric => (
              <div key={metric.label} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="text-lg font-black tabular-nums text-slate-900">{metric.value}</div>
                <div className="text-[11px] font-semibold text-slate-500">{metric.label}</div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-400 flex items-center gap-1.5">
          <Link2 className="w-3 h-3" /> Invitations and <Paperclip className="w-3 h-3" /> attachments
          are counted — never their contents.
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-teal-700" />
          <h2 className="text-sm font-bold text-slate-900">Admin</h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 text-xs">
          <button onClick={onOpenUsers} className="text-left p-4 rounded-xl border border-slate-200 hover:border-teal-500 hover:bg-teal-50/50 transition-colors cursor-pointer">
            <div className="font-bold text-slate-900 mb-1">Users</div>
            <div className="text-slate-500">Accounts, roles, access, passwords.</div>
          </button>
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60">
            <div className="font-bold text-slate-900 mb-1">Audit</div>
            <div className="text-slate-500">{auditLogs.length} events · {flagged} flagged.</div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60">
            <div className="font-bold text-slate-900 mb-1">Queue</div>
            <div className="text-slate-500">{appointments.length} total · {todayCount} awaiting.</div>
          </div>
        </div>
      </section>
    </div>
  );
};
