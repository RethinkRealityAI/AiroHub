/**
 * The shared paint layer.
 *
 * Every player paints into one 2048² canvas which is uploaded as a texture and
 * composited over each model's own PBR material (see `paintMaterial.ts`). The
 * layer is *transparent* by default rather than filled, so a Meshy-textured
 * object shows through everywhere the players have not painted — that is what
 * makes "spray over an existing textured object" work.
 *
 * Two things dominate how good the painting feels, and both are handled here:
 *
 *  1. **Stamp spacing.** Input arrives as discrete events at 30-60 Hz. Drawing
 *     one blob per event leaves a dotted trail whenever the hand moves quickly.
 *     Every stroke is therefore resampled along its path at a fixed pixel
 *     spacing so the density is speed-independent.
 *
 *  2. **Sprite stamping.** The old renderer issued ~75 `arc()` fills per spray
 *     event, which is thousands of path operations per second once several
 *     players are painting. Stamps are pre-rendered once per colour and blitted
 *     with `drawImage`, which the browser can hardware-accelerate.
 */
import * as THREE from 'three';

export const CANVAS_RES = 2048;

/** A single point along a stroke. */
export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

/** Per-player stroke bookkeeping so strokes can interleave without tangling. */
interface StrokeState {
  last: StrokePoint | null;
  /** Distance carried over from the previous segment, keeps spacing even. */
  residue: number;
  /** Smoothed speed, used to taper brush width. */
  speed: number;
}

/* ------------------------------------------------------------------
   Pre-rendered stamps
   ------------------------------------------------------------------ */

const STAMP_SIZE = 128;

/** Soft radial alpha falloff — the aerosol core. */
function buildSoftStamp(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = STAMP_SIZE;
  const ctx = c.getContext('2d')!;
  const r = STAMP_SIZE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STAMP_SIZE, STAMP_SIZE);
  return c;
}

