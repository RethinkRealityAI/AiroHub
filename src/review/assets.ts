/**
 * The review roster — every asset that can reach a live room, in one list.
 *
 * Two sources, one shape: the shipped catalog (`PAINTABLE_OBJECTS`) and every
 * row in `airohub_models`. The gallery has to be able to judge an asset before
 * anybody has judged it, which dictates the one rule this module exists to
 * enforce:
 *
 * **`listCustomModels()`, never `ensureCustomModels()`.** The latter is the
 * *player's* view of the library — it now returns approved uploads only, and it
 * mutates the global catalog as a side effect. Building the review roster from
 * it would mean reviewing the gate through the gate: a freshly published model
 * is pending, so it would never appear in the gallery, so it could never be
 * approved, so it would never appear. The feature would be inert on day one.
 *
 * Built-ins are read straight out of `PAINTABLE_OBJECTS` filtered to the
 * non-`Uploads` categories, not sliced by count, because `ensureCustomModels()`
 * pushes upload entries into that same array and may already have run earlier
 * in the SPA session.
 */
import { PAINTABLE_OBJECTS, type PaintableObject } from '../paint/objectCatalog';
import { listCustomModels, publicModelUrl, isBackendConfigured } from '../admin/supabase';
import type { AssetKind } from './reviews';

export interface ReviewAsset {
  /** App-wide catalog id and the primary key of the verdict row. */
  key: string;
  kind: AssetKind;
  label: string;
  /** `airohub_models.id`; null for built-ins, which have no registry row. */
  modelId: string | null;
  /**
   * Rendered still of the model, shown while the card's 3D stage is unmounted.
   * Absent for uploads — nothing has ever rendered them — which is exactly why
   * they are the assets most worth turning around by hand.
   */
  poster?: string;
  category: string;
  blurb: string;
  /** Longest dimension after normalisation, passed through to `loadModel`. */
  targetSize: number;
  /** Absolute GLB URL for uploads; built-ins resolve through `modelUrl()`. */
  url?: string;
  sizeBytes?: number;
  triangles?: number;
  createdAt?: string;
}

export interface ReviewRoster {
  assets: ReviewAsset[];
  /**
   * Why the uploads half is missing, if it is. Built-ins are always present, so
   * the gallery stays useful (and diagnosable) with Supabase unreachable.
   */
  uploadsError: string | null;
}

function fromBuiltin(object: PaintableObject): ReviewAsset {
  return {
    key: object.id,
    kind: 'builtin',
    label: object.label,
    modelId: null,
    poster: object.thumb,
    category: object.category,
    blurb: object.blurb,
    targetSize: object.targetSize,
  };
}

/** The shipped roster, synchronously — the gallery renders this before any fetch. */
export function builtinReviewAssets(): ReviewAsset[] {
  return PAINTABLE_OBJECTS.filter((o) => o.category !== 'Uploads').map(fromBuiltin);
}

/**
 * Built-ins plus every uploaded model, whatever its verdict.
 *
 * Never rejects: an unreachable registry yields the built-ins and a message,
 * because a reviewer who cannot see uploads should still be able to work.
 */
export async function buildReviewAssets(): Promise<ReviewRoster> {
  const assets = builtinReviewAssets();
  if (!isBackendConfigured()) {
    return { assets, uploadsError: null };
  }
  try {
    const rows = await listCustomModels();
    for (const row of rows) {
      assets.push({
        key: `up-${row.id}`,
        kind: 'upload',
        label: row.name,
        modelId: row.id,
        category: 'Uploads',
        blurb: 'Uploaded through the admin portal.',
        targetSize: Number(row.target_size) || 7,
        url: publicModelUrl(row.storage_path),
        sizeBytes: Number(row.size_bytes) || undefined,
        triangles: Number(row.triangles) || undefined,
        createdAt: row.created_at,
      });
    }
    return { assets, uploadsError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not reach Supabase.';
    return { assets, uploadsError: message };
  }
}
