/**
 * Tilt aiming for a phone you are looking at.
 *
 * The controller's `AimTracker` models a phone pointed *at a screen* like a
 * remote: it integrates yaw and pitch of the pointing direction and is
 * deliberately blind to roll, so a stroke stays straight however the can is
 * gripped. That is right for the studio and wrong for the landing page, where
 * the visitor holds the phone like any other phone and tilts it like a spirit
 * level: roll is exactly how they try to move sideways, and the pitch that
 * tracker reads comes out backwards for this grip.
 *
 * So the landing page aims from gravity instead:
 *
 *   - gravity is derived from (beta, gamma), which stays continuous in every
 *     posture (raw gamma is unstable near upright, gravity is not);
 *   - it is rotated into *screen* axes using the screen orientation angle, so
 *     landscape works the same as portrait;
 *   - "right edge down" moves the aim right and "top edge down" (tipping the
 *     phone away from you) moves it down, the mapping people reach for;
 *   - the mapping is absolute around a neutral pose: hold a tilt and the aim
 *     stays there, return to neutral and it comes back. Past the edge of the
 *     range the neutral ratchets along, like a mouse at the edge of a pad;
 *   - a One-Euro filter removes sensor jitter when still without adding lag to
 *     quick moves.
 *
 * Pure and DOM-free, so the unit tests can drive it with synthetic angles.
 */

const DEG = Math.PI / 180;

/** Tilt (degrees) from neutral that reaches the edge of the aim range. */
export const TILT_RANGE_X = 20;
export const TILT_RANGE_Y = 16;

/** Gravity direction in device coordinates for DeviceOrientation beta/gamma (degrees). */
export function deviceGravity(betaDeg: number, gammaDeg: number): [number, number, number] {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  // R = Rz(alpha) Rx(beta) Ry(gamma); gravity in the device frame is
  // R^T (0, 0, -1), which does not depend on alpha.
  return [Math.cos(b) * Math.sin(g), -Math.sin(b), -Math.cos(b) * Math.cos(g)];
}

/**
 * Screen-space tilt angles, in degrees:
 *   roll  > 0 when the screen's right edge is lower than its left;
 *   pitch     how far the screen's top edge is raised (90 = upright facing you).
 *
 * Roll is the turn about the phone's own long axis (what people do when they
 * "tilt side to side"), not the angle to the horizon, which shrinks as the
 * phone leans back and made sideways tilt feel half as strong as vertical at
 * a reading angle. Near upright that axis stops being observable from gravity,
 * so the denominator is floored: sensitivity stays bounded and continuous.
 */
export function screenTilt(
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg = 0
): { roll: number; pitch: number } {
  const [gx, gy, gz] = deviceGravity(betaDeg, gammaDeg);
  const a = screenAngleDeg * DEG;
  // Screen axes expressed in device coordinates for a screen rotated by `a`
  // (the orientation angle: 90 = device turned counter-clockwise).
  const sx = gx * Math.cos(a) - gy * Math.sin(a);
  const sy = gx * Math.sin(a) + gy * Math.cos(a);
  const roll = Math.atan2(sx, Math.max(-gz, 0.6)) / DEG;
  const pitch = Math.atan2(-sy, -gz) / DEG;
  return { roll, pitch };
}

/** One-Euro filter (Casiez et al. 2012): steady when slow, lag-free when fast. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff = 1
  ) {}
  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  reset() {
    this.x = null;
  }
  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.t = tMs;
      return value;
    }
    const dt = Math.max((tMs - this.t) / 1000, 1 / 240);
    this.t = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export interface TiltSample {
  /** Aim in normalised device coordinates, -1..1, +y up. */
  x: number;
  y: number;
  /** Angular speed of the filtered tilt, degrees per second. */
  speed: number;
  /** How far the aim sits from where the neutral pose puts it (NDC). */
  fromNeutral: number;
}

export class TiltAim {
  private roll = new OneEuro(1.2, 0.06, 2);
  private pitch = new OneEuro(1.2, 0.06, 2);
  private neutral: { roll: number; pitch: number } | null = null;
  private last: { roll: number; pitch: number; t: number } | null = null;
  private out: TiltSample = { x: 0, y: 0, speed: 0, fromNeutral: 0 };
  /** The aim the neutral pose should map to when it is (re)captured. */
  private anchor = { x: 0, y: 0 };

  /**
   * Makes the pose the phone is in *right now* map to (x, y), so switching
   * from touch back to tilt continues from where the finger left the aim.
   */
  rebase(x = 0, y = 0) {
    this.anchor = { x, y };
    this.neutral = null;
  }

  update(betaDeg: number, gammaDeg: number, tMs: number, screenAngleDeg = 0): TiltSample {
    const raw = screenTilt(betaDeg, gammaDeg, screenAngleDeg);
    const roll = this.roll.filter(raw.roll, tMs);
    const pitch = this.pitch.filter(raw.pitch, tMs);

    if (!this.neutral) {
      this.neutral = {
        roll: roll - this.anchor.x * TILT_RANGE_X,
        pitch: pitch - this.anchor.y * TILT_RANGE_Y,
      };
    }

    let x = (roll - this.neutral.roll) / TILT_RANGE_X;
    let y = (pitch - this.neutral.pitch) / TILT_RANGE_Y;
    // Edge ratchet: past the range, drag the neutral along instead of
    // clamping, so tilting back starts moving the aim at once.
    if (x > 1) {
      this.neutral.roll += (x - 1) * TILT_RANGE_X;
      x = 1;
    } else if (x < -1) {
      this.neutral.roll += (x + 1) * TILT_RANGE_X;
      x = -1;
    }
    if (y > 1) {
      this.neutral.pitch += (y - 1) * TILT_RANGE_Y;
      y = 1;
    } else if (y < -1) {
      this.neutral.pitch += (y + 1) * TILT_RANGE_Y;
      y = -1;
    }

    let speed = 0;
    if (this.last) {
      const dt = Math.max((tMs - this.last.t) / 1000, 1 / 240);
      speed = Math.hypot(roll - this.last.roll, pitch - this.last.pitch) / dt;
    }
    this.last = { roll, pitch, t: tMs };

    this.out.x = x;
    this.out.y = y;
    this.out.speed = speed;
    this.out.fromNeutral = Math.hypot(
      (roll - this.neutral.roll) / TILT_RANGE_X - this.anchor.x,
      (pitch - this.neutral.pitch) / TILT_RANGE_Y - this.anchor.y
    );
    return this.out;
  }
}
