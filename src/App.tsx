/**
 * MedZone - Telemedicine & Follow-ups Platform
 * Designed to match the exact enterprise clinical consultation specification in the design reference.
 */

import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { MedZoneProvider, useMedZone } from './context/MedZoneContext';
import type { RbacSubject } from './lib/rbac';
import { canAccessTab, defaultTabFor } from './lib/rbac';
import type { TabId } from './types/auth';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { fetchInviteSummary } from './lib/api';
import { VitalsProvider } from './context/VitalsContext';
import { LoginScreen } from './components/auth/LoginScreen';
import { AppSidebar } from './components/layout/AppSidebar';
import { ErrorBoundary } from './components/ErrorBoundary';

// Chart screens are route-like: load each one when it is first opened instead
// of shipping the video room, every dashboard and every table in the sign-in
// payload. The band and modal shell stay eager so navigation is instant.
const ConsultationRoom = lazy(() =>
  import('./components/consultation/ConsultationRoom').then((m) => ({ default: m.ConsultationRoom }))
);
const AdminDashboard = lazy(() =>
  import('./components/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
const FollowUpDetailView = lazy(() =>
  import('./components/followup/FollowUpDetailView').then((m) => ({ default: m.FollowUpDetailView }))
);
const ClinicianDashboard = lazy(() =>
  import('./components/clinician/ClinicianDashboard').then((m) => ({ default: m.ClinicianDashboard }))
);
const PatientDashboard = lazy(() =>
  import('./components/patient/PatientDashboard').then((m) => ({ default: m.PatientDashboard }))
);
const AppointmentsView = lazy(() =>
  import('./components/views/AppointmentsView').then((m) => ({ default: m.AppointmentsView }))
);
const PrescriptionsView = lazy(() =>
  import('./components/views/PrescriptionsView').then((m) => ({ default: m.PrescriptionsView }))
);
const RecordsView = lazy(() =>
  import('./components/views/RecordsView').then((m) => ({ default: m.RecordsView }))
);
const UserManagementView = lazy(() =>
  import('./components/users/UserManagementView').then((m) => ({ default: m.UserManagementView }))
);
const FHIRInteroperabilityModal = lazy(() =>
  import('./components/fhir/FHIRInteroperabilityModal').then((m) => ({
    default: m.FHIRInteroperabilityModal,
  }))
);
const HIPAAComplianceModal = lazy(() =>
  import('./components/security/HIPAAComplianceModal').then((m) => ({
    default: m.HIPAAComplianceModal,
  }))
);
const MedicalSummaryExportModal = lazy(() =>
  import('./components/export/MedicalSummaryExportModal').then((m) => ({
    default: m.MedicalSummaryExportModal,
  }))
);

/** Neutral placeholder while a chart chunk is on the wire. */
const ViewFallback: React.FC = () => (
  <div role="status" aria-live="polite" className="p-8 text-sm text-[#5b6b75]">
    Loading view…
  </div>
);
function GatedShell() {
  const { isAuthenticated, loading } = useAuth();
  const { isHydrated } = useMedZone();
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-screen w-screen items-center justify-center bg-[#f2f6f7] text-sm text-[#5b6b75]"
      >
        Restoring session…
      </div>
    );
  }
  if (!isAuthenticated) return <LoginScreen />;
  // Backend-only store: never render the shell before the bootstrap read has
  // settled, so no empty or stale pre-backend state can flash on screen.
  if (!isHydrated) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-screen w-screen items-center justify-center bg-[#f2f6f7] text-sm text-[#5b6b75]"
      >
        Loading clinical records…
      </div>
    );
  }
  return <MainAppShell />;
}

