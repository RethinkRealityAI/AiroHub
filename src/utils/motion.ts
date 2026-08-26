/**
 * Device orientation → aim vector.
 *
 * The controller aims like a **gyro mouse**, not a laser pointer. Earlier
 * versions decomposed the phone's absolute pointing direction in the world
 * (gravity) frame — heading about the vertical axis, elevation against
 * gravity. That is mathematically faithful to where the phone points, but it
 * is not what the wrist *means*: with any roll in the player's grip (and no
 * one holds a phone perfectly plumb — pressing a thumb on the glass adds
 * more), a pure wrist-"up" motion changes world heading too, so vertical
 * strokes drifted sideways and fine shapes felt impossible.
 *
 * The fix is the technique competitive gyro-aiming settled on ("player-space
 * gyro"): integrate per-event rotation *deltas* read in the device's own
 * frame — pitch from rotation about the device's X axis, yaw from the
 * world-vertical component with the player-space magnitude relaxation. Like a
 * mouse it is roll-invariant, has no heading seam, ratchets naturally at the
 * screen edges, and — crucially — deltas can simply be *discarded* while the
 * thumb is landing on the trigger, so pressing to spray no longer kicks the
 * cursor.
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

/**
 * One Euro filter — an adaptive low-pass that trades jitter against lag based
 * on how fast the signal is moving. Used for the cosmetic roll readout; the
 * aim path itself uses tightening + two-band smoothing on rotation deltas,
 * which holds steadier at rest without adding flick lag.
 */
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
  /** Integrated angular offsets in radians, useful for tool tilt. */
  yaw: number;
  pitch: number;
  roll: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Converts a stream of orientation events into a smoothed, calibrated aim
 * point. Instantiate one per controller. See the module comment for why this
 * integrates player-space rotation deltas instead of decomposing the absolute
 * pointing direction.
 */
export class AimTracker {
  private q = new THREE.Quaternion();
  private reference = new THREE.Quaternion();
  private relative = new THREE.Quaternion();
  private upDir = new THREE.Vector3();
  private hasReference = false;

  /** Body-frame rotation delta between consecutive samples. */
  private dq = new THREE.Quaternion();
  private inv = new THREE.Quaternion();
  private omega = new THREE.Vector3();
  private upDev = new THREE.Vector3();

  /** Integrated aim, radians from centre. The player-space "mouse position". */
  private yawAcc = 0;
  private pitchAcc = 0;

  /**
   * Banded low-pass of the orientation itself. Deltas are extracted from this
   * smoothed pose, whose cutoff opens with movement speed — and because the
   * deltas are integrated, a transiently narrow cutoff never loses reach: the
   * smoothed pose always converges to the real one, so the integral of its
   * deltas equals the true total rotation.
   */
  private qSmooth = new THREE.Quaternion();
  private qSmoothPrev = new THREE.Quaternion();

  /**
   * Noise-cancelling movement-speed estimate: an EMA of the player-space
   * delta-rate *vector*. Sensor noise alternates direction sample to sample
   * and cancels here, while a real sweep accumulates — this is what lets the
   * tracker distinguish "holding still on a noisy IMU" (which can read as
   * 20°/s of per-sample rate) from an actual 20°/s stroke.
   */
  private rateY = 0;
  private rateP = 0;

  /** Rotation speed (rad/s, EMA-smoothed) — gates the translation assist. */
  private prevQ = new THREE.Quaternion();
  private prevQt = 0;
  private rotSpeed = 0;

  /**
   * Deltas are dropped until this stamp: pressing or releasing the trigger
   * physically rotates the phone for ~80 ms, and in a delta model that wobble
   * can simply never enter the integrator. (An absolute decomposition cannot
   * do this — dropping samples there just defers the same snap.)
   */
  private suppressUntil = -1e9;

  private rollFilter = new OneEuroFilter(1.4, 0.02);

