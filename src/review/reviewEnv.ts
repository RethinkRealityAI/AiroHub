/**
 * Lighting environments for the review stage — imperative, no R3F.
 *
 * `StudioEnvironment.tsx` is a component and can only be used inside a fiber
 * tree. This module is plain three.js on purpose: it is what the gallery uses,
 * and it is also the seed for a tool-agnostic scene fixture (`three:` visual
 * checks render a scene from source, with no React renderer in the picture).
 * Nothing here imports `@react-three/*`; keep it that way.
 *
 * **`neutral` is the default, and that is a review decision.** The studio's
 * lighting is designed to flatter: warm key, cool fill, two brand-coloured rim
 * accents. Those rims paint an orange edge on anything, which is exactly how a
 * muddy normal map or a seam down the back of a model gets waved through. A
 * plain RoomEnvironment judges the asset instead of judging our lighting.
 * `studio` is there to answer the second question — "and how will it look in a
 * room?" — not to be the one you review under.
 *
 * Both environments are built once per renderer-lifetime and cached: PMREM is
 * a render-to-target chain, and rebuilding it per card would cost more than
 * every model in the grid put together.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type ReviewEnvKind = 'neutral' | 'studio';

export const REVIEW_ENV_KINDS: ReviewEnvKind[] = ['neutral', 'studio'];

/** How hard each environment drives `scene.environmentIntensity`. */
export const REVIEW_ENV_INTENSITY: Record<ReviewEnvKind, number> = {
  // RoomEnvironment is bright by construction; hold it back so mid greys read
  // as mid greys rather than blowing out.
  neutral: 0.85,
  // Mirrors the intensity `GuideStage` and the studio pass to StudioEnvironment.
  studio: 0.62,
};

interface Lightform {
  form: 'rect' | 'circle';
  intensity: number;
  color: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale: [number, number];
}

/**
 * The exact layout of `src/scene/StudioEnvironment.tsx`, transcribed.
 *
 * drei's `<Lightformer>` is a plane (or circle) with an unlit material whose
 * colour is the accent scaled by `intensity`, which is what these are — if the
 * component's layout changes, change these numbers with it, because the whole
 * point of the `studio` option is that it is the same light the studio uses.
 */
const STUDIO_LIGHTFORMS: Lightform[] = [
  // Warm key softbox, camera-left and high.
  { form: 'rect', intensity: 5, color: '#fff4e8', position: [-6, 6, 8], rotation: [0, Math.PI / 5, 0], scale: [10, 10] },
  // Cool fill from the opposite side.
  { form: 'rect', intensity: 2.4, color: '#cfe6ff', position: [8, 3, 6], rotation: [0, -Math.PI / 4, 0], scale: [8, 8] },
  // Overhead strip.
  { form: 'rect', intensity: 3.2, color: '#ffffff', position: [0, 10, 0], rotation: [Math.PI / 2, 0, 0], scale: [14, 5] },
  // Low bounce standing in for a floor.
  { form: 'rect', intensity: 1.1, color: '#3a3a48', position: [0, -7, 2], rotation: [-Math.PI / 2, 0, 0], scale: [16, 12] },
  // Brand rim accents — the flattering pair the neutral environment omits.
  { form: 'circle', intensity: 2.2, color: '#ff7a4a', position: [-9, -1, -7], scale: [4, 4] },
  { form: 'circle', intensity: 1.8, color: '#4ac8ff', position: [9, 1, -8], scale: [4, 4] },
];

/**
 * The studio's lighting as a scene PMREM can consume.
 *
 * Exported because a scene fixture wants the light rig without the gallery
 * around it. The caller owns the result and should `dispose()` its geometries
 * when done — `getReviewEnvironment` does exactly that.
 */
export function buildStudioEnvScene(): THREE.Scene {
  const scene = new THREE.Scene();
  for (const form of STUDIO_LIGHTFORMS) {
    const geometry =
      form.form === 'circle'
        ? new THREE.CircleGeometry(0.5, 32)
        : new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      // Unlit emitters: colour times intensity is the radiance PMREM integrates.
      color: new THREE.Color(form.color).multiplyScalar(form.intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...form.position);
    if (form.rotation) mesh.rotation.set(...form.rotation);
    mesh.scale.set(form.scale[0], form.scale[1], 1);
    scene.add(mesh);
  }
  return scene;
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material?.dispose();
  });
}

/**
 * Keyed by the renderer, not just the kind. A PMREM bake is a render target on
 * one specific WebGL context; leaving `/admin/review` destroys that context,
 * and a plain per-kind cache would hand the next visit's fresh renderer a
 * texture whose backing store died with the old one — every card lit by
 * `scene.environment` alone then renders black. A WeakMap keyed by the
 * renderer makes staleness impossible by construction, and lets a torn-down
 * renderer's entries leave with it instead of pinning dead GPU handles.
 */
const cache = new WeakMap<THREE.WebGLRenderer, Map<ReviewEnvKind, THREE.WebGLRenderTarget>>();

/**
 * The cached PMREM cube-UV texture for one environment on one renderer.
 *
 * The renderer is borrowed for the bake; the returned texture outlives the
 * generator, which is disposed immediately (it holds blur materials and
 * scratch targets that nothing needs afterwards).
 */
export function getReviewEnvironment(
  renderer: THREE.WebGLRenderer,
  kind: ReviewEnvKind
): THREE.Texture {
  let perRenderer = cache.get(renderer);
  if (!perRenderer) {
    perRenderer = new Map();
    cache.set(renderer, perRenderer);
  }
  const cached = perRenderer.get(kind);
  if (cached) return cached.texture;

  const scene = kind === 'neutral' ? (new RoomEnvironment() as unknown as THREE.Scene) : buildStudioEnvScene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  // A touch of blur: a hard-edged softbox reflection reads as a bug in the
  // asset when it is really a one-texel emitter in a 256px cube.
  const target = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  disposeScene(scene);

  target.texture.name = `airo-review-env-${kind}`;
  perRenderer.set(kind, target);
  return target.texture;
}

/**
 * Drops one renderer's bakes eagerly. The WeakMap already guarantees a new
 * renderer never sees an old context's texture; this exists so the gallery can
 * release the render targets the moment its canvas unmounts instead of waiting
 * for the collector.
 */
export function disposeReviewEnvironments(renderer: THREE.WebGLRenderer) {
  const perRenderer = cache.get(renderer);
  if (!perRenderer) return;
  for (const target of perRenderer.values()) target.dispose();
  cache.delete(renderer);
}
