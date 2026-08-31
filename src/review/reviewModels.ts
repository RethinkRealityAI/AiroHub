/**
 * Loading catalog assets for review, without disturbing the studio's copies.
 *
 * Three things go wrong if this is done naively, and each has its own guard:
 *
 *  1. **A null paint sampler.** `paintMaterial.ts` injects
 *     `texture2D(paintMap, vMapUv)` into every patched material and samples it
 *     unconditionally — there is no `#ifdef` around it. Passing `null` binds
 *     unit 0 to nothing, which is undefined behaviour in WebGL: on some drivers
 *     it reads black, on others the last texture bound to that unit, and the
 *     model renders with another object's albedo smeared over it. The review
 *     stage paints nothing, so it hands over a shared 1x1 fully transparent
 *     texture instead of a surface — alpha 0 blends to a no-op, and the sampler
 *     is always valid.
 *
 *  2. **The SPA-fallback 404 trap.** `modelUrl()` falls back to
 *     `/models/<id>.glb` for any id it has no registered URL for. An upload's
 *     id is `up-<uuid>`, that path does not exist, and both the dev server and
 *     Netlify answer unknown paths with `index.html` — so GLTFLoader gets a
 *     200 full of HTML and fails on "Unexpected token '<'". `registerModelUrl`
 *     must therefore run BEFORE `loadModel`, not alongside it.
 *
 *  3. **One Object3D in two scenes.** Each drei `<View>` portals into its own
 *     `THREE.Scene`, and an Object3D has exactly one parent. Handing the cached
 *     root to a grid card and then to the detail modal would make the two views
 *     fight over it — whichever mounted last steals it and the other goes
 *     blank. Every caller gets `root.clone(true)`; geometry, materials and the
 *     BVH stay shared (so cloning is cheap and the paint uniforms still resolve
 *     to one block per material), only the node graph is new.
 */
import * as THREE from 'three';
import { loadModel, registerModelUrl } from '../paint/modelRegistry';
import type { PaintUniforms } from '../paint/paintMaterial';
import type { ReviewAsset } from './assets';

export interface ReviewModel {
  /** A private clone, safe to add to exactly one view scene. */
  root: THREE.Group;
  /** Half the bounding-box diagonal after normalisation — the framing radius. */
  radius: number;
  /**
   * Paint uniform blocks of the *shared* materials. Primer is a gallery-wide
   * toggle, so every clone of a model agreeing on it is the intent, not a leak.
   */
  paintBlocks: PaintUniforms[];
}

let blank: THREE.DataTexture | null = null;

/**
 * The 1x1 fully transparent RGBA texture every reviewed model samples as its
 * paint map. One instance for the whole gallery: it is immutable and never
 * uploaded to more than once.
 */
export function blankPaintTexture(): THREE.DataTexture {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blank.colorSpace = THREE.SRGBColorSpace;
    blank.needsUpdate = true;
    blank.name = 'airo-review-blank-paint';
  }
  return blank;
}

/**
 * Loads an asset for review and returns a clone of it.
 *
 * Shares `modelRegistry`'s cache with the studio, so a model already streamed
 * in this session is re-parsed for nobody.
 */
export async function loadForReview(asset: ReviewAsset): Promise<ReviewModel> {
  if (asset.kind === 'upload') {
    if (!asset.url) throw new Error(`Upload "${asset.key}" has no storage URL.`);
    registerModelUrl(asset.key, asset.url);
  }
  const loaded = await loadModel(asset.key, blankPaintTexture(), asset.targetSize);
  return {
    root: loaded.root.clone(true),
    radius: loaded.radius,
    paintBlocks: loaded.paintBlocks,
  };
}

/**
 * Releases a clone. Geometries, materials and textures belong to the cached
 * original and are deliberately NOT disposed — doing so would blank every
 * other card showing the same model, and the studio's copy with it.
 */
export function releaseReviewModel(model: ReviewModel | null) {
  model?.root.removeFromParent();
}
