/**
 * The stamp library.
 *
 * Two kinds of stamp share one shelf:
 *
 *   - **Stencils** shipped with the app (`/ui/stamps/stamp-*.webp`). They are
 *     white shapes on alpha, so they carry no colour of their own and are
 *     always drawn through a tint — the painter's current colour.
 *   - **Uploads** the player brings themselves. Those are full-colour artwork
 *     and are never tinted; recolouring someone's logo would be vandalism.
 *
 * Uploads and the recently-used list persist in `localStorage` under
 * `airo:stamps:v1` so a phone keeps its shelf between sessions.
 *
 * Everything that crosses the network does so as a data URL, which is why the
 * encoder here is stingy: images are downscaled and re-encoded until they fit
 * inside the broadcast budget, built-in stencils included (their source webp
 * files are authored at 480px and are far too heavy to send raw).
 */

import type { PaintSurface } from './PaintSurface';
import type { ImageStampData } from '../types';

/** Hard ceiling for the `img` field of an `image-stamp` broadcast. */
export const STAMP_DATAURL_MAX = 64 * 1024;

/** Longest edge a transmitted stamp is encoded at. */
const STAMP_ENCODE_DIM = 256;

/** How many uploads the shelf keeps before evicting the oldest. */
const MAX_UPLOADS = 24;
/** How many entries the "recent" row remembers. */
const MAX_RECENT = 12;

const STORAGE_KEY = 'airo:stamps:v1';

export interface StampAsset {
  id: string;
  label: string;
  /** Public URL (built-ins) or data URL (uploads). */
  src: string;
  /** White-on-alpha stencils take the painter's colour; uploads do not. */
  tintable: boolean;
  origin: 'builtin' | 'upload';
  /** Wall-clock time an upload was added, used as the eviction order. */
  addedAt?: number;
}

/** The shipped stencil set, in shelf order. */
export const BUILTIN_STAMPS: StampAsset[] = [
  { id: 'crown', label: 'Crown' },
  { id: 'star', label: 'Star' },
  { id: 'flame', label: 'Flame' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'skull', label: 'Skull' },
  { id: 'ring', label: 'Ring' },
  { id: 'bolt', label: 'Bolt' },
  { id: 'heart', label: 'Heart' },
].map(({ id, label }) => ({
  id: `builtin:${id}`,
  label,
  src: `/ui/stamps/stamp-${id}.webp`,
  tintable: true,
  origin: 'builtin' as const,
}));

/** Built-in stencils by their bare id (`crown`, `bolt`, …). */
export const BUILTIN_BY_NAME = new Map(
  BUILTIN_STAMPS.map((asset) => [asset.id.slice('builtin:'.length), asset])
);

/**
 * Legacy stencil symbols, mapped onto the stencil set.
 *
 * The AI endpoints answer with `stencilSymbol` — a single character picked by
 * the model (or by the curated fallbacks it ships with). That used to be typed
 * straight onto the artwork; it now selects a real stencil instead. Written as
 * escapes rather than literal characters so no pictograph appears in the
 * source, and so the table is readable as data.
 */
const SYMBOL_STAMPS: Record<string, string> = {
  '\u26A1': 'bolt', // high voltage
  '\u{1F5F2}': 'bolt', // lightning mood
  '\u{1F451}': 'crown', // crown
  '\u2605': 'star', // black star
  '\u2606': 'star', // white star
  '\u2726': 'star', // four-pointed star
  '\u2727': 'star',
  '\u2B50': 'star', // white medium star
  '\u{1F31F}': 'star', // glowing star
  '\u2665': 'heart', // heart suit
  '\u2764': 'heart', // heavy black heart
  '\u{1F525}': 'flame', // fire
  '\u2620': 'skull', // skull and crossbones
  '\u{1F480}': 'skull', // skull
  '\u27A4': 'arrow', // black rightwards arrowhead
  '\u2794': 'arrow', // heavy wide-headed arrow
  '\u{1F409}': 'flame', // dragon
  '\u{1F680}': 'flame', // rocket
  '\u{1F441}': 'ring', // eye
  '\u{1F440}': 'ring', // eyes
};

/**
 * The stencil an AI suggestion should place.
 *
 * Accepts a legacy symbol, a bare stencil id (`crown`) or anything at all —
 * an unrecognised suggestion falls back to the ring, which reads as a
 * deliberate mark rather than as a missing glyph.
 */
