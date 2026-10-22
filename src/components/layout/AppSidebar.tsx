import React from 'react';
import {
  LayoutDashboard,
  LogOut,
  Stethoscope,
  Users,
  Calendar,
  Pill,
  UserCog,
  Globe,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage, LANGUAGES, type LanguageCode } from '../../context/LanguageContext';
import { useMedZone } from '../../context/MedZoneContext';
import type { RbacSubject } from '../../lib/rbac';
import { visibleTabs } from '../../lib/rbac';
import type { TabId } from '../../types/auth';

interface AppSidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  collapsed?: boolean;
  setCollapsed?: (collapsed: boolean) => void;
}

/** Icon per tab. Labels come from the shared policy (src/lib/rbac.ts). */
const TAB_ICONS: Record<TabId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  followups: Stethoscope,
  appointments: Calendar,
  contacts: Users,
  availability: Pill,
  users: UserCog,
};

/** i18n key per tab, so the rail follows the patient's chosen language. */
const TAB_I18N: Record<TabId, string> = {
  dashboard: 'nav.home',
  followups: 'nav.visits',
  appointments: 'nav.schedule',
  contacts: 'nav.records',
  availability: 'nav.meds',
  users: 'nav.users',
};

export const AppSidebar: React.FC<AppSidebarProps> = ({
  currentTab,
  setCurrentTab,
}) => {
  const { user, logout } = useAuth();
  const { setShowComplianceModal } = useMedZone();
  const { t, lang, setLang } = useLanguage();

  // Navigation is derived from the same policy the API enforces, so the rail
  // cannot offer a destination the server would refuse. A patient sees only
  // the tabs their role and grants allow.
  const subject: RbacSubject | null = user
    ? { role: user.role, isAdmin: user.isAdmin, modules: user.modules }
    : null;
  const navItems = visibleTabs(subject).map(id => ({
    id: id as string,
    label: t(TAB_I18N[id]),
    icon: TAB_ICONS[id],
  }));

  return (
    <aside className="w-[68px] sm:w-[76px] shrink-0 bg-white border-r border-[#e8eef0] flex flex-col items-center py-5 justify-between z-30 select-none">
      <div className="flex flex-col items-center gap-6 w-full">
        <div className="w-10 h-10 rounded-2xl bg-[#0e8aa0] text-white flex items-center justify-center font-black text-[15px]">
          M
        </div>

        <nav aria-label="Primary navigation" className="flex flex-col items-center gap-1.5 w-full px-2">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCurrentTab(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex flex-col items-center gap-1 py-2.5 rounded-2xl transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#e9f4f6] text-[#0b6e81]'
                    : 'text-[#5b6b75] hover:text-[#16232b] hover:bg-[#f6f9fa]'
                }`}
              >
                <Icon
                  className="w-5 h-5 shrink-0"
                  strokeWidth={isActive ? 2.2 : 1.8}
                />
                <span className={`text-[10px] leading-none ${isActive ? 'font-bold' : 'font-medium'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom — language + avatar + sign out */}
      <div className="flex flex-col items-center gap-3">
        <label
          className="flex flex-col items-center gap-1 text-[10px] text-[#5b6b75]"
          title={t('app.language')}
        >
          <Globe className="w-[18px] h-[18px]" strokeWidth={1.8} />
          <select
            value={lang}
            aria-label={t('app.language')}
            onChange={e => setLang(e.target.value as LanguageCode)}
            className="w-[56px] bg-white border border-[#e8eef0] rounded-lg px-1 py-0.5 text-[10px] font-semibold text-[#3d4f59] focus:outline-none focus:border-[#0e8aa0] cursor-pointer"
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>
                {l.native}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setShowComplianceModal(true)}
          title="Security & privacy"
          aria-label="Open security and privacy settings"
          className="w-10 h-10 rounded-full flex items-center justify-center text-[#5b6b75] hover:text-[#0b6e81] hover:bg-[#e9f4f6] transition-colors cursor-pointer"
        >
          <ShieldCheck className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
        {user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={`${user.displayName} avatar`}
            title={user.displayName}
            className="w-10 h-10 rounded-full object-cover border border-[#e8eef0]"
          />
        ) : (
          <span
            title={user?.displayName ?? 'Care Team'}
            aria-label={`Signed in as ${user?.displayName ?? 'Care Team'}`}
            className="w-10 h-10 rounded-full bg-[#eef2f3] text-[#3d4f59] text-[12px] font-bold flex items-center justify-center"
          >
            {(user?.displayName ?? 'C').slice(0, 1).toUpperCase()}
          </span>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          title="Sign out"
          aria-label="Sign out"
          className="w-10 h-10 rounded-full flex items-center justify-center text-[#5b6b75] hover:text-[#b4232a] hover:bg-[#fef2f2] transition-colors cursor-pointer"
        >
          <LogOut className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
      </div>
    </aside>
  );
};
