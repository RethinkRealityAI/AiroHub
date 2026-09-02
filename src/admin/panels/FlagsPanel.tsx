/**
 * The Settings tab's two live-service panels: the feature switches, and what
 * the AI copilot has cost today.
 *
 * The switches are the launch's steering wheel. AI and Pad mode ship **off**,
 * so the first thing a visitor meets is the three spray modes and nothing
 * else; turning either on is a deliberate act taken here, from a phone if
 * need be. That is only safe if the page is honest about the delay: flags are
 * cached at the edge for a minute and read once per page load, so a change
 * made here reaches a visitor within about a minute and reaches an already
 * open tab on its next load. The success line says exactly that, because an
 * owner who flips a switch and reloads a stuck tab twice will otherwise
 * conclude the switch is broken.
 *
 * Every row says what *disappears* rather than what the flag is called. "Pad
 * mode" means nothing at 2am; "removes the third option from the phone's mode
 * switch" is checkable against the phone in your hand.
 *
 * `AiUsagePanel` lives in this file because it reads the cap this panel
 * writes: when the cap is saved, the meter beside it must not keep drawing
 * against yesterday's ceiling. The subscription below is that link, and it is
 * cheaper than lifting both panels' state into the page.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  ToggleLeft,
} from 'lucide-react';
import { GlassPanel } from '../../ui/Glass';
import {
  DEFAULT_FLAGS,
  NOTICE_MAX,
  type EventRow,
  type Flags,
  type OverviewResponse,
  type UiFlags,
} from '../../api/contracts';
import { adminGet, adminPost, isDatabaseAsleep, rowsOf } from '../api';
import { BudgetField, SectionHeader } from './primitives';
import { Meter, formatCompact, relativeTime } from './charts';

/* ------------------------------------------------ cap → meter, in one hop */

type CapListener = (cap: number) => void;
const capListeners = new Set<CapListener>();

function announceCap(cap: number): void {
  for (const listener of [...capListeners]) listener(cap);
}

function subscribeCap(listener: CapListener): () => void {
  capListeners.add(listener);
  return () => capListeners.delete(listener);
}

/* --------------------------------------------------------------- the flags */

interface FlagRow {
  key: keyof UiFlags;
  title: string;
  /** What stops existing for visitors when this is off. */
  gone: string;
}

const FLAG_ROWS: FlagRow[] = [
  {
    key: 'aiPanel',
    title: 'AI copilot',
    gone: 'The wand button in the studio, and the sheet it opens.',
  },
  {
    key: 'padMode',
    title: 'Pad mode',
    gone: 'Removes the third option from the phone’s mode switch.',
  },
  {
    key: 'stamps',
    title: 'Stamps',
    gone: 'The stencil tool on both screens, and its keyboard shortcut.',
  },
  {
    key: 'showcase',
    title: 'Showcase',
    gone: 'The turntable recorder that saves a spinning clip of the piece.',
  },
  {
    key: 'uploads',
    title: 'Uploads',
    gone: 'The “bring your own model” entry in the studio’s object picker.',
  },
  {
    key: 'feedbackButton',
    title: 'Feedback button',
    gone: 'The message button on every screen. This dashboard keeps working.',
  },
];

function mergeFlags(payload: Partial<Flags> | null | undefined): Flags {
  return {
    ui: { ...DEFAULT_FLAGS.ui, ...(payload?.ui ?? {}) },
    notice: typeof payload?.notice === 'string' ? payload.notice : DEFAULT_FLAGS.notice,
    ai: {
      dailyCap:
        typeof payload?.ai?.dailyCap === 'number' && Number.isFinite(payload.ai.dailyCap)
          ? payload.ai.dailyCap
          : DEFAULT_FLAGS.ai.dailyCap,
    },
  };
}

