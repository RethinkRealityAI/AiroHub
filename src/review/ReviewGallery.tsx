/**
 * /admin/review — judge every asset that can reach a live room, in one grid.
 *
 * The bug this exists to prevent: until now an admin upload went straight into
 * the object picker of every session the moment it was published. Nobody had
 * ever seen it rendered. A model with inverted normals, a 40 MB texture atlas
 * or somebody's holiday photos would simply appear in a room full of people.
 * The gate in `src/paint/customModels.ts` now requires an `approved` verdict,
 * and this page is where verdicts come from.
 *
 * Four things are load-bearing:
 *
 *  - **One canvas.** Sixteen live WebGL contexts is Chromium's practical
 *    ceiling and it evicts the oldest without warning, so a per-card `<Canvas>`
 *    grid blanks cells at random as you scroll. Every card is a drei `<View>`
 *    scissored out of one shared context, which also keeps the whole grid on
 *    one frame budget instead of sixteen.
 *  - **Off-screen cards do not exist.** IntersectionObserver with the same
 *    200px margin `GuideStage` uses mounts a card's stage just before it
 *    arrives and drops it once it leaves; the rest of the time the card shows
 *    a still, so the grid never reflows under the cursor.
 *  - **The frame loop is parked by default.** `always` only while at least one
 *    stage is live AND Spin is on; otherwise `demand`, with an explicit
 *    `invalidate()` on every state change, on scroll and on resize. A still
 *    grid of sixty cards should cost nothing.
 *  - **No localStorage fallback for verdicts.** With Supabase unconfigured the
 *    turntables and every diagnostic still work and the verdict controls go
 *    dark behind a notice. Storing verdicts locally instead would be worse
 *    than a disabled button: the gate reads the database, so a reviewer would
 *    approve twenty assets, watch the chips turn green, and none of it would
 *    reach a single player. A control that does nothing must look like one.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Canvas, invalidate, useThree } from '@react-three/fiber';
import { View } from '@react-three/drei';
import {
  ArrowLeft,
  Boxes,
  Check,
  ClipboardList,
  CloudOff,
  Contrast,
  Copy,
  Layers,
  Loader2,
  PaintBucket,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  SprayCan,
  XCircle,
} from 'lucide-react';
import { GlassPanel, Segmented, type SegmentOption } from '../ui/Glass';
import { buildReviewAssets, builtinReviewAssets, type ReviewAsset } from './assets';
import {
  clearVerdict,
  isBackendConfigured,
  listVerdicts,
  upsertVerdict,
  type Verdict,
  type VerdictMap,
} from './reviews';
import { bucketAssets, buildChecklist } from './exportChecklist';
import { ReviewCard, toneOf } from './ReviewCard';
import { ReviewDetail } from './ReviewDetail';
import { DEFAULT_DIAGNOSTICS, type ReviewDiagnostics, type StageStatus } from './TurntableView';
import { disposeReviewEnvironments, type ReviewEnvKind } from './reviewEnv';

const REVIEWER_KEY = 'airo:review:reviewer';

type FilterKey = 'all' | 'pending' | 'rejected' | 'approved' | 'uploads';

const spring = { type: 'spring', stiffness: 260, damping: 30 } as const;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/* ------------------------------------------------------------------
   Toolbar bits
   ------------------------------------------------------------------ */

const ToggleChip: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent: string;
  title?: string;
}> = ({ active, onClick, icon, label, accent, title }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    title={title}
    className={`tap label-caps inline-flex items-center gap-1.5 rounded-full px-3 py-2 ${
      active ? 'text-white' : 'text-white/45 hover:text-white/80'
    }`}
    style={
      active
        ? { background: `${accent}2e`, boxShadow: `inset 0 0 0 1px ${accent}80` }
        : { background: 'rgba(255,255,255,0.05)' }
    }
  >
    {icon}
    {label}
  </button>
);

const StatChip: React.FC<{ paint: string; icon: React.ReactNode; children: React.ReactNode }> = ({
  paint,
  icon,
  children,
}) => (
  <span
    className="splat-chip glass glass-sheen inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-extrabold tracking-wide"
    style={{ '--paint': paint } as React.CSSProperties}
  >
    {icon}
    {children}
  </span>
);

