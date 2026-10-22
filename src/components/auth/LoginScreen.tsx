/**
 * MedZone login screen.
 *
 * Mirrors the elgon Login component: username + password form backed by the
 * session API. Styled for the MedZone light clinical theme.
 *
 * Accessibility notes: the error is announced as an alert, the submit button
 * reports its busy state, and the password visibility control is a real
 * button with an accessible name (not a text glyph).
 */
import React, { useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    if (!username.trim() || !password) {
      setError('Enter your username and password to continue.');
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#f2f6f7] text-[#16232b] flex items-center justify-center p-4 font-sans antialiased">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div
            aria-hidden="true"
            className="w-14 h-14 rounded-2xl bg-[#0e8aa0] text-white flex items-center justify-center font-black text-xl shadow-[0_1px_2px_rgba(16,35,43,0.12)]"
          >
            <span className="tracking-tighter">M</span>
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">MedZone</h1>
          <p className="mt-1 text-[13px] text-[#5b6b75]">Care, minus the clutter.</p>
        </div>

        <form
          aria-busy={isLoading}
          onSubmit={e => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="bg-white border border-[#e8eef0] rounded-2xl p-6 space-y-4 shadow-[0_1px_2px_rgba(16,35,43,0.04)]"
        >
          <div>
            <label htmlFor="username" className="block text-xs font-semibold text-[#3d4f59] mb-1.5">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              placeholder="Username"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'login-error' : undefined}
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#e8eef0] text-[#16232b] text-sm focus:outline-none focus:border-[#0e8aa0]"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-[#3d4f59] mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                placeholder="Password"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login-error' : undefined}
                className="w-full px-3 py-2.5 pr-12 rounded-xl bg-white border border-[#e8eef0] text-[#16232b] text-sm focus:outline-none focus:border-[#0e8aa0]"
              />
              <button
                type="button"
                onClick={() => setShowPassword(value => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 w-11 flex items-center justify-center text-[#5b6b75] hover:text-[#16232b] rounded-r-xl cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Eye className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div
              id="login-error"
              role="alert"
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-4 py-2.5 rounded-xl bg-[#0e8aa0] hover:bg-[#0b6e81] text-white text-sm font-semibold transition-colors disabled:opacity-60 cursor-pointer"
          >
            {isLoading ? 'Signing in…' : 'Sign In'}
          </button>

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#5b6b75] pt-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#0b6e81]" aria-hidden="true" />
            Secure session · clinical access is audited
          </p>
        </form>
      </div>
    </div>
  );
};
