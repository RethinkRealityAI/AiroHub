/**
 * /admin — the AiroHub model-management portal.
 *
 * One scrolling page over the stage vignette, all liquid glass + paint skin:
 *
 *   LIBRARY  — audits the built-in catalog (fetch → analyze → graded checks)
 *              and lists custom models published to Supabase.
 *   UPLOAD   — drop a .glb/.gltf, get instant analysis + health checks, run
 *              the in-browser optimizer (textures → ≤1024² WebP), then publish
 *              to the `airohub-models` bucket + registry table.
 *   SETTINGS — editable check budgets (localStorage) and the danger zone.
 *
 * Everything three.js-heavy lives in src/admin/* and this whole route is
 * lazy-loaded, so none of it touches the main entry bundle.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  CloudOff,
  Copy,
  Database,
  HardDrive,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Ruler,
  Settings2,
  ShieldAlert,
  Sparkles,
  SprayCan,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { GlassPanel } from '../ui/Glass';
import { ObjectThumb } from '../ui/ObjectPicker';
import { PAINTABLE_OBJECTS, type PaintableObject } from '../paint/objectCatalog';
import { analyzeModel, type ModelStats } from '../admin/analyze';
import { optimizeGlb } from '../admin/optimize';
import { isGlb } from '../admin/glb';
import {
  computeChecks,
  regradeChecks,
  describeCheck,
  formatBytes,
  formatCount,
  loadBudgets,
  saveBudgets,
  DEFAULT_BUDGETS,
  GRADED_CHECK_KEYS,
  type CheckBudgets,
  type ChecksMap,
  type CheckStatus,
} from '../admin/checks';
import {
  deleteAllCustomModels,
  deleteCustomModel,
  isBackendConfigured,
  listCustomModels,
  publicModelUrl,
  publishModel,
  MAX_UPLOAD_BYTES,
  type CustomModelRow,
} from '../admin/supabase';

/* ------------------------------------------------------------------
   Shared bits
   ------------------------------------------------------------------ */

const spring = { type: 'spring', stiffness: 260, damping: 30 } as const;

const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: '#34D399',
  warn: '#FFB020',
  fail: '#FF4D1C',
};

const CATEGORY_ACCENT: Record<string, string> = {
  Canvas: '#FFB020',
  Street: '#22D3EE',
  Objects: '#A78BFA',
};

const CHECK_SHORT: Record<string, string> = {
  size_bytes: 'size',
  triangles: 'tris',
  texture_mp: 'tex',
  vram_mb: 'vram',
  has_uvs: 'uv',
};

