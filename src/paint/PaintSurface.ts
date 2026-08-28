/**
 * The shared paint layer.
 *
 * One transparent 2048² canvas that every player paints into, composited over
 * each model's own PBR texture in the shader (`paintMaterial.ts`), so painted
 * texels cover the model's texture and untouched texels keep it.
 *
 * The only mutation API is `applyStamp` / `applyStamps` — small dabs at a UV
 * with a radius in texture pixels. There is deliberately **no** UV-space stroke
 * interpolation here: the generated models are UV-atlased into islands, so any
 * line or large disc drawn in UV space can cross island boundaries and smear
 * paint across unrelated parts of the model. Path resampling happens upstream
 * in *screen space* (`SurfacePainter`), where geometry is continuous, and each
 * resulting sample arrives here as its own local stamp.
 *
 * Rendering uses pre-tinted sprite blits rather than per-dab path fills, so
 * four players spraying at once stays cheap.
 */
import * as THREE from 'three';
import { PaintStamp } from './stamps';

export const CANVAS_RES = 2048;

/* ------------------------------------------------------------------
   Pre-rendered stamp sprites
   ------------------------------------------------------------------ */

const STAMP_SIZE = 128;

/** Soft aerosol dot — dense core with a fine falloff. */
function buildSprayStamp(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = STAMP_SIZE;
  const ctx = c.getContext('2d')!;
  const r = STAMP_SIZE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STAMP_SIZE, STAMP_SIZE);
  return c;
}

/** Firm-edged brush dab with a 2px feather. */
function buildBrushStamp(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = STAMP_SIZE;
  const ctx = c.getContext('2d')!;
  const r = STAMP_SIZE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.85, 'rgba(255,255,255,1)');
  g.addColorStop(0.96, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STAMP_SIZE, STAMP_SIZE);
  return c;
}

type StampKind = 'spray' | 'brush';

let baseStamps: Record<StampKind, HTMLCanvasElement> | null = null;
function getBaseStamps() {
  if (!baseStamps) baseStamps = { spray: buildSprayStamp(), brush: buildBrushStamp() };
  return baseStamps;
}

/** Colour-tinted sprites, cached — tinting once per colour beats per-dab fills. */
const tintCache = new Map<string, HTMLCanvasElement>();
function tinted(kind: StampKind, color: string): HTMLCanvasElement {
  const key = `${kind}:${color}`;
  const hit = tintCache.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = c.height = STAMP_SIZE;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(getBaseStamps()[kind], 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, STAMP_SIZE, STAMP_SIZE);

  if (tintCache.size > 96) tintCache.clear();
  tintCache.set(key, c);
  return c;
}

/* ------------------------------------------------------------------
   PaintSurface
   ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
   Image stamps
   ------------------------------------------------------------------ */

/** Any image source a stamp can be built from. */
export type StampImageSource = HTMLImageElement | ImageBitmap | HTMLCanvasElement;

/**
 * Longest edge kept for a stored stamp bitmap. Stamps live in the stroke log
 * for the whole session so undo/replay can redraw them; storing the source at
 * full resolution would put tens of megabytes behind a few taps. 512px is well
 * above the largest radius the UI can place (2 × 180px).
 */
const STAMP_BITMAP_MAX = 512;

