/**
 * Liquid-glass refraction — the maths and the raster, with no React in sight.
 *
 * `.glass` in index.css blurs whatever sits behind a panel. Real glass also
 * *bends* it, and the bend lives entirely at the rim: a thick edge works as a
 * lens, so the background squeezes and slides as it passes under the bezel and
 * then runs straight again across the flat middle. This module builds the one
 * asset SVG needs to reproduce that — a displacement map — and hands back a PNG
 * data URL together with the `scale` that decodes it.
 *
 * Why a map rather than a shader: `backdrop-filter` can reference an SVG filter,
 * and `feDisplacementMap` moves each backdrop pixel by `scale * (channel - 0.5)`.
 * Encode the per-pixel refraction offset into R and G, hand the filter the right
 * `scale`, and the compositor does the bending for free — no WebGL context, no
 * frame loop, nothing competing with the 60fps stage the panels float over.
 *
 * The physics, in one dimension and then generalised:
 *
 *   1. A convex-squircle cross-section `h(x) = (1 - (1-x)^4)^(1/4)` across the
 *      bezel band, x running inward from the outer edge (0) to the flat middle
 *      (1). Steep at the rim, flat by the time it reaches the body.
 *   2. Its slope, by central difference, gives the surface normal.
 *   3. One Snell refraction air → glass (eta = 1/1.5) of a ray arriving straight
 *      down through that normal.
 *   4. The ray's lateral drift over the local glass depth is the pixel offset.
 *
 * That is a 127-sample LUT, computed once per (thickness, bezel) pair. A rounded
 * rectangle is then the same profile wrapped around a signed-distance field: the
 * LUT supplies the magnitude at `-sd / bezel`, the SDF gradient supplies the
 * direction. A circle is that same code with radius = w/2 = h/2, so the round
 * case is a special case of nothing — it falls out.
 *
 * Nothing here touches the document beyond one detached <canvas>, and every
 * failure path returns null so the caller can leave the CSS blur alone.
 */

/* ------------------------------------------------------------------
   Constants
   ------------------------------------------------------------------ */

/** Samples across the bezel band. Roughly five per pixel at the default width. */
export const LUT_SAMPLES = 127;

/** Central-difference step, in normalised band units. */
const DELTA = 0.001;

/**
 * Air → crown glass. A single refraction event: the exit face of a UI panel is
 * flat and parallel enough that a second one would only re-straighten what the
 * first bent, at twice the cost.
 */
const ETA = 1 / 1.5;

/** feDisplacementMap can address ±128px per channel and no further. */
export const MAX_DISPLACEMENT_PX = 128;

/** Fallback corner radius — `--radius-glass`, the house rounding. */
export const DEFAULT_RADIUS = 26;

/** Widest the bezel band gets, however large the corner radius asks for. */
export const DEFAULT_BEZEL_CAP = 24;

/** Default glass depth in px. This is the strength dial. */
export const DEFAULT_THICKNESS = 20;

/**
 * Raster sizes are rounded into buckets this wide, so dragging a window edge
 * reuses maps instead of minting one per pixel of travel. `preserveAspectRatio`
 * on the feImage stretches the last two pixels back onto the real border box.
 */
const BUCKET = 2;

/** Base64 PNGs are not free; a slow drag would otherwise stack them up. */
const CACHE_LIMIT = 24;

const clamp = (value: number, lo: number, hi: number) =>
  value < lo ? lo : value > hi ? hi : value;

/* ------------------------------------------------------------------
   The one-dimensional profile
   ------------------------------------------------------------------ */

/**
 * Convex-squircle height across the band, normalised on both axes.
 *
 * x is clamped before the power on purpose: the central difference below asks
 * for h(-delta), where `(1 - x)^4 > 1` and the fourth root of a negative number
 * is NaN. One NaN in the LUT poisons every pixel of the map it feeds.
 */
export function height(x: number): number {
  const u = 1 - clamp(x, 0, 1);
  return (1 - u * u * u * u) ** 0.25;
}

/**
 * Signed pixel offsets across the band, rim first.
 *
 * Both ends come out at zero and for opposite reasons — at x = 0 the glass has
 * no depth yet, at x = 1 the surface is flat and the ray passes straight
 * through — so the peak sits a fraction of the band in from the edge, which is
 * exactly where a real bezel does its bending.
 */
