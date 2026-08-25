/**
 * Device orientation → aim vector.
 *
 * The previous controller aimed by taking raw deltas of the `alpha` and `beta`
 * Euler angles. That is unstable in practice: the Euler triplet is not a linear
 * space, so the mapping warps badly as the phone tilts, it gimbal-locks when
 * the phone is held near-vertical (exactly how you hold a spray can), and it
 * ignores screen rotation entirely.
 *
 * This module instead reconstructs the real device quaternion, cancels the
 * calibration pose, and reads the aim direction off the device's own -Z axis.
 * That behaves correctly at every attitude and makes "recentre" exact.
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------
   Orientation → quaternion
   ------------------------------------------------------------------ */

const ZEE = new THREE.Vector3(0, 0, 1);
const EULER = new THREE.Euler();
const Q0 = new THREE.Quaternion();
// -PI/2 about X: maps the W3C device frame (screen up = +Y, out of screen = +Z)
// onto the frame where the phone's "pointing" axis is -Z, like a camera.
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

const DEG2RAD = Math.PI / 180;

/**
 * Builds the device quaternion from a DeviceOrientationEvent triplet.
 *
 * @param screenAngle `screen.orientation.angle` in degrees, so landscape use
 *                    aims the same way portrait use does.
 */
export function quaternionFromOrientation(
  out: THREE.Quaternion,
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle: number
): THREE.Quaternion {
  EULER.set(beta * DEG2RAD, alpha * DEG2RAD, -gamma * DEG2RAD, 'YXZ');
  out.setFromEuler(EULER);
  out.multiply(Q1);
  out.multiply(Q0.setFromAxisAngle(ZEE, -screenAngle * DEG2RAD));
  return out;
}

export function currentScreenAngle(): number {
  const orientation = (screen as any)?.orientation;
  if (orientation && typeof orientation.angle === 'number') return orientation.angle;
  return typeof (window as any).orientation === 'number' ? (window as any).orientation : 0;
}

/* ------------------------------------------------------------------
   One Euro filter
   ------------------------------------------------------------------ */

/**
 * One Euro filter — an adaptive low-pass that trades jitter against lag based
 * on how fast the signal is moving.
 *
 * Phone IMUs are noisy at rest, which makes a held aim visibly shimmer, but a
 * fixed low-pass strong enough to kill that shimmer would smear fast flicks.
 * One Euro smooths hard when slow and barely at all when fast, which is exactly
 * the behaviour a spray can wants.
 */
class LowPass {
  private y: number | null = null;
  filter(value: number, alpha: number): number {
    this.y = this.y === null ? value : alpha * value + (1 - alpha) * this.y;
    return this.y;
  }
  get last(): number | null {
    return this.y;
  }
  reset() {
    this.y = null;
  }
}

export class OneEuroFilter {
  private xFilter = new LowPass();
  private dxFilter = new LowPass();
  private lastTime: number | null = null;

