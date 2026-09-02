/**
 * One asset's cell in the review grid.
 *
 * The card is always a card. Its 3D stage is not: the gallery mounts a
 * `<TurntableView>` only while the cell is near the viewport, and swaps in a
 * still the rest of the time. That is the difference between a page that holds
 * sixty live turntables and one that holds the four you can see — and the
 * poster has to be there, because a card that collapses to an empty box when
 * it scrolls out reflows the grid underneath the reviewer's cursor.
 *
 * Uploads have no still. Nothing has ever rendered them, which is precisely why
 * they are the assets most worth turning around by hand, so they get the same
 * tinted glyph chip the object picker uses for them and read as "not yet seen"
 * rather than as a broken image.
 *
 * The status ring is the only colour on the card that means anything: it is the
 * verdict, and it is drawn on the stage rather than in the footer so a reviewer
 * scanning the grid at arm's length reads the piles without reading any text.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Boxes, Check, Maximize2, StickyNote, X } from 'lucide-react';
import { GlassPanel } from '../ui/Glass';
import { ObjectThumb } from '../ui/ObjectPicker';
import type { ReviewAsset } from './assets';
import type { ReviewRow, Verdict } from './reviews';
import {
  TurntableView,
  type ReviewDiagnostics,
  type StageStatus,
} from './TurntableView';

/** What a verdict looks like. `flagged` is a note with no verdict yet. */
export type CardTone = Verdict | 'flagged';

export const TONE_COLOR: Record<CardTone, string> = {
  approved: '#34D399',
  rejected: '#FF4D1C',
  flagged: '#FFB020',
  pending: 'rgba(255,255,255,0.14)',
};

export const TONE_LABEL: Record<CardTone, string> = {
  approved: 'Ship it',
  rejected: 'Needs work',
  flagged: 'Flagged',
  pending: 'Unreviewed',
};

/** The single place the "note without a verdict is flagged" rule is applied. */
export function toneOf(row: ReviewRow | undefined): CardTone {
  if (row?.status === 'approved') return 'approved';
  if (row?.status === 'rejected') return 'rejected';
  if (row?.note && row.note.trim().length > 0) return 'flagged';
  return 'pending';
}

export interface ReviewCardProps {
  asset: ReviewAsset;
  row: ReviewRow | undefined;
  /** True while the cell is near the viewport — the stage is live. */
  mounted: boolean;
  diagnostics: ReviewDiagnostics;
  spin: boolean;
  /** False parks every grid view while the detail modal owns the canvas. */
  viewsVisible: boolean;
  selected: boolean;
  busy: boolean;
  /** False with Supabase unconfigured: look, diagnose, but do not judge. */
  canWrite: boolean;
  /** Hands the observed element to the gallery's IntersectionObserver. */
  registerCell: (key: string, element: HTMLElement | null) => void;
  onVerdict: (asset: ReviewAsset, status: Verdict) => void;
  onOpen: (asset: ReviewAsset) => void;
  onSelect: (key: string) => void;
  onStageStatus?: (key: string, status: StageStatus) => void;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
  asset,
  row,
  mounted,
  diagnostics,
  spin,
  viewsVisible,
  selected,
  busy,
  canWrite,
  registerCell,
  onVerdict,
  onOpen,
  onSelect,
  onStageStatus,
}) => {
  const cellRef = useRef<HTMLDivElement>(null);
  const tone = toneOf(row);
  const ring = TONE_COLOR[tone];

  useEffect(() => {
    registerCell(asset.key, cellRef.current);
    return () => registerCell(asset.key, null);
  }, [asset.key, registerCell]);

  const handleStatus = useCallback(
    (status: StageStatus) => onStageStatus?.(asset.key, status),
    [asset.key, onStageStatus]
  );

  const noted = Boolean(row?.note && row.note.trim().length > 0);

  return (
    <GlassPanel
      radius="rounded-[22px]"
      data-review-key={asset.key}
      data-review-status={tone}
      onMouseEnter={() => onSelect(asset.key)}
      className={`relative flex flex-col overflow-hidden transition-shadow ${
        selected ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.35)]' : ''
      }`}
    >
      {/* ---------------------------- stage ---------------------------- */}
      <div ref={cellRef} className="relative aspect-[4/3] w-full">
        {mounted ? (
          <TurntableView
            asset={asset}
            diagnostics={diagnostics}
            spin={spin}
            visible={viewsVisible}
            className="absolute inset-0"
            onStatusChange={handleStatus}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <ObjectThumb
              thumb={asset.poster}
              label={asset.label}
              size={104}
              accent={asset.kind === 'upload' ? '#A78BFA' : '#FF7A34'}
            />
          </div>
        )}

        {/* The verdict, as a ring rather than a word. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-t-[22px]"
          style={{
            boxShadow:
              tone === 'pending'
                ? `inset 0 0 0 1px ${ring}`
                : `inset 0 0 0 2px ${ring}, inset 0 0 26px -12px ${ring}`,
          }}
        />

        {asset.kind === 'upload' && (
          <span className="glass pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold text-[#A78BFA]">
            <Boxes size={11} />
            Upload
          </span>
        )}

        <button
          type="button"
          onClick={() => onOpen(asset)}
          aria-label={`Open ${asset.label} in the detail view`}
          className="tap glass glass-sheen absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full text-white/70 hover:text-white"
        >
          <Maximize2 size={13} />
        </button>

        {noted && (
          <span
            title={row?.note}
            className="glass absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold text-[#FFB020]"
          >
            <StickyNote size={11} />
            Note
          </span>
        )}
      </div>

      {/* ---------------------------- footer ---------------------------- */}
      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold tracking-tight text-white">
            {asset.label}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/40">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: ring }}
            />
            <span className="truncate">
              {TONE_LABEL[tone]}
              {row?.reviewer ? ` · ${row.reviewer}` : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <VerdictButton
            tone="approved"
            active={tone === 'approved'}
            disabled={!canWrite || busy}
            onClick={() => onVerdict(asset, tone === 'approved' ? 'pending' : 'approved')}
          />
          <VerdictButton
            tone="rejected"
            active={tone === 'rejected'}
            disabled={!canWrite || busy}
            onClick={() => onVerdict(asset, tone === 'rejected' ? 'pending' : 'rejected')}
          />
        </div>
      </div>
    </GlassPanel>
  );
};

/**
 * A verdict chip. Clicking the active one clears the verdict — the same
 * gesture in reverse, because a mis-click that cannot be undone in place is
 * how a reviewer learns to stop clicking.
 */
const VerdictButton: React.FC<{
  tone: 'approved' | 'rejected';
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}> = ({ tone, active, disabled, onClick }) => {
  const color = TONE_COLOR[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      data-verdict={tone}
      className={`tap label-caps flex flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 py-2 disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'text-white' : 'text-white/50 hover:text-white/85'
      }`}
      style={
        active
          ? { background: `${color}2e`, boxShadow: `inset 0 0 0 1px ${color}80` }
          : { background: 'rgba(255,255,255,0.05)' }
      }
    >
      {tone === 'approved' ? <Check size={12} /> : <X size={12} />}
      {TONE_LABEL[tone]}
    </button>
  );
};

export default ReviewCard;
