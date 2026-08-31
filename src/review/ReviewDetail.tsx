/**
 * The one-asset view: same turntable, bigger, and you can move the camera.
 *
 * Orbit lives here and nowhere else. The grid's whole value is that every cell
 * is shot from the identical angle, so an orbit control on a card would let a
 * reviewer flatter one asset and not the next without noticing. When a
 * silhouette looks wrong you come here, turn it, and go back.
 *
 * The camera pose is remembered per asset under `airo:review:cam:<key>`.
 * Reviewing is iterative — you find a bad seam, write a note, come back after
 * a re-export — and landing on the general three-quarter view every time means
 * hunting for the seam again on every pass. It is written on close, so a
 * mid-drag pose is never what gets saved.
 *
 * Notes and verdicts are submitted together: a note typed but not saved before
 * clicking "Needs work" would otherwise be discarded by the re-render, which is
 * the most annoying possible way to lose the only sentence that mattered.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Boxes, Check, CloudOff, RotateCcw, Save, Triangle, X } from 'lucide-react';
import { Sheet } from '../ui/Glass';
import { formatBytes, formatCount } from '../admin/checks';
import type { ReviewAsset } from './assets';
import type { ReviewRow, Verdict } from './reviews';
import {
  GRID_POSE,
  TurntableView,
  clonePose,
  type CameraPose,
  type ReviewDiagnostics,
} from './TurntableView';
import { TONE_COLOR, TONE_LABEL, toneOf } from './ReviewCard';

const poseStorageKey = (assetKey: string) => `airo:review:cam:${assetKey}`;

/** localStorage throws outright in some privacy modes; a lost pose is not an error. */
function readPose(assetKey: string): CameraPose | null {
  try {
    const raw = localStorage.getItem(poseStorageKey(assetKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CameraPose>;
    if (
      typeof parsed.azimuth !== 'number' ||
      typeof parsed.polar !== 'number' ||
      typeof parsed.zoom !== 'number' ||
      !Number.isFinite(parsed.azimuth + parsed.polar + parsed.zoom)
    ) {
      return null;
    }
    return { azimuth: parsed.azimuth, polar: parsed.polar, zoom: parsed.zoom };
  } catch {
    return null;
  }
}

function writePose(assetKey: string, pose: CameraPose) {
  try {
    localStorage.setItem(poseStorageKey(assetKey), JSON.stringify(pose));
  } catch {
    // Storage full or blocked — the next visit just gets the default angle.
  }
}

export interface ReviewDetailProps {
  /** Null closes the sheet. */
  asset: ReviewAsset | null;
  row: ReviewRow | undefined;
  diagnostics: ReviewDiagnostics;
  spin: boolean;
  canWrite: boolean;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  /** Note travels with the verdict so an unsaved note is never dropped. */
  onSubmit: (asset: ReviewAsset, status: Verdict, note: string) => void;
  /** Exposed so the gallery's `n` shortcut can drop the caret in the note. */
  noteRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export const ReviewDetail: React.FC<ReviewDetailProps> = ({
  asset,
  row,
  diagnostics,
  spin,
  canWrite,
  busy,
  error,
  onClose,
  onSubmit,
  noteRef,
}) => {
  const [note, setNote] = useState('');
  const [pose, setPose] = useState<CameraPose | null>(null);
  const poseRef = useRef<CameraPose>(clonePose(GRID_POSE));
  const assetKey = asset?.key ?? null;

  /* `Sheet` animates its exit through AnimatePresence, which needs the panel's
     content to survive the close by a couple of hundred milliseconds. Dropping
     to null the instant the asset clears would make the dialog vanish with a
     pop while every other sheet in the app scales away. */
  const [shown, setShown] = useState<ReviewAsset | null>(asset);
  useEffect(() => {
    if (asset) setShown(asset);
  }, [asset]);

  /* Restore on open; persist on close. The cleanup fires both when the sheet
     closes and when the reviewer steps to the next asset, which are the same
     event as far as this pose is concerned. */
  useEffect(() => {
    if (!assetKey) return;
    const restored = readPose(assetKey) ?? clonePose(GRID_POSE);
    poseRef.current = clonePose(restored);
    setPose(restored);
    return () => writePose(assetKey, poseRef.current);
  }, [assetKey]);

  useEffect(() => {
    setNote(row?.note ?? '');
  }, [assetKey, row?.note]);

  const handlePose = useCallback((next: CameraPose) => {
    poseRef.current = next;
  }, []);

  const resetPose = useCallback(() => {
    const next = clonePose(GRID_POSE);
    poseRef.current = next;
    setPose(next);
  }, []);

  if (!shown) return null;

  const subject = shown;
  const tone = toneOf(row);
  const trimmed = note.trim();
  const noteChanged = trimmed !== (row?.note ?? '').trim();

  return (
    <Sheet
      open={Boolean(asset)}
      onClose={onClose}
      centered
      wide
      title={subject.label}
      subtitle={`${subject.kind === 'upload' ? 'Upload' : 'Built-in'} · ${subject.key}`}
    >
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/25">
        <TurntableView
          asset={subject}
          diagnostics={diagnostics}
          spin={spin}
          interactive
          pose={pose}
          onPoseChange={handlePose}
          className="h-[42vh] min-h-[240px] w-full"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            boxShadow:
              tone === 'pending'
                ? 'inset 0 0 0 1px rgba(255,255,255,0.10)'
                : `inset 0 0 0 2px ${TONE_COLOR[tone]}`,
          }}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
          <span className="glass rounded-full px-2.5 py-1 text-[10px] text-white/50">
            Drag to orbit · scroll to zoom
          </span>
          <button
            type="button"
            onClick={resetPose}
            className="tap glass glass-sheen pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold text-white/60 hover:text-white"
          >
            <RotateCcw size={11} />
            Reset view
          </button>
        </div>
      </div>

      {/* ------------------------------ meta ------------------------------ */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold"
          style={{
            color: tone === 'pending' ? 'rgba(255,255,255,0.55)' : TONE_COLOR[tone],
            background: tone === 'pending' ? 'rgba(255,255,255,0.06)' : `${TONE_COLOR[tone]}1f`,
          }}
        >
          {TONE_LABEL[tone]}
        </span>
        {subject.kind === 'upload' && (
          <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold text-[#A78BFA]">
            <Boxes size={11} />
            Upload
          </span>
        )}
        {typeof subject.triangles === 'number' && (
          <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold text-white/55">
            <Triangle size={11} />
            {formatCount(subject.triangles)} tris
          </span>
        )}
        {typeof subject.sizeBytes === 'number' && (
          <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold text-white/55">
            {formatBytes(subject.sizeBytes)}
          </span>
        )}
      </div>

      {/* ------------------------------ note ------------------------------ */}
      <label className="label-caps mt-4 block text-white/40" htmlFor="airo-review-note">
        Note
      </label>
      <textarea
        id="airo-review-note"
        ref={noteRef}
        value={note}
        disabled={!canWrite}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        placeholder="What is wrong with it, in one line."
        className="mt-1.5 w-full resize-y rounded-2xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none disabled:opacity-50"
      />

      {!canWrite && (
        <p className="mt-2 flex items-start gap-2 text-[11.5px] leading-relaxed text-[#FFB020]">
          <CloudOff size={13} className="mt-0.5 shrink-0" />
          Supabase is not configured, so verdicts cannot be saved. The turntable and the
          diagnostics still work.
        </p>
      )}
      {error && <p className="mt-2 text-[11.5px] text-[#FF4D1C]">{error}</p>}

      {/* ---------------------------- verdicts ---------------------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canWrite || busy}
          onClick={() => onSubmit(subject, 'approved', trimmed)}
          data-verdict="approved"
          className="paint-btn tap inline-flex items-center gap-2 px-6 py-2.5 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ '--paint': 'linear-gradient(120deg, #10b981, #34D399)' } as React.CSSProperties}
        >
          <Check size={13} />
          Ship it
        </button>
        <button
          type="button"
          disabled={!canWrite || busy}
          onClick={() => onSubmit(subject, 'rejected', trimmed)}
          data-verdict="rejected"
          className="paint-btn tap inline-flex items-center gap-2 px-6 py-2.5 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ '--paint': 'linear-gradient(120deg, #FF4D1C, #FF7A34)' } as React.CSSProperties}
        >
          <X size={13} />
          Needs work
        </button>
        <button
          type="button"
          disabled={!canWrite || busy || !noteChanged}
          onClick={() => onSubmit(subject, row?.status ?? 'pending', trimmed)}
          className="tap glass glass-sheen inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[11px] font-bold text-white/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save size={12} />
          Save note
        </button>
        <button
          type="button"
          disabled={!canWrite || busy || tone === 'pending'}
          onClick={() => onSubmit(subject, 'pending', '')}
          className="tap glass inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[11px] font-bold text-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw size={12} />
          Clear
        </button>
      </div>
    </Sheet>
  );
};

export default ReviewDetail;