  /**
   * Soft-boundary drift, in radians. When the aim saturates at a screen edge,
   * the neutral origin slides with the overshoot so that reversing direction
   * responds immediately — mouse-style ratcheting instead of a dead zone.
   */
  private yawDrift = 0;
  private pitchDrift = 0;

  /**
   * Radians of rotation that map to a full sweep of the stage. Smaller is more
   * sensitive. ~50° each way felt like the sweet spot between "reach the
   * corners without moving your feet" and "hold a steady line".
   */
  gain = 1 / (50 * DEG2RAD);

  /** Player-space yaw: how far world-yaw may be amplified toward the local
   *  yaw/roll magnitude. 1.41 is the published sweet spot. */
  private static RELAX = 1.41;
  /** EMA bandwidth of the movement-speed estimate (Hz). */
  private static RATE_EMA_HZ = 2.5;
  /** Below this speed, deltas are quadratically "tightened" toward zero — the
   *  last shimmer of a held aim vanishes without any hold lag. */
  private static TIGHTEN_RATE = 6 * DEG2RAD;
  /** Orientation low-pass band: CUT_LO Hz when holding still (≤ RATE_LO),
   *  opening to CUT_HI Hz (effectively raw) at RATE_HI and above. */
  private static RATE_LO = 6 * DEG2RAD;
  private static RATE_HI = 50 * DEG2RAD;
  private static CUT_LO = 0.35;
  private static CUT_HI = 25;
  /** Precision curve: slow deliberate rotations get a finer ratio, fast
   *  flicks a coarser one, so small shapes and full reach coexist. */
  private static ACCEL_LO = 25 * DEG2RAD;
  private static ACCEL_HI = 210 * DEG2RAD;
  private static SCALE_LO = 0.85;
  private static SCALE_HI = 1.3;
  private static PRESS_SUPPRESS_MS = 120;
  private static RELEASE_SUPPRESS_MS = 80;

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
   * Call on trigger press/release edges. Aim deltas (and the translation
   * assist) are ignored for a short window so the mechanical jolt of the
   * thumb landing on or leaving the glass cannot move the cursor.
   */
  notifyTriggerEdge(pressed: boolean, timestampMs: number) {
    this.suppressUntil =
      timestampMs +
      (pressed ? AimTracker.PRESS_SUPPRESS_MS : AimTracker.RELEASE_SUPPRESS_MS);
    this.rateY = 0;
    this.rateP = 0;
  }

  /**
   * Body-frame angular displacement between two orientations, forced onto the
   * short arc (quaternion double-cover would otherwise occasionally hand back
   * the long way round as a huge delta). Returns the rotation angle.
   */
  private omegaBetween(prev: THREE.Quaternion, cur: THREE.Quaternion, out: THREE.Vector3): number {
    this.dq.copy(this.inv.copy(prev).invert()).multiply(cur);
    if (this.dq.w < 0) this.dq.set(-this.dq.x, -this.dq.y, -this.dq.z, -this.dq.w);
    const w = THREE.MathUtils.clamp(this.dq.w, -1, 1);
    const angle = 2 * Math.acos(w);
    const s = Math.sqrt(Math.max(1 - w * w, 0));
    if (angle > 1e-7 && s > 1e-7) {
      out.set(this.dq.x / s, this.dq.y / s, this.dq.z / s).multiplyScalar(angle);
    } else {
      out.set(0, 0, 0);
    }
    return angle;
  }