export function stampForSymbol(symbol?: string | null): StampAsset {
  const raw = (symbol || '').trim();
  const byName = BUILTIN_BY_NAME.get(raw.toLowerCase());
  if (byName) return byName;
  const mapped = SYMBOL_STAMPS[raw] ?? SYMBOL_STAMPS[[...raw][0] ?? ''];
  return BUILTIN_BY_NAME.get(mapped ?? 'ring') ?? BUILTIN_STAMPS[0];
}

/**
 * Texture-pixel radius a stamp is placed at for a given tool-size multiplier.
 *
 * A stamp is a coherent quad in *UV* space, and the generated models are
 * UV-atlased into many small charts — so the wider a stamp is, the more likely
 * its edges spill over a chart boundary and reappear somewhere unrelated on
 * the model (the same hazard `SurfacePainter` avoids by using tiny per-ray
 * dabs). The dock's 0.4–2.0 slider therefore maps to 22–110 px on the 2048²
 * canvas: big enough to read as a badge, small enough to sit inside one chart
 * on most objects.
 */
export function stampRadiusPx(sizeMultiplier: number): number {
  return Math.round(55 * Math.min(Math.max(sizeMultiplier, 0.3), 2.4));
}

/* ------------------------------------------------------------------
   Decoding
   ------------------------------------------------------------------ */

const decodeCache = new Map<string, Promise<HTMLImageElement>>();

/** Decodes a URL or data URL into an image, memoised per source. */
export function decodeStampImage(src: string): Promise<HTMLImageElement> {
  const hit = decodeCache.get(src);
  if (hit) return hit;

  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`stamp image failed to load: ${src.slice(0, 48)}`));
    image.src = src;
  });

  // Data URLs are unbounded in count; keep the cache from growing forever.
  if (decodeCache.size > 64) decodeCache.clear();
  decodeCache.set(src, pending);
  return pending;
}

/* ------------------------------------------------------------------
   Encoding for the wire
   ------------------------------------------------------------------ */

function drawScaled(image: HTMLImageElement, maxDim: number): HTMLCanvasElement {
  const w = image.naturalWidth || image.width || 1;
  const h = image.naturalHeight || image.height || 1;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Squeezes an image into `budget` characters of data URL: webp first (it keeps
 * alpha and is dramatically smaller than png for these shapes), stepping the
 * quality down and then the resolution, with png as the last resort for
 * browsers that cannot encode webp at all.
 */
function encodeWithinBudget(image: HTMLImageElement, budget: number): string {
  let dim = STAMP_ENCODE_DIM;
  let fallback = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    const canvas = drawScaled(image, dim);
    for (const quality of [0.86, 0.72, 0.6, 0.48, 0.36]) {
      const url = canvas.toDataURL('image/webp', quality);
      // Browsers without a webp encoder silently hand back a png.
      if (!url.startsWith('data:image/webp')) break;
      fallback = url;
      if (url.length <= budget) return url;
    }
    const png = canvas.toDataURL('image/png');
    if (!fallback) fallback = png;
    if (png.length <= budget) return png;
    dim = Math.round(dim * 0.7);
  }
  return fallback;
}

const payloadCache = new Map<string, Promise<string>>();

/**
 * The data URL to broadcast for a stamp. Uploads already arrive compressed, so
 * they are passed straight through; built-in stencils are re-encoded once and
 * memoised for the rest of the session.
 */
export function stampPayload(asset: StampAsset): Promise<string> {
  if (asset.origin === 'upload') return Promise.resolve(asset.src);
  const hit = payloadCache.get(asset.id);
  if (hit) return hit;
  const pending = decodeStampImage(asset.src).then((image) =>
    encodeWithinBudget(image, STAMP_DATAURL_MAX)
  );
  payloadCache.set(asset.id, pending);
  return pending;
}

/**
 * Builds the receiver for `image-stamp` broadcasts.
 *
 * Decoding a data URL is asynchronous, so applications are chained rather than
 * fired in parallel: two stamps sent back to back have to land in the order
 * they were sent, or the stroke log — and with it every peer's undo order and
 * time-lapse replay — would disagree about which one is on top.
 */