  constructor(
    private minCutoff = 1.1,
    private beta = 0.012,
    private dCutoff = 1.0
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, timestampMs: number): number {
    if (this.lastTime === null) {
      this.lastTime = timestampMs;
      this.xFilter.filter(value, 1);
      return value;
    }
    const dt = Math.max((timestampMs - this.lastTime) / 1000, 1 / 240);
    this.lastTime = timestampMs;

    const prev = this.xFilter.last ?? value;
    const derivative = (value - prev) / dt;
    const smoothedDerivative = this.dxFilter.filter(derivative, this.alpha(this.dCutoff, dt));

    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
    return this.xFilter.filter(value, this.alpha(cutoff, dt));
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

/* ------------------------------------------------------------------
   Aim tracker
   ------------------------------------------------------------------ */

export interface AimSample {
  /** Normalised cursor, 0..1 across the stage. */
  x: number;
  y: number;
  /** Raw angular offsets in radians, useful for tool tilt. */
  yaw: number;
  pitch: number;
  roll: number;
}

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Converts a stream of orientation events into a smoothed, calibrated aim
 * point. Instantiate one per controller.
 *
 * Yaw/pitch are decomposed in the **world (gravity) frame**, not the
 * calibration-relative frame. The difference matters exactly when the phone is
 * held like a real spray can: with a relative decomposition, calibrating at a
 * reclined angle tilts the whole cursor plane with it, so turning left/right
 * drags the cursor diagonally — it feels like the tracker assumes the phone is
 * lying flat. In the world frame, rotation about the true vertical axis is
 * always a pure horizontal sweep and elevation against gravity is always a
 * pure vertical one, no matter how the phone is reclined at calibration.
 */
export class AimTracker {
  private q = new THREE.Quaternion();
  private reference = new THREE.Quaternion();
  private relative = new THREE.Quaternion();
  private dir = new THREE.Vector3();
  private upDir = new THREE.Vector3();
  private hasReference = false;

  /**
   * World heading of the pointing ray. Heading comes from atan2 and wraps at
   * ±π, so it is unwrapped into a continuous accumulator before filtering —
   * turning past "behind you" must not snap the cursor across the screen.
   */
  private headingRaw = 0;
  private headingCont = 0;
  /** World elevation of the pointing ray at the calibration pose. */
  private refElevation = 0;

  /** Rotation speed (rad/s, EMA-smoothed) — gates the translation assist. */
  private prevQ = new THREE.Quaternion();
  private prevQt = 0;
  private rotSpeed = 0;

  /**
   * Tuned for a steady held aim: a lower resting cutoff smooths micro-jitter
   * harder while the raised speed coefficient keeps deliberate flicks snappy.
   */
  private yawFilter = new OneEuroFilter(0.85, 0.024);
  private pitchFilter = new OneEuroFilter(0.85, 0.024);
  private rollFilter = new OneEuroFilter(1.4, 0.02);

  /**
   * Soft-boundary drift, in radians. When the aim saturates at a screen edge,
   * the neutral origin slides with the overshoot so that reversing direction
   * responds immediately — without this, turning far past an edge leaves a
   * dead zone the player has to wind back through.
   */
  private yawDrift = 0;
  private pitchDrift = 0;

  /**
   * Radians of rotation that map to a full sweep of the stage. Smaller is more
   * sensitive. ~50° each way felt like the sweet spot between "reach the
   * corners without moving your feet" and "hold a steady line".
   */
  gain = 1 / (50 * DEG2RAD);

  /**
   * Copies the latest calibrated device rotation, for driving the on-screen
   * 3D tool. Identity until the first orientation sample arrives.
   */
  getRelativeQuaternion(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.relative);
  }

  /** True once at least one orientation sample has been processed. */
  get hasFix(): boolean {
    return this.hasReference;
  }

  /**
   * World heading of a pointing ray. Undefined when the ray is near-vertical
   * (nobody sprays the ceiling through this app), so hold the previous value
   * there instead of letting atan2 of noise spin the cursor.
   */
  private headingOf(dir: THREE.Vector3, fallback: number): number {
    if (Math.hypot(dir.x, dir.z) < 0.12) return fallback;
    return Math.atan2(dir.x, -dir.z);
  }

  /**
   * Lateral-translation assist. Rotation is the backbone of aiming; this only
   * covers the player who holds the phone still and *slides* it sideways.
   *
   * The hard-won constraint (this caused a real regression): swinging the
   * phone through a rotation moves the sensor along an arc, which reads as
   * genuine linear acceleration — integrating it while the player is doing
   * ordinary rotational aiming shoves the cursor around and makes tracking
   * feel broken. So translation is gated OFF whenever the device is rotating:
   * above ~14°/s the assist contributes nothing and rotational aiming is
   * exactly the pure-gyro behaviour. Only a rotationally-quiet, deliberately
   * sliding phone engages it.
   */
  private accelBias = new THREE.Vector3();
  private velX = 0;
  private velY = 0;
  private transX = 0;
  private transY = 0;
  private accelWorld = new THREE.Vector3();

  /** m/s² below this is treated as rest — phones idle around ±0.05-0.1. */
  private static ACCEL_DEADBAND = 0.35;
  /** Velocity half-life ≈ 0.15s: glides while moving, stops when you stop. */
  private static VEL_LEAK = 4.5;
  /** Radian-equivalent cursor offset per metre of integrated travel. */
  private static TRANSLATE_GAIN = 0.9;
  /** rad/s of device rotation at which the assist is fully suppressed. */
  private static ROT_GATE = 0.25;
  /**
   * ms the gate stays closed after rotation stops. At a sweep's turnaround
   * the angular speed passes through zero exactly when tangential arc
   * acceleration peaks — without this hold-off the assist grabs that spike.
   */
  private static ROT_HOLDOFF_MS = 650;
  private lastRotAboveMs = -1e9;
  /**
   * Probation for fresh gate-open streaks. Rotation detection lags the real
   * movement by ~150ms (the speed estimate is smoothed), so the moment a
   * rotation STARTS, peak arc-acceleration arrives while the gate still looks
   * open. New streaks therefore integrate into a pending buffer first: if
   * rotation follows within the window the buffer is discarded; if the quiet
   * holds, it commits retroactively so a genuine slide loses nothing.
   */
  private static COMMIT_DELAY_MS = 250;
  private gateOpenSince = -1;
  private pendingX = 0;
  private pendingY = 0;

  /**
   * Feeds gravity-free device acceleration (DeviceMotionEvent.acceleration,
   * device frame, m/s²). Call from the devicemotion listener.
   */
  addTranslation(ax: number, ay: number, az: number, dtSeconds: number) {
    if (!this.hasReference) return;
    const dt = THREE.MathUtils.clamp(dtSeconds, 1 / 120, 0.05);

    // Rotation gate — see the class comment. The hold-off keeps it closed
    // through sweep turnarounds, where rotation momentarily stops exactly as
    // tangential arc acceleration peaks. Rotating also dumps any built-up
    // velocity so a rotation started mid-slide cannot keep coasting.
    if (this.rotSpeed > AimTracker.ROT_GATE * 0.45) this.lastRotAboveMs = this.prevQt;
    const inHoldoff = this.prevQt - this.lastRotAboveMs < AimTracker.ROT_HOLDOFF_MS;
    const gate = inHoldoff
      ? 0
      : THREE.MathUtils.clamp(1 - this.rotSpeed / AimTracker.ROT_GATE, 0, 1);
    if (gate < 0.6) {
      this.velX *= 0.7;
      this.velY *= 0.7;
    }
    if (gate <= 0.02) {
      // Rotation: drop anything the lagging gate let through on its way shut.
      this.pendingX = 0;
      this.pendingY = 0;
      this.gateOpenSince = -1;
    } else if (this.gateOpenSince < 0) {
      this.gateOpenSince = this.prevQt;
    }
    const committed =
      this.gateOpenSince >= 0 && this.prevQt - this.gateOpenSince > AimTracker.COMMIT_DELAY_MS;

    // Device frame → world frame, so "slide right" is screen-right whatever
    // the phone's tilt. The device quaternion q includes the camera-style
    // remap, so the device's own axes are recovered through it directly.
    this.accelWorld.set(ax, ay, az).applyQuaternion(this.q);

    // Slow bias filter: whatever survives averaging over ~2s at rest is
    // offset, not motion. Frozen while rotating — arc acceleration would
    // poison it.
    if (gate > 0.8) {
      const biasAlpha = Math.min(dt / 2.0, 1);
      this.accelBias.lerp(this.accelWorld, biasAlpha);
    }
    // The orientation pipeline's -gamma convention mirrors the device X axis
    // into world space, so world X is negated to make "slide right" read
    // as screen-right (verified numerically).
    let wx = -(this.accelWorld.x - this.accelBias.x) * gate;
    let wy = (this.accelWorld.y - this.accelBias.y) * gate;

    const mag = Math.hypot(wx, wy);
    if (mag < AimTracker.ACCEL_DEADBAND) {
      wx = 0;
      wy = 0;
    }

    const leak = Math.exp(-AimTracker.VEL_LEAK * dt);
    this.velX = this.velX * leak + wx * dt;
    this.velY = this.velY * leak + wy * dt;

    const stepX = this.velX * dt * AimTracker.TRANSLATE_GAIN * 10;
    const stepY = this.velY * dt * AimTracker.TRANSLATE_GAIN * 10;
    if (committed) {
      this.transX += this.pendingX + stepX;
      this.transY += this.pendingY + stepY;
      this.pendingX = 0;
      this.pendingY = 0;
    } else {
      this.pendingX += stepX;
      this.pendingY += stepY;
    }
    this.transX = THREE.MathUtils.clamp(this.transX, -0.5, 0.5);
    this.transY = THREE.MathUtils.clamp(this.transY, -0.5, 0.5);
  }

  /** Marks the current pose as dead centre. */
  calibrate() {
    this.reference.copy(this.q);
    this.hasReference = true;
    this.dir.copy(FORWARD).applyQuaternion(this.q);
    this.headingRaw = this.headingOf(this.dir, this.headingRaw);
    this.headingCont = 0;
    this.refElevation = Math.asin(THREE.MathUtils.clamp(this.dir.y, -1, 1));
    this.yawDrift = 0;
    this.pitchDrift = 0;
    this.velX = 0;
    this.velY = 0;
    this.transX = 0;
    this.transY = 0;
    this.pendingX = 0;
    this.pendingY = 0;
    this.gateOpenSince = -1;
    this.yawFilter.reset();
    this.pitchFilter.reset();
    this.rollFilter.reset();
  }

  update(alpha: number, beta: number, gamma: number, timestampMs: number): AimSample {
    quaternionFromOrientation(this.q, alpha, beta, gamma, currentScreenAngle());

    // Track how fast the device is rotating — the translation assist's gate.
    if (this.prevQt > 0) {
      const dtq = Math.max((timestampMs - this.prevQt) / 1000, 1 / 240);
      const dot = Math.min(Math.abs(this.prevQ.dot(this.q)), 1);
      const instant = (2 * Math.acos(dot)) / dtq;
      this.rotSpeed += (instant - this.rotSpeed) * Math.min(dtq / 0.12, 1);
    }
    this.prevQ.copy(this.q);
    this.prevQt = timestampMs;

    if (!this.hasReference) this.calibrate();

    // Kept for driving the on-screen 3D tool: the can tilts with the device.
    this.relative.copy(this.reference).invert().multiply(this.q);

    // Aim decomposition happens in the world frame (see class doc): heading
    // about the true vertical axis, elevation against gravity — then the
    // calibrated heading/elevation are subtracted so calibration is "centre"
    // without tilting the cursor plane.
    this.dir.copy(FORWARD).applyQuaternion(this.q);
    const rawHeading = this.headingOf(this.dir, this.headingRaw);
    let step = rawHeading - this.headingRaw;
    if (step > Math.PI) step -= Math.PI * 2;
    else if (step < -Math.PI) step += Math.PI * 2;
    this.headingCont += step;
    this.headingRaw = rawHeading;

    const yaw = this.headingCont;
    const pitch = Math.asin(THREE.MathUtils.clamp(this.dir.y, -1, 1)) - this.refElevation;

    this.upDir.copy(UP).applyQuaternion(this.relative);
    const roll = Math.atan2(this.upDir.x, this.upDir.y);

    const sYaw = this.yawFilter.filter(yaw, timestampMs);
    const sPitch = this.pitchFilter.filter(pitch, timestampMs);
    const sRoll = this.rollFilter.filter(roll, timestampMs);

    // Rotation plus the translation assist share one angular scale, so the
    // drifting origin and edge clamps below govern their sum unchanged.
    const aimYaw = sYaw + this.transX;
    const aimPitch = sPitch + this.transY;

    // Map through the drifting origin, then let the origin follow overshoot.
    const half = this.gain * 0.5;
    const PAD = 0.015;
    let x = 0.5 + (aimYaw - this.yawDrift) * half;
    if (x < PAD) {
      this.yawDrift = aimYaw - (PAD - 0.5) / half;
      x = PAD;
    } else if (x > 1 - PAD) {
      this.yawDrift = aimYaw - (1 - PAD - 0.5) / half;
      x = 1 - PAD;
    }
    let y = 0.5 - (aimPitch - this.pitchDrift) * half;
    if (y < PAD) {
      this.pitchDrift = aimPitch - (0.5 - PAD) / half;
      y = PAD;
    } else if (y > 1 - PAD) {
      this.pitchDrift = aimPitch - (0.5 - (1 - PAD)) / half;
      y = 1 - PAD;
    }

    return { x, y, yaw: sYaw, pitch: sPitch, roll: sRoll };
  }

  reset() {
    this.hasReference = false;
  }
}

/* ------------------------------------------------------------------
   Receive-side smoothing
   ------------------------------------------------------------------ */

/**
 * Motion arrives over the network at ~30 Hz but the stage renders at 60-120 Hz.
 * Stepping the cursor straight to each received sample produces visible
 * staircasing in the paint stroke, so the studio eases toward the newest target
 * every frame instead. Critically damped so it never overshoots into a wobble.
 */
export class SmoothedCursor {
  private current = { x: 0.5, y: 0.5 };
  private target = { x: 0.5, y: 0.5 };
  private primed = false;