export function buildLut(thickness: number, bezel: number): Float64Array {
  const lut = new Float64Array(LUT_SAMPLES);
  // h is normalised on both axes, so the real rise per px across the band is
  // thickness/bezel times the normalised slope.
  const aspect = bezel > 0 ? thickness / bezel : 0;

  for (let i = 0; i < LUT_SAMPLES; i++) {
    const x = i / (LUT_SAMPLES - 1);
    const slope = ((height(x + DELTA) - height(x - DELTA)) / (2 * DELTA)) * aspect;

    // Cross-section normal, then one refraction of a ray travelling straight in.
    const len = Math.hypot(slope, 1);
    const nx = slope / len;
    const ny = 1 / len;
    const cosine = -ny; // dot(N, (0, -1))
    const k = 1 - ETA * ETA * (1 - cosine * cosine);
    if (k < 0) {
      // Unreachable going into a denser medium (eta < 1), kept so this stays
      // the actual refraction formula rather than a convenient half of it.
      lut[i] = 0;
      continue;
    }
    const s = ETA * cosine + Math.sqrt(k);
    // refract((0,-1), N, eta) = eta*I - s*N; the incident x term is zero.
    const tx = -s * nx;
    const ty = -ETA - s * ny;
    lut[i] = ty !== 0 ? (tx / ty) * thickness * height(x) : 0;
  }
  return lut;
}

/** LUT lookup with linear interpolation; x is clamped to the band. */
export function sampleLut(lut: ArrayLike<number>, x: number): number {
  const last = lut.length - 1;
  const t = clamp(x, 0, 1) * last;
  const i = Math.min(last, Math.floor(t));
  const j = Math.min(last, i + 1);
  return lut[i] + (lut[j] - lut[i]) * (t - i);
}

/* ------------------------------------------------------------------
   Rounded-rectangle field
   ------------------------------------------------------------------ */

/**
 * Signed distance to a rounded rectangle centred on the origin — negative
 * inside. The standard formulation, with its gradient written out analytically
 * below so the direction never has to be finite-differenced per pixel.
 */
export function sdRoundRect(
  px: number,
  py: number,
  halfW: number,
  halfH: number,
  radius: number
): number {
  const r = Math.min(radius, halfW, halfH);
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;
  return (
    Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
  );
}

/**
 * Outward unit normal of that field, written into `out`.
 *
 * Three regions, one per piece of the shape: inside a corner arc the normal is
 * radial from that corner's centre, otherwise it is the axis of whichever edge
 * is nearest. In the flat interior it degenerates to an axis too, which costs
 * nothing — the LUT magnitude out there is zero.
 */
export function sdRoundRectNormal(
  px: number,
  py: number,
  halfW: number,
  halfH: number,
  radius: number,
  out: number[]
): number[] {
  const r = Math.min(radius, halfW, halfH);
  const sx = px < 0 ? -1 : 1;
  const sy = py < 0 ? -1 : 1;
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;

  if (qx > 0 && qy > 0) {
    const len = Math.hypot(qx, qy) || 1;
    out[0] = (sx * qx) / len;
    out[1] = (sy * qy) / len;
  } else if (qx > qy) {
    out[0] = sx;
    out[1] = 0;
  } else {
    out[0] = 0;
    out[1] = sy;
  }
  return out;
}

/* ------------------------------------------------------------------
   Encoding
   ------------------------------------------------------------------ */

/**
 * Pack a normalised offset in [-1, 1] into one 8-bit channel.
 *
 * feDisplacementMap reads `scale * (C - 0.5)`, so the neutral byte is the one
 * decoding to exactly 0.5 — 127.5, which eight bits cannot hold. Rounding lands
 * it on 128, the same value the unused blue channel carries, leaving a fixed
 * 0.5/255 bias: under a typical `scale` of ~17 that is a third of a pixel of
 * uniform drift across the flat middle, comfortably inside the 0.4px blur that
 * closes the filter chain.
 */
export function encodeChannel(value: number): number {
  return clamp(Math.round(127.5 + clamp(value, -1, 1) * 127.5), 0, 255);
}

/** Inverse of {@link encodeChannel}, for tests and for reasoning about a map. */
export function decodeChannel(byte: number): number {
  return (byte - 127.5) / 127.5;
}

/* ------------------------------------------------------------------
   Raster
   ------------------------------------------------------------------ */

export interface MapSpec {
  /** Element border-box size in CSS px. */
  width: number;
  height: number;
  /** Corner radius in px. Defaults to `--radius-glass`. */
  radius?: number;
  /** Bezel band width in px. Defaults to `min(radius * 1.2, 24)`. */
  bezel?: number;
  /** Glass depth in px. */
  thickness?: number;
}

export interface DisplacementMap {
  /** PNG data URL, ready for an feImage href. */
  url: string;
  /** Raster size in px — bucketed, then stretched onto the real border box. */
  width: number;
  height: number;
  /** feDisplacementMap scale: twice the peak, because the channels carry a
   *  ±0.5 offset around neutral rather than a 0..1 magnitude. */
  scale: number;
  /** Peak offset the map encodes, in px. */
  maxDisplacement: number;
  /** Cache key, so a caller can tell two maps apart without comparing URLs. */
  key: string;
}

const CACHE = new Map<string, DisplacementMap>();

const quantise = (value: number) => Math.max(BUCKET, Math.round(value / BUCKET) * BUCKET);

/**
 * Is this browser going to *render* what we are about to build?
 *
 * Three independent reasons to walk away, and walking away is free — the panel
 * keeps the blur it has always had.
 */
