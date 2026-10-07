import React from 'react';
import {
  LayoutDashboard,
  Stethoscope,
  Users,
  Calendar,
  Clock,
  Settings,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  FileCode2,
} from 'lucide-react';
import { useMedZone } from '../../context/MedZoneContext';

interface AppSidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  currentTab,
  setCurrentTab,
  collapsed,
  setCollapsed,
}) => {
  const { setShowComplianceModal, setShowFhirModal } = useMedZone();

  const navItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      subtext: 'Overview & metrics',
      icon: LayoutDashboard,
    },
    {
      id: 'followups',
      label: 'Follow-ups / Consultations',
      subtext: 'Manage follow-ups',
      icon: Stethoscope,
    },
    {
      id: 'contacts',
      label: 'Contacts',
      subtext: 'Patient directory',
      icon: Users,
    },
    {
      id: 'appointments',
      label: 'Appointments',
      subtext: 'Calendar schedule',
      icon: Calendar,
    },
    {
      id: 'availability',
      label: 'Availability',
      subtext: 'Working hours',
      icon: Clock,
    },
  ];

  return (
    <aside
      className={`bg-white border-r border-slate-200/90 flex flex-col justify-between transition-all duration-200 shrink-0 select-none z-30 ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      <div>
        {/* Brand Lockup: HCW@Home */}
        <div className="h-16 flex items-center px-5 border-b border-slate-100 justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            {/* Logo Icon */}
            <div className="w-9 h-9 rounded-xl bg-teal-800 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-xs">
              <span className="tracking-tighter">H</span>
            </div>
            {!collapsed && (
              <div className="leading-tight">
                <span className="font-extrabold text-base tracking-tight text-slate-900 block">
                  HCW<span className="text-teal-700">@Home</span>
                </span>
                <span className="text-[10px] text-slate-400 font-medium block">
                  Telemedicine Workstation
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer hidden sm:block"
            title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="p-3 space-y-1.5">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-left transition-all cursor-pointer ${
                  isActive
                    ? 'bg-teal-50/80 text-teal-900 font-semibold border border-teal-200/70 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon
                  className={`w-5 h-5 shrink-0 ${
                    isActive ? 'text-teal-700' : 'text-slate-400'
                  }`}
                />
                {!collapsed && (
                  <div className="overflow-hidden">
                    <span className="text-xs font-semibold block truncate">
                      {item.label}
                    </span>
                    <span className="text-[10px] text-slate-400 font-normal block truncate">
                      {item.subtext}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Tool Links */}
      <div className="p-3 border-t border-slate-100 space-y-1">
        <button
          onClick={() => setShowFhirModal(true)}
          className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
        >
          <FileCode2 className="w-4 h-4 text-slate-400 shrink-0" />
          {!collapsed && <span className="font-medium">FHIR R4 / HL7</span>}
        </button>

        <button
          onClick={() => setShowComplianceModal(true)}
          className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
        >
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          {!collapsed && <span className="font-medium">HIPAA 256-Bit</span>}
        </button>
      </div>
    </aside>
  );
};
