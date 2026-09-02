/**
 * The small, shared pieces of the admin dashboard.
 *
 * These were all born inside `AdminView.tsx`, back when the page had exactly
 * one job. The dashboard now has four tabs written across four files, and a
 * section heading that looks different on the Overview tab than on the Models
 * tab is how a dashboard stops reading as one product. Lifting them here is a
 * pure move: same markup, same timings, same behaviour — `AdminView` imports
 * what it used to declare.
 *
 * The two hooks are idioms rather than components. Both encode a timing that
 * was tuned in place: a copy confirmation long enough to read (1.6 s) and a
 * destructive tap that disarms itself if you walk away (4 s), so an armed
 * "click again to confirm" never waits patiently for tomorrow's careless
 * click.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

/* --------------------------------------------------------------- components */

export function SectionHeader({
  icon,
  accent,
  title,
  sub,
  right,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  sub: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        <span
          className="glass glass-sheen grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{ color: accent }}
        >
          {icon}
        </span>
        <div>
          <h2 className="paint-title text-xl font-black tracking-tight sm:text-2xl">{title}</h2>
          <p className="mt-0.5 text-[11px] text-white/45">{sub}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="label-caps text-white/35">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] font-bold text-white/90">{value}</div>
    </div>
  );
}

export function BudgetField({
  label,
  value,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  step: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="label-caps text-white/35">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n > 0) onCommit(n);
        }}
        className="w-full rounded-xl border border-white/12 bg-white/[0.06] px-3 py-2 font-mono text-[12px] text-white focus:border-[var(--color-airo-aqua)]/60 focus:outline-none"
      />
    </label>
  );
}

/* -------------------------------------------------------------------- idioms */

/**
 * "Copied" state for a list of copy buttons, keyed by row.
 *
 * A blocked clipboard (no permission, insecure origin) is not an error worth
 * showing: the button simply does not flip, which is the truth.
 */
export function useCopyPing(resetMs = 1600): {
  copiedId: string | null;
  copy: (id: string, text: string) => Promise<void>;
} {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(
    async (id: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopiedId((c) => (c === id ? null : c)), resetMs);
      } catch {
        // Clipboard blocked — the copy button just stays inert.
      }
    },
    [resetMs]
  );

  return { copiedId, copy };
}

/**
 * Two-tap confirmation for a destructive row action.
 *
 * `arm(id)` returns false on the first tap (the row is now armed and the
 * caller should show "click again to confirm") and true on the second, which
 * also disarms. Walking away disarms after `timeoutMs`.
 */
export function useTwoTapConfirm(timeoutMs = 4000): {
  armedId: string | null;
  arm: (id: string) => boolean;
  disarm: () => void;
} {
  const [armedId, setArmedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const disarm = useCallback(() => {
    clear();
    setArmedId(null);
  }, [clear]);

  const arm = useCallback(
    (id: string) => {
      if (armedId === id) {
        clear();
        setArmedId(null);
        return true;
      }
      clear();
      setArmedId(id);
      timer.current = setTimeout(() => setArmedId((c) => (c === id ? null : c)), timeoutMs);
      return false;
    },
    [armedId, clear, timeoutMs]
  );

  return { armedId, arm, disarm };
}
