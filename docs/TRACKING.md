# Motion tracking — how the phone becomes a mouse

The controller's Aim mode turns a phone into a spray can. The pipeline is
built so that it *feels* like a mouse: steady when held still, exact under
slow deliberate strokes, instant on flicks, and immune to the ways a hand and
a network try to corrupt the signal.

All of the code lives in `src/utils/motion.ts` (`AimTracker`,
`InterpolatedCursor`), fed by `ControllerView` and consumed by
`StudioScene`. `npm test` runs `scripts/test/aim-regression.mjs`, which locks
every property below behind a numeric check.

## Why deltas, not absolute pointing

Earlier versions decomposed the phone's absolute pointing direction in the
world (gravity) frame — heading about the vertical axis, elevation against
gravity. Mathematically faithful, but not what the wrist *means*: with any
roll in the grip (nobody holds a phone plumb, and a thumb pressing the glass
adds more), a pure wrist-"up" motion changes world heading too, so vertical
strokes drifted sideways. A 20° grip roll bled ~38% of a vertical stroke into
horizontal.

The tracker now integrates **player-space rotation deltas** — the technique
competitive gyro-aiming settled on:

- **Pitch** is rotation about the device's own X axis (wrist flexion).
  Roll-invariant: vertical strokes stay vertical however the phone is held.
- **Yaw** takes its *direction* from the world-vertical component (turning
  left is always screen-left whatever the tilt) and its *magnitude* from the
  local yaw/roll plane, relaxed toward `RELAX ×` world yaw (1.41, the
  published sweet spot). The relax factor fades to 1 at rest so it cannot
  amplify hold noise.
- Like a mouse, the integrated aim **ratchets** at the screen edges (the
  drifting-origin clamp) and has no heading seam anywhere.

Measured effect: rolled-grip cross-axis bleed 37.7% → 0.0%.

## Hold steadiness without flick lag

Per-sample rate gating cannot tell sensor noise from a real sweep — white
noise at 60 Hz *looks like* ~20°/s of rate. What distinguishes them is
direction correlation, so the tracker keeps a **noise-cancelling movement
estimate**: an EMA of the delta-rate *vector* (`RATE_EMA_HZ`). Noise
alternates sign and cancels; intent accumulates. That estimate gates:

- a **banded low-pass on the orientation itself** (`CUT_LO`→`CUT_HI` Hz
  between `RATE_LO` and `RATE_HI`). Reach is never lost to the band: the
  smoothed pose converges to the raw one, and the integral of its deltas
  equals the true total rotation;
- **tightening** (`TIGHTEN_RATE`): quadratic squash of what little leaks
  through below the movement threshold — a held aim is pixel-still;
- the **precision curve** (`ACCEL_LO/HI`, `SCALE_LO/HI`): slow deliberate
  strokes get a finer ratio than fast sweeps, so small shapes and full reach
  coexist.

## Trigger-press suppression

Pressing or releasing the on-screen trigger physically rotates the phone for
~80 ms. `AimTracker.notifyTriggerEdge()` (via `suppressFor()`) discards aim
deltas for 120/80 ms around the edges and snaps the smoothed pose to raw, so
the wobble never enters the integrator — taps land where you aimed *before*
the thumb hit the glass. Measured cursor kick: 0.32% of stage → 0.00%.

**Shake-to-recentre** reuses the same mechanism: shaking the can (the rattle
gesture) calls `calibrate()` — which exactly recentres the cursor — plus a
650 ms `suppressFor()` so the tail of the shake cannot drag the
freshly-centred aim away.

## Translation assist

Sliding the phone sideways (no rotation) moves the cursor via gravity-free
accelerometer integration. Rotation corrupts this (arc acceleration at the
sensor reads as linear), so the assist is gated hard: off above ~14°/s of
rotation, a 650 ms hold-off after rotation stops (turnarounds put peak arc
acceleration exactly at zero angular speed), and a 250 ms probation buffer
for fresh gate-open streaks (rotation detection lags its onset). Verified:
worst-case rotational sweep contributes exactly 0 cursor movement.

## Receive-side interpolation

Motion samples cross Supabase Realtime at ~40 Hz with genuine delivery
jitter. The studio must not chase the newest packet (lags on steady motion
*and* lurches on bursts). `InterpolatedCursor` instead:

- arrival-stamps each sample and renders ~`delayMs` (90 ms) behind through a
  Catmull-Rom curve — C¹ continuous through every actual sample;
- **re-times bunched packets** to `minSpacingMs` (18 ms — below the 25 ms
  send cadence): TCP head-of-line blocking delivers bunches microseconds
  apart carrying tens of ms of path, which would otherwise play back
  unboundedly fast;
- advances a **slewed playhead** (0.35×–1.7×): it pauses at the buffer's end
  during a dropout and replays the missed path quickly on resume instead of
  teleporting; tangents are capped against the segment chord.

Under jittery delivery with a 90 ms dropout, the max per-frame cursor step is
~1.8× the ideal smooth step, with 0.003 RMS path accuracy. The controller's
own screen stays instant — only the studio view carries the delay, which is
also why painting is WYSIWYG: strokes start and stop at the position the
player *saw*.

## Tuning knobs

| Knob | Where | Effect |
| --- | --- | --- |
| `gain` | `AimTracker` | Degrees of rotation for a full-stage sweep (50° each way). Smaller = more sensitive. |
| `SCALE_LO` / `ACCEL_LO` | `AimTracker` | How much finer slow strokes are, and where "slow" starts. |
| `TIGHTEN_RATE` | `AimTracker` | Below this speed the aim is glued still. Raise if a held aim shimmers on a noisy phone. |
| `PRESS_SUPPRESS_MS` | `AimTracker` | Trigger-press wobble window. |
| `delayMs` | `InterpolatedCursor` | Studio-side smoothing delay. Lower = snappier remote cursor, less jitter headroom. |
| `MOTION_HZ` | `ControllerView` | Send rate (keep `minSpacingMs` below its period). |

## Regression suite

`npm test` → `scripts/test/aim-regression.mjs`. Eleven checks, each encoding
a symptom that was actually reported and fixed: yaw/pitch handedness and
sensitivity, rolled-grip bleed, roll immunity, hold steadiness under sensor
noise, flick reach without creep, press suppression, interpolation
smoothness under TCP-style jitter, interpolation accuracy, translation
assist, and calibrate/shake recentring. If one fails, the matching feel
regression will be noticeable on a real phone.