function MainAppShell() {
  const {
    activeConsultation,
    appointments,
    startConsultation,
    triggerPushNotification,
    showComplianceModal,
    showFhirModal,
    showSummaryExportModal,
  } = useMedZone();
  const { user, effectiveRole } = useAuth();
  const { isRtl } = useLanguage();
  const [currentTab, setCurrentTab] = useState<string>('followups');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  // One-click patient invitation link (HCW@Home parity). The token is read
  // from the address bar once the shell mounts (i.e. after sign-in and
  // hydration), then resolved to the visit and joined automatically — no
  // navigation for the invited patient.
  const inviteToken = useMemo<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const match = window.location.pathname.match(/^\/join\/([A-Za-z0-9_-]+)\/?$/);
    if (match) return match[1];
    return new URLSearchParams(window.location.search).get('join');
  }, []);
  const [inviteResolved, setInviteResolved] = useState(false);
  useEffect(() => {
    if (!inviteToken || inviteResolved) return;
    let cancelled = false;
    (async () => {
      const summary = await fetchInviteSummary(inviteToken);
      if (cancelled) return;
      const target = summary ? appointments.find(a => a.id === summary.appointmentId) : undefined;
      if (summary && summary.valid && target) {
        await startConsultation(target);
      } else if (summary && summary.valid && !target) {
        triggerPushNotification(
          'Invitation Link',
          'This visit is not linked to your account. Sign in with the account the visit was booked for, or ask the clinic.',
          'appointment',
        );
      } else if (!summary || !summary.valid) {
        triggerPushNotification(
          'Invitation Link',
          'That invitation link is no longer valid. Please ask the clinic to resend it.',
          'appointment',
        );
      }
      setInviteResolved(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, inviteResolved, appointments, startConsultation, triggerPushNotification]);

  // The account's RBAC subject: role, module grants and (for patients) the
  // chart they own. Everything below is decided from this, never from the
  // requested tab — the policy in src/lib/rbac.ts is the single source.
  const subject: RbacSubject | null = user
    ? { role: user.role, isAdmin: user.isAdmin, modules: user.modules }
    : null;
  const landingTab = defaultTabFor(subject);

  // A tab the account may not open (a stale tab from the previous session, or
  // one set by hand) falls back to the role's landing tab. Patients land on
  // their own dashboard rather than the clinical follow-up chart.
  useEffect(() => {
    if (!canAccessTab(subject, currentTab as TabId)) setCurrentTab(landingTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab, landingTab, user?.id, user?.role, user?.isAdmin]);

  // "Launch" is only offered for visits the server could actually admit —
  // a scheduled visit, never an arbitrary roster row. Without one, the action
  // explains itself instead of opening a room the backend would refuse.
  const launchFirstScheduledCall = () => {
    const next = appointments.find((appointment) => appointment.status === 'scheduled');
    if (!next) {
      triggerPushNotification(
        'No Scheduled Visits',
        'There is no scheduled tele-visit to join right now. Book one from the appointments view first.',
        'appointment',
      );
      return;
    }
    void startConsultation(next);
  };

  // FIX 1: the video room was never mounted. When a call starts (via any
  // "Join/Launch" button), render the full-screen ConsultationRoom overlay.
  // Vitals are scoped to the active chart: the provider resolves the visit's
  // patient id through context, so the room shows recorded data or an honest
  // empty state.
  if (activeConsultation) {
    return (
      <Suspense
        fallback={
          <div
            role="status"
            aria-live="polite"
            className="flex h-screen w-screen items-center justify-center bg-[#f2f6f7] text-sm text-[#5b6b75]"
          >
            Preparing secure room…
          </div>
        }
      >
        <VitalsProvider patientId={activeConsultation.patientId ?? null}>
          <ConsultationRoom />
        </VitalsProvider>
      </Suspense>
    );
  }

  // Only the tab the policy allows is rendered; the guard above keeps the
  // state in step with it.
  const canOpen = (tab: TabId) => canAccessTab(subject, tab);

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="flex h-screen w-screen overflow-hidden bg-[#f2f6f7] font-sans antialiased text-[#16232b]"
    >
      <a href="#main-content" className="mz-skip-link">
        Skip to main content
      </a>

      {/* Minimal icon-rail navigation */}
      <AppSidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      {/* Main View Area */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 flex flex-col overflow-y-auto min-w-0 focus:outline-none"
      >
        <Suspense fallback={<ViewFallback />}>
        {currentTab === 'followups' && canOpen('followups') && <FollowUpDetailView />}
        {currentTab === 'dashboard' && canOpen('dashboard') && (
          <div className="px-6 sm:px-8 py-6 max-w-[1120px] mx-auto w-full">
            {effectiveRole === 'admin' ? (
              <AdminDashboard onOpenUsers={() => setCurrentTab('users')} onLaunchCall={launchFirstScheduledCall} />
            ) : effectiveRole === 'clinician' ? (
              <ClinicianDashboard />
            ) : (
              <PatientDashboard />
            )}
          </div>
        )}
        {currentTab === 'appointments' && canOpen('appointments') && (
          <div className="p-6 sm:p-8 max-w-7xl mx-auto w-full">
            <AppointmentsView />
          </div>
        )}
        {currentTab === 'contacts' && canOpen('contacts') && (
          <div className="p-6 sm:p-8 max-w-7xl mx-auto w-full">
            <RecordsView />
          </div>
        )}
        {currentTab === 'availability' && canOpen('availability') && (
          <div className="p-6 sm:p-8 max-w-7xl mx-auto w-full">
            <PrescriptionsView />
          </div>
        )}
        {currentTab === 'users' && canOpen('users') && (
          <div className="p-6 sm:p-8 max-w-7xl mx-auto w-full">
            <UserManagementView />
          </div>
        )}
        </Suspense>
      </main>

      {/* Global Clinical Modals — mounted only when opened, so their document
          builders and crypto panels stay out of the sign-in bundle. */}
      <Suspense fallback={null}>
        {showFhirModal && <FHIRInteroperabilityModal />}
        {showComplianceModal && <HIPAAComplianceModal />}
        {showSummaryExportModal && <MedicalSummaryExportModal />}
      </Suspense>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <MedZoneProvider>
            <GatedShell />
          </MedZoneProvider>
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
