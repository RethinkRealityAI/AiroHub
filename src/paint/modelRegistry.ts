/**
 * Loads, normalises and caches the generated GLB models.
 *
 * Assets are meshopt-compressed and fetched on demand — sixteen models is a few
 * megabytes in total, but there is no reason to pay for all of them when a
 * session usually touches two or three.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Spray painting fires dozens of rays per frame (path samples x cone rays).
// A linear triangle scan per ray would melt the frame budget on 20k-triangle
// models, so every loaded geometry gets a BVH and raycasts go through it.
// The lib's bundled module augmentation lags its own export types, hence the
// casts; runtime behaviour is the documented prototype patch.
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;
import { TargetObjectType } from '../types';
import { OBJECT_BY_ID } from './objectCatalog';
import { makeGroupPaintable, PaintUniforms, setPrimerMix } from './paintMaterial';

export interface LoadedModel {
  id: string;
  root: THREE.Group;
  paintBlocks: PaintUniforms[];
  /** Half-extent of the normalised model, for camera framing. */
  radius: number;
  /** World-space vertical centre after grounding. */
  center: THREE.Vector3;
}

let loader: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

const cache = new Map<string, Promise<LoadedModel>>();

export function modelUrl(id: string): string {
  return `${import.meta.env.BASE_URL || '/'}models/${id}.glb`.replace(/\/{2,}/g, '/');
}

/**
 * Centres a model on the origin and scales it so its longest axis matches
 * `targetSize`. Meshy returns assets in arbitrary units and orientations, so
 * normalising here keeps camera framing, tool hover distances and spray cone
 * geometry consistent across every object.
 */
/** Builds BVHs for every mesh under `root` so painting raycasts stay cheap. */
export function buildRaycastAcceleration(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && !(mesh.geometry as any).boundsTree) {
      (mesh.geometry as any).computeBoundsTree({ maxLeafTris: 24 });
    }
  });
}

function normalise(root: THREE.Object3D, targetSize: number): { radius: number; center: THREE.Vector3 } {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
  const scale = targetSize / maxDim;

  root.scale.setScalar(scale);
  root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  root.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(root);
  return {
    radius: scaled.getSize(new THREE.Vector3()).length() / 2,
    center: scaled.getCenter(new THREE.Vector3()),
  };
}

/**
 * Loads a catalog model. Repeat calls share one in-flight request, and the
 * resolved model is reused rather than re-parsed.
 */
export function loadModel(
  id: TargetObjectType | string,
  paintTexture: THREE.Texture | null,
  targetSizeOverride?: number
): Promise<LoadedModel> {
  const cached = cache.get(id);
  if (cached) {
    // Re-point the paint sampler in case a new surface was created.
    void cached.then((m) => makeGroupPaintable(m.root, paintTexture));
    return cached;
  }

  const targetSize =
    targetSizeOverride ?? OBJECT_BY_ID.get(id as TargetObjectType)?.targetSize ?? 11;

  const promise = new Promise<LoadedModel>((resolve, reject) => {
    getLoader().load(
      modelUrl(id),
      (gltf) => {
        const root = new THREE.Group();
        root.name = `airo-model-${id}`;

        const inner = gltf.scene;
        const { radius, center } = normalise(inner, targetSize);
        root.add(inner);

        const yaw = OBJECT_BY_ID.get(id as TargetObjectType)?.yaw;
        if (yaw) root.rotation.y = yaw;

        const paintBlocks = makeGroupPaintable(root, paintTexture);
        buildRaycastAcceleration(root);
        resolve({ id, root, paintBlocks, radius, center });
      },
      undefined,
      (err) => {
        cache.delete(id);
        reject(err);
      }
    );
  });

  cache.set(id, promise);
  return promise;
}

/** Warms the cache for models the player is likely to reach for next. */
export function prefetchModels(ids: string[], paintTexture: THREE.Texture | null) {
  for (const id of ids) {
    if (!cache.has(id)) void loadModel(id, paintTexture).catch(() => undefined);
  }
}

export { setPrimerMix };
