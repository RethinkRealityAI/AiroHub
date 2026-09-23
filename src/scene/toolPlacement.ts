/**
 * Where a player's floating tool sits, given where they are aiming.
 *
 * The tool rides the AIM RAY (camera -> paint point), backed off the surface
 * by a hover distance. It used to sit at "hit + normal x hover", which hung
 * the can on a 1-unit lever off whichever triangle the ray hit: on the side
 * face of a skateboard truck the normal points sideways, which shoved the can
 * back against the direction of travel until the aim cleared the axle (it
 * looked stuck, then jumped), and on lumpy generated geometry every facet
 * step came out as sideways jitter. A point that moves along a camera ray
 * stays on the same pixel, so on the ray the nozzle tracks the aim exactly;
 * humps and edges only change its depth, which eases separately.
 *
 * Pure and allocation-free per step, so tests can drive it directly.
 */
import * as THREE from 'three';

export interface ToolPlacement {
  /** Smoothed aim direction from the camera (unit). */
  dir: THREE.Vector3;
  /** Smoothed distance from the camera to the nozzle; < 0 until first step. */
  depth: number;
}

export function createToolPlacement(): ToolPlacement {
  return { dir: new THREE.Vector3(0, 0, -1), depth: -1 };
}

/** Depth jumps larger than this (object switch, camera cut) snap instead of gliding. */
const SNAP_DEPTH = 12;
/** Direction blend rate (1/s): only evens out packet-rate steps. */
const DIR_RATE = 40;
/** Depth blend rate (1/s): crossing a hump is a glide of ~100 ms. */
const DEPTH_RATE = 9;

const scratch = new THREE.Vector3();

/**
 * Advances the placement one frame and writes the nozzle position to `out`.
 * `target` is the paint point on the surface, or the aim's point on the
 * camera-facing plane when off the model (then `hover` should be 0).
 */
export function stepToolPlacement(
  state: ToolPlacement,
  camPos: THREE.Vector3,
  target: THREE.Vector3,
  hover: number,
  delta: number,
  out: THREE.Vector3
): THREE.Vector3 {
  scratch.copy(target).sub(camPos);
  const dist = scratch.length();
  if (dist > 1e-4) scratch.divideScalar(dist);
  else scratch.copy(state.dir);
  const targetDepth = Math.max(dist - hover, 0.5);

  if (state.depth < 0 || Math.abs(targetDepth - state.depth) > SNAP_DEPTH) {
    state.dir.copy(scratch);
    state.depth = targetDepth;
  } else {
    state.dir.lerp(scratch, 1 - Math.exp(-DIR_RATE * delta)).normalize();
    state.depth += (targetDepth - state.depth) * (1 - Math.exp(-DEPTH_RATE * delta));
  }
  return out.copy(camPos).addScaledVector(state.dir, state.depth);
}