const Toggle: React.FC<{ flagKey: keyof UiFlags; on: boolean; onToggle: () => void }> = ({
  flagKey,
  on,
  onToggle,
}) => (
  <button
    type="button"
    data-flag={`ui.${flagKey}`}
    aria-pressed={on}
    aria-label={`ui.${flagKey}`}
    onClick={onToggle}
    className={`tap relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
      on ? 'border-[#34D399]/60 bg-[#34D399]/25' : 'border-white/12 bg-white/[0.06]'
    }`}
  >
    <span
      className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all ${
        on ? 'left-[26px] bg-[#34D399]' : 'left-[3px] bg-white/45'
      }`}
    />
  </button>
);

export default function FlagsPanel() {
  const [flags, setFlags] = useState<Flags | null>(null);
  const [saved, setSaved] = useState<Flags | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; asleep: boolean } | null>(null);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const merged = mergeFlags(await adminGet<Partial<Flags>>('settings'));
      setFlags(merged);
      setSaved(merged);
      announceCap(merged.ai.dailyCap);
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : 'Could not load the settings.',
        asleep: isDatabaseAsleep(err),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = Boolean(flags && saved && JSON.stringify(flags) !== JSON.stringify(saved));

  const save = useCallback(async () => {
    if (!flags || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await adminPost('settings', { flags });
      setSaved(flags);
      setSuccess(true);
      announceCap(flags.ai.dailyCap);
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : 'Could not save the settings.',
        asleep: isDatabaseAsleep(err),
      });
    } finally {
      setSaving(false);
    }
  }, [flags, saving]);

  const setUi = useCallback((key: keyof UiFlags) => {
    setSuccess(false);
    setFlags((current) =>
      current ? { ...current, ui: { ...current.ui, [key]: !current.ui[key] } } : current
    );
  }, []);

  return (
    <section className="mt-10" data-testid="admin-settings">
      <SectionHeader
        icon={<SlidersHorizontal size={15} />}
        accent="#34D399"
        title="What visitors can see"
        sub="Six switches, one notice, one budget. Off means the control is not rendered at all."
        right={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || saving}
            className="tap glass glass-sheen inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-bold text-white/65 hover:text-white disabled:opacity-60"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Reload
          </button>
        }
      />

      {!flags ? (
        <GlassPanel className="flex items-center gap-3 p-5 text-[12px] text-white/50">
          {error ? (
            <span className="text-[#FFB020]">
              {error.asleep
                ? 'Database not reachable yet — it wakes on first use; try again in a moment.'
                : error.message}
            </span>
          ) : (
            <>
              <Loader2 size={15} className="animate-spin" /> Loading the switches…
            </>
          )}
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GlassPanel className="p-5">
            <h3 className="flex items-center gap-2 text-[13px] font-bold text-white/85">
              <ToggleLeft size={14} className="text-[#34D399]" /> Feature switches
            </h3>
            <ul className="mt-3 flex flex-col divide-y divide-white/8">
              {FLAG_ROWS.map((row) => (
                <li key={row.key} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-white/85">{row.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-white/45">
                      Off: {row.gone}
                    </p>
                  </div>
                  <Toggle
                    flagKey={row.key}
                    on={flags.ui[row.key]}
                    onToggle={() => setUi(row.key)}
                  />
                </li>
              ))}
            </ul>
          </GlassPanel>

          <div className="flex flex-col gap-4">
            <GlassPanel className="p-5">
              <h3 className="text-[13px] font-bold text-white/85">Notice</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                A single line across the top of the studio. Empty hides it entirely.
              </p>
              <textarea
                value={flags.notice}
                maxLength={NOTICE_MAX}
                rows={2}
                placeholder="Back in ten minutes — the paint is drying."
                onChange={(event) => {
                  setSuccess(false);
                  setFlags((current) =>
                    current ? { ...current, notice: event.target.value } : current
                  );
                }}
                className="mt-3 w-full resize-none rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2 text-[12px] leading-relaxed text-white placeholder:text-white/20 focus:border-[var(--color-airo-aqua)]/60 focus:outline-none"
              />
              <div className="mt-1 flex justify-end font-mono text-[10px] text-white/30">
                {flags.notice.length}/{NOTICE_MAX}
              </div>

              <p className="label-caps mt-2 text-white/30">Preview</p>
              {flags.notice.trim() ? (
                <div className="glass glass-sheen mt-1.5 flex items-center gap-2 rounded-full px-3.5 py-2 text-[11.5px] text-white/80">
                  <AlertTriangle size={12} className="shrink-0 text-[#FFB020]" />
                  <span className="min-w-0 truncate">{flags.notice}</span>
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-white/30">
                  Nothing shows on the studio while this is empty.
                </p>
              )}
            </GlassPanel>

            <GlassPanel className="p-5">
              <h3 className="text-[13px] font-bold text-white/85">AI budget</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                Gemini calls allowed per UTC day. Past the cap the copilot answers from its
                curated fallbacks instead of failing — and it fails closed if the count cannot be
                read at all.
              </p>
              <div className="mt-3 max-w-[220px]">
                <BudgetField
                  label="Calls per day"
                  value={flags.ai.dailyCap}
                  step={50}
                  onCommit={(n) => {
                    setSuccess(false);
                    setFlags((current) =>
                      current ? { ...current, ai: { dailyCap: Math.round(n) } } : current
                    );
                  }}
                />
              </div>
            </GlassPanel>
          </div>
        </div>
      )}

      {flags && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="paint-btn tap inline-flex items-center gap-2 px-8 py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50"
            style={
              { '--paint': 'linear-gradient(120deg, #34D399, #22D3EE)' } as React.CSSProperties
            }
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Save changes
          </button>
          {success && !dirty && (
            <p className="text-[11.5px] leading-relaxed text-[#34D399]">
              Saved. Changes reach visitors within about 60 seconds. Open tabs pick it up on their
              next load.
            </p>
          )}
          {dirty && !saving && (
            <p className="text-[11.5px] text-white/40">Unsaved changes.</p>
          )}
          {error && (
            <p className="text-[11.5px] text-[#FF4D1C]">
              {error.asleep
                ? 'Database not reachable yet — it wakes on first use; try again in a moment.'
                : error.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- AI usage */

/**
 * Today's copilot spend against the cap, plus whatever browsers have reported
 * going wrong. Errors sit here rather than on the Overview tab because they
 * are read for the same reason the cap is: to decide whether to turn
 * something off.
 */
export function AiUsagePanel() {
  const [calls, setCalls] = useState<number | null>(null);
  const [cap, setCap] = useState(DEFAULT_FLAGS.ai.dailyCap);
  const [errors, setErrors] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [overview, errorRows] = await Promise.all([
        adminGet<OverviewResponse>('overview', { days: 14 }),
        adminGet('errors').then(rowsOf<EventRow>).catch(() => [] as EventRow[]),
      ]);
      setCalls(overview.aiCallsToday);
      setErrors(errorRows);
    } catch (err) {
      setMessage(
        isDatabaseAsleep(err)
          ? 'Database not reachable yet — it wakes on first use; try again in a moment.'
          : err instanceof Error
            ? err.message
            : 'Could not read today’s usage.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The cap the panel above just saved, without a refetch.
  useEffect(() => subscribeCap(setCap), []);

  return (
    <section className="mt-10">
      <SectionHeader
        icon={<Bot size={15} />}
        accent="#A78BFA"
        title="Today’s AI and errors"
        sub="What the copilot has spent since midnight UTC, and what visitors’ browsers reported."
        right={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="tap glass glass-sheen inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-bold text-white/65 hover:text-white disabled:opacity-60"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <h3 className="text-[13px] font-bold text-white/85">AI calls today</h3>
          <div className="mt-3">
            <Meter
              value={calls ?? 0}
              max={cap}
              caption="Counted per UTC day. At the cap the copilot keeps answering — from curated text, without calling Gemini."
            />
          </div>
          {message && <p className="mt-3 text-[11.5px] text-[#FFB020]">{message}</p>}
        </GlassPanel>

        <GlassPanel className="p-5">
          <h3 className="text-[13px] font-bold text-white/85">
            Browser errors{' '}
            <span className="font-mono text-[11px] font-normal text-white/40">
              {formatCompact(errors.length)}
            </span>
          </h3>
          {errors.length === 0 ? (
            <p className="mt-3 text-[11.5px] text-white/35">
              {loading ? 'Reading…' : 'Nothing reported. Quiet is the right answer here.'}
            </p>
          ) : (
            <ul className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
              {errors.map((row, index) => (
                <li
                  key={`${row.occurred_at}-${index}`}
                  className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-mono text-[10.5px] text-white/70">
                      {String(row.props?.message ?? 'client.error')}
                    </span>
                    <span className="shrink-0 text-[10px] text-white/35">
                      {relativeTime(row.occurred_at)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-2 font-mono text-[10px] text-white/35">
                    {row.path && <span>{row.path}</span>}
                    {row.props?.source ? <span>{String(row.props.source)}</span> : null}
                    {row.device && <span>{row.device}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </div>
    </section>
  );
}
