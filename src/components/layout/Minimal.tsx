import React from 'react';
import { Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useMedZone } from '../../context/MedZoneContext';

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map(p => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase() || '•';

export const MinimalHeader: React.FC<{
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  back?: React.ReactNode;
}> = ({ title, subtitle, actions, back }) => {
  const { user } = useAuth();
  const { signedInUserName, notifications } = useMedZone();
  const name = user?.displayName ?? signedInUserName ?? 'there';
  const unread = notifications.filter(n => !n.read).length;

  return (
    <header className="bg-white border-b border-[#e8eef0]">
      <div className="px-6 sm:px-8 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {back}
          <div className="min-w-0">
            <h1 className="text-[26px] leading-8 font-extrabold tracking-tight text-[#16232b] truncate">
              {title}
            </h1>
            <p className="text-[13px] text-[#7b8a94] mt-0.5 truncate">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {actions}
          <span className="relative w-9 h-9 rounded-full flex items-center justify-center text-[#5b6b75]">
            <Bell className="w-[18px] h-[18px]" strokeWidth={1.8} />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#0e8aa0]" />
            )}
          </span>
          <span className="hidden sm:flex items-center gap-2.5 pl-1">
            <span className="text-[13px] font-semibold text-[#16232b] max-w-[140px] truncate">
              {name}
            </span>
            <span className="w-9 h-9 rounded-xl bg-[#0e8aa0] text-white text-[12px] font-bold flex items-center justify-center">
              {initialsOf(name)}
            </span>
          </span>
        </div>
      </div>
    </header>
  );
};