  /**
   * Player-space yaw displacement of a body-frame delta (see update()).
   *
   * @param relax how far world-yaw may be amplified toward the local
   *   yaw/roll magnitude. Passed in because it must fade to 1 at rest: the
   *   amplification borrows the roll axis's magnitude, which on a noisy IMU
   *   would amplify hold shimmer on the yaw channel by the same factor.
   */
  private playerYaw(omega: THREE.Vector3, source: THREE.Quaternion, relax: number): number {
    this.upDev.copy(UP).applyQuaternion(this.inv.copy(source).invert());
    const worldYaw = omega.dot(this.upDev);
    const yawRollMag = Math.hypot(omega.y, omega.z);
    return Math.sign(worldYaw) * Math.min(Math.abs(worldYaw) * relax, yawRollMag);
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

    // The thumb landing on the trigger is also an acceleration spike.
    if (this.prevQt < this.suppressUntil) {
      this.velX *= 0.5;
      this.velY *= 0.5;
      this.pendingX = 0;
      this.pendingY = 0;
      this.gateOpenSince = -1;
      return;
    }

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
    this.yawAcc = 0;
    this.pitchAcc = 0;
    this.qSmooth.copy(this.q);
    this.rateY = 0;
    this.rateP = 0;
    this.yawDrift = 0;
    this.pitchDrift = 0;
    this.velX = 0;
    this.velY = 0;
    this.transX = 0;
    this.transY = 0;
    this.pendingX = 0;
    this.pendingY = 0;
    this.gateOpenSince = -1;
    this.rollFilter.reset();
  }

  update(alpha: number, beta: number, gamma: number, timestampMs: number): AimSample {
    quaternionFromOrientation(this.q, alpha, beta, gamma, currentScreenAngle());

    let yawDisp = 0;
    let pitchDisp = 0;

    if (this.prevQt > 0) {
      const dtq = THREE.MathUtils.clamp((timestampMs - this.prevQt) / 1000, 1 / 240, 0.1);

      // Raw body-frame delta: feeds the translation-assist gate and the
      // movement-speed estimate, never the cursor directly.
      const angle = this.omegaBetween(this.prevQ, this.q, this.omega);
      this.rotSpeed += (angle / dtq - this.rotSpeed) * Math.min(dtq / 0.12, 1);

      // Player-space decomposition of the raw delta:
      //  · pitch is rotation about the device's own X (pure wrist flexion —
      //    roll-invariant, so vertical strokes stay vertical however the
      //    phone is gripped);
      //  · yaw takes its direction from the world-vertical component (turning
      //    left is always screen-left whatever the tilt) and its magnitude
      //    from the local yaw/roll plane, relaxed toward RELAX× world yaw.
      const rawY = this.playerYaw(this.omega, this.q, AimTracker.RELAX);
      const rawP = this.omega.x;

      // Noise-cancelling speed estimate (see the field comment).
      const aRate = 1 - Math.exp(-2 * Math.PI * AimTracker.RATE_EMA_HZ * dtq);
      this.rateY += (rawY / dtq - this.rateY) * aRate;
      this.rateP += (rawP / dtq - this.rateP) * aRate;
      const vecRate = Math.hypot(this.rateY, this.rateP);

      if (timestampMs < this.suppressUntil) {
        // Thumb landing on / leaving the trigger: absorb the wobble. Snapping
        // the smoothed pose to the raw one means whatever small persistent
        // tilt the press leaves behind is adopted without cursor movement.
        this.qSmooth.copy(this.q);
        this.rateY = 0;
        this.rateP = 0;
      } else {
        // Banded orientation low-pass: ~CUT_LO Hz while holding (kills IMU
        // shimmer), opening to effectively-raw once genuinely moving. Reach
        // is never lost to the band — the integral of the smoothed pose's
        // deltas converges to the true total rotation.
        const band = THREE.MathUtils.clamp(
          (vecRate - AimTracker.RATE_LO) / (AimTracker.RATE_HI - AimTracker.RATE_LO),
          0,
          1
        );
        const cutoff =
          AimTracker.CUT_LO +
          (AimTracker.CUT_HI - AimTracker.CUT_LO) * band * band * (3 - 2 * band);
        const aQ = 1 - Math.exp(-2 * Math.PI * cutoff * dtq);
        this.qSmoothPrev.copy(this.qSmooth);
        this.qSmooth.slerp(this.q, aQ);

        this.omegaBetween(this.qSmoothPrev, this.qSmooth, this.omega);
        const relax = 1 + (AimTracker.RELAX - 1) * band;
        let yDisp = this.playerYaw(this.omega, this.qSmooth, relax);
        let pDisp = this.omega.x;

        // Tightening: quadratically squash what little the low-pass lets
        // through below the movement threshold. A held aim is pixel-still.
        if (vecRate < AimTracker.TIGHTEN_RATE) {
          const k = vecRate / AimTracker.TIGHTEN_RATE;
          yDisp *= k * k;
          pDisp *= k * k;
        }

        // Precision curve: finer ratio for careful strokes, coarser for
        // flicks, judged on real movement speed rather than noisy samples.
        const t = THREE.MathUtils.clamp(
          (vecRate - AimTracker.ACCEL_LO) / (AimTracker.ACCEL_HI - AimTracker.ACCEL_LO),
          0,
          1
        );
        const scale =
          AimTracker.SCALE_LO + (AimTracker.SCALE_HI - AimTracker.SCALE_LO) * t * t * (3 - 2 * t);
        yawDisp = yDisp * scale;
        pitchDisp = pDisp * scale;
      }
    }
    this.prevQ.copy(this.q);
    this.prevQt = timestampMs;

    if (!this.hasReference) this.calibrate();

    // Kept for driving the on-screen 3D tool: the can tilts with the device.
    this.relative.copy(this.reference).invert().multiply(this.q);

    // Integrate. Positive world-yaw (turning left, CCW from above) must move
    // the cursor left, matching the previous world-frame mapping's handedness;
    // positive device pitch (wrist up) moves it up.
    this.yawAcc -= yawDisp;
    this.pitchAcc += pitchDisp;

    this.upDir.copy(UP).applyQuaternion(this.relative);
    const roll = this.rollFilter.filter(
      Math.atan2(this.upDir.x, this.upDir.y),
      timestampMs
    );

    // Rotation plus the translation assist share one angular scale, so the
    // drifting origin and edge clamps below govern their sum unchanged.
    const aimYaw = this.yawAcc + this.transX;
    const aimPitch = this.pitchAcc + this.transY;

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

    return { x, y, yaw: this.yawAcc, pitch: this.pitchAcc, roll };
  }

