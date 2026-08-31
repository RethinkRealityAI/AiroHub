/**
 * One reviewable asset on a turntable, drawn into a slice of the gallery's
 * single shared WebGL canvas.
 *
 * Every card is a drei `<View>`: an ordinary DOM box out here, a scissored
 * viewport over there. Per-card `<Canvas>` elements would be the obvious
 * shape and are unusable — Chromium evicts WebGL contexts past roughly
 * sixteen live ones, so the seventeenth card would blank a random earlier one
 * and keep doing it as you scrolled.
 *
 * Three properties make the grid a fair comparison rather than a mood board:
 *
 *  - **One camera angle for every card.** `GRID_POSE` is shared, and the only
 *    thing that varies per card is distance, derived from the model's own
 *    bounding radius by the same fit math as `src/scene/useFitCamera.ts`. Two
 *    assets photographed from different angles cannot be compared; two
 *    photographed from the same angle at matched framing can.
 *  - **One turntable phase.** The yaw comes from a single module-level
 *    accumulator driven by the shared r3f clock, so at any instant every card
 *    shows the same rotation relative to its own front. Per-card clocks drift
 *    apart within seconds and the grid turns into a shimmer.
 *  - **A camera per view, not per canvas.** The root camera belongs to all
 *    views at once; the detail modal orbits, and one shared camera would drag
 *    the whole grid around with it. Each `<View>` portals into its own scene,
 *    so it can — and does — own its own camera.
 *
 * Diagnostics live here too, because they are per-view state: `silhouette`
 * swaps `scene.overrideMaterial` and paints a light `scene.background` (a
 * background Color forces a clear *inside the active scissor rect*, which is
 * the only way to get a per-card clear colour — `gl.setClearColor` is
 * renderer-global and would repaint every other card as well).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { View } from '@react-three/drei';
import * as THREE from 'three';
import { setPrimerMix } from '../paint/paintMaterial';
import type { ReviewAsset } from './assets';
import { loadForReview, releaseReviewModel, type ReviewModel } from './reviewModels';
import { getReviewEnvironment, REVIEW_ENV_INTENSITY, type ReviewEnvKind } from './reviewEnv';

/* ------------------------------------------------------------------
   Framing
   ------------------------------------------------------------------ */

/** Long lens: less perspective distortion, so silhouettes read honestly. */
export const REVIEW_FOV = 32;

export interface CameraPose {
  /** Radians around Y. */
  azimuth: number;
  /** Radians from +Y. Clamped away from the poles so up never flips. */
  polar: number;
  /** Multiplier on the fitted distance. 1 = the framing every grid card uses. */
  zoom: number;
}

/**
 * The one angle every grid card is shot from — a three-quarter view a little
 * above the equator, which is where a bad silhouette, a bad topline and a bad
 * base all show at once.
 */
export const GRID_POSE: CameraPose = {
  azimuth: Math.PI * 0.23,
  polar: Math.PI * 0.42,
  zoom: 1,
};

export function clonePose(pose: CameraPose): CameraPose {
  return { azimuth: pose.azimuth, polar: pose.polar, zoom: pose.zoom };
}

/**
 * Distance that just contains a sphere of `radius`, taking whichever of the
 * vertical and horizontal fields of view is more restrictive.
 *
 * Same derivation as `useFitCamera`, inlined rather than imported because that
 * hook drives the *default* camera through r3f state; here the camera is
 * per-view and the distance is recomputed every frame from a live aspect.
 */
export function fitDistance(radius: number, aspect: number, margin = 1.18): number {
  const vFov = (REVIEW_FOV * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 1e-3));
  return Math.max(radius / Math.sin(vFov / 2), radius / Math.sin(hFov / 2)) * margin;
}

/* ------------------------------------------------------------------
   The shared turntable clock
   ------------------------------------------------------------------ */

/** Radians per second. Slow enough to read detail, fast enough to notice. */
const SPIN_RATE = 0.42;

let sharedYaw = 0;
let lastElapsed = -1;

