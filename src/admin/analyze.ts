/**
 * Model analysis — parses a GLB/GLTF buffer with three's GLTFLoader (wired for
 * meshopt exactly like the runtime loader in paint/modelRegistry.ts) and
 * measures everything the health checks grade: triangle count, unique texture
 * area, estimated VRAM, UV coverage and bounds. The parsed scene is thrown
 * away immediately — every geometry, material, texture and ImageBitmap is
 * disposed before the stats are returned.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { readGltfJson } from './glb';

export interface ModelStats {
  sizeBytes: number;
  triangles: number;
  meshes: number;
  materials: number;
  /** Unique texture images referenced by materials. */
  textures: number;
  /** Sum of texture megapixels across unique images. */
  textureMP: number;
  /** Estimated GPU memory: Σ w×h×4×1.33 bytes, in MB. */
  vramMB: number;
  /** False when any renderable mesh lacks a `uv` attribute. */
  hasUVs: boolean;
  /** EXT_meshopt_compression present in extensionsUsed. */
  meshopt: boolean;
  /** Raw bounding-box extents in the file's own units. */
  dims: { x: number; y: number; z: number };
}

let loader: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

function parseAsync(buffer: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    try {
      getLoader().parse(buffer, '', resolve, (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

interface ImageLike {
  width?: number;
  height?: number;
}

function disposeGltf(gltf: GLTF, textures: Set<THREE.Texture>) {
  gltf.scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) mat?.dispose();
    }
  });
  for (const tex of textures) {
    const image = tex.image as unknown;
    tex.dispose();
    // GLTFLoader decodes embedded images to ImageBitmaps where supported;
    // dispose() does not close those, and un-closed bitmaps pin real memory.
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      try {
        image.close();
      } catch {
        // Already closed (shared between textures) — fine.
      }
    }
  }
}

/**
 * Full quality analysis of a model buffer. Rejects when the buffer is not a
 * parseable glTF asset (corrupt file, unsupported compression, external refs).
 */
export async function analyzeModel(buffer: ArrayBuffer): Promise<ModelStats> {
  const json = readGltfJson(buffer);
  const extensionsUsed: unknown = json?.extensionsUsed;
  const meshopt =
    Array.isArray(extensionsUsed) && extensionsUsed.includes('EXT_meshopt_compression');

  const gltf = await parseAsync(buffer);

  let triangles = 0;
  let meshes = 0;
  let hasUVs = true;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  gltf.scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes += 1;

    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    triangles += Math.floor((index ? index.count : position ? position.count : 0) / 3);
    if (!geometry.getAttribute('uv')) hasUVs = false;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      materials.add(mat);
      // Sweep every texture slot generically rather than hard-coding map names,
      // so KHR extension materials are covered too.
      for (const value of Object.values(mat)) {
        const tex = value as THREE.Texture | null;
        if (tex && (tex as THREE.Texture).isTexture) textures.add(tex);
      }
    }
  });

  // Multiple textures can share one decoded image; count each image once.
  const uniqueImages = new Set<unknown>();
  let pixels = 0;
  for (const tex of textures) {
    const image = tex.image as ImageLike | null | undefined;
    if (!image || uniqueImages.has(image)) continue;
    uniqueImages.add(image);
    const w = image.width ?? 0;
    const h = image.height ?? 0;
    pixels += w * h;
  }

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());

  const stats: ModelStats = {
    sizeBytes: buffer.byteLength,
    triangles,
    meshes,
    materials: materials.size,
    textures: uniqueImages.size,
    textureMP: pixels / 1_000_000,
    vramMB: (pixels * 4 * 1.33) / (1024 * 1024),
    hasUVs: meshes > 0 ? hasUVs : false,
    meshopt,
    dims: { x: size.x, y: size.y, z: size.z },
  };

  disposeGltf(gltf, textures);
  return stats;
}

/**
 * Cheap sanity re-parse used by the optimizer: resolves true only when three
 * can still load the rewritten container end to end.
 */
export async function validateModel(buffer: ArrayBuffer): Promise<boolean> {
  try {
    const gltf = await parseAsync(buffer);
    const textures = new Set<THREE.Texture>();
    gltf.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        for (const value of Object.values(mat)) {
          const tex = value as THREE.Texture | null;
          if (tex && (tex as THREE.Texture).isTexture) textures.add(tex);
        }
      }
    });
    disposeGltf(gltf, textures);
    return true;
  } catch {
    return false;
  }
}