  reset() {
    this.hasReference = false;
  }
}

/* ------------------------------------------------------------------
   Receive-side interpolation
   ------------------------------------------------------------------ */

/**
 * Motion arrives over the network at ~40 Hz with real delivery jitter —
 * packets bunch up and gap. The old approach eased toward the *newest* sample
 * every frame, which is the worst of both worlds: it lags behind steady
 * movement yet still lurches when two packets arrive together. This is the
 * standard game-netcode answer instead: buffer samples with their arrival
 * times and render the cursor a fixed ~90 ms behind "now", interpolating a
 * Catmull-Rom curve through the actual received positions. Output velocity is
 * then continuous no matter how unevenly the packets landed, so remote
 * strokes come out as smooth curves rather than chains of kinks.
 */
export class InterpolatedCursor {
  private samples: { x: number; y: number; at: number }[] = [];
  private out = { x: 0.5, y: 0.5 };
  private primed = false;

  /**
   * The playhead is a *slewed clock*, not `now - delay` directly: it pauses
   * at the buffer's end during a feed stall and replays the missed path at up
   * to ~2× speed once packets resume, instead of teleporting across the gap.
   * (Adaptive playout, as in VoIP jitter buffers.)
   */
  private playhead = -1;
  private lastStepAt = -1;

  /**
   * @param minSpacingMs de-jitter re-timing floor. TCP head-of-line blocking
   *   delivers bunches of packets microseconds apart that carry tens of ms of
   *   real path — interpolated on raw arrival stamps, the playhead would tear
   *   through those positions unboundedly fast. Bunched packets are spread
   *   back out to at least this spacing. Must sit below the sender's real
   *   cadence (the controller emits every 25ms) or the timeline drifts.
   */
  constructor(
    private delayMs = 90,
    private minSpacingMs = 18
  ) {}