function assetUrl(id: string): string {
  return `${import.meta.env.BASE_URL || '/'}models/${id}.glb`.replace(/\/{2,}/g, '/');
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface CheckInputsLike {
  sizeBytes?: number;
  triangles?: number;
  textureMP?: number;
  vramMB?: number;
  hasUVs?: boolean;
  meshopt?: boolean;
}

function inputsFromStats(stats: ModelStats): CheckInputsLike {
  return {
    sizeBytes: stats.sizeBytes,
    triangles: stats.triangles,
    textureMP: stats.textureMP,
    vramMB: stats.vramMB,
    hasUVs: stats.hasUVs,
    meshopt: stats.meshopt,
  };
}

function StatusIcon({ status, size = 13 }: { status: CheckStatus; size?: number }) {
  const color = STATUS_COLOR[status];
  if (status === 'pass') return <CheckCircle2 size={size} style={{ color }} />;
  if (status === 'warn') return <AlertTriangle size={size} style={{ color }} />;
  return <XCircle size={size} style={{ color }} />;
}

/** Compact row of check verdict chips + the informational meshopt chip. */
function ChecksBadges({
  checks,
  inputs,
  budgets,
}: {
  checks: ChecksMap;
  inputs: CheckInputsLike;
  budgets: CheckBudgets;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {GRADED_CHECK_KEYS.map((key) => {
        const status = checks[key] ?? 'warn';
        const d = describeCheck(key, inputs, budgets);
        const color = STATUS_COLOR[status];
        return (
          <span
            key={key}
            title={`${d.label} — ${status.toUpperCase()} · ${d.detail}\n${d.hint}`}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{ borderColor: `${color}55`, color, background: `${color}14` }}
          >
            <StatusIcon status={status} size={10} />
            {CHECK_SHORT[key]}
          </span>
        );
      })}
      <span
        title={describeCheck('meshopt', inputs, budgets).hint}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
          inputs.meshopt
            ? 'border-white/25 text-white/70 bg-white/10'
            : 'border-white/12 text-white/35 bg-white/[0.04]'
        }`}
      >
        <Info size={10} />
        meshopt{inputs.meshopt ? '' : ' —'}
      </span>
    </div>
  );
}

/** Full check/warn/fail rows with hints — the expanded health readout. */
function ChecksDetail({
  checks,
  inputs,
  budgets,
}: {
  checks: ChecksMap;
  inputs: CheckInputsLike;
  budgets: CheckBudgets;
}) {
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {GRADED_CHECK_KEYS.map((key) => {
        const status = checks[key] ?? 'warn';
        const d = describeCheck(key, inputs, budgets);
        return (
          <li
            key={key}
            title={d.hint}
            className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] border border-white/8 px-3 py-2"
          >
            <StatusIcon status={status} />
            <span className="text-[12px] font-semibold text-white/85">{d.label}</span>
            <span className="ml-auto text-right font-mono text-[10.5px] text-white/45">{d.detail}</span>
          </li>
        );
      })}
      <li
        title={describeCheck('meshopt', inputs, budgets).hint}
        className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] border border-white/6 px-3 py-2"
      >
        <Info size={13} className="text-white/40" />
        <span className="text-[12px] font-semibold text-white/60">Meshopt</span>
        <span className="ml-auto font-mono text-[10.5px] text-white/40">
          {describeCheck('meshopt', inputs, budgets).detail}
        </span>
      </li>
    </ul>
  );
}

function StatsLine({ stats }: { stats: ModelStats }) {
  return (
    <p className="font-mono text-[10.5px] leading-relaxed text-white/45">
      {formatCount(stats.triangles)} tris · {stats.meshes} mesh{stats.meshes === 1 ? '' : 'es'} ·{' '}
      {stats.textures} tex · {stats.textureMP.toFixed(1)} MP · {stats.vramMB.toFixed(0)} MB VRAM
    </p>
  );
}

function SectionHeader({
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

/* ------------------------------------------------------------------
   Built-in library
   ------------------------------------------------------------------ */

interface BuiltinEntry {
  def: PaintableObject;
  sizeBytes?: number;
}

interface RunState {
  status: 'idle' | 'running' | 'done' | 'error';
  stats?: ModelStats;
  error?: string;
}

function BuiltinCard({
  entry,
  run,
  budgets,
  expanded,
  onToggle,
  onRun,
  index,
}: {
  entry: BuiltinEntry;
  run: RunState;
  budgets: CheckBudgets;
  expanded: boolean;
  onToggle: () => void;
  onRun: () => void;
  index: number;
}) {
  const { def } = entry;
  const accent = CATEGORY_ACCENT[def.category] ?? '#22D3EE';
  const checks = run.stats ? computeChecks(run.stats, budgets) : null;
  const inputs = run.stats ? inputsFromStats(run.stats) : {};

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: Math.min(index * 0.035, 0.4) }}
    >
      <GlassPanel className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div
            className="glass grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl"
            style={{ borderColor: `${accent}45` }}
          >
            <ObjectThumb thumb={def.thumb} label={def.label} size={34} accent={accent} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[14px] font-bold leading-tight">{def.label}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="label-caps" style={{ color: `${accent}cc` }}>
                {def.category}
              </span>
              <span className="rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white/55">
                Built-in
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10.5px] text-white/45">
              {entry.sizeBytes != null ? formatBytes(entry.sizeBytes) : '· · ·'}
            </div>
            <div className="mt-0.5 flex items-center justify-end gap-1 font-mono text-[9.5px] text-white/25">
              <Ruler size={9} aria-hidden />
              {def.targetSize} wu
            </div>
          </div>
        </div>

        {run.status === 'done' && run.stats ? (
          <>
            <StatsLine stats={run.stats} />
            {checks && (
              <div className="flex items-center gap-2">
                <ChecksBadges checks={checks} inputs={inputs} budgets={budgets} />
              </div>
            )}
            <div className="mt-auto flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onToggle}
                className="tap inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-[11px] font-semibold text-white/60 hover:text-white"
              >
                <ChevronDown
                  size={12}
                  className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
                {expanded ? 'Hide details' : 'Details'}
              </button>
              <button
                type="button"
                onClick={onRun}
                title="Re-run checks"
                className="tap glass grid h-8 w-8 place-items-center rounded-full text-white/60 hover:text-white"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            {expanded && checks && (
              <ChecksDetail checks={checks} inputs={inputs} budgets={budgets} />
            )}
          </>
        ) : (
          <>
            <p className="text-[11px] leading-snug text-white/40">{def.blurb}</p>
            <div className="mt-auto pt-1">
              {run.status === 'error' ? (
                <p className="mb-2 flex items-center gap-1.5 text-[11px] text-[#FF4D1C]">
                  <XCircle size={12} className="shrink-0" /> {run.error}
                </p>
              ) : null}
              <button
                type="button"
                onClick={onRun}
                disabled={run.status === 'running'}
                className="tap inline-flex w-full items-center justify-center gap-2 rounded-full border px-3 py-2 text-[11.5px] font-bold transition-colors disabled:opacity-60"
                style={{ borderColor: `${accent}50`, color: accent, background: `${accent}12` }}
              >
                {run.status === 'running' ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Analyzing…
                  </>
                ) : (
                  <>
                    <Play size={12} /> Run checks
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </GlassPanel>
    </motion.div>
  );
}

/* ------------------------------------------------------------------
   Custom model card
   ------------------------------------------------------------------ */

function CustomCard({
  row,
  budgets,
  expanded,
  onToggle,
  copied,
  onCopy,
  confirming,
  deleting,
  onDelete,
  index,
}: {
  row: CustomModelRow;
  budgets: CheckBudgets;
  expanded: boolean;
  onToggle: () => void;
  copied: boolean;
  onCopy: () => void;
  confirming: boolean;
  deleting: boolean;
  onDelete: () => void;
  index: number;
}) {
  const inputs: CheckInputsLike = {
    sizeBytes: Number(row.size_bytes),
    triangles: Number(row.triangles),
    textureMP: Number(row.texture_mp),
    vramMB: Number(row.vram_mb),
    hasUVs: row.checks?.has_uvs !== 'fail',
    meshopt: row.checks?.meshopt === 'pass',
  };
  const checks = regradeChecks(
    {
      sizeBytes: Number(row.size_bytes),
      triangles: Number(row.triangles),
      textureMP: Number(row.texture_mp),
      vramMB: Number(row.vram_mb),
    },
    row.checks,
    budgets
  );
  const created = new Date(row.created_at);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: Math.min(index * 0.035, 0.4) }}
    >
      <GlassPanel className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className="glass grid h-11 w-11 shrink-0 place-items-center rounded-2xl border-[#34D399]/35">
            <Boxes size={18} className="text-[#34D399]" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[14px] font-bold leading-tight">{row.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-[#34D399]/35 bg-[#34D399]/12 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#34D399]">
                Custom
              </span>
              <span className="font-mono text-[9.5px] text-white/35">
                {Number.isNaN(created.getTime())
                  ? '—'
                  : created.toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10.5px] text-white/45">{formatBytes(Number(row.size_bytes))}</div>
            <div className="mt-0.5 flex items-center justify-end gap-1 font-mono text-[9.5px] text-white/25">
              <Ruler size={9} aria-hidden />
              {Number(row.target_size)} wu
            </div>
          </div>
        </div>

        <p className="font-mono text-[10.5px] text-white/45">
          {formatCount(Number(row.triangles))} tris · {Number(row.texture_mp).toFixed(1)} MP ·{' '}
          {Number(row.vram_mb).toFixed(0)} MB VRAM
        </p>

        <ChecksBadges checks={checks} inputs={inputs} budgets={budgets} />
        {expanded && <ChecksDetail checks={checks} inputs={inputs} budgets={budgets} />}

        <div className="mt-auto flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onToggle}
            className="tap glass grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/60 hover:text-white"
            title={expanded ? 'Hide details' : 'Details'}
          >
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="tap inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#22D3EE]/40 bg-[#22D3EE]/12 px-3 py-1.5 text-[11px] font-bold text-[#22D3EE]"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy URL'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className={`tap inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-60 ${
              confirming
                ? 'border-[#FF4D1C]/70 bg-[#FF4D1C]/25 text-white'
                : 'border-[#FF4D1C]/40 bg-[#FF4D1C]/10 text-[#FF4D1C]'
            }`}
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {deleting ? 'Deleting…' : confirming ? 'Sure?' : 'Delete'}
          </button>
        </div>
      </GlassPanel>
    </motion.div>
  );
}

/* ------------------------------------------------------------------
   Upload draft
   ------------------------------------------------------------------ */

interface Draft {
  fileName: string;
  isBinary: boolean;
  original: ArrayBuffer;
  stats: ModelStats | null;
  analyzeError: string | null;
  optimized: { buffer: ArrayBuffer; stats: ModelStats; imagesTouched: number } | null;
  optimizeNote: string | null;
  optimizeOk: boolean | null;
}

function DeltaBadge({
  label,
  before,
  after,
  format,
}: {
  label: string;
  before: number;
  after: number;
  format: (n: number) => string;
}) {
  const improved = after < before;
  const pct = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="label-caps text-white/35">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-mono text-[10.5px] text-white/40 line-through">{format(before)}</span>
        <span className="font-mono text-[12.5px] font-bold text-white/90">{format(after)}</span>
      </div>
      <span
        className={`mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-bold ${
          improved
            ? 'border-[#34D399]/45 bg-[#34D399]/15 text-[#34D399]'
            : 'border-white/12 bg-white/[0.04] text-white/40'
        }`}
      >
        {improved ? `−${pct}%` : '±0%'}
      </span>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="label-caps text-white/35">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] font-bold text-white/90">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Settings
   ------------------------------------------------------------------ */

const BUDGET_FIELDS: { key: keyof CheckBudgets; label: string; step: number }[] = [
  { key: 'sizePassMB', label: 'Size pass · MB', step: 0.5 },
  { key: 'sizeWarnMB', label: 'Size warn · MB', step: 0.5 },
  { key: 'trianglesPass', label: 'Tris pass', step: 5000 },
  { key: 'trianglesWarn', label: 'Tris warn', step: 5000 },
  { key: 'textureMpPass', label: 'Tex MP pass', step: 0.5 },
  { key: 'textureMpWarn', label: 'Tex MP warn', step: 0.5 },
  { key: 'vramPassMB', label: 'VRAM pass · MB', step: 5 },
  { key: 'vramWarnMB', label: 'VRAM warn · MB', step: 5 },
];

function BudgetField({
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

/* ==================================================================
   The dashboard
   ================================================================== */

export default function AdminView() {
  const backendReady = isBackendConfigured();
  const [budgets, setBudgetsState] = useState<CheckBudgets>(() => loadBudgets());

  const updateBudget = useCallback((key: keyof CheckBudgets, value: number) => {
    setBudgetsState((prev) => {
      const next = { ...prev, [key]: value };
      saveBudgets(next);
      return next;
    });
  }, []);

  const resetBudgets = useCallback(() => {
    setBudgetsState({ ...DEFAULT_BUDGETS });
    saveBudgets({ ...DEFAULT_BUDGETS });
  }, []);

  /* ---------- Built-in catalog ---------- */

  const [builtins, setBuiltins] = useState<BuiltinEntry[] | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [audit, setAudit] = useState<{ running: boolean; done: number; total: number } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The pseudo-entry for user uploads has no shipped asset; every other
      // entry is probed so cards only render for models that actually exist.
      const defs = PAINTABLE_OBJECTS.filter((o) => o.id !== 'custom3d');
      const probed = await Promise.all(
        defs.map(async (def): Promise<BuiltinEntry | null> => {
          try {
            const res = await fetch(assetUrl(def.id), { method: 'HEAD' });
            const type = res.headers.get('content-type') ?? '';
            // SPA hosts rewrite missing paths to index.html with a 200, so a
            // "successful" HTML response still means the asset is absent.
            if (!res.ok || type.includes('text/html')) return null;
            const len = Number(res.headers.get('content-length'));
            return { def, sizeBytes: Number.isFinite(len) && len > 0 ? len : undefined };
          } catch {
            return null;
          }
        })
      );
      if (!cancelled) setBuiltins(probed.filter((e): e is BuiltinEntry => e !== null));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRun = useCallback((id: string, patch: Partial<RunState>) => {
    setRuns((prev) => ({ ...prev, [id]: { status: 'idle', ...prev[id], ...patch } }));
  }, []);

  const runBuiltinCheck = useCallback(
    async (id: string) => {
      setRun(id, { status: 'running', error: undefined });
      try {
        const res = await fetch(assetUrl(id));
        if (!res.ok) throw new Error(`fetch failed (HTTP ${res.status})`);
        const buffer = await res.arrayBuffer();
        const stats = await analyzeModel(buffer);
        setRun(id, { status: 'done', stats });
        setBuiltins((prev) =>
          prev ? prev.map((e) => (e.def.id === id ? { ...e, sizeBytes: stats.sizeBytes } : e)) : prev
        );
      } catch (err) {
        setRun(id, { status: 'error', error: errorMessage(err, 'analysis failed') });
      }
    },
    [setRun]
  );

  const auditAll = useCallback(async () => {
    if (!builtins || audit?.running) return;
    setAudit({ running: true, done: 0, total: builtins.length });
    for (let i = 0; i < builtins.length; i++) {
      await runBuiltinCheck(builtins[i].def.id);
      setAudit({ running: true, done: i + 1, total: builtins.length });
    }
    setAudit((prev) => (prev ? { ...prev, running: false } : prev));
  }, [builtins, audit?.running, runBuiltinCheck]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ---------- Custom library ---------- */

  const [customRows, setCustomRows] = useState<CustomModelRow[] | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refreshCustom = useCallback(async () => {
    if (!isBackendConfigured()) return;
    setCustomLoading(true);
    setCustomError(null);
    try {
      setCustomRows(await listCustomModels());
    } catch (err) {
      setCustomError(errorMessage(err, 'Could not reach Supabase.'));
    } finally {
      setCustomLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCustom();
  }, [refreshCustom]);

  const copyRowUrl = useCallback(async (row: CustomModelRow) => {
    try {
      await navigator.clipboard.writeText(publicModelUrl(row.storage_path));
      setCopiedId(row.id);
      setTimeout(() => setCopiedId((c) => (c === row.id ? null : c)), 1600);
    } catch {
      // Clipboard blocked — the copy button just stays inert.
    }
  }, []);

  const handleDeleteRow = useCallback(
    async (row: CustomModelRow) => {
      if (confirmDeleteId !== row.id) {
        setConfirmDeleteId(row.id);
        setTimeout(() => setConfirmDeleteId((c) => (c === row.id ? null : c)), 4000);
        return;
      }
      setConfirmDeleteId(null);
      setDeletingId(row.id);
      try {
        await deleteCustomModel(row);
        setCustomRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
      } catch (err) {
        setCustomError(errorMessage(err, 'Delete failed.'));
      } finally {
        setDeletingId(null);
      }
    },
    [confirmDeleteId]
  );

  /* ---------- Upload ---------- */

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);
  const [modelName, setModelName] = useState('');
  const [targetSize, setTargetSize] = useState(7);

  const handleFiles = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setFileError(null);
    setPublishError(null);
    setPublishSuccess(null);
    setDraft(null);

    if (!/\.(glb|gltf)$/i.test(file.name)) {
      setFileError('Only .glb / .gltf files can be added to the library.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError(
        `That file is ${formatBytes(file.size)} — over the 25 MB storage cap. Shrink it before uploading.`
      );
      return;
    }

    let original: ArrayBuffer;
    try {
      original = await file.arrayBuffer();
    } catch {
      setFileError('Could not read the file.');
      return;
    }

    setModelName(file.name.replace(/\.(glb|gltf)$/i, ''));
    setTargetSize(7);
    const next: Draft = {
      fileName: file.name,
      isBinary: isGlb(original),
      original,
      stats: null,
      analyzeError: null,
      optimized: null,
      optimizeNote: null,
      optimizeOk: null,
    };
    setDraft(next);
    setAnalyzing(true);
    try {
      const stats = await analyzeModel(original);
      setDraft((d) => (d && d.fileName === file.name ? { ...d, stats } : d));
    } catch {
      setDraft((d) =>
        d && d.fileName === file.name
          ? {
              ...d,
              analyzeError:
                'Could not parse this model. It must be a valid, self-contained glTF/GLB (external .bin or image references are not supported here).',
            }
          : d
      );
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const runOptimize = useCallback(async () => {
    if (!draft?.stats || optimizing) return;
    setOptimizing(true);
    try {
      const result = await optimizeGlb(draft.original);
      if (result.ok && result.changed) {
        const stats = await analyzeModel(result.buffer);
        setDraft((d) =>
          d
            ? {
                ...d,
                optimized: { buffer: result.buffer, stats, imagesTouched: result.imagesTouched },
                optimizeNote: result.note,
                optimizeOk: true,
              }
            : d
        );
      } else {
        setDraft((d) => (d ? { ...d, optimizeNote: result.note, optimizeOk: result.ok } : d));
      }
    } catch {
      setDraft((d) =>
        d ? { ...d, optimizeNote: 'Optimization failed — original kept unchanged.', optimizeOk: false } : d
      );
    } finally {
      setOptimizing(false);
    }
  }, [draft, optimizing]);

  const publish = useCallback(async () => {
    if (!draft || publishing) return;
    const stats = draft.optimized?.stats ?? draft.stats;
    if (!stats) return;
    const name = modelName.trim() || draft.fileName.replace(/\.(glb|gltf)$/i, '');
    setPublishing(true);
    setPublishError(null);
    try {
      await publishModel({
        name,
        bytes: draft.optimized?.buffer ?? draft.original,
        targetSize,
        triangles: stats.triangles,
        textureMP: stats.textureMP,
        vramMB: stats.vramMB,
        checks: computeChecks(stats, budgets),
      });
      setPublishSuccess(`“${name}” is live in the library.`);
      setDraft(null);
      setModelName('');
      setTargetSize(7);
      if (fileInputRef.current) fileInputRef.current.value = '';
      void refreshCustom();
    } catch (err) {
      setPublishError(errorMessage(err, 'Publish failed.'));
    } finally {
      setPublishing(false);
    }
  }, [draft, publishing, modelName, targetSize, budgets, refreshCustom]);

  const clearDraft = useCallback(() => {
    setDraft(null);
    setFileError(null);
    setPublishError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  /* ---------- Danger zone ---------- */

  const [dangerArmed, setDangerArmed] = useState(false);
  const [purging, setPurging] = useState(false);
  const [dangerMsg, setDangerMsg] = useState<string | null>(null);

  const purgeAll = useCallback(async () => {
    const rows = customRows ?? [];
    if (rows.length === 0 || purging) return;
    if (!dangerArmed) {
      setDangerArmed(true);
      setTimeout(() => setDangerArmed(false), 6000);
      return;
    }
    if (!window.confirm(`Really delete ALL ${rows.length} custom models? This cannot be undone.`)) {
      setDangerArmed(false);
      return;
    }
    setDangerArmed(false);
    setPurging(true);
    setDangerMsg(null);
    try {
      const n = await deleteAllCustomModels(rows);
      setDangerMsg(`${n} model${n === 1 ? '' : 's'} deleted.`);
    } catch (err) {
      setDangerMsg(errorMessage(err, 'Purge failed part-way.'));
    } finally {
      setPurging(false);
      void refreshCustom();
    }
  }, [customRows, purging, dangerArmed, refreshCustom]);

  /* ---------- Derived header stats ---------- */

  const totalLibraryBytes = useMemo(() => {
    const builtinBytes = (builtins ?? []).reduce((sum, e) => sum + (e.sizeBytes ?? 0), 0);
    const customBytes = (customRows ?? []).reduce((sum, r) => sum + Number(r.size_bytes || 0), 0);
    return builtinBytes + customBytes;
  }, [builtins, customRows]);

  const draftStats = draft?.optimized?.stats ?? draft?.stats ?? null;
  const draftChecks = draftStats ? computeChecks(draftStats, budgets) : null;

  /* ---------- Render ---------- */

  return (
    <div className="min-h-[100svh] stage-vignette text-white">
      <div className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8 safe-top">
        {/* ============ Header ============ */}
        <header className="pt-6 sm:pt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              to="/"
              className="tap glass glass-sheen inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold text-white/70 hover:text-white"
            >
              <ArrowLeft size={14} />
              Home
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FFB020]/40 bg-[#FFB020]/10 px-3 py-1.5 text-[10px] font-semibold text-[#FFB020]">
              <ShieldAlert size={12} className="shrink-0" />
              Anyone with this URL can manage models
            </span>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.08 }}
            className="drip-edge mt-7"
            style={{ '--paint': 'linear-gradient(90deg, #FF4D1C, #FFB020 55%, #e879f9)' } as React.CSSProperties}
          >
            <div className="flex items-center gap-3">
              <SprayCan size={30} className="shrink-0 text-[var(--color-airo-flame)]" />
              <h1 className="paint-title text-4xl font-black leading-none tracking-tight sm:text-6xl">
                AiroHub Admin
              </h1>
            </div>
            <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-white/55">
              The model-management portal — audit the built-in catalog, upload and optimize new
              models, and publish them to Supabase so they land in live sessions.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.18 }}
            className="mt-12 flex flex-wrap items-center gap-2.5"
          >
            <span
              className="splat-chip glass glass-sheen inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-extrabold tracking-wide"
              style={{ '--paint': 'rgba(255,77,28,0.85)' } as React.CSSProperties}
            >
              <Boxes size={13} />
              {builtins ? builtins.length : '…'} built-in
            </span>
            <span
              className="splat-chip glass glass-sheen inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-extrabold tracking-wide"
              style={{ '--paint': 'rgba(34,211,238,0.8)' } as React.CSSProperties}
            >
              <Database size={13} />
              {backendReady ? (customRows ? customRows.length : '…') : 0} custom
            </span>
            <span
              className="splat-chip glass glass-sheen inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-extrabold tracking-wide"
              style={{ '--paint': 'rgba(167,139,250,0.8)' } as React.CSSProperties}
            >
              <HardDrive size={13} />
              {formatBytes(totalLibraryBytes)} library
            </span>
          </motion.div>
        </header>

        {/* ============ LIBRARY — built-ins ============ */}
        <section className="mt-14">
          <SectionHeader
            icon={<Boxes size={15} />}
            accent="#FF7A34"
            title="Built-in Library"
            sub="The shipped catalog — fetch, analyze and grade each model in-browser."
            right={
              <button
                type="button"
                onClick={() => void auditAll()}
                disabled={!builtins || builtins.length === 0 || Boolean(audit?.running)}
                className="paint-btn tap inline-flex items-center gap-2 px-7 py-2.5 text-[12px] font-bold text-white disabled:opacity-60"
                style={{ '--paint': 'linear-gradient(120deg, #FF4D1C, #FF7A34 70%, #FFB020)' } as React.CSSProperties}
              >
                {audit?.running ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Auditing {audit.done}/{audit.total}
                  </>
                ) : (
                  <>
                    <Play size={13} />
                    Audit all
                  </>
                )}
              </button>
            }
          />

          {audit?.running && (
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#FF4D1C] to-[#FFB020] transition-all duration-300"
                style={{ width: `${audit.total ? (audit.done / audit.total) * 100 : 0}%` }}
              />
            </div>
          )}

          {builtins === null ? (
            <GlassPanel className="flex items-center gap-3 p-5 text-[12px] text-white/50">
              <Loader2 size={15} className="animate-spin" /> Scanning the shipped catalog…
            </GlassPanel>
          ) : builtins.length === 0 ? (
            <GlassPanel className="p-5 text-[12px] text-white/50">
              No built-in model assets were found under /models.
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {builtins.map((entry, i) => (
                <BuiltinCard
                  key={entry.def.id}
                  entry={entry}
                  run={runs[entry.def.id] ?? { status: 'idle' }}
                  budgets={budgets}
                  expanded={expandedIds.has(entry.def.id)}
                  onToggle={() => toggleExpanded(entry.def.id)}
                  onRun={() => void runBuiltinCheck(entry.def.id)}
                  index={i}
                />
              ))}
            </div>
          )}
        </section>

        {/* ============ LIBRARY — custom ============ */}
        <section className="mt-14">
          <SectionHeader
            icon={<Database size={15} />}
            accent="#34D399"
            title="Custom Models"
            sub="Published to the airohub-models bucket — available to every session."
            right={
              backendReady ? (
                <button
                  type="button"
                  onClick={() => void refreshCustom()}
                  disabled={customLoading}
                  className="tap glass glass-sheen inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-bold text-white/70 hover:text-white disabled:opacity-60"
                >
                  <RefreshCw size={12} className={customLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              ) : undefined
            }
          />

          {!backendReady ? (
            <GlassPanel className="flex items-start gap-3 border-[#FFB020]/30 p-5">
              <CloudOff size={17} className="mt-0.5 shrink-0 text-[#FFB020]" />
              <div>
                <p className="text-[13px] font-bold text-[#FFB020]">Supabase is offline</p>
                <p className="mt-1 text-[12px] leading-relaxed text-white/55">
                  <code className="font-mono text-white/70">VITE_SUPABASE_URL</code> /{' '}
                  <code className="font-mono text-white/70">VITE_SUPABASE_ANON_KEY</code> are not
                  set, so the custom library and publishing are disabled. Built-in audits and the
                  optimizer still work.
                </p>
              </div>
            </GlassPanel>
          ) : (
            <>
              {customError && (
                <p className="mb-3 flex items-center gap-1.5 text-[12px] text-[#FF4D1C]">
                  <XCircle size={13} className="shrink-0" /> {customError}
                </p>
              )}
              {customRows === null ? (
                <GlassPanel className="flex items-center gap-3 p-5 text-[12px] text-white/50">
                  <Loader2 size={15} className="animate-spin" /> Loading the custom library…
                </GlassPanel>
              ) : customRows.length === 0 ? (
                <GlassPanel className="p-6 text-center">
                  <Sparkles size={18} className="mx-auto text-white/30" />
                  <p className="mt-2 text-[13px] font-semibold text-white/60">No custom models yet</p>
                  <p className="mt-1 text-[11.5px] text-white/40">
                    Publish your first one from the upload station below.
                  </p>
                </GlassPanel>
              ) : (
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {customRows.map((row, i) => (
                    <CustomCard
                      key={row.id}
                      row={row}
                      budgets={budgets}
                      expanded={expandedIds.has(row.id)}
                      onToggle={() => toggleExpanded(row.id)}
                      copied={copiedId === row.id}
                      onCopy={() => void copyRowUrl(row)}
                      confirming={confirmDeleteId === row.id}
                      deleting={deletingId === row.id}
                      onDelete={() => void handleDeleteRow(row)}
                      index={i}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* ============ UPLOAD ============ */}
        <section className="mt-14">
          <SectionHeader
            icon={<UploadCloud size={15} />}
            accent="#22D3EE"
            title="Upload Station"
            sub="Drop a model → instant analysis → optimize in-browser → publish."
          />

          <GlassPanel
            strong
            className="splatter-accent overflow-hidden p-5 sm:p-6"
            style={{ '--paint': '#22D3EE' } as React.CSSProperties}
          >
            {/* Dropzone */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void handleFiles(e.dataTransfer.files);
              }}
              className={`tap relative z-10 cursor-pointer rounded-[22px] border-2 border-dashed px-6 py-9 text-center transition-colors ${
                dragging
                  ? 'border-[#22D3EE] bg-[#22D3EE]/10'
                  : 'border-white/15 bg-white/[0.03] hover:border-white/30'
              }`}
            >
              <UploadCloud size={26} className={`mx-auto ${dragging ? 'text-[#22D3EE]' : 'text-white/40'}`} />
              <p className="mt-2.5 text-[13.5px] font-bold text-white/80">
                Drop a <span className="text-[#22D3EE]">.glb</span> /{' '}
                <span className="text-[#22D3EE]">.gltf</span> here
              </p>
              <p className="mt-1 text-[11px] text-white/40">or click to browse · 25 MB max</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </div>

            {fileError && (
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[#FF4D1C]">
                <XCircle size={13} className="shrink-0" /> {fileError}
              </p>
            )}
            {publishSuccess && !draft && (
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[#34D399]">
                <CheckCircle2 size={13} className="shrink-0" /> {publishSuccess}
              </p>
            )}

            {/* Draft workbench */}
            {draft && (
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
                className="relative z-10 mt-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-1.5 font-mono text-[11px] text-white/80">
                    {draft.fileName}
                    <span className="text-white/35">{formatBytes(draft.original.byteLength)}</span>
                  </span>
                  {!draft.isBinary && (
                    <span className="rounded-full border border-[#FFB020]/40 bg-[#FFB020]/10 px-2.5 py-1 text-[10px] font-semibold text-[#FFB020]">
                      JSON .gltf — analysis only, publish needs a binary .glb
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={clearDraft}
                    className="tap ml-auto rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-[10.5px] font-semibold text-white/50 hover:text-white"
                  >
                    Clear
                  </button>
                </div>

                {analyzing && (
                  <p className="mt-4 flex items-center gap-2 text-[12px] text-white/55">
                    <Loader2 size={14} className="animate-spin" /> Parsing and measuring…
                  </p>
                )}
                {draft.analyzeError && (
                  <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF4D1C]">
                    <XCircle size={13} className="mt-0.5 shrink-0" /> {draft.analyzeError}
                  </p>
                )}

                {draftStats && draftChecks && (
                  <>
                    {/* Stats */}
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                      <StatTile label="Size" value={formatBytes(draftStats.sizeBytes)} />
                      <StatTile label="Triangles" value={formatCount(draftStats.triangles)} />
                      <StatTile label="Meshes" value={String(draftStats.meshes)} />
                      <StatTile
                        label="Textures"
                        value={`${draftStats.textures} · ${draftStats.textureMP.toFixed(1)} MP`}
                      />
                      <StatTile label="Est. VRAM" value={`${draftStats.vramMB.toFixed(0)} MB`} />
                      <StatTile
                        label="Bounds"
                        value={`${draftStats.dims.x.toFixed(1)}×${draftStats.dims.y.toFixed(1)}×${draftStats.dims.z.toFixed(1)}`}
                      />
                    </div>

                    {/* Checks */}
                    <div className="mt-4">
                      <div className="label-caps mb-2 text-white/35">Health checks</div>
                      <ChecksDetail
                        checks={draftChecks}
                        inputs={inputsFromStats(draftStats)}
                        budgets={budgets}
                      />
                    </div>

                    {/* Optimize */}
                    <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void runOptimize()}
                          disabled={optimizing || !draft.isBinary || Boolean(draft.optimized)}
                          className="paint-btn paint-btn-2 tap inline-flex items-center gap-2 px-7 py-2.5 text-[12px] font-bold text-white disabled:opacity-50"
                          style={{ '--paint': 'linear-gradient(120deg, #A78BFA, #e879f9)' } as React.CSSProperties}
                        >
                          {optimizing ? (
                            <>
                              <Loader2 size={13} className="animate-spin" /> Optimizing…
                            </>
                          ) : (
                            <>
                              <Sparkles size={13} /> Optimize
                            </>
                          )}
                        </button>
                        <p className="min-w-0 flex-1 text-[11px] leading-snug text-white/45">
                          {(draft.optimizeOk !== false && draft.optimizeNote) ||
                            'Downscales embedded textures over 1024px to WebP (q0.82) and rewrites the GLB in-browser — validated by a full re-parse before it replaces your file.'}
                        </p>
                      </div>

                      {draft.optimizeNote && !draft.optimized && draft.optimizeOk === false && (
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#FFB020]">
                          <AlertTriangle size={12} className="shrink-0" /> {draft.optimizeNote}
                        </p>
                      )}

                      {draft.optimized && draft.stats && (
                        <div className="mt-4">
                          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#34D399]">
                            <CheckCircle2 size={12} />
                            Optimized — {draft.optimized.imagesTouched} texture
                            {draft.optimized.imagesTouched === 1 ? '' : 's'} re-encoded, re-parse
                            verified
                          </p>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <DeltaBadge
                              label="File size"
                              before={draft.stats.sizeBytes}
                              after={draft.optimized.stats.sizeBytes}
                              format={formatBytes}
                            />
                            <DeltaBadge
                              label="Triangles"
                              before={draft.stats.triangles}
                              after={draft.optimized.stats.triangles}
                              format={formatCount}
                            />
                            <DeltaBadge
                              label="Texture MP"
                              before={draft.stats.textureMP}
                              after={draft.optimized.stats.textureMP}
                              format={(n) => `${n.toFixed(1)} MP`}
                            />
                            <DeltaBadge
                              label="Est. VRAM"
                              before={draft.stats.vramMB}
                              after={draft.optimized.stats.vramMB}
                              format={(n) => `${n.toFixed(0)} MB`}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Publish form */}
                    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-1.5">
                        <span className="label-caps text-white/35">Model name</span>
                        <input
                          value={modelName}
                          onChange={(e) => setModelName(e.target.value)}
                          maxLength={64}
                          placeholder="My model"
                          className="w-full rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 text-[13px] text-white placeholder:text-white/25 focus:border-[var(--color-airo-aqua)]/60 focus:outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="label-caps flex items-baseline justify-between text-white/35">
                          <span>Target display size</span>
                          <span className="font-mono text-[11px] normal-case tracking-normal text-[#22D3EE]">
                            {targetSize} world units
                          </span>
                        </span>
                        <input
                          type="range"
                          min={3}
                          max={12}
                          step={0.5}
                          value={targetSize}
                          onChange={(e) => setTargetSize(Number(e.target.value))}
                          className="airo-slider w-full"
                        />
                        <span className="flex justify-between font-mono text-[9px] text-white/25">
                          <span>3 · handheld</span>
                          <span>12 · monumental</span>
                        </span>
                      </label>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void publish()}
                        disabled={!backendReady || !draft.isBinary || publishing || !modelName.trim()}
                        className="paint-btn tap inline-flex items-center gap-2 px-9 py-3 text-[13px] font-bold text-white disabled:opacity-50"
                        style={{ '--paint': 'linear-gradient(120deg, #22D3EE, #34D399)' } as React.CSSProperties}
                      >
                        {publishing ? (
                          <>
                            <Loader2 size={14} className="animate-spin" /> Publishing…
                          </>
                        ) : (
                          <>
                            <UploadCloud size={14} /> Publish to library
                          </>
                        )}
                      </button>
                      {draft.optimized && (
                        <span className="text-[11px] text-white/45">
                          Publishing the <span className="font-semibold text-[#A78BFA]">optimized</span>{' '}
                          build ({formatBytes(draft.optimized.stats.sizeBytes)})
                        </span>
                      )}
                      {!backendReady && (
                        <span className="text-[11px] text-[#FFB020]">
                          Publishing disabled — Supabase env vars are missing.
                        </span>
                      )}
                    </div>
                    {publishError && (
                      <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF4D1C]">
                        <XCircle size={13} className="mt-0.5 shrink-0" /> {publishError}
                      </p>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </GlassPanel>
        </section>

        {/* ============ SETTINGS ============ */}
        <section className="mt-14">
          <SectionHeader
            icon={<Settings2 size={15} />}
            accent="#A78BFA"
            title="Settings"
            sub="Check budgets apply everywhere immediately and persist on this device."
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <GlassPanel className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-bold text-white/85">Check budgets</h3>
                <button
                  type="button"
                  onClick={resetBudgets}
                  className="tap rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-[10.5px] font-semibold text-white/55 hover:text-white"
                >
                  Reset defaults
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {BUDGET_FIELDS.map((field) => (
                  <BudgetField
                    key={field.key}
                    label={field.label}
                    step={field.step}
                    value={budgets[field.key]}
                    onCommit={(n) => updateBudget(field.key, n)}
                  />
                ))}
              </div>
              <p className="mt-3 text-[10.5px] leading-relaxed text-white/35">
                Stored in localStorage (<code className="font-mono">airo:admin:budgets</code>). Values
                at or under “pass” are green; under “warn”, amber; anything above fails.
              </p>
            </GlassPanel>

            <GlassPanel className="border-[#FF4D1C]/25 p-5">
              <h3 className="flex items-center gap-2 text-[13px] font-bold text-[#FF4D1C]">
                <AlertTriangle size={14} /> Danger zone
              </h3>
              <p className="mt-2 text-[11.5px] leading-relaxed text-white/50">
                Removes every custom model — storage objects and registry rows. Built-in models are
                never touched. Two confirmations required.
              </p>
              <button
                type="button"
                onClick={() => void purgeAll()}
                disabled={!backendReady || purging || (customRows ?? []).length === 0}
                className={`tap mt-4 inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-[12px] font-bold transition-colors disabled:opacity-40 ${
                  dangerArmed
                    ? 'border-[#FF4D1C] bg-[#FF4D1C]/30 text-white'
                    : 'border-[#FF4D1C]/45 bg-[#FF4D1C]/10 text-[#FF4D1C]'
                }`}
              >
                {purging ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Deleting…
                  </>
                ) : dangerArmed ? (
                  <>
                    <AlertTriangle size={13} /> Click again to confirm
                  </>
                ) : (
                  <>
                    <Trash2 size={13} /> Delete ALL custom models
                  </>
                )}
              </button>
              {dangerMsg && <p className="mt-3 text-[11.5px] text-white/55">{dangerMsg}</p>}
            </GlassPanel>
          </div>
        </section>

        <footer className="safe-bottom mt-16 flex items-center justify-center gap-2 text-[10px] text-white/30">
          <SprayCan size={11} />
          AiroHub model portal · checks graded against local budgets
        </footer>
      </div>
    </div>
  );
}
