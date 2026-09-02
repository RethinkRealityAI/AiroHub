/**
 * The login card in front of the admin pages — and the honest note on it.
 *
 * This component is a **courtesy, not a lock.** `/admin` is a public URL
 * serving a public chunk; the thing that actually protects the data is the
 * signed cookie the API demands on every `/api/admin/*` call. So the gate is
 * deliberately thin: ask the server whether this browser is signed in, show
 * the page if it is, show a password field if it is not, and — the part that
 * matters — flip straight back to the password field the moment any panel's
 * fetch comes back 401. A dashboard whose session expired mid-read is showing
 * numbers it can no longer refresh, and it should say so without waiting for
 * the person to press reload.
 *
 * It lives inside the two admin pages rather than around their routes
 * (`AdminView`, `ReviewGallery`) so that `App.tsx` keeps one shape for every
 * route. The chunk downloads before the card appears; that costs a stranger
 * some bandwidth and gains them nothing, because the chunk is a shell and the
 * API is the gate.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, LogOut, ShieldCheck, SprayCan } from 'lucide-react';
import { GlassPanel } from '../ui/Glass';
import { adminLogin, adminLogout, adminSession, onUnauthorized } from './api';

type GateState = 'checking' | 'in' | 'out';

/**
 * The signed-in pill for an admin page header, with the way out.
 *
 * Reloads after signing out instead of flipping state in place: the pages
 * behind it hold fetched rows, half-typed notes and an upload draft, and the
 * cheapest way to guarantee none of that survives the session that fetched it
 * is to throw the document away.
 */
export const AdminSessionChip: React.FC = () => {
  const [busy, setBusy] = useState(false);

  const signOut = useCallback(async () => {
    setBusy(true);
    await adminLogout();
    window.location.reload();
  }, []);

  return (
    <span className="glass glass-sheen inline-flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 text-[10px] font-semibold text-white/70">
      <ShieldCheck size={12} className="shrink-0 text-[#34D399]" />
      Signed in
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy}
        className="tap inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-1 text-[10px] font-semibold text-white/55 hover:text-white disabled:opacity-50"
      >
        {busy ? <Loader2 size={10} className="animate-spin" /> : <LogOut size={10} />}
        Log out
      </button>
    </span>
  );
};

const AdminGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<GateState>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await adminSession();
        if (!cancelled) setState(session.authenticated ? 'in' : 'out');
      } catch {
        // The probe answers 200 even when signed out, so a failure here is the
        // network or a server that cannot answer at all. Either way there is
        // nothing to show but the password field.
        if (!cancelled) setState('out');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 from any panel, at any time.
  useEffect(
    () =>
      onUnauthorized(() => {
        setState('out');
        setError('That session has expired. Sign in again.');
      }),
    []
  );

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting || !password) return;
      setSubmitting(true);
      setError(null);
      try {
        await adminLogin(password);
        setPassword('');
        setState('in');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sign-in failed.');
      } finally {
        setSubmitting(false);
      }
    },
    [password, submitting]
  );

  if (state === 'in') return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className="min-h-[100svh] stage-vignette grid place-items-center">
        <span className="airo-breathe label-caps text-white/40">Checking session…</span>
      </div>
    );
  }

  return (
    <div className="min-h-[100svh] stage-vignette grid place-items-center px-4 text-white">
      <GlassPanel className="w-full max-w-sm p-7">
        <div className="flex items-center gap-2.5">
          <SprayCan size={22} className="shrink-0 text-[var(--color-airo-flame)]" />
          <h1 className="paint-title text-2xl font-black leading-none tracking-tight">
            AiroHub Admin
          </h1>
        </div>

        <form data-testid="admin-login" onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="label-caps text-white/35">Password</span>
            <input
              name="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 text-[13px] text-white placeholder:text-white/25 focus:border-[var(--color-airo-aqua)]/60 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={submitting || password.length === 0}
            className="paint-btn paint-cta tap mt-1 inline-flex items-center justify-center gap-2 self-start px-9 py-3 text-[13px] font-bold text-white disabled:opacity-50"
            style={
              { '--paint': 'linear-gradient(120deg, #FF4D1C, #FF7A34 70%, #FFB020)' } as React.CSSProperties
            }
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            Sign in
          </button>

          {error && (
            <p role="alert" className="text-[12px] leading-relaxed text-[#FF4D1C]">
              {error}
            </p>
          )}
        </form>

        <p className="mt-6 border-t border-white/8 pt-4 text-[11px] leading-relaxed text-white/40">
          This card is a doorway, not the lock: the password is checked by the API, and every
          admin request carries the session cookie it hands back. Sessions last 12 hours.
        </p>
      </GlassPanel>
    </div>
  );
};

export default AdminGate;
