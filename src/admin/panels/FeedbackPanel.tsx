/**
 * The Feedback tab — the messages people sent, and what was done about them.
 *
 * Two decisions worth keeping:
 *
 * **Status changes are optimistic and roll back.** Marking a note read is a
 * one-tap action an owner does while reading down a list; making them wait for
 * a round trip turns triage into a series of pauses. The row flips
 * immediately, and if the write fails the row flips back and says why — an
 * optimistic update that cannot undo itself would be a lie.
 *
 * **The whole list is fetched once and filtered here.** The counts on the
 * filter track have to be right for every bucket at all times, which a
 * server-side `?status=` filter cannot give without three more requests. The
 * volume this is sized for is a launch's worth of messages, not a mailbox.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bug,
  Check,
  Copy,
  Inbox,
  Lightbulb,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { GlassPanel, Segmented, type SegmentOption } from '../../ui/Glass';
import {
  FEEDBACK_NOTE_MAX,
  type FeedbackKind,
  type FeedbackRow,
  type FeedbackStatus,
} from '../../api/contracts';
import { adminGet, adminPost, isDatabaseAsleep, rowsOf } from '../api';
import { SectionHeader } from './primitives';
import { useCopyPing } from './primitives';
import { relativeTime } from './charts';

type Filter = 'all' | FeedbackStatus;

const KIND_STYLE: Record<FeedbackKind, { label: string; color: string; icon: React.ReactNode }> = {
  feedback: { label: 'Feedback', color: '#22D3EE', icon: <MessageSquare size={11} /> },
  suggestion: { label: 'Suggestion', color: '#A78BFA', icon: <Lightbulb size={11} /> },
  bug: { label: 'Bug', color: '#FF4D1C', icon: <Bug size={11} /> },
};

export default function FeedbackPanel() {
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; asleep: boolean } | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [savedNoteId, setSavedNoteId] = useState<number | null>(null);
  const { copiedId, copy } = useCopyPing();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(rowsOf<FeedbackRow>(await adminGet('feedback')));
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : 'Could not load the feedback.',
        asleep: isDatabaseAsleep(err),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      all: all.length,
      new: all.filter((row) => row.status === 'new').length,
      read: all.filter((row) => row.status === 'read').length,
      resolved: all.filter((row) => row.status === 'resolved').length,
    };
  }, [rows]);

  const visible = useMemo(
    () => (rows ?? []).filter((row) => filter === 'all' || row.status === filter),
    [rows, filter]
  );

  /** Optimistic patch with a rollback to exactly what was there before. */
  const patch = useCallback(
    async (row: FeedbackRow, change: Partial<Pick<FeedbackRow, 'status' | 'admin_note'>>) => {
      const before = row;
      setWriteError(null);
      setBusyId(row.id);
      setRows((current) =>
        (current ?? []).map((item) => (item.id === row.id ? { ...item, ...change } : item))
      );
      try {
        await adminPost('feedback', {
          id: row.id,
          ...(change.status ? { status: change.status } : {}),
          ...(change.admin_note !== undefined ? { adminNote: change.admin_note } : {}),
        });
        if (change.admin_note !== undefined) {
          setSavedNoteId(row.id);
          setTimeout(() => setSavedNoteId((id) => (id === row.id ? null : id)), 1800);
        }
      } catch (err) {
        setRows((current) => (current ?? []).map((item) => (item.id === row.id ? before : item)));
        setWriteError(err instanceof Error ? err.message : 'That change did not save.');
      } finally {
        setBusyId((id) => (id === row.id ? null : id));
      }
    },
    []
  );

  const filterOptions: SegmentOption<Filter>[] = [
    { value: 'all', label: `All ${counts.all}` },
    { value: 'new', label: `New ${counts.new}`, accent: '#FFB020' },
    { value: 'read', label: `Read ${counts.read}`, accent: '#22D3EE' },
    { value: 'resolved', label: `Resolved ${counts.resolved}`, accent: '#34D399' },
  ];

  return (
    <section className="mt-10" data-testid="admin-feedback">
      <SectionHeader
        icon={<Inbox size={15} />}
        accent="#FFB020"
        title="Feedback"
        sub="Everything sent from the button on the site, oldest problems first if you let them sit."
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

      <div className="no-scrollbar mb-4 min-w-0 overflow-x-auto">
        <Segmented<Filter>
          options={filterOptions}
          value={filter}
          onChange={setFilter}
          layoutId="feedback-filter"
          size="sm"
          paint
          className="w-full min-w-max"
        />
      </div>

      {writeError && (
        <p className="mb-3 text-[12px] text-[#FF4D1C]">{writeError}</p>
      )}

      {rows === null ? (
        error ? (
          <GlassPanel className="p-5">
            <p className="text-[13px] font-bold text-[#FFB020]">
              {error.asleep ? 'Database not reachable yet' : 'Could not load the feedback'}
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">
              {error.asleep
                ? 'Database not reachable yet — it wakes on first use; try again in a moment.'
                : error.message}
            </p>
          </GlassPanel>
        ) : (
          <GlassPanel className="flex items-center gap-3 p-5 text-[12px] text-white/50">
            <Loader2 size={15} className="animate-spin" /> Loading messages…
          </GlassPanel>
        )
      ) : visible.length === 0 ? (
        <GlassPanel className="p-8 text-center">
          <Inbox size={20} className="mx-auto text-white/25" />
          <p className="mt-2 text-[13px] font-semibold text-white/60">
            {counts.all === 0 ? 'No messages yet' : 'Nothing in this bucket'}
          </p>
          <p className="mt-1 text-[11.5px] text-white/40">
            {counts.all === 0
              ? 'The feedback button on the site writes straight into this list.'
              : 'Try another filter.'}
          </p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((row) => {
            const kind = KIND_STYLE[row.kind] ?? KIND_STYLE.feedback;
            const busy = busyId === row.id;
            return (
              <GlassPanel key={row.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold"
                    style={{
                      borderColor: `${kind.color}55`,
                      color: kind.color,
                      background: `${kind.color}14`,
                    }}
                  >
                    {kind.icon}
                    {kind.label}
                  </span>
                  {row.status !== 'new' && (
                    <span className="rounded-full border border-white/12 bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold text-white/45">
                      {row.status === 'read' ? 'Read' : 'Resolved'}
                    </span>
                  )}
                  <span className="text-[10.5px] text-white/40">{relativeTime(row.created_at)}</span>
                  {row.country && (
                    <span className="font-mono text-[10px] text-white/35">
                      {row.country.toUpperCase()}
                    </span>
                  )}
                  {busy && <Loader2 size={12} className="animate-spin text-white/40" />}
                </div>

                <p className="mt-2.5 whitespace-pre-wrap text-[13px] leading-relaxed text-white/85">
                  {row.message}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {row.email && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 font-mono text-[10.5px] text-white/60">
                      {row.email}
                      <button
                        type="button"
                        onClick={() => void copy(`email-${row.id}`, row.email)}
                        aria-label={`Copy ${row.email}`}
                        className="tap text-white/45 hover:text-white"
                      >
                        {copiedId === `email-${row.id}` ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                    </span>
                  )}
                  {row.path && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10.5px] text-white/45">
                      {row.path}
                    </span>
                  )}
                  {row.room_id && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10.5px] text-white/45">
                      room {row.room_id}
                    </span>
                  )}
                </div>

                <label className="mt-3 flex flex-col gap-1">
                  <span className="label-caps flex items-center gap-2 text-white/30">
                    Note to self
                    {savedNoteId === row.id && (
                      <span className="normal-case tracking-normal text-[#34D399]">saved</span>
                    )}
                  </span>
                  <textarea
                    defaultValue={row.admin_note}
                    maxLength={FEEDBACK_NOTE_MAX}
                    rows={2}
                    placeholder="What you did about it"
                    onBlur={(event) => {
                      const next = event.target.value;
                      if (next === row.admin_note) return;
                      void patch(row, { admin_note: next });
                    }}
                    className="w-full resize-none rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2 text-[12px] leading-relaxed text-white placeholder:text-white/20 focus:border-[var(--color-airo-aqua)]/60 focus:outline-none"
                  />
                </label>

                <div className="mt-3 flex flex-wrap gap-2">
                  {row.status === 'new' && (
                    <button
                      type="button"
                      onClick={() => void patch(row, { status: 'read' })}
                      disabled={busy}
                      className="tap rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-1.5 text-[11px] font-semibold text-white/65 hover:text-white disabled:opacity-50"
                    >
                      Mark read
                    </button>
                  )}
                  {row.status !== 'resolved' && (
                    <button
                      type="button"
                      onClick={() => void patch(row, { status: 'resolved' })}
                      disabled={busy}
                      className="tap inline-flex items-center gap-1.5 rounded-full border border-[#34D399]/40 bg-[#34D399]/10 px-3.5 py-1.5 text-[11px] font-semibold text-[#34D399] hover:bg-[#34D399]/20 disabled:opacity-50"
                    >
                      <Check size={12} /> Mark resolved
                    </button>
                  )}
                  {row.status !== 'new' && (
                    <button
                      type="button"
                      onClick={() => void patch(row, { status: 'new' })}
                      disabled={busy}
                      className="tap inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-1.5 text-[11px] font-semibold text-white/55 hover:text-white disabled:opacity-50"
                    >
                      <RotateCcw size={12} /> Reopen
                    </button>
                  )}
                </div>
              </GlassPanel>
            );
          })}
        </div>
      )}
    </section>
  );
}
