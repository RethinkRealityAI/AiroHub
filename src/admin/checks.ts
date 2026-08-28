/**
 * The model health system: budgets, graded checks, and display formatting.
 *
 * A "check" is a single graded verdict (pass / warn / fail) about one aspect of
 * a model. The thresholds live in an editable budget object persisted to
 * localStorage, so the admin can tighten or relax the bar without a deploy.
 * The same ChecksMap shape is stored as the `checks` jsonb column on publish.
 */
import type { ModelStats } from './analyze';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type ChecksMap = Record<string, CheckStatus>;

export interface CheckBudgets {
  /** Download size, decimal-ish MB (MiB) — pass / warn ceilings. */
  sizePassMB: number;
  sizeWarnMB: number;
  trianglesPass: number;
  trianglesWarn: number;
  /** Total texture megapixels. 8.4 ≈ two 2048² maps. */
  textureMpPass: number;
  textureMpWarn: number;
  /** Estimated GPU memory (RGBA + mip chain). */
  vramPassMB: number;
  vramWarnMB: number;
}

export const DEFAULT_BUDGETS: CheckBudgets = {
  sizePassMB: 2.5,
  sizeWarnMB: 8,
  trianglesPass: 80_000,
  trianglesWarn: 150_000,
  textureMpPass: 8.4,
  textureMpWarn: 17,
  vramPassMB: 90,
  vramWarnMB: 180,
};

const BUDGETS_KEY = 'airo:admin:budgets';

export function loadBudgets(): CheckBudgets {
  try {
    const raw = localStorage.getItem(BUDGETS_KEY);
    if (!raw) return { ...DEFAULT_BUDGETS };
    const parsed = JSON.parse(raw) as Partial<Record<keyof CheckBudgets, unknown>>;
    const merged = { ...DEFAULT_BUDGETS };
    for (const key of Object.keys(DEFAULT_BUDGETS) as (keyof CheckBudgets)[]) {
      const value = parsed[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        merged[key] = value;
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_BUDGETS };
  }
}

export function saveBudgets(budgets: CheckBudgets) {
  try {
    localStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets));
  } catch {
    // Storage full / private mode — budgets simply won't persist.
  }
}

const MB = 1024 * 1024;

function grade(value: number, pass: number, warn: number): CheckStatus {
  if (value <= pass) return 'pass';
  if (value <= warn) return 'warn';
  return 'fail';
}

/**
 * Grades a model against the budgets.
 *
 * `meshopt` rides along in the map so custom rows keep the info after publish,
 * but the UI renders it as an informational chip, never as a warning.
 */
export function computeChecks(stats: ModelStats, budgets: CheckBudgets): ChecksMap {
  return {
    size_bytes: grade(stats.sizeBytes, budgets.sizePassMB * MB, budgets.sizeWarnMB * MB),
    triangles: grade(stats.triangles, budgets.trianglesPass, budgets.trianglesWarn),
    texture_mp: grade(stats.textureMP, budgets.textureMpPass, budgets.textureMpWarn),
    vram_mb: grade(stats.vramMB, budgets.vramPassMB, budgets.vramWarnMB),
    has_uvs: stats.hasUVs ? 'pass' : 'fail',
    meshopt: stats.meshopt ? 'pass' : 'warn',
  };
}

/** The numbers a published row keeps, enough to re-grade with live budgets. */
export interface CheckInputs {
  sizeBytes: number;
  triangles: number;
  textureMP: number;
  vramMB: number;
}