/**
 * The yaw every card is at, right now.
 *
 * Called once per card per frame with r3f's shared clock time, which is
 * identical for every subscriber within a frame — so the first caller advances
 * the accumulator and the rest see a zero delta and read the same value. That
 * makes the result order-independent and immune to the number of live cards,
 * which a `performance.now()`-derived phase would not be. Pausing holds the
 * angle instead of resetting it, so Spin off then on does not snap.
 */
export function sharedTurntableYaw(elapsed: number, spinning: boolean): number {
  if (lastElapsed < 0) lastElapsed = elapsed;
  const delta = Math.min(Math.max(elapsed - lastElapsed, 0), 0.1);
  lastElapsed = elapsed;
  if (spinning) sharedYaw = (sharedYaw + delta * SPIN_RATE) % (Math.PI * 2);
  return sharedYaw;
}

/* ------------------------------------------------------------------
   Diagnostics
   ------------------------------------------------------------------ */

export interface ReviewDiagnostics {
  env: ReviewEnvKind;
  /** Flat fill against a light ground — reads the outline, not the texture. */
  silhouette: boolean;
  /** Washes the model's own albedo to primer, the studio's blank finish. */
  primer: boolean;
}

export const DEFAULT_DIAGNOSTICS: ReviewDiagnostics = {
  env: 'neutral',
  silhouette: false,
  primer: false,
};

/** Near-black fill; the ground behind it is light, so the shape is the message. */
const SILHOUETTE_MATERIAL = new THREE.MeshBasicMaterial({ color: '#0b0b12' });
const SILHOUETTE_GROUND = new THREE.Color('#c8ccd8');

export type StageStatus = 'loading' | 'ready' | 'error';

/* ------------------------------------------------------------------
   The 3D half — runs inside the View's own portal scene
   ------------------------------------------------------------------ */

interface StageProps {
  asset: ReviewAsset;
  diagnostics: ReviewDiagnostics;
  spin: boolean;
  poseRef: React.MutableRefObject<CameraPose>;
  /** Filled in here so the DOM-side pointer handlers can wake a demand loop. */
  invalidateRef: React.MutableRefObject<() => void>;
  onStatus?: (status: StageStatus) => void;
}

const ReviewStage: React.FC<StageProps> = ({
  asset,
  diagnostics,
  spin,
  poseRef,
  invalidateRef,
  onStatus,
}) => {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const set = useThree((state) => state.set);
  const invalidate = useThree((state) => state.invalidate);

  const [model, setModel] = useState<ReviewModel | null>(null);
  const baseYaw = useRef(0);

  const camera = useMemo(() => new THREE.PerspectiveCamera(REVIEW_FOV, 1, 0.1, 400), []);

  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    invalidateRef.current = () => invalidate();
  }, [invalidate, invalidateRef]);

  /* This view's own default camera. `set` here is the portal store's setter,
     so it never touches the root camera the other cards are using. */
  useEffect(() => {
    camera.name = `airo-review-cam-${asset.key}`;
    set({ camera });
  }, [set, camera, asset.key]);

  /* ------------------------------ model ------------------------------ */

  useEffect(() => {
    let cancelled = false;
    let loaded: ReviewModel | null = null;
    setModel(null);
    statusRef.current?.('loading');
    loadForReview(asset)
      .then((result) => {
        loaded = result;
        if (cancelled) {
          releaseReviewModel(result);
          return;
        }
        baseYaw.current = result.root.rotation.y;
        setModel(result);
        statusRef.current?.('ready');
        invalidate();
      })
      .catch(() => {
        if (!cancelled) statusRef.current?.('error');
      });
    return () => {
      cancelled = true;
      releaseReviewModel(loaded);
    };
  }, [asset, invalidate]);

  /* --------------------------- diagnostics --------------------------- */

  useEffect(() => {
    scene.environment = getReviewEnvironment(gl, diagnostics.env);
    scene.environmentIntensity = REVIEW_ENV_INTENSITY[diagnostics.env];
    invalidate();
  }, [scene, gl, diagnostics.env, invalidate]);

  useEffect(() => {
    scene.overrideMaterial = diagnostics.silhouette ? SILHOUETTE_MATERIAL : null;
    // A Color background makes WebGLRenderer force a clear, and the clear obeys
    // the scissor rect drei has already set — so this lights up one card only.
    scene.background = diagnostics.silhouette ? SILHOUETTE_GROUND : null;
    invalidate();
    return () => {
      scene.overrideMaterial = null;
      scene.background = null;
    };
  }, [scene, diagnostics.silhouette, invalidate]);

  useEffect(() => {
    if (model) setPrimerMix(model.paintBlocks, diagnostics.primer ? 1 : 0);
    invalidate();
  }, [model, diagnostics.primer, invalidate]);

  /* ------------------------------ frame ------------------------------ */

  useFrame((state) => {
    const yaw = sharedTurntableYaw(state.clock.elapsedTime, spin);
    if (model) model.root.rotation.y = baseYaw.current + yaw;

    const pose = poseRef.current;
    const radius = model?.radius ?? 6;
    const distance = fitDistance(radius, camera.aspect || 1) * pose.zoom;
    camera.position.setFromSphericalCoords(distance, pose.polar, pose.azimuth);
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(distance / 200, 0.05);
    camera.far = distance * 12;
    camera.updateProjectionMatrix();
  });

  return model ? <primitive object={model.root} /> : null;
};

