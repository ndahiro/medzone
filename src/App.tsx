/**
 * HCW@Home / MedZone - Telemedicine & Follow-ups Platform
 * Designed to match the exact enterprise clinical consultation specification in the design reference.
 */

import React, { useState } from 'react';
import { MedZoneProvider, useMedZone } from './context/MedZoneContext';
import { AppSidebar } from './components/layout/AppSidebar';
import { FollowUpDetailView } from './components/followup/FollowUpDetailView';
import { ClinicianDashboard } from './components/clinician/ClinicianDashboard';
import { PatientDashboard } from './components/patient/PatientDashboard';
import { AppointmentsView } from './components/views/AppointmentsView';
import { PrescriptionsView } from './components/views/PrescriptionsView';
import { RecordsView } from './components/views/RecordsView';
import { FHIRInteroperabilityModal } from './components/fhir/FHIRInteroperabilityModal';
import { HIPAAComplianceModal } from './components/security/HIPAAComplianceModal';
import { MedicalSummaryExportModal } from './components/export/MedicalSummaryExportModal';

function MainAppShell() {
  const { role } = useMedZone();
  // Default to 'followups' which renders the exact Follow-up Details view from the PDF!
  const [currentTab, setCurrentTab] = useState<string>('followups');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 font-sans antialiased text-slate-900">
      {/* HCW@Home Sidebar Navigation */}
      <AppSidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col overflow-y-auto min-w-0">
        {currentTab === 'followups' && <FollowUpDetailView />}
        {currentTab === 'dashboard' && (
          <div className="p-6 sm:p-8 max-w-7xl mx-auto w-full">
            {role === 'clinician' ? <ClinicianDashboard /> : <PatientDashboard />}
          </div>
        )}
        {currentTab === 'appointments' && (
          <div className="p-6 sm:p-8 max-w-7xl mx-auto w-full">
            <AppointmentsView />
          </div>
        )}
        {currentTab === 'contacts' && (
          <div className="p-6 sm:p-8 max-w-7xl mx-auto w-full">
            <RecordsView />
          </div>
        )}
        {currentTab === 'availability' && (
          <div className="p-6 sm:p-8 max-w-7xl mx-auto w-full">
            <PrescriptionsView />
          </div>
        )}
      </div>

      {/* Global Clinical Modals */}
      <FHIRInteroperabilityModal />
      <HIPAAComplianceModal />
      <MedicalSummaryExportModal />
    </div>
  );
}

export default function App() {
  return (
    <MedZoneProvider>
      <MainAppShell />
    </MedZoneProvider>
  );
}
