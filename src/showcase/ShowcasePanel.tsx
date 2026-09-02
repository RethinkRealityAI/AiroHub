/**
 * Showcase panel — the UI around `recordTurntable`.
 *
 * A liquid-glass dialog that offers a clip length, sweeps the studio camera a
 * full turn while capturing the WebGL canvas, auto-saves the resulting WebM
 * and then shows it back as an inline preview with a "Save again" action.
 *
 * Self-contained by design: it imports nothing from the app besides its own
 * recorder module and the analytics queue, and leans only on the global
 * utilities already defined in src/index.css (`glass-strong`, `glass-sheen`,
 * `paint-btn`, `splat-btn`, `label-caps`, `segmented`, `tap`, `airo-breathe`).
 * Mount it anywhere in the studio tree and hand it `handles`; see
 * src/showcase/README.md.
 *
 * The backdrop deliberately thins out while recording — the whole point is to
 * watch the turntable happen behind the panel. The overlay itself never lands
 * in the video: `captureStream` taps the canvas, not the page composite.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clapperboard, Video, Download, X, CircleStop, RotateCcw, TriangleAlert } from 'lucide-react';
import {
  recordTurntable,
  checkShowcaseSupport,
  downloadBlob,
  showcaseFileName,
  type ShowcaseHandles,
  type ShowcaseSeconds,
} from './recorder';
import { track } from '../analytics/track';

export type { ShowcaseHandles } from './recorder';

export interface ShowcasePanelProps {
  open: boolean;
  onClose: () => void;
  handles: ShowcaseHandles;
}

type Phase = 'idle' | 'recording' | 'ready' | 'error';

const DURATIONS: { value: ShowcaseSeconds; label: string; accent: string }[] = [
  { value: 6, label: '6 seconds', accent: '#FF4D1C' },
  { value: 10, label: '10 seconds', accent: '#22D3EE' },
];

const RING_SIZE = 88;
const RING_RADIUS = 37;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const ShowcasePanel: React.FC<ShowcasePanelProps> = ({ open, onClose, handles }) => {
  // `handles` is typically rebuilt inline by the parent every render, so it
  // lives in a ref instead of in any dependency array.
  const handlesRef = useRef(handles);
  handlesRef.current = handles;

  const support = useMemo(() => checkShowcaseSupport(), []);

  const [seconds, setSeconds] = useState<ShowcaseSeconds>(6);
  const [phase, setPhase] = useState<Phase>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recordingRef = useRef(false);
  recordingRef.current = phase === 'recording';

  const releaseClip = useCallback(() => {
    if (urlRef.current) {
      try {
        URL.revokeObjectURL(urlRef.current);
      } catch {
        /* ignore */
      }
      urlRef.current = null;
    }
    blobRef.current = null;
    setClipUrl(null);
  }, []);

  // Abort any take and free the object URL when the panel leaves the tree.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current) {
        try {
          URL.revokeObjectURL(urlRef.current);
        } catch {
          /* ignore */
        }
        urlRef.current = null;
      }
    },
    []
  );

  const start = useCallback(async () => {
    if (recordingRef.current || !support.supported) return;

    releaseClip();
    setError(null);
    setSaveNote(null);
    setPercent(0);
    setPhase('recording');
    track('showcase.record', { seconds });

    const controller = new AbortController();
    abortRef.current = controller;

    // rAF fires ~60x/s; re-rendering that often would steal frames from the
    // very capture we are running, so progress state only moves per whole
    // percent (at most 100 updates across the clip).
    let lastPercent = -1;

    try {
      const blob = await recordTurntable(
        handlesRef.current,
        seconds,
        (t) => {
          const next = Math.round(Math.min(Math.max(t, 0), 1) * 100);
          if (next !== lastPercent) {
            lastPercent = next;
            setPercent(next);
          }
        },
        controller.signal
      );

      if (controller.signal.aborted) return;

      blobRef.current = blob;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setClipUrl(url);
      setPercent(100);
      setPhase('ready');

      const saved = downloadBlob(blob, showcaseFileName(handlesRef.current.roomId));
      setSaveNote(
        saved
          ? `Saved as ${showcaseFileName(handlesRef.current.roomId)}`
          : 'Your browser blocked the automatic save. Use Save again, or the video controls below.'
      );
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase('idle');
        setPercent(0);
        return;
      }
      setError(err instanceof Error ? err.message : 'The recording failed.');
      setPhase('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [releaseClip, seconds, support.supported]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
    setPercent(0);
  }, []);

  const saveAgain = useCallback(() => {
    const blob = blobRef.current;
    if (!blob) return;
    const name = showcaseFileName(handlesRef.current.roomId);
    setSaveNote(
      downloadBlob(blob, name)
        ? `Saved as ${name}`
        : 'Your browser blocked the save. Use the video controls below instead.'
    );
  }, []);

  const requestClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (recordingRef.current) {
      setPhase('idle');
      setPercent(0);
    }
    onClose();
  }, [onClose]);

  // Escape closes, matching every other overlay in the studio.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, requestClose]);

  const recording = phase === 'recording';
  const remaining = Math.max(0, Math.ceil(seconds * (1 - percent / 100)));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          initial="hidden"
          animate="shown"
          exit="hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Showcase recorder"
        >
          <motion.div
            variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
            transition={{ duration: 0.18 }}
            onClick={recording ? undefined : requestClose}
            className={`absolute inset-0 transition-colors duration-500 ${
              recording ? 'bg-black/25 backdrop-blur-[2px]' : 'bg-black/70 backdrop-blur-md'
            }`}
          />

          <motion.div
            variants={{
              hidden: { opacity: 0, scale: 0.94, y: 12 },
              shown: { opacity: 1, scale: 1, y: 0 },
            }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="relative w-full max-w-sm glass-strong glass-sheen rounded-[28px] overflow-hidden flex flex-col max-h-[88vh]"
            style={{ background: 'linear-gradient(180deg, rgba(17,17,28,0.94), rgba(8,8,14,0.96))' }}
          >
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-24 pointer-events-none"
              style={{
                background:
                  'radial-gradient(ellipse 55% 100% at 20% 0%, rgba(255,77,28,0.18), transparent 70%),' +
                  'radial-gradient(ellipse 50% 90% at 82% 0%, rgba(34,211,238,0.14), transparent 70%)',
              }}
            />

            {/* ------------------------------ header ------------------------------ */}
            <header className="relative shrink-0 px-5 pt-5 pb-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-[14px] bg-gradient-to-tr from-[#FF4D1C] to-[#FFB020] grid place-items-center shadow-[0_0_26px_rgba(255,77,28,0.45)] shrink-0">
                <Clapperboard size={19} className="text-white" />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h2 className="text-[17px] font-bold tracking-tight text-white leading-tight">Showcase</h2>
                <p className="text-[11.5px] text-white/55 mt-0.5 leading-snug">
                  A cinematic turntable of your piece, saved as video.
                </p>
              </div>
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close showcase"
                className="tap glass rounded-full w-8 h-8 grid place-items-center text-white/70 hover:text-white shrink-0"
              >
                <X size={15} />
              </button>
            </header>

            <div className="relative flex-1 min-h-0 overflow-y-auto px-5 pb-5">
              {!support.supported ? (
                /* ------------------------- unsupported ------------------------- */
                <div className="rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <TriangleAlert size={14} className="text-[var(--color-airo-ember)] shrink-0" />
                    <span className="label-caps text-white/45">Not available here</span>
                  </div>
                  <p className="text-[12px] text-white/65 leading-relaxed">{support.reason}</p>
                  <button
                    type="button"
                    onClick={requestClose}
                    className="tap glass rounded-full mt-3.5 w-full py-2.5 text-[12px] font-semibold text-white/85 hover:text-white"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  {/* --------------------------- length --------------------------- */}
                  <div className="mb-4">
                    <div className="label-caps text-white/35 mb-2">Clip length</div>
                    <div className="segmented" role="radiogroup" aria-label="Clip length">
                      {DURATIONS.map((option) => {
                        const selected = option.value === seconds;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={recording}
                            onClick={() => setSeconds(option.value)}
                            className={`tap relative z-10 flex-1 rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-wide whitespace-nowrap disabled:opacity-50 ${
                              selected
                                ? option.accent === '#22D3EE'
                                  ? 'text-[#0B0B12]' // ink on the light aqua stroke
                                  : 'text-white'
                                : 'text-white/55 hover:text-white/85'
                            }`}
                          >
                            {selected && (
                              <motion.span
                                layoutId="showcase-duration-pill"
                                transition={{ type: 'spring', stiffness: 480, damping: 38, mass: 0.7 }}
                                className="absolute -z-10 pointer-events-none"
                                style={{
                                  // Match the app-wide paint-stroke toggle language
                                  // (Segmented's StrokeIndicator): a sprayed streak
                                  // stencil instead of a plain pill.
                                  inset: '-46% -6%',
                                  background: `linear-gradient(105deg, ${option.accent} 0%, ${option.accent} 58%, ${option.accent}d9 100%)`,
                                  WebkitMaskImage: 'url(/ui/mask-stroke-2.webp)',
                                  maskImage: 'url(/ui/mask-stroke-2.webp)',
                                  WebkitMaskSize: '100% 100%',
                                  maskSize: '100% 100%',
                                  WebkitMaskRepeat: 'no-repeat',
                                  maskRepeat: 'no-repeat',
                                  filter: `saturate(1.1) drop-shadow(0 5px 14px ${option.accent}80)`,
                                }}
                              />
                            )}
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* -------------------------- progress -------------------------- */}
                  <AnimatePresence initial={false}>
                    {recording && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-4 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3.5 mb-3">
                          <ProgressRing percent={percent} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-[#FF4D1C] airo-breathe shrink-0" />
                              <span className="label-caps text-white/45">Recording</span>
                            </div>
                            <p className="text-[12px] text-white/65 mt-1 leading-snug">
                              Sweeping a full turn. {remaining}s left.
                            </p>
                          </div>
                        </div>
                        <div
                          className="h-1.5 rounded-full bg-white/12 overflow-hidden mb-4"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={percent}
                          aria-label="Recording progress"
                        >
                          <div
                            className="h-full rounded-full transition-[width] duration-100 ease-linear"
                            style={{
                              width: `${percent}%`,
                              background: 'linear-gradient(90deg, #FF4D1C, #FFB020 60%, #22D3EE)',
                            }}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* --------------------------- preview --------------------------- */}
                  {clipUrl && !recording && (
                    <div className="mb-4">
                      <div className="label-caps text-white/35 mb-2">Your clip</div>
                      <video
                        key={clipUrl}
                        src={clipUrl}
                        className="w-full rounded-2xl border border-white/12 bg-black"
                        controls
                        loop
                        muted
                        autoPlay
                        playsInline
                      />
                      {saveNote && (
                        <p className="text-[11px] text-white/45 mt-2 leading-snug break-words">{saveNote}</p>
                      )}
                    </div>
                  )}

                  {/* ---------------------------- error ---------------------------- */}
                  {phase === 'error' && error && (
                    <div className="rounded-2xl border border-[#FF4D1C]/35 bg-[#FF4D1C]/10 px-4 py-3 mb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <TriangleAlert size={13} className="text-[var(--color-airo-ember)] shrink-0" />
                        <span className="label-caps text-white/50">Recording failed</span>
                      </div>
                      <p className="text-[12px] text-white/70 leading-relaxed">{error}</p>
                    </div>
                  )}

                  {/* ---------------------------- actions ---------------------------- */}
                  {recording ? (
                    <button
                      type="button"
                      onClick={cancel}
                      className="tap glass rounded-full w-full py-3 flex items-center justify-center gap-2 text-[12px] font-bold text-white/85 hover:text-white"
                    >
                      <CircleStop size={15} />
                      Cancel take
                    </button>
                  ) : clipUrl ? (
                    <div className="flex flex-col gap-2.5">
                      <button
                        type="button"
                        onClick={saveAgain}
                        className="paint-btn tap w-full py-3.5 px-8 flex items-center justify-center gap-2 text-[13px] font-bold text-white"
                        style={{ '--paint': 'linear-gradient(120deg, #22D3EE, #38BDF8 65%, #A78BFA)' } as React.CSSProperties}
                      >
                        <Download size={15} />
                        Save again
                      </button>
                      <button
                        type="button"
                        onClick={start}
                        className="tap glass rounded-full w-full py-2.5 flex items-center justify-center gap-2 text-[12px] font-semibold text-white/80 hover:text-white"
                      >
                        <RotateCcw size={14} />
                        Record another
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={start}
                      className="paint-btn tap w-full py-3.5 px-8 flex items-center justify-center gap-2 text-[13px] font-bold text-white"
                      style={{ '--paint': 'linear-gradient(120deg, #FF4D1C, #FF7A34 70%, #FFB020)' } as React.CSSProperties}
                    >
                      <Video size={15} />
                      Record turntable
                    </button>
                  )}

                  <p className="text-[10.5px] text-white/30 mt-3 leading-snug text-center">
                    Keep this tab in front while it records.
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ------------------------------------------------------------------
   Progress ring
   ------------------------------------------------------------------ */

const ProgressRing: React.FC<{ percent: number }> = ({ percent }) => {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const offset = RING_CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <div
        className="splat-btn absolute inset-0 rounded-full"
        style={{ '--paint': 'rgba(255,77,28,0.22)' } as React.CSSProperties}
        aria-hidden
      />
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="relative -rotate-90">
        <defs>
          <linearGradient id="airo-showcase-ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FF4D1C" />
            <stop offset="55%" stopColor="#FFB020" />
            <stop offset="100%" stopColor="#22D3EE" />
          </linearGradient>
        </defs>
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={6}
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="url(#airo-showcase-ring)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 120ms linear' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-[15px] font-bold tabular-nums text-white">{Math.round(clamped)}</span>
      </div>
    </div>
  );
};

export default ShowcasePanel;
