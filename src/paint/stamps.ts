/**
 * Stamps — the wire and application format for paint.
 *
 * Everything that paints (studio pointer, phone motion aim, phone touch-paint,
 * the flat pad) reduces to a list of stamps: tiny dabs at a UV coordinate with
 * a radius in texture pixels. Peers exchange *stamps*, not stroke endpoints,
 * because interpolating between two UV points is only valid when the texture
 * is a single continuous chart. The generated models are atlased into many UV
 * islands, so a UV-space line between two surface points can cross the whole
 * atlas and smear paint across unrelated parts of the model — which is exactly
 * the "random patches" artefact this format exists to prevent.
 */

export interface PaintStamp {
  /** Texture-space position, 0..1. */
  u: number;
  v: number;
  /** Stamp radius in texture pixels. */
  r: number;
  /** Opacity multiplier 0..1. */
  o: number;
}

export type StrokeState = 'start' | 'paint' | 'end';

export interface StampPacket {
  playerId: string;
  playerName?: string;
  tool: 'spray' | 'brush';
  color: string;
  state: StrokeState;
  /** Flat [u,v,r,o] quads — cheaper to serialise than objects. */
  stamps: number[];
  /** Latest aim point, for positioning the player's 3D tool remotely. */
  cursor?: [number, number];
  /** World-space surface contact of the latest stamp, for tool placement. */
  point?: [number, number, number];
  normal?: [number, number, number];
}

export function packStamps(stamps: PaintStamp[]): number[] {
  const out = new Array<number>(stamps.length * 4);
  for (let i = 0; i < stamps.length; i++) {
    const s = stamps[i];
    out[i * 4] = s.u;
    out[i * 4 + 1] = s.v;
    out[i * 4 + 2] = s.r;
    out[i * 4 + 3] = s.o;
  }
  return out;
}

export function* unpackStamps(flat: number[]): Generator<PaintStamp> {
  for (let i = 0; i + 3 < flat.length; i += 4) {
    yield { u: flat[i], v: flat[i + 1], r: flat[i + 2], o: flat[i + 3] };
  }
}

/**
 * Batches stamps for the network.
 *
 * Spraying generates hundreds of stamps per second; sending each one as its own
 * broadcast would blow straight through the realtime rate limit. The batcher
 * accumulates and flushes on an interval (or when a stroke starts/ends, so
 * remote peers animate promptly).
 */
export interface BatchContext {
  cursor?: [number, number];
  point?: [number, number, number];
  normal?: [number, number, number];
}

export class StampBatcher {
  private pending: PaintStamp[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private context: BatchContext = {};

  constructor(
    private send: (stamps: PaintStamp[], state: StrokeState, context: BatchContext) => void,
    private intervalMs = 60,
    private maxBatch = 96
  ) {}

  begin() {
    this.flush('start');
    if (!this.timer) {
      this.timer = setInterval(() => this.flush('paint'), this.intervalMs);
    }
  }

  push(stamps: PaintStamp[], context?: BatchContext) {
    for (const s of stamps) this.pending.push(s);
    if (context) this.context = { ...this.context, ...context };
    if (this.pending.length >= this.maxBatch) this.flush('paint');
  }

  end() {
    this.flush('end');
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private flush(state: StrokeState) {
    // start/end markers must go out even with no stamps attached.
    if (this.pending.length === 0 && state === 'paint') return;
    this.send(this.pending, state, this.context);
    this.pending = [];
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending = [];
  }
}