/* ------------------------------------------------------------------
   The route
   ------------------------------------------------------------------ */

/**
 * Frees the PMREM bakes with the context they belong to. The per-renderer
 * cache in `reviewEnv.ts` already guarantees a remount never sees a dead
 * context's texture; this releases the old render targets the moment the
 * shared canvas unmounts instead of waiting for the collector.
 */
function EnvironmentJanitor(): null {
  const gl = useThree((state) => state.gl);
  useEffect(() => () => disposeReviewEnvironments(gl), [gl]);
  return null;
}

export default function ReviewGallery(): React.JSX.Element {
  const backendReady = isBackendConfigured();
  const reducedMotion = usePrefersReducedMotion();

  const wrapRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  /* Built-ins are available synchronously, so the grid is never empty while
     the registry is in flight. */
  const [assets, setAssets] = useState<ReviewAsset[]>(() => builtinReviewAssets());
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [uploadsError, setUploadsError] = useState<string | null>(null);

  const [verdicts, setVerdicts] = useState<VerdictMap>(() => new Map());
  const [verdictsError, setVerdictsError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [reviewer, setReviewer] = useState('');
  const [spin, setSpin] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ReviewDiagnostics>(DEFAULT_DIAGNOSTICS);

  const [mounted, setMounted] = useState<Set<string>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const writesRef = useRef(0);
  const stageStatus = useRef(new Map<string, StageStatus>());

  /* --------------------------- data loading --------------------------- */

  const refreshAssets = useCallback(async () => {
    setAssetsLoading(true);
    const roster = await buildReviewAssets();
    setAssets(roster.assets);
    setUploadsError(roster.uploadsError);
    setAssetsLoading(false);
  }, []);

  const refreshVerdicts = useCallback(async () => {
    if (!isBackendConfigured()) return;
    try {
      setVerdicts(await listVerdicts());
      setVerdictsError(null);
    } catch (err) {
      setVerdictsError(errorMessage(err, 'Could not load review verdicts.'));
    }
  }, []);

  useEffect(() => {
    void refreshAssets();
    void refreshVerdicts();
  }, [refreshAssets, refreshVerdicts]);

  /* Spin defaults off when the reader has asked for less motion — sixty
     rotating objects is exactly the kind of thing that setting is for. */
  useEffect(() => {
    setSpin(!reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(REVIEWER_KEY);
      if (stored) setReviewer(stored);
    } catch {
      // Blocked storage just means the name has to be retyped.
    }
  }, []);

  const updateReviewer = useCallback((value: string) => {
    setReviewer(value);
    try {
      localStorage.setItem(REVIEWER_KEY, value);
    } catch {
      // See above.
    }
  }, []);

  /* ---------------------------- derived ---------------------------- */

  const buckets = useMemo(() => bucketAssets(assets, verdicts), [assets, verdicts]);

  const counts = useMemo(
    () => ({
      all: assets.length,
      approved: buckets.shipIt.length,
      rejected: buckets.needsWork.length,
      flagged: buckets.flagged.length,
      /** No verdict either way — what the "Pending" filter and chip both mean. */
      pending: buckets.flagged.length + buckets.unreviewed.length,
      uploads: assets.filter((a) => a.kind === 'upload').length,
    }),
    [assets, buckets]
  );

  const visible = useMemo(() => {
    switch (filter) {
      case 'pending':
        return assets.filter((a) => {
          const tone = toneOf(verdicts.get(a.key));
          return tone === 'pending' || tone === 'flagged';
        });
      case 'rejected':
        return assets.filter((a) => verdicts.get(a.key)?.status === 'rejected');
      case 'approved':
        return assets.filter((a) => verdicts.get(a.key)?.status === 'approved');
      case 'uploads':
        return assets.filter((a) => a.kind === 'upload');
      default:
        return assets;
    }
  }, [assets, verdicts, filter]);

  const detailAsset = useMemo(
    () => (detailKey ? (assets.find((a) => a.key === detailKey) ?? null) : null),
    [assets, detailKey]
  );

  /* ------------------------ mount gating ------------------------ */

  const cellsRef = useRef(new Map<string, HTMLElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleKeysRef = useRef<string[]>([]);
  visibleKeysRef.current = visible.map((a) => a.key);

  const registerCell = useCallback((key: string, element: HTMLElement | null) => {
    const previous = cellsRef.current.get(key);
    if (previous) {
      observerRef.current?.unobserve(previous);
      cellsRef.current.delete(key);
    }
    if (element) {
      element.dataset.reviewCell = key;
      cellsRef.current.set(key, element);
      observerRef.current?.observe(element);
      return;
    }
    setMounted((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      // No observer means no gating; a heavy grid still beats a blank one.
      setMounted(new Set(visibleKeysRef.current));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setMounted((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const key = (entry.target as HTMLElement).dataset.reviewCell;
            if (!key) continue;
            if (entry.isIntersecting) {
              if (!next.has(key)) {
                next.add(key);
                changed = true;
              }
            } else if (next.delete(key)) {
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { rootMargin: '200px 0px' }
    );
    observerRef.current = observer;
    // Cards register in their own effects, which run before this one on the
    // first mount, so pick up whatever is already in the map.
    for (const element of cellsRef.current.values()) observer.observe(element);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  const handleStageStatus = useCallback((key: string, status: StageStatus) => {
    stageStatus.current.set(key, status);
  }, []);

  /* --------------------------- frame loop --------------------------- */

  /* The sheet takes a couple of hundred milliseconds to scale away and the
     grid has to stay parked for all of it — otherwise fourteen turntables
     flash over the fading scrim, because the canvas is above it. */
  const [modalOnScreen, setModalOnScreen] = useState(false);
  useEffect(() => {
    if (detailKey) {
      setModalOnScreen(true);
      return;
    }
    const timer = setTimeout(() => setModalOnScreen(false), 320);
    return () => clearTimeout(timer);
  }, [detailKey]);

  const liveViews = mounted.size + (modalOnScreen ? 1 : 0);
  const frameloop: 'always' | 'demand' = spin && liveViews > 0 ? 'always' : 'demand';

  /* Any React state change can move a view or change what it draws, and in
     `demand` nothing repaints on its own — so ask for a frame after every
     commit. Cheap: `invalidate` only raises a counter. */
  useEffect(() => {
    invalidate();
  });

  /* Scrolling and resizing move the scissor rects without re-rendering React,
     which in `demand` would leave the last frame painted at the old offsets. */
  useEffect(() => {
    const wake = () => invalidate();
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('resize', wake);
    return () => {
      window.removeEventListener('scroll', wake);
      window.removeEventListener('resize', wake);
    };
  }, []);

  /* ---------------------------- verdicts ---------------------------- */

  const applyVerdict = useCallback(
    async (asset: ReviewAsset, status: Verdict, note?: string) => {
      if (!isBackendConfigured()) return;
      const existing = verdicts.get(asset.key);
      const nextNote = note ?? existing?.note ?? '';
      setBusyKey(asset.key);
      setWriteError(null);
      try {
        if (status === 'pending' && nextNote.trim().length === 0) {
          // Nothing left to say about it — drop the row, because absence IS
          // pending and a stub row would be a second way to spell the same
          // state.
          await clearVerdict(asset.key);
          setVerdicts((prev) => {
            const next = new Map(prev);
            next.delete(asset.key);
            return next;
          });
        } else {
          const saved = await upsertVerdict({
            assetKey: asset.key,
            kind: asset.kind,
            modelId: asset.modelId,
            status,
            note: nextNote,
            reviewer,
          });
          setVerdicts((prev) => new Map(prev).set(asset.key, saved));
        }
        writesRef.current += 1;
      } catch (err) {
        setWriteError(errorMessage(err, 'Could not save the verdict.'));
      } finally {
        setBusyKey(null);
      }
    },
    [reviewer, verdicts]
  );

  const toggleVerdict = useCallback(
    (asset: ReviewAsset, status: Verdict) => {
      void applyVerdict(asset, status);
    },
    [applyVerdict]
  );

  const submitDetail = useCallback(
    (asset: ReviewAsset, status: Verdict, note: string) => {
      void applyVerdict(asset, status, note);
    },
    [applyVerdict]
  );

  /* ---------------------------- checklist ---------------------------- */

  const copyChecklist = useCallback(async () => {
    const markdown = buildChecklist(assets, verdicts, new Date());
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — the button just stays inert, same as /admin's.
    }
  }, [assets, verdicts]);

  /* ---------------------------- shortcuts ---------------------------- */

  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => undefined);

  useEffect(() => {
    shortcutRef.current = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      /* A focused button or link already does something with Enter, and the
         browser is about to dispatch that click — opening the sheet as well
         would double up on every keyboard-driven verdict. */
      const nativeActivation =
        !!target && (target.tagName === 'BUTTON' || target.tagName === 'A');

      if (event.key === 'Escape') {
        // Escape out of the field first, then out of the sheet — otherwise a
        // reviewer mid-note loses the note to a keystroke meant to unfocus.
        if (typing) {
          target?.blur();
          return;
        }
        if (detailKey) {
          event.preventDefault();
          setDetailKey(null);
        } else {
          setSelectedKey(null);
        }
        return;
      }

      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      const keys = visibleKeysRef.current;
      if (keys.length === 0) return;
      const active = detailKey ?? selectedKey;
      const index = active ? keys.indexOf(active) : -1;

      const step = (delta: number) => {
        event.preventDefault();
        const next = keys[(((index < 0 ? 0 : index + delta) % keys.length) + keys.length) % keys.length];
        setSelectedKey(next);
        if (detailKey) setDetailKey(next);
        const element = cellsRef.current.get(next);
        element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };

      switch (event.key) {
        case 'j':
        case 'ArrowRight':
        case 'ArrowDown':
          step(1);
          return;
        case 'k':
        case 'ArrowLeft':
        case 'ArrowUp':
          step(-1);
          return;
        case 'Enter': {
          if (!active || nativeActivation) return;
          event.preventDefault();
          setDetailKey(active);
          return;
        }
        case 'a':
        case 'x': {
          if (!active) return;
          const asset = assets.find((item) => item.key === active);
          if (!asset) return;
          event.preventDefault();
          const wanted: Verdict = event.key === 'a' ? 'approved' : 'rejected';
          const current = toneOf(verdicts.get(active));
          void applyVerdict(asset, current === wanted ? 'pending' : wanted);
          return;
        }
        case 'n': {
          if (!active) return;
          event.preventDefault();
          setDetailKey(active);
          // The sheet animates in; the caret can only land once it exists.
          setTimeout(() => noteRef.current?.focus(), 260);
          return;
        }
        default:
      }
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => shortcutRef.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------------------------- debug hook ---------------------------- */

  const probeRef = useRef({ ready: false, cards: 0, mounted: 0, pending: 0 });
  probeRef.current = {
    ready: !assetsLoading,
    cards: visible.length,
    mounted: mounted.size,
    pending: counts.pending,
  };

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__airoReview = () => ({
      ...probeRef.current,
      verdictWrites: writesRef.current,
      backend: isBackendConfigured(),
      stages: Object.fromEntries(stageStatus.current),
    });
    return () => {
      delete w.__airoReview;
    };
  }, []);

  /* ------------------------------ render ------------------------------ */

  const filterOptions: SegmentOption<FilterKey>[] = [
    { value: 'all', label: `All ${counts.all}` },
    { value: 'pending', label: `Pending ${counts.pending}`, accent: '#FFB020' },
    { value: 'rejected', label: `Needs work ${counts.rejected}`, accent: '#FF4D1C' },
    { value: 'approved', label: `Ship it ${counts.approved}`, accent: '#34D399' },
    { value: 'uploads', label: `Uploads ${counts.uploads}`, accent: '#A78BFA' },
  ];

  const envOptions: SegmentOption<ReviewEnvKind>[] = [
    { value: 'neutral', label: 'Neutral' },
    { value: 'studio', label: 'Studio', accent: '#22D3EE' },
  ];

  return (
    <div ref={wrapRef} className="min-h-[100svh] stage-vignette text-white">
      <div className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8 safe-top">
        {/* ============ Header ============ */}
        <header className="pt-6 sm:pt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              to="/admin"
              className="tap glass glass-sheen inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold text-white/70 hover:text-white"
            >
              <ArrowLeft size={14} />
              Admin
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FFB020]/40 bg-[#FFB020]/10 px-3 py-1.5 text-[10px] font-semibold text-[#FFB020]">
              <ShieldAlert size={12} className="shrink-0" />
              Anyone with this URL can approve models
            </span>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.08 }}
            className="drip-edge mt-7"
            style={
              { '--paint': 'linear-gradient(90deg, #34D399, #22D3EE 55%, #A78BFA)' } as React.CSSProperties
            }
          >
            <div className="flex items-center gap-3">
              <SprayCan size={30} className="shrink-0 text-[var(--color-airo-flame)]" />
              <h1 className="paint-title text-4xl font-black leading-none tracking-tight sm:text-6xl">
                Asset Review
              </h1>
            </div>
            <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-white/55">
              Every object a session can load, on a turntable. An upload reaches the object picker
              only once it is approved here — no verdict means pending, and pending stays out.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.18 }}
            className="mt-10 flex flex-wrap items-center gap-2.5"
          >
            <StatChip paint="rgba(255,77,28,0.85)" icon={<Layers size={13} />}>
              {counts.all} assets
            </StatChip>
            <StatChip paint="rgba(52,211,153,0.8)" icon={<Check size={13} />}>
              {counts.approved} ship it
            </StatChip>
            <StatChip paint="rgba(255,176,32,0.8)" icon={<ClipboardList size={13} />}>
              {counts.pending} pending
            </StatChip>
            <StatChip paint="rgba(167,139,250,0.8)" icon={<Boxes size={13} />}>
              {counts.uploads} uploads
            </StatChip>
          </motion.div>
        </header>

        {/* ============ Toolbar ============ */}
        <GlassPanel liquid className="mt-8 flex flex-col gap-3 p-3.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {/* Five filters do not fit a phone track, and a clipped one is
                unreachable — so on a phone the track owns its own row and
                keeps its natural width, scrolling instead of squeezing. */}
            <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto">
              <Segmented<FilterKey>
                options={filterOptions}
                value={filter}
                onChange={setFilter}
                layoutId="review-filter"
                size="sm"
                paint
                className="w-full min-w-max"
              />
            </div>
            {/* `paint-btn` paints past its own box, so the neighbours need real
                clearance or the stroke laps over them. */}
            <div className="flex shrink-0 flex-wrap items-center gap-3.5">
              <button
                type="button"
                onClick={() => {
                  void refreshAssets();
                  void refreshVerdicts();
                }}
                disabled={assetsLoading}
                className="tap glass glass-sheen inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-bold text-white/65 hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={12} className={assetsLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void copyChecklist()}
                className="paint-btn tap inline-flex items-center gap-2 px-5 py-2.5 text-[11.5px] font-bold text-white"
                style={
                  { '--paint': 'linear-gradient(120deg, #22D3EE, #A78BFA)' } as React.CSSProperties
                }
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy checklist'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={reviewer}
              onChange={(event) => updateReviewer(event.target.value)}
              placeholder="Your name"
              aria-label="Reviewer name"
              maxLength={60}
              className="w-40 rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-2 text-[11.5px] text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none"
            />
            <ToggleChip
              active={spin}
              onClick={() => setSpin((value) => !value)}
              icon={<RotateCw size={12} />}
              label="Spin"
              accent="#22D3EE"
              title="Turntable rotation — off by default under reduced motion"
            />
            <Segmented
              options={envOptions}
              value={diagnostics.env}
              onChange={(env) => setDiagnostics((prev) => ({ ...prev, env }))}
              layoutId="review-env"
              size="sm"
            />
            <ToggleChip
              active={diagnostics.silhouette}
              onClick={() =>
                setDiagnostics((prev) => ({ ...prev, silhouette: !prev.silhouette }))
              }
              icon={<Contrast size={12} />}
              label="Silhouette"
              accent="#FFB020"
              title="Flat fill on a light ground — reads the outline, not the texture"
            />
            <ToggleChip
              active={diagnostics.primer}
              onClick={() => setDiagnostics((prev) => ({ ...prev, primer: !prev.primer }))}
              icon={<PaintBucket size={12} />}
              label="Primer"
              accent="#A78BFA"
              title="Wash the baked albedo to the studio's blank finish"
            />
          </div>
        </GlassPanel>

        {/* ============ Notices ============ */}
        {!backendReady && (
          <GlassPanel className="mt-4 flex items-start gap-3 border-[#FFB020]/30 p-5">
            <CloudOff size={17} className="mt-0.5 shrink-0 text-[#FFB020]" />
            <div>
              <p className="text-[13px] font-bold text-[#FFB020]">Supabase is offline</p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/55">
                <code className="font-mono text-white/70">VITE_SUPABASE_URL</code> /{' '}
                <code className="font-mono text-white/70">VITE_SUPABASE_ANON_KEY</code> are not set,
                so uploads cannot be listed and verdicts cannot be saved. The built-in catalog,
                the turntable and every diagnostic still work. Verdicts are deliberately not
                cached locally — the promotion gate reads the database, so a local approval would
                look like it worked and change nothing.
              </p>
            </div>
          </GlassPanel>
        )}
        {uploadsError && (
          <p className="mt-4 flex items-center gap-1.5 text-[12px] text-[#FF4D1C]">
            <XCircle size={13} className="shrink-0" /> Uploads could not be listed: {uploadsError}
          </p>
        )}
        {verdictsError && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#FF4D1C]">
            <XCircle size={13} className="shrink-0" /> {verdictsError}
          </p>
        )}
        {writeError && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#FF4D1C]">
            <XCircle size={13} className="shrink-0" /> {writeError}
          </p>
        )}

        {/* ============ Grid ============ */}
        <section className="mt-6">
          {visible.length === 0 ? (
            <GlassPanel className="flex items-center gap-3 p-5 text-[12px] text-white/50">
              {assetsLoading ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Loading the roster…
                </>
              ) : (
                'No assets match this filter.'
              )}
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((asset) => (
                <ReviewCard
                  key={asset.key}
                  asset={asset}
                  row={verdicts.get(asset.key)}
                  mounted={mounted.has(asset.key)}
                  diagnostics={diagnostics}
                  spin={spin}
                  viewsVisible={!modalOnScreen}
                  selected={selectedKey === asset.key}
                  busy={busyKey === asset.key}
                  canWrite={backendReady}
                  registerCell={registerCell}
                  onVerdict={toggleVerdict}
                  onOpen={(item) => {
                    setSelectedKey(item.key);
                    setDetailKey(item.key);
                  }}
                  onSelect={setSelectedKey}
                  onStageStatus={handleStageStatus}
                />
              ))}
            </div>
          )}

          <p className="mt-6 text-[11px] leading-relaxed text-white/35">
            j / k or the arrow keys move · Enter opens · a approves · x rejects · n jumps to the
            note · Esc closes. Shortcuts stand down while a field has focus.
          </p>
        </section>
      </div>

      {/* ============ The one canvas ============ */}
      <Canvas
        eventSource={wrapRef as React.RefObject<HTMLElement>}
        dpr={[1, 1.5]}
        frameloop={frameloop}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        /* Above the sheet's scrim (z-60): the detail modal draws its turntable
           through this canvas, and grid views are parked while it is open so
           they cannot paint over the scrim. `eventSource` already forces
           pointer-events: none, so nothing under it loses a click. */
        style={{ position: 'fixed', inset: 0, zIndex: 70 }}
      >
        <View.Port />
        <EnvironmentJanitor />
      </Canvas>

      <ReviewDetail
        asset={detailAsset}
        row={detailKey ? verdicts.get(detailKey) : undefined}
        diagnostics={diagnostics}
        spin={spin}
        canWrite={backendReady}
        busy={busyKey === detailKey}
        error={writeError}
        noteRef={noteRef}
        onClose={() => setDetailKey(null)}
        onSubmit={submitDetail}
      />
    </div>
  );
}
