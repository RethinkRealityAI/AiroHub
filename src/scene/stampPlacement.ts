/**
 * Where a tap lands on the painted object.
 *
 * Stamp mode needs one raycast per tap, not the continuous stroke machinery in
 * `SurfacePainter`. It also needs to work from `CanvasView`, which sits outside
 * the scene and therefore has no access to `PaintTarget`'s mesh registry.
 *
 * Rather than thread a registry out of the scene, the paintable meshes are
 * recognised by the fingerprint `paintMaterial` already stamps on every
 * material it patches: a `customProgramCacheKey` of `airo-paintable-v1`. That
 * marks exactly the meshes the shared paint texture is composited onto — the
 * model and nothing else, so the ray cannot catch a player's floating spray
 * can, the spray mist, or the contact shadow plane.
 */
import * as THREE from 'three';

/** Set by `makePaintable`; see `src/paint/paintMaterial.ts`. */
const PAINT_PROGRAM_KEY = 'airo-paintable-v1';

function isPaintable(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    if (!material) continue;
    try {
      if (material.customProgramCacheKey?.() === PAINT_PROGRAM_KEY) return true;
    } catch {
      /* a material whose cache key throws is not ours */
    }
  }
  return false;
}

/** Every mesh under `root` that the shared paint layer is composited onto. */
export function collectPaintableMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.visible && isPaintable(mesh)) meshes.push(mesh);
  });
  return meshes;
}

const raycaster = new THREE.Raycaster();
(raycaster as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
const ndc = new THREE.Vector2();

/**
 * Casts a screen-space point (NDC, -1..1) at the object and returns the UV it
 * hit, or null when the tap missed the model or landed on geometry with no UVs.
 */
export function pickSurfaceUV(
  root: THREE.Object3D,
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number
): { u: number; v: number } | null {
  const meshes = collectPaintableMeshes(root);
  if (meshes.length === 0) return null;
  ndc.set(ndcX, ndcY);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(meshes, false);
  for (const hit of hits) {
    if (hit.uv) return { u: hit.uv.x, v: hit.uv.y };
  }
  return null;
}

/** Converts a client-space pointer position on `canvas` into NDC. */
export function pointerToNdc(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  };
}