/* ------------------------------------------------------------------
   The card-side wrapper
   ------------------------------------------------------------------ */

export interface TurntableViewProps {
  asset: ReviewAsset;
  diagnostics: ReviewDiagnostics;
  spin: boolean;
  /** Sizing box. The `<View>` fills it exactly. */
  className?: string;
  /**
   * False parks the view without unmounting it — used while the detail modal
   * is open, because the modal's scrim sits UNDER the shared canvas and grid
   * cards would otherwise paint straight through it.
   */
  visible?: boolean;
  /** Detail modal only: drag to orbit, wheel to dolly. */
  interactive?: boolean;
  /** Starting pose. Omitted, the card uses the shared grid angle. */
  pose?: CameraPose | null;
  /** Fired when a drag or a wheel settles, so a pose can be persisted. */
  onPoseChange?: (pose: CameraPose) => void;
  onStatusChange?: (status: StageStatus) => void;
}

const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value;

export const TurntableView: React.FC<TurntableViewProps> = ({
  asset,
  diagnostics,
  spin,
  className = '',
  visible = true,
  interactive = false,
  pose,
  onPoseChange,
  onStatusChange,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef<CameraPose>(clonePose(pose ?? GRID_POSE));
  const invalidateRef = useRef<() => void>(() => undefined);
  const poseChangeRef = useRef(onPoseChange);
  poseChangeRef.current = onPoseChange;

  /* A restored pose arrives after mount (localStorage read in the parent), and
     the pose lives in a ref so orbiting never re-renders React. */
  useEffect(() => {
    poseRef.current = clonePose(pose ?? GRID_POSE);
    invalidateRef.current();
  }, [pose, asset.key]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !interactive) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      el.setPointerCapture?.(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const next = poseRef.current;
      next.azimuth -= (event.clientX - lastX) * 0.0085;
      // Never quite reach a pole: `lookAt` has no up vector to work with there
      // and the model snaps through 180 degrees.
      next.polar = clamp(next.polar - (event.clientY - lastY) * 0.0085, 0.14, Math.PI - 0.14);
      lastX = event.clientX;
      lastY = event.clientY;
      invalidateRef.current();
    };
    const onUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      el.releasePointerCapture?.(event.pointerId);
      poseChangeRef.current?.(clonePose(poseRef.current));
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = poseRef.current;
      next.zoom = clamp(next.zoom * Math.exp(event.deltaY * 0.0012), 0.4, 2.6);
      invalidateRef.current();
      poseChangeRef.current?.(clonePose(next));
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [interactive]);

  const handleStatus = useCallback(
    (status: StageStatus) => onStatusChange?.(status),
    [onStatusChange]
  );

  return (
    <div
      ref={wrapRef}
      className={`${className} ${interactive ? 'cursor-grab active:cursor-grabbing touch-none' : ''}`}
    >
      <View className="h-full w-full" visible={visible}>
        <ReviewStage
          asset={asset}
          diagnostics={diagnostics}
          spin={spin}
          poseRef={poseRef}
          invalidateRef={invalidateRef}
          onStatus={handleStatus}
        />
      </View>
    </div>
  );
};

export default TurntableView;
