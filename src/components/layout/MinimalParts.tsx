import React from 'react';

export const MinimalCard: React.FC<{
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  amber?: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, icon, action, amber, children }) => (
  <section
    className={`rounded-2xl border bg-white overflow-hidden shadow-[0_1px_2px_rgba(16,35,43,0.04)] ${
      amber ? 'border-[#fbe9b7]' : 'border-[#e8eef0]'
    }`}
  >
    {(title || action) && (
      <div
        className={`flex items-center justify-between gap-4 px-6 py-4 border-b ${
          amber ? 'bg-[#fffaeb] border-[#fbe9b7]' : 'bg-white border-[#eef3f4]'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <span
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                amber ? 'text-[#b7791f]' : 'bg-[#eef7f8] text-[#0e8aa0]'
              }`}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {title && (
              <h2 className="text-[15px] font-bold text-[#16232b] truncate">{title}</h2>
            )}
            {subtitle && (
              <p className="text-[12.5px] text-[#7b8a94] truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {action}
      </div>
    )}
    {children}
  </section>
);

export const OutlineButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
> = ({ label, className = '', ...rest }) => (
  <button
    {...rest}
    className={`px-4 py-1.5 rounded-full border border-[#0e8aa0] text-[#0e7d90] text-[12.5px] font-semibold hover:bg-[#eef7f8] transition-colors cursor-pointer whitespace-nowrap ${className}`}
  >
    {label}
  </button>
);

export const EmptyState: React.FC<{ icon: React.ReactNode; title: string; hint?: string }> = ({
  icon,
  title,
  hint,
}) => (
  <div className="py-16 px-6 flex flex-col items-center text-center">
    <div className="text-[#c3ced4] mb-4">{icon}</div>
    <p className="text-[14px] text-[#a9b7bf]">{title}</p>
    {hint && <p className="text-[14px] text-[#5b6b75] mt-2">{hint}</p>}
  </div>
);