function sourceSize(image: StampImageSource): { w: number; h: number } {
  const w = (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width || 1;
  const h = (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height || 1;
  return { w: Math.max(w, 1), h: Math.max(h, 1) };
}

/**
 * Bakes a stamp into a self-contained canvas: downscaled to the storage cap
 * and, when a tint is given, recoloured through `source-in` so the shape's
 * alpha survives while every texel takes the tint. The built-in stencils are
 * white-on-alpha precisely so this reproduces the chosen colour exactly.
 */
function composeStampBitmap(image: StampImageSource, tint: string | null): HTMLCanvasElement {
  const { w, h } = sourceSize(image);
  const scale = Math.min(1, STAMP_BITMAP_MAX / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(image as CanvasImageSource, 0, 0, c.width, c.height);
  if (tint) {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-over';
  }
  return c;
}

/** One undoable unit: a stroke's stamps, or an image stamp. */
type LogEntry =
  | { kind: 'stamps'; strokeId: string; tool: 'spray' | 'brush'; color: string; stamps: PaintStamp[] }
  | {
      kind: 'image';
      strokeId: string;
      /** Already tinted and size-capped, so replay is a straight blit. */
      bitmap: HTMLCanvasElement;
      u: number;
      v: number;
      radiusPx: number;
      rotation: number;
    };

/** Keep the log bounded; the oldest strokes simply stop being undoable. */
const LOG_MAX_ENTRIES = 600;
const LOG_MAX_STAMPS = 120000;
/** Image stamps are the memory-heavy entries; keep far fewer of them. */
const LOG_MAX_IMAGES = 64;

export class PaintSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;

  /** Set when anything changed; flushed once per frame by `commit()`. */
  private dirty = false;

  /**
   * Ordered record of everything painted. This is what powers global undo and
   * the time-lapse replay: undo removes an entry and repaints the rest, replay
   * re-runs the whole history from a blank surface.
   */
  private log: LogEntry[] = [];
  private loggedStamps = 0;
  private loggedImages = 0;
  private replaying = false;

  /**
   * Snapshot of the artwork as it stood when this client joined. Everything a
   * late joiner missed is baked in here; the live log sits on top of it. Not
   * undoable from this client (the strokes inside it predate its log).
   */
  private baseline: HTMLImageElement | ImageBitmap | null = null;

  constructor(size: number = CANVAS_RES) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false; // glTF UV convention
    this.texture.anisotropy = 4;
  }

  /**
   * Uploads at most one texture update per frame. Uploading per stamp would
   * push 16 MB of pixels per dab with four players spraying.
   */
  commit() {
    if (!this.dirty) return;
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.log = [];
    this.loggedStamps = 0;
    this.loggedImages = 0;
    this.redoStack = [];
    this.baseline = null;
    this.dirty = true;
  }

  /**
   * Reads one texel straight off the paint layer (not the composited model
   * texture). Exists so automated verification can assert what landed without
   * depending on a camera, a model or the shader — see `__airoPaintProbe`.
   */
  samplePaint(u: number, v: number): [number, number, number, number] {
    const x = Math.min(Math.max(Math.round(u * this.canvas.width), 0), this.canvas.width - 1);
    const y = Math.min(Math.max(Math.round(v * this.canvas.height), 0), this.canvas.height - 1);
    const data = this.ctx.getImageData(x, y, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }

  /** Installs the joined-late snapshot and repaints with it underneath. */
  setBaseline(image: HTMLImageElement | ImageBitmap) {
    this.baseline = image;
    this.repaintFromLog();
  }

  /** One dab. `u`/`v` are 0..1 texture space, `r` is texture pixels. */
  private drawStamp(stamp: PaintStamp, tool: 'spray' | 'brush', color: string) {
    const ctx = this.ctx;
    const x = stamp.u * this.canvas.width;
    const y = stamp.v * this.canvas.height;
    const r = Math.max(stamp.r, 0.5);
    ctx.globalAlpha = Math.min(Math.max(stamp.o, 0.02), 1);
    ctx.drawImage(tinted(tool, color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
    this.dirty = true;
  }

  /**
   * Draws stamps and records them under `strokeId` for undo/replay. Stamps
   * without a strokeId still draw but are not undoable.
   */
  applyStamps(
    stamps: Iterable<PaintStamp>,
    tool: 'spray' | 'brush',
    color: string,
    strokeId?: string
  ) {
    let entry: Extract<LogEntry, { kind: 'stamps' }> | null = null;
    if (strokeId) {
      const last = this.log[this.log.length - 1];
      // Coalesce only a true continuation: same stroke id AND same tool and
      // colour. A reused id with a different colour must open a fresh entry,
      // or the stamps would draw in the new colour live but *record* under
      // the old entry's colour — replay would then repaint them wrong, and
      // undo would swallow several visually separate strokes at once.
      if (
        last &&
        last.kind === 'stamps' &&
        last.strokeId === strokeId &&
        last.tool === tool &&
        last.color === color
      ) {
        entry = last;
      } else {
        entry = { kind: 'stamps', strokeId, tool, color, stamps: [] };
        this.log.push(entry);
      }
    }
    for (const stamp of stamps) {
      this.drawStamp(stamp, tool, color);
      if (entry) {
        entry.stamps.push(stamp);
        this.loggedStamps++;
      }
    }
    this.trimLog();
  }

  /**
   * Places an image on the surface as **one** undoable entry.
   *
   * `u`/`v` are 0..1 texture space and address the image's *centre*;
   * `radiusPx` is half the stamp's longest edge in texture pixels, so the
   * image is drawn at `max(w,h) = 2 * radiusPx` with its aspect preserved.
   * A `tint` recolours the (white-on-alpha) source; pass null to keep a
   * full-colour image such as a user upload as-is.
   */
  stampImage(
    image: StampImageSource,
    u: number,
    v: number,
    radiusPx: number,
    rotationRad: number,
    tint: string | null,
    strokeId: string
  ) {
    const entry: Extract<LogEntry, { kind: 'image' }> = {
      kind: 'image',
      strokeId,
      bitmap: composeStampBitmap(image, tint),
      u,
      v,
      radiusPx: Math.max(radiusPx, 1),
      rotation: rotationRad || 0,
    };
    this.log.push(entry);
    this.loggedImages++;
    this.trimLog();
    this.drawImageStamp(entry);
  }

  private drawImageStamp(entry: Extract<LogEntry, { kind: 'image' }>) {
    const { bitmap } = entry;
    const longest = Math.max(bitmap.width, bitmap.height) || 1;
    const scale = (entry.radiusPx * 2) / longest;
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(entry.u * this.canvas.width, entry.v * this.canvas.height);
    if (entry.rotation) ctx.rotate(entry.rotation);
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
    ctx.restore();
    this.dirty = true;
  }

  private trimLog() {
    while (
      this.log.length > LOG_MAX_ENTRIES ||
      (this.loggedStamps > LOG_MAX_STAMPS && this.log.length > 1)
    ) {
      const dropped = this.log.shift();
      if (dropped?.kind === 'stamps') this.loggedStamps -= dropped.stamps.length;
      else if (dropped?.kind === 'image') this.loggedImages--;
    }
    // Image bitmaps are evicted on their own axis: dropping whole *strokes*
    // to get under the bitmap budget would throw away far more history than
    // the memory it reclaims, so retire the oldest image instead.
    while (this.loggedImages > LOG_MAX_IMAGES) {
      const index = this.log.findIndex((entry) => entry.kind === 'image');
      if (index < 0) break;
      this.log.splice(index, 1);
      this.loggedImages--;
    }
  }

  /** Most recent undoable stroke, if any. */
  lastStrokeId(): string | null {
    return this.log.length ? this.log[this.log.length - 1].strokeId : null;
  }

  /**
   * Undone strokes park here so they can be redone. Kept independent of new
   * painting (multiplayer strokes keep arriving; strict linear history would
   * constantly invalidate everyone's redo) — a redone stroke simply re-lands
   * on top of the log.
   */
  private redoStack: LogEntry[] = [];

  /** Removes one stroke, parks it for redo, and repaints the rest. */
  undoStroke(strokeId: string): boolean {
    for (let i = this.log.length - 1; i >= 0; i--) {
      if (this.log[i].strokeId === strokeId) {
        const [removed] = this.log.splice(i, 1);
        if (removed.kind === 'stamps') this.loggedStamps -= removed.stamps.length;
        else if (removed.kind === 'image') this.loggedImages--;
        this.redoStack.push(removed);
        if (this.redoStack.length > 40) this.redoStack.shift();
        this.repaintFromLog();
        return true;
      }
    }
    return false;
  }

  /** Stroke id the next redo would restore, if any. */
  lastUndoneStrokeId(): string | null {
    return this.redoStack.length ? this.redoStack[this.redoStack.length - 1].strokeId : null;
  }

  /**
   * Restores an undone stroke — the one matching `strokeId`, or the most
   * recently undone. Returns its stroke id so the caller can broadcast the
   * redo to peers (they hold the same parked entry from the mirrored undo).
   */
  redoStroke(strokeId?: string): string | null {
    let index = this.redoStack.length - 1;
    if (strokeId) {
      index = this.redoStack.map((e) => e.strokeId).lastIndexOf(strokeId);
    }
    if (index < 0) return null;
    const [entry] = this.redoStack.splice(index, 1);
    this.log.push(entry);
    if (entry.kind === 'stamps') this.loggedStamps += entry.stamps.length;
    else if (entry.kind === 'image') this.loggedImages++;
    this.trimLog();
    this.repaintFromLog();
    return entry.strokeId;
  }

  private repaintFromLog() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.baseline) {
      this.ctx.drawImage(this.baseline, 0, 0, this.canvas.width, this.canvas.height);
    }
    for (const entry of this.log) this.replayEntry(entry);
    this.dirty = true;
  }

  /** Redraws a single log entry, whatever kind it is. */
  private replayEntry(entry: LogEntry) {
    if (entry.kind === 'stamps') {
      for (const stamp of entry.stamps) this.drawStamp(stamp, entry.tool, entry.color);
    } else {
      this.drawImageStamp(entry);
    }
  }

  get isReplaying() {
    return this.replaying;
  }

  /**
   * Time-lapse: wipes the surface and repaints the entire history over
   * `durationMs`, oldest stroke first. Live painting during a replay still
   * logs; the final frame repaints from the full log so nothing is lost.
   */
  async replayTimelapse(durationMs = 4200): Promise<void> {
    if (this.replaying || this.log.length === 0) return;
    this.replaying = true;

    // Work from a snapshot so live strokes arriving mid-replay don't shift it.
    const snapshot = this.log.map((entry) =>
      entry.kind === 'stamps' ? { ...entry, stamps: [...entry.stamps] } : { ...entry }
    );
    const totalUnits = snapshot.reduce(
      (sum, e) => sum + (e.kind === 'stamps' ? e.stamps.length : 40),
      0
    );

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.baseline) {
      this.ctx.drawImage(this.baseline, 0, 0, this.canvas.width, this.canvas.height);
    }
    this.dirty = true;

    let drawnUnits = 0;
    let entryIndex = 0;
    let stampIndex = 0;
    const start = performance.now();

    await new Promise<void>((resolve) => {
      const tick = () => {
        const t = Math.min((performance.now() - start) / durationMs, 1);
        // Ease-in so the replay accelerates like a montage.
        const target = Math.floor(totalUnits * (t * t * (3 - 2 * t)));
        while (drawnUnits < target && entryIndex < snapshot.length) {
          const entry = snapshot[entryIndex];
          if (entry.kind !== 'stamps') {
            // Image stamps land in one go — they have no internal ordering to
            // reveal — and are worth 40 units of the timeline.
            this.replayEntry(entry);
            drawnUnits += 40;
            entryIndex++;
            continue;
          }
          this.drawStamp(entry.stamps[stampIndex], entry.tool, entry.color);
          drawnUnits++;
          stampIndex++;
          if (stampIndex >= entry.stamps.length) {
            entryIndex++;
            stampIndex = 0;
          }
        }
        this.commit();
        if (t >= 1 || entryIndex >= snapshot.length) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });

    // Converge with anything painted during the replay.
    this.repaintFromLog();
    this.commit();
    this.replaying = false;
  }

  /**
   * Flattens the paint layer over a solid backdrop for export — the live layer
   * is transparent, so a straight `toDataURL` would be mostly empty.
   */
  /** Downscaled snapshot for syncing late joiners; ~40-150 KB as webp. */
  toSyncDataURL(size = 1024): string {
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(this.canvas, 0, 0, size, size);
    return out.toDataURL('image/webp', 0.72);
  }

  toExportDataURL(background = '#0d0d12'): string {
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.canvas, 0, 0);
    return out.toDataURL('image/png');
  }

  /* ---------------- Stylistic transforms (AI copilot) ---------------- */

  /*
   * The flourishes these transforms paint used to be typed characters — star,
   * heart and sparkle dingbats set in the system font, which put whatever
   * glyph the host machine happened to ship straight onto the artwork. They
   * are drawn as filled paths now: same motifs, painted rather than typeset,
   * and identical on every device.
   */

  /** A pointed star, painted as one path. `inner` is the waist ratio. */
  private paintStar(cx: number, cy: number, radius: number, points = 5, inner = 0.42, rotation = -Math.PI / 2) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? radius : radius * inner;
      const angle = rotation + (i * Math.PI) / points;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  /** A four-point sparkle with concave sides — the cosmic accent. */
  private paintSparkle(cx: number, cy: number, radius: number) {
    const ctx = this.ctx;
    const waist = radius * 0.16;
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius);
    ctx.quadraticCurveTo(cx + waist, cy - waist, cx + radius, cy);
    ctx.quadraticCurveTo(cx + waist, cy + waist, cx, cy + radius);
    ctx.quadraticCurveTo(cx - waist, cy + waist, cx - radius, cy);
    ctx.quadraticCurveTo(cx - waist, cy - waist, cx, cy - radius);
    ctx.closePath();
    ctx.fill();
  }

  /** A stencilled heart with a gravity drip hanging off its point. */
  private paintHeart(cx: number, cy: number, size: number, drip = size * 0.9) {
    const ctx = this.ctx;
    const w = size;
    const h = size * 0.92;
    ctx.beginPath();
    ctx.moveTo(cx, cy + h * 0.62);
    ctx.bezierCurveTo(cx - w * 1.08, cy - h * 0.12, cx - w * 0.5, cy - h * 0.95, cx, cy - h * 0.3);
    ctx.bezierCurveTo(cx + w * 0.5, cy - h * 0.95, cx + w * 1.08, cy - h * 0.12, cx, cy + h * 0.62);
    ctx.closePath();
    ctx.fill();

    if (drip > 0) {
      const width = size * 0.09;
      ctx.beginPath();
      ctx.moveTo(cx - width, cy + h * 0.58);
      ctx.lineTo(cx + width, cy + h * 0.58);
      ctx.lineTo(cx + width * 0.7, cy + h * 0.58 + drip);
      ctx.arc(cx, cy + h * 0.58 + drip, width * 0.95, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
    }
  }

  applyCyberpunkStyle(accentColor = '#22D3EE', secondaryColor = '#EC4899', tagText = 'CYBERPUNK') {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.16)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= CANVAS_RES; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_RES);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_RES; y += 128) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_RES, y);
      ctx.stroke();
    }
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 40;
    ctx.fillStyle = secondaryColor;
    ctx.font = '900 130px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`// ${tagText} //`, 1024, 1750);
    ctx.restore();
    this.dirty = true;
  }

  applyWildstyleDrips(accentColor = '#FF4D1C', tagText = 'WILDSTYLE') {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = accentColor;
    for (let i = 0; i < 28; i++) {
      const startX = Math.random() * 1800 + 124;
      const startY = Math.random() * 800 + 400;
      const dripLength = Math.random() * 320 + 80;
      const dripWidth = Math.random() * 8 + 3;
      ctx.beginPath();
      ctx.moveTo(startX - dripWidth / 2, startY);
      ctx.lineTo(startX + dripWidth / 2, startY);
      ctx.lineTo(startX + dripWidth / 3, startY + dripLength);
      ctx.arc(startX, startY + dripLength, dripWidth * 0.9, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 25;
    ctx.fillStyle = '#FFB020';
    ctx.font = '900 140px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(tagText, 1024, 1720);
    // Painted stars flanking the tag, set off its measured width.
    const half = ctx.measureText(tagText).width / 2;
    this.paintStar(1024 - half - 120, 1672, 62);
    this.paintStar(1024 + half + 120, 1672, 62);
    ctx.restore();
    this.dirty = true;
  }

  applyBanksyFilter(accentColor = '#FF4D1C', tagText = 'HOPE') {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = accentColor;
    ctx.textAlign = 'center';
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 20;
    // The one red accent of the stencil style: a painted heart, dripping.
    this.paintHeart(1024, 690, 150);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 95px monospace';
    ctx.fillText(`"${tagText.toUpperCase()}"`, 1024, 1680);
    ctx.restore();
    this.dirty = true;
  }

  applyPopArtDots(accentColor = '#FFB020', tagText = 'POW!') {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(34, 211, 238, 0.22)';
    for (let x = 0; x < CANVAS_RES; x += 32) {
      for (let y = 0; y < CANVAS_RES; y += 32) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = accentColor;
    ctx.strokeStyle = '#18181B';
    ctx.lineWidth = 14;
    ctx.font = '900 180px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeText(tagText, 1024, 1700);
    ctx.fillText(tagText, 1024, 1700);
    ctx.restore();
    this.dirty = true;
  }

  applyCosmicNebula(accentColor = '#A78BFA', secondaryColor = '#22D3EE', tagText = 'COSMOS') {
    const ctx = this.ctx;
    ctx.save();
    const grad = ctx.createRadialGradient(1024, 1024, 100, 1024, 1024, 1200);
    grad.addColorStop(0, 'rgba(167, 139, 250, 0.3)');
    grad.addColorStop(0.6, 'rgba(34, 211, 238, 0.18)');
    grad.addColorStop(1, 'rgba(10, 5, 25, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_RES, CANVAS_RES);
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 350; i++) {
      ctx.globalAlpha = Math.random() * 0.8 + 0.2;
      ctx.beginPath();
      ctx.arc(Math.random() * CANVAS_RES, Math.random() * CANVAS_RES, Math.random() * 3.5 + 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 45;
    ctx.fillStyle = secondaryColor;
    ctx.font = '900 130px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(tagText, 1024, 1720);
    // Painted sparkles instead of typeset ones, sized off the tag.
    const half = ctx.measureText(tagText).width / 2;
    this.paintSparkle(1024 - half - 110, 1678, 58);
    this.paintSparkle(1024 + half + 110, 1678, 58);
    ctx.restore();
    this.dirty = true;
  }
}