/** Re-grades stored numeric columns; UV/meshopt verdicts come from the stored map. */
export function regradeChecks(
  inputs: CheckInputs,
  stored: ChecksMap | null,
  budgets: CheckBudgets
): ChecksMap {
  return {
    size_bytes: grade(inputs.sizeBytes, budgets.sizePassMB * MB, budgets.sizeWarnMB * MB),
    triangles: grade(inputs.triangles, budgets.trianglesPass, budgets.trianglesWarn),
    texture_mp: grade(inputs.textureMP, budgets.textureMpPass, budgets.textureMpWarn),
    vram_mb: grade(inputs.vramMB, budgets.vramPassMB, budgets.vramWarnMB),
    has_uvs: stored?.has_uvs ?? 'pass',
    meshopt: stored?.meshopt ?? 'warn',
  };
}

export interface CheckDescriptor {
  key: string;
  label: string;
  /** e.g. "1.8 MB · budget 2.5 MB" */
  detail: string;
  /** Longer explanation surfaced as a tooltip / hint line. */
  hint: string;
}

/** Human copy for one check row given the measured value and live budgets. */
export function describeCheck(
  key: string,
  inputs: Partial<CheckInputs> & { hasUVs?: boolean; meshopt?: boolean },
  budgets: CheckBudgets
): CheckDescriptor {
  switch (key) {
    case 'size_bytes':
      return {
        key,
        label: 'File size',
        detail:
          inputs.sizeBytes != null
            ? `${formatBytes(inputs.sizeBytes)} · budget ${budgets.sizePassMB} MB`
            : `budget ${budgets.sizePassMB} MB`,
        hint: `Download weight. Pass ≤ ${budgets.sizePassMB} MB, warn ≤ ${budgets.sizeWarnMB} MB.`,
      };
    case 'triangles':
      return {
        key,
        label: 'Triangles',
        detail:
          inputs.triangles != null
            ? `${formatCount(inputs.triangles)} · budget ${formatCount(budgets.trianglesPass)}`
            : `budget ${formatCount(budgets.trianglesPass)}`,
        hint: `Raycast + render cost. Pass ≤ ${formatCount(budgets.trianglesPass)}, warn ≤ ${formatCount(budgets.trianglesWarn)}.`,
      };
    case 'texture_mp':
      return {
        key,
        label: 'Texture area',
        detail:
          inputs.textureMP != null
            ? `${inputs.textureMP.toFixed(1)} MP · budget ${budgets.textureMpPass} MP`
            : `budget ${budgets.textureMpPass} MP`,
        hint: `Sum of texture megapixels. Pass ≤ ${budgets.textureMpPass} MP (≈ two 2048² maps), warn ≤ ${budgets.textureMpWarn} MP.`,
      };
    case 'vram_mb':
      return {
        key,
        label: 'Est. VRAM',
        detail:
          inputs.vramMB != null
            ? `${inputs.vramMB.toFixed(0)} MB · budget ${budgets.vramPassMB} MB`
            : `budget ${budgets.vramPassMB} MB`,
        hint: `RGBA upload + mip chain (w × h × 4 × 1.33). Pass ≤ ${budgets.vramPassMB} MB, warn ≤ ${budgets.vramWarnMB} MB.`,
      };
    case 'has_uvs':
      return {
        key,
        label: 'UV coordinates',
        detail: inputs.hasUVs === false ? 'missing on painted meshes' : 'all meshes mapped',
        hint: 'Paint REQUIRES UVs — spray stamps land in UV space, so a mesh without a uv attribute cannot be painted at all.',
      };
    case 'meshopt':
      return {
        key,
        label: 'Meshopt',
        detail: inputs.meshopt ? 'EXT_meshopt_compression present' : 'not compressed',
        hint: 'Informational: whether the geometry is meshopt-compressed like the built-in catalog.',
      };
    default:
      return { key, label: key, detail: '', hint: '' };
  }
}

/** Ordering used everywhere a full checks list renders. */
export const GRADED_CHECK_KEYS = ['size_bytes', 'triangles', 'texture_mp', 'vram_mb', 'has_uvs'] as const;

/* ------------------------------------------------------------------
   Formatting
   ------------------------------------------------------------------ */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 2 : 1)} MB`;
}

export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${Math.round(n)}`;
}