export function createStampApplier(surface: PaintSurface) {
  let chain: Promise<unknown> = Promise.resolve();

  return function applyImageStamp(payload: Partial<ImageStampData> | null | undefined) {
    if (!payload) return;
    const { img, u, v } = payload;
    if (typeof img !== 'string' || img.length < 32) return;
    if (typeof u !== 'number' || typeof v !== 'number') return;
    const radiusPx = typeof payload.radiusPx === 'number' ? payload.radiusPx : 90;
    const rotation = typeof payload.rotation === 'number' ? payload.rotation : 0;
    const tint = typeof payload.tint === 'string' ? payload.tint : null;
    const strokeId = payload.stampId || `stamp#${Math.random().toString(36).slice(2, 9)}`;

    chain = chain
      .then(() => decodeStampImage(img))
      .then((image) => {
        surface.stampImage(image, u, v, radiusPx, rotation, tint, strokeId);
        surface.commit();
      })
      .catch((err) => console.error('[stamp] could not apply image stamp', err));
  };
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

/** Turns a picked file into a transmittable stamp asset (never tinted). */
export async function stampFromFile(file: File): Promise<StampAsset> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Pick an image file — PNG, JPG, WEBP or GIF.');
  }
  const image = await decodeStampImage(await readFile(file));
  const src = encodeWithinBudget(image, STAMP_DATAURL_MAX);
  if (!src || src.length > STAMP_DATAURL_MAX) {
    throw new Error('That image is too detailed to send. Try a simpler graphic.');
  }
  const label = file.name.replace(/\.[^.]+$/, '').slice(0, 18) || 'Upload';
  return {
    id: `up:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    label,
    src,
    tintable: false,
    origin: 'upload',
    addedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------
   Persistence
   ------------------------------------------------------------------ */

export interface StampLibrary {
  uploads: StampAsset[];
  /** Stamp ids, most recently used first. */
  recent: string[];
}

const EMPTY: StampLibrary = { uploads: [], recent: [] };

export function loadStampLibrary(): StampLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<StampLibrary>;
    const uploads = Array.isArray(parsed.uploads)
      ? parsed.uploads
          .filter((entry): entry is StampAsset => Boolean(entry?.id && entry?.src))
          .map((entry) => ({ ...entry, tintable: false, origin: 'upload' as const }))
          .slice(-MAX_UPLOADS)
      : [];
    const recent = Array.isArray(parsed.recent)
      ? parsed.recent.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT)
      : [];
    return { uploads, recent };
  } catch {
    // Private mode, corrupt entry, quota games — an empty shelf is fine.
    return { ...EMPTY };
  }
}

function persist(library: StampLibrary): StampLibrary {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch {
    // Over quota: shed the oldest half and try once more before giving up.
    try {
      const trimmed: StampLibrary = {
        uploads: library.uploads.slice(Math.ceil(library.uploads.length / 2)),
        recent: library.recent.slice(0, 6),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch {
      /* nothing persists in this browser; the in-memory shelf still works */
    }
  }
  return library;
}

/** Adds an upload, evicting the oldest once the shelf is full. */
export function addUpload(library: StampLibrary, asset: StampAsset): StampLibrary {
  const uploads = [...library.uploads.filter((u) => u.id !== asset.id), asset].slice(-MAX_UPLOADS);
  return persist({ ...library, uploads });
}

export function removeUpload(library: StampLibrary, id: string): StampLibrary {
  return persist({
    uploads: library.uploads.filter((u) => u.id !== id),
    recent: library.recent.filter((r) => r !== id),
  });
}

export function markRecent(library: StampLibrary, id: string): StampLibrary {
  const recent = [id, ...library.recent.filter((r) => r !== id)].slice(0, MAX_RECENT);
  return persist({ ...library, recent });
}

/** Every stamp currently on the shelf, built-ins first. */
export function allStamps(library: StampLibrary): StampAsset[] {
  return [...BUILTIN_STAMPS, ...[...library.uploads].reverse()];
}

/** Resolves the recent-id list back to assets, skipping anything deleted. */
export function recentStamps(library: StampLibrary): StampAsset[] {
  const byId = new Map(allStamps(library).map((asset) => [asset.id, asset]));
  return library.recent
    .map((id) => byId.get(id))
    .filter((asset): asset is StampAsset => Boolean(asset));
}