  /** @param atMs arrival stamp on this machine's performance.now() clock. */
  push(x: number, y: number, atMs: number) {
    const s = this.samples;
    const prev = s[s.length - 1];
    const at = prev ? Math.max(atMs, prev.at + this.minSpacingMs) : atMs;
    s.push({ x, y, at });
    if (s.length > 48) s.splice(0, s.length - 48);
    if (!this.primed) {
      this.out.x = x;
      this.out.y = y;
      this.primed = true;
    }
  }

  step(nowMs: number): { x: number; y: number } {
    const s = this.samples;
    if (s.length === 0) return this.out;

    const target = nowMs - this.delayMs;
    if (this.playhead < 0) this.playhead = Math.min(target, s[0].at);
    const frameDt = this.lastStepAt < 0 ? 0 : THREE.MathUtils.clamp(nowMs - this.lastStepAt, 0, 100);
    this.lastStepAt = nowMs;

    // Slew toward real time: behind (after a stall) → catch up at ≤1.7×,
    // replaying the buffered path rather than jumping over it; ahead
    // (delay budget shrank) → slow-motion briefly instead of stepping back.
    const err = target - this.playhead;
    const speed = THREE.MathUtils.clamp(1 + err / 250, 0.35, 1.7);
    this.playhead = Math.min(this.playhead + frameDt * speed, s[s.length - 1].at);

    const t = this.playhead;
    if (t <= s[0].at) {
      this.out.x = s[0].x;
      this.out.y = s[0].y;
      return this.out;
    }
    const last = s[s.length - 1];
    if (t >= last.at) {
      this.out.x = last.x;
      this.out.y = last.y;
      return this.out;
    }

    let i = s.length - 2;
    while (i > 0 && s[i].at > t) i--;
    const p1 = s[i];
    const p2 = s[i + 1];
    const p0 = s[i - 1] ?? p1;
    const p3 = s[i + 2] ?? p2;

    const span = Math.max(p2.at - p1.at, 1e-3);
    const u = (t - p1.at) / span;

    // Cubic Hermite with Catmull-Rom (finite-difference) tangents on the
    // non-uniform arrival timeline — C¹ continuous through every sample.
    // Tangents are capped relative to the segment chord: bunched arrivals
    // make the finite differences explode otherwise, and an exploded tangent
    // is a visible squiggle in the stroke.
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const capTangent = (mx: number, my: number): [number, number] => {
      const mag = Math.hypot(mx, my);
      const cap = chord * 3 + 1e-6;
      if (mag > cap) {
        const k = cap / mag;
        return [mx * k, my * k];
      }
      return [mx, my];
    };
    const [m1x, m1y] = capTangent(
      (span * (p2.x - p0.x)) / Math.max(p2.at - p0.at, 1e-3),
      (span * (p2.y - p0.y)) / Math.max(p2.at - p0.at, 1e-3)
    );
    const [m2x, m2y] = capTangent(
      (span * (p3.x - p1.x)) / Math.max(p3.at - p1.at, 1e-3),
      (span * (p3.y - p1.y)) / Math.max(p3.at - p1.at, 1e-3)
    );

    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;

    this.out.x = THREE.MathUtils.clamp(
      h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x,
      0,
      1
    );
    this.out.y = THREE.MathUtils.clamp(
      h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y,
      0,
      1
    );
    return this.out;
  }

  get value() {
    return this.out;
  }

  reset(x = 0.5, y = 0.5) {
    this.samples.length = 0;
    this.out = { x, y };
    this.primed = false;
    this.playhead = -1;
    this.lastStepAt = -1;
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