  setTarget(x: number, y: number) {
    this.target.x = x;
    this.target.y = y;
    if (!this.primed) {
      this.current.x = x;
      this.current.y = y;
      this.primed = true;
    }
  }

  /** @param responsiveness higher converges faster; 18-26 feels right. */
  step(delta: number, responsiveness = 22): { x: number; y: number } {
    const t = 1 - Math.exp(-responsiveness * delta);
    this.current.x += (this.target.x - this.current.x) * t;
    this.current.y += (this.target.y - this.current.y) * t;
    return this.current;
  }

  get value() {
    return this.current;
  }

  reset(x = 0.5, y = 0.5) {
    this.current = { x, y };
    this.target = { x, y };
    this.primed = false;
  }
}

/* ------------------------------------------------------------------
   Shake detection
   ------------------------------------------------------------------ */

/**
 * Detects the "rattle the can" gesture.
 *
 * Thresholding raw |acceleration| (the old approach) fires on any hard jolt,
 * including simply setting the phone down. Real shaking is *oscillation*, so
 * this requires several direction reversals in quick succession.
 */
export class ShakeDetector {
  private lastMagnitude = 0;
  private lastSign = 0;
  private reversals = 0;
  private windowStart = 0;
  private lastFire = 0;

  constructor(
    private threshold = 12,
    private requiredReversals = 3,
    private windowMs = 700,
    private cooldownMs = 500
  ) {}

  /** @returns shake intensity when triggered, otherwise 0. */
  push(x: number, y: number, z: number, now: number): number {
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    const delta = magnitude - this.lastMagnitude;
    this.lastMagnitude = magnitude;

    if (Math.abs(delta) < this.threshold * 0.25) return 0;

    const sign = Math.sign(delta);
    if (sign !== 0 && sign !== this.lastSign) {
      if (now - this.windowStart > this.windowMs) {
        this.reversals = 0;
        this.windowStart = now;
      }
      this.lastSign = sign;
      if (Math.abs(delta) > this.threshold) this.reversals++;
    }

    if (this.reversals >= this.requiredReversals && now - this.lastFire > this.cooldownMs) {
      this.lastFire = now;
      this.reversals = 0;
      this.windowStart = now;
      return Math.min(magnitude / 20, 2);
    }
    return 0;
  }
}