export function isLiquidGlassSupported(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  if (!CSS.supports('backdrop-filter', 'url(#x)')) return false;

  if (typeof navigator === 'undefined') return false;
  // The only user-agent sniff in the codebase, and it can only ever remove a
  // decoration — never gate a feature. WebKit *parses* `backdrop-filter:
  // url(...)` and then draws nothing at all, so a Safari that passed the
  // CSS.supports test above would end up wearing an inline filter list that
  // renders as a flat translucent box. Every Chromium build carries `Chrome/`,
  // `Chromium/` or `Edg/` in its UA; Safari carries none of the three.
  if (!/(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent || '')) return false;

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    // Nobody who asked for less transparency or less motion asked for a lens on
    // every floating surface.
    if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  }
  return true;
}

/**
 * A 2D surface to raster into.
 *
 * `src/admin/optimize.ts` reaches for OffscreenCanvas first for exactly this
 * kind of never-displayed bitmap, and this raster would be a fine tenant — but
 * OffscreenCanvas serialises only through the async `convertToBlob()`, and the
 * filter must never go up pointing at a map URL that does not exist yet (see
 * useLiquidGlass for what that costs). `HTMLCanvasElement.toDataURL` is the one
 * synchronous encoder, so it leads instead, and with no document there is no
 * filter to feed either — the guard reports "not here" rather than falling back
 * to something that cannot finish the job.
 */
function createSurface(
  width: number,
  height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

function rasterise(
  key: string,
  width: number,
  height: number,
  radius: number,
  bezel: number,
  thickness: number
): DisplacementMap | null {
  const lut = buildLut(thickness, bezel);
  let peak = 0;
  for (let i = 0; i < lut.length; i++) {
    if (!Number.isFinite(lut[i])) return null;
    peak = Math.max(peak, Math.abs(lut[i]));
  }
  const maxDisplacement = Math.min(peak, MAX_DISPLACEMENT_PX);
  if (!(maxDisplacement > 0)) return null; // no bend to draw

  const surface = createSurface(width, height);
  if (!surface) return null;
  const { canvas, ctx } = surface;

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(radius, halfW, halfH);
  const dir = [0, 0];
  let p = 0;

  for (let y = 0; y < height; y++) {
    const py = y + 0.5 - halfH;
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - halfW;
      // Distance inward from the edge, normalised across the band. Outside the
      // rounded shape — the four bounding-box corners — this clamps to 0, where
      // the LUT is zero, so those pixels stay neutral.
      const depth = clamp(-sdRoundRect(px, py, halfW, halfH, r) / bezel, 0, 1);
      const magnitude = sampleLut(lut, depth) / maxDisplacement;
      sdRoundRectNormal(px, py, halfW, halfH, r, dir);

      data[p] = encodeChannel(magnitude * dir[0]);
      data[p + 1] = encodeChannel(magnitude * dir[1]);
      data[p + 2] = 128; // unread by the R/G selectors; the neutral byte
      data[p + 3] = 255; // opaque, so nothing is premultiplied away
      p += 4;
    }
  }

  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL('image/png');
  if (!url || url.indexOf('data:image/png') !== 0) return null;

  return { url, width, height, scale: 2 * maxDisplacement, maxDisplacement, key };
}

/**
 * The displacement map for one panel, or null if this browser will not render
 * it, the raster failed, or the box is too small to have a bezel.
 *
 * Identical specs hand back the identical object, so a caller can compare by
 * reference to decide whether anything needs rebuilding.
 */
export function getDisplacementMap(spec: MapSpec): DisplacementMap | null {
  if (!isLiquidGlassSupported()) return null;
  if (!Number.isFinite(spec.width) || !Number.isFinite(spec.height)) return null;

  const width = quantise(spec.width);
  const height = quantise(spec.height);
  const shortest = Math.min(width, height);
  if (shortest < 8) return null;

  const radius = clamp(spec.radius ?? DEFAULT_RADIUS, 0, shortest / 2);
  const bezel = clamp(
    spec.bezel ?? Math.min(radius * 1.2, DEFAULT_BEZEL_CAP),
    1,
    shortest / 2
  );
  const thickness = clamp(spec.thickness ?? DEFAULT_THICKNESS, 0, MAX_DISPLACEMENT_PX);

  const key = `${width}|${height}|${radius}|${bezel}|${thickness}`;
  const cached = CACHE.get(key);
  if (cached) return cached;

  let map: DisplacementMap | null = null;
  try {
    map = rasterise(key, width, height, radius, bezel, thickness);
  } catch {
    // A tainted or unavailable canvas is not worth a broken panel.
    return null;
  }
  if (!map) return null;

  if (CACHE.size >= CACHE_LIMIT) {
    const oldest = CACHE.keys().next();
    if (!oldest.done) CACHE.delete(oldest.value);
  }
  CACHE.set(key, map);
  return map;
}