/** Speckle ring — the grainy overspray that reads as real aerosol. */
function buildGrainStamp(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = STAMP_SIZE;
  const ctx = c.getContext('2d')!;
  const r = STAMP_SIZE / 2;
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 900; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Bias outwards: the centre is already covered by the soft core.
    const dist = Math.pow(Math.random(), 0.55) * r;
    const alpha = (1 - dist / r) * 0.5 * Math.random();
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(r + Math.cos(angle) * dist, r + Math.sin(angle) * dist, Math.random() * 1.6 + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

/** Firm-edged stamp for the brush — mostly opaque with a 1px feather. */
function buildBrushStamp(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = STAMP_SIZE;
  const ctx = c.getContext('2d')!;
  const r = STAMP_SIZE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.82, 'rgba(255,255,255,1)');
  g.addColorStop(0.94, 'rgba(255,255,255,0.72)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STAMP_SIZE, STAMP_SIZE);
  return c;
}

type StampKind = 'soft' | 'grain' | 'brush';

let baseStamps: Record<StampKind, HTMLCanvasElement> | null = null;
function getBaseStamps() {
  if (!baseStamps) {
    baseStamps = { soft: buildSoftStamp(), grain: buildGrainStamp(), brush: buildBrushStamp() };
  }
  return baseStamps;
}

/**
 * Colour-tinted stamps, built lazily and cached. Tinting once per colour beats
 * re-tinting per stamp by orders of magnitude.
 */
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

  // Unbounded growth would be a leak; colours are picked from a small palette
  // plus the occasional custom hex, so a modest cap is plenty.
  if (tintCache.size > 96) tintCache.clear();
  tintCache.set(key, c);
  return c;
}

/* ------------------------------------------------------------------
   PaintSurface
   ------------------------------------------------------------------ */

export class PaintSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;

  private strokes = new Map<string, StrokeState>();
  /** Set when anything changed, flushed once per frame by `commit()`. */
  private dirty = false;

  constructor(size: number = CANVAS_RES) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false; // glTF UV convention
    this.texture.anisotropy = 4;
  }

  /**
   * Uploads at most one texture update per frame.
   *
   * Setting `needsUpdate` on every stamp re-uploads 16 MB of pixels per call;
   * with four players spraying that alone will drop the stage to single-digit
   * frame rates.
   */
  commit() {
    if (!this.dirty) return;
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokes.clear();
    this.dirty = true;
  }

  /** True when a player has painted something (used to gate the Save button). */
  get hasContent(): boolean {
    return this.strokes.size > 0 || this.dirty;
  }

  beginStroke(id: string) {
    this.strokes.set(id, { last: null, residue: 0, speed: 0 });
  }

  endStroke(id: string) {
    this.strokes.delete(id);
  }

  /**
   * Paints from the player's previous point to `point`, resampling the segment
   * so coverage does not depend on how fast events arrive.
   */
  stroke(
    id: string,
    point: StrokePoint,
    tool: 'spray' | 'brush',
    color: string,
    sizeMultiplier: number
  ) {
    let state = this.strokes.get(id);
    if (!state) {
      state = { last: null, residue: 0, speed: 0 };
      this.strokes.set(id, state);
    }

    const radius = (tool === 'spray' ? 62 : 26) * sizeMultiplier;
    const spacing = Math.max(radius * (tool === 'spray' ? 0.22 : 0.12), 1.2);

    if (!state.last) {
      this.stamp(point.x, point.y, radius, point.pressure, tool, color);
      state.last = { ...point };
      this.dirty = true;
      return;
    }

    const dx = point.x - state.last.x;
    const dy = point.y - state.last.y;
    const distance = Math.hypot(dx, dy);

    // Exponential moving average; brush width tapers as the hand accelerates.
    state.speed = state.speed * 0.7 + distance * 0.3;

    if (distance < 0.01) {
      // Held still: keep laying down paint so a stationary can still builds up,
      // which is how real aerosol behaves.
      if (tool === 'spray') {
        this.stamp(point.x, point.y, radius, point.pressure * 0.55, tool, color);
        this.dirty = true;
      }
      return;
    }

    const nx = dx / distance;
    const ny = dy / distance;
    let travelled = -state.residue;

    while (travelled + spacing <= distance) {
      travelled += spacing;
      const t = travelled / distance;
      const px = state.last.x + nx * travelled;
      const py = state.last.y + ny * travelled;
      const pressure = state.last.pressure + (point.pressure - state.last.pressure) * t;
      this.stamp(px, py, radius, pressure, tool, color, state.speed);
    }

    state.residue = distance - travelled;
    state.last = { ...point };
    this.dirty = true;
  }

  private stamp(
    x: number,
    y: number,
    radius: number,
    pressure: number,
    tool: 'spray' | 'brush',
    color: string,
    speed = 0
  ) {
    const ctx = this.ctx;
    if (tool === 'spray') {
      // Soft core plus a jittered grain pass. The jitter breaks up the regular
      // spacing of the resampled path so the trail never looks like a chain.
      const jitterX = (Math.random() - 0.5) * radius * 0.16;
      const jitterY = (Math.random() - 0.5) * radius * 0.16;
      const d = radius * 2;

      ctx.globalAlpha = Math.min(0.16 * pressure, 1);
      ctx.drawImage(tinted('soft', color), x - radius + jitterX, y - radius + jitterY, d, d);

      ctx.globalAlpha = Math.min(0.2 * pressure, 1);
      const gr = radius * 1.18;
      ctx.drawImage(tinted('grain', color), x - gr + jitterY, y - gr + jitterX, gr * 2, gr * 2);
    } else {
      // Faster strokes thin out, like a brush being dragged off the surface.
      const taper = THREE.MathUtils.clamp(1 - speed / 900, 0.55, 1);
      const r = radius * taper;
      ctx.globalAlpha = Math.min(0.55 * pressure, 1);
      ctx.drawImage(tinted('brush', color), x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  /** One-shot decorative stamp used by the AI stencil feature. */
  stampSymbol(symbol: string, x: number, y: number, color: string, text?: string) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = 'bold 260px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 35;
    ctx.fillText(symbol, x, y - (text ? 80 : 0));
    if (text) {
      ctx.font = '900 110px sans-serif';
      ctx.fillText(text.toUpperCase(), x, y + 120);
    }
    ctx.restore();
    this.dirty = true;
  }

  /**
   * Flattens the paint layer over a solid backdrop for export. The live layer
   * is transparent, so a straight `toDataURL` would produce a mostly-empty PNG.
   */
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
    ctx.fillText(`★ ${tagText} ★`, 1024, 1720);
    ctx.restore();
    this.dirty = true;
  }

  applyBanksyFilter(accentColor = '#FF4D1C', tagText = 'HOPE') {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = accentColor;
    ctx.font = 'bold 220px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 20;
    ctx.fillText('♥', 1024, 750);
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
    ctx.fillText(`✦ ${tagText} ✦`, 1024, 1720);
    ctx.restore();
    this.dirty = true;
  }
}
