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

export class PaintSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;

  /** Set when anything changed; flushed once per frame by `commit()`. */
  private dirty = false;

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
    this.dirty = true;
  }

  /** One dab. `u`/`v` are 0..1 texture space, `r` is texture pixels. */
  applyStamp(stamp: PaintStamp, tool: 'spray' | 'brush', color: string) {
    const ctx = this.ctx;
    const x = stamp.u * this.canvas.width;
    const y = stamp.v * this.canvas.height;
    const r = Math.max(stamp.r, 0.5);
    ctx.globalAlpha = Math.min(Math.max(stamp.o, 0.02), 1);
    ctx.drawImage(tinted(tool, color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
    this.dirty = true;
  }

  applyStamps(stamps: Iterable<PaintStamp>, tool: 'spray' | 'brush', color: string) {
    for (const stamp of stamps) this.applyStamp(stamp, tool, color);
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
   * Flattens the paint layer over a solid backdrop for export — the live layer
   * is transparent, so a straight `toDataURL` would be mostly empty.
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
