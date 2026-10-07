import React, { useState } from 'react';
import {
  Bell,
  ShieldCheck,
  FileCode2,
  Download,
  Volume2,
  VolumeX,
  User,
  Stethoscope,
  X,
  CheckCircle2,
  Clock,
  Pill,
  Video,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, setCurrentTab }) => {
  const {
    role,
    setRole,
    patient,
    notifications,
    unreadNotifsCount,
    markNotificationRead,
    clearAllNotifications,
    soundEnabled,
    toggleSound,
    setShowComplianceModal,
    setShowFhirModal,
    setShowSummaryExportModal,
    mfaVerified,
  } = useMedZone();

  const [showNotifMenu, setShowNotifMenu] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ZONE 1: Clean Brand Wordmark (Strict single text element) */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentTab('overview')}
              className="text-xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2 hover:opacity-90 transition-opacity"
            >
              <span className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center text-sm font-black shadow-xs">
                MZ
              </span>
              <span>MedZone</span>
            </button>
          </div>

          {/* ZONE 2: 4-6 Clean Text Navigation Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <button
              onClick={() => setCurrentTab('overview')}
              className={`transition-colors whitespace-nowrap cursor-pointer py-1 ${
                currentTab === 'overview'
                  ? 'text-teal-700 font-semibold border-b-2 border-teal-700'
                  : 'hover:text-slate-900'
              }`}
            >
              {role === 'patient' ? 'My Health Hub' : 'Clinical Queue'}
            </button>

            <button
              onClick={() => setCurrentTab('appointments')}
              className={`transition-colors whitespace-nowrap cursor-pointer py-1 ${
                currentTab === 'appointments'
                  ? 'text-teal-700 font-semibold border-b-2 border-teal-700'
                  : 'hover:text-slate-900'
              }`}
            >
              Consultations
            </button>

            <button
              onClick={() => setCurrentTab('prescriptions')}
              className={`transition-colors whitespace-nowrap cursor-pointer py-1 ${
                currentTab === 'prescriptions'
                  ? 'text-teal-700 font-semibold border-b-2 border-teal-700'
                  : 'hover:text-slate-900'
              }`}
            >
              Prescriptions
            </button>

            <button
              onClick={() => setCurrentTab('records')}
              className={`transition-colors whitespace-nowrap cursor-pointer py-1 ${
                currentTab === 'records'
                  ? 'text-teal-700 font-semibold border-b-2 border-teal-700'
                  : 'hover:text-slate-900'
              }`}
            >
              EHR Records
            </button>

            <button
              onClick={() => setShowFhirModal(true)}
              className="text-slate-600 hover:text-teal-700 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 py-1"
            >
              <FileCode2 className="w-4 h-4 text-slate-500" />
              <span>FHIR R4 / HL7</span>
            </button>
          </nav>

          {/* ZONE 3: 1-2 Primary Action Areas (Role Switcher & Tools) */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Dual-Role Segmented Switcher */}
            <div
              className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200/80"
              role="group"
              aria-label="Portal Mode"
            >
              <button
                onClick={() => setRole('patient')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${
                  role === 'patient'
                    ? 'bg-white text-teal-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Patient</span>
              </button>
              <button
                onClick={() => setRole('clinician')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${
                  role === 'clinician'
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Stethoscope className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Clinician</span>
              </button>
            </div>

            {/* Quick Export Summary Button */}
            <button
              onClick={() => setShowSummaryExportModal(true)}
              title="Export Patient Health Summary (PDF & FHIR)"
              className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200/80 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>Export</span>
            </button>

            {/* Audio Toggle */}
            <button
              onClick={toggleSound}
              title={soundEnabled ? 'Mute Clinical Audio' : 'Enable Clinical Audio'}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-teal-700" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {/* HIPAA & MFA Security Button */}
            <button
              onClick={() => setShowComplianceModal(true)}
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200/80 transition-colors cursor-pointer"
              title="HIPAA Security & MFA Status"
            >
              <ShieldCheck
                className={`w-4 h-4 ${mfaVerified ? 'text-emerald-600' : 'text-amber-500'}`}
              />
              <span className="hidden xl:inline text-slate-600">HIPAA 256-bit</span>
            </button>

            {/* Notification Bell with Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowNotifMenu(!showNotifMenu)}
                className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifsCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-600 rounded-full ring-2 ring-white animate-pulse" />
                )}
              </button>

              {/* Notification Popover */}
              {showNotifMenu && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-slate-200 z-50 p-3 text-left">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Notifications
                      </span>
                      {unreadNotifsCount > 0 && (
                        <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">
                          {unreadNotifsCount} new
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={clearAllNotifications}
                        className="text-[11px] text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                      >
                        Mark all read
                      </button>
                      <button
                        onClick={() => setShowNotifMenu(false)}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="max-h-72 overflow-y-auto space-y-2">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-4">No notifications</p>
                    ) : (
                      notifications.slice(0, 6).map(notif => (
                        <div
                          key={notif.id}
                          onClick={() => markNotificationRead(notif.id)}
                          className={`p-2.5 rounded-lg text-xs transition-colors cursor-pointer border ${
                            notif.read
                              ? 'bg-slate-50/50 border-slate-100 text-slate-600'
                              : 'bg-teal-50/50 border-teal-100 text-slate-900 font-medium'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {notif.type === 'medication' && (
                              <Pill className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
                            )}
                            {notif.type === 'appointment' && (
                              <Video className="w-4 h-4 text-cyan-600 shrink-0 mt-0.5" />
                            )}
                            {notif.type === 'clinical' && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            )}
                            {notif.type === 'security' && (
                              <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold">{notif.title}</span>
                                <span className="text-[10px] text-slate-400 font-normal">
                                  {notif.timestamp}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5 font-normal">
                                {notif.message}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Avatar Chip */}
            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200">
              <img
                src={role === 'patient' ? patient.avatarUrl : '/src/assets/images/doctor_cardiology_chen_1791375844784.jpg'}
                alt="User"
                className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-300"
              />
              <div className="text-left leading-tight hidden lg:block">
                <p className="text-xs font-semibold text-slate-900 truncate max-w-[110px]">
                  {role === 'patient' ? patient.name : 'Dr. Sarah Chen'}
                </p>
                <p className="text-[10px] text-slate-500 font-mono">
                  {role === 'patient' ? patient.mrn : 'NPI: 1892019482'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Secondary Tab Navigation */}
      <div className="flex md:hidden overflow-x-auto px-4 py-2 border-t border-slate-100 gap-4 text-xs font-medium text-slate-600 bg-slate-50/80">
        <button
          onClick={() => setCurrentTab('overview')}
          className={`whitespace-nowrap ${currentTab === 'overview' ? 'text-teal-700 font-bold' : ''}`}
        >
          {role === 'patient' ? 'Hub' : 'Queue'}
        </button>
        <button
          onClick={() => setCurrentTab('appointments')}
          className={`whitespace-nowrap ${currentTab === 'appointments' ? 'text-teal-700 font-bold' : ''}`}
        >
          Consultations
        </button>
        <button
          onClick={() => setCurrentTab('prescriptions')}
          className={`whitespace-nowrap ${currentTab === 'prescriptions' ? 'text-teal-700 font-bold' : ''}`}
        >
          Prescriptions
        </button>
        <button
          onClick={() => setCurrentTab('records')}
          className={`whitespace-nowrap ${currentTab === 'records' ? 'text-teal-700 font-bold' : ''}`}
        >
          EHR Records
        </button>
        <button
          onClick={() => setShowFhirModal(true)}
          className="whitespace-nowrap text-teal-700 font-semibold"
        >
          FHIR R4
        </button>
      </div>
    </header>
  );
};
