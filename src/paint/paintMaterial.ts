/**
 * Composites the shared paint layer on top of a model's own PBR material.
 *
 * The old objects were untextured primitives, so painting could simply *replace*
 * `material.map` with the paint canvas. Meshy models arrive with real baked
 * albedo/normal/roughness maps, and throwing those away to paint would defeat
 * the point of generating them.
 *
 * Instead the paint canvas is injected as a second sampler and blended over the
 * shaded albedo in `MeshStandardMaterial`'s own fragment shader, using the
 * model's existing UV set. That gives three things at once:
 *
 *   - paint sits over the real texture, so you can tag a *textured* object
 *   - un-painted areas keep their full PBR response
 *   - a "primer" mix can wash the base towards a blank finish on demand,
 *     which is the untextured variant without needing a second asset
 *
 * Painted texels also get pushed toward a matte, non-metallic response, because
 * fresh aerosol over chrome should read as paint rather than as chrome.
 */
import * as THREE from 'three';

export interface PaintUniforms {
  paintMap: { value: THREE.Texture | null };
  primerMix: { value: number };
  primerColor: { value: THREE.Color };
  paintRoughness: { value: number };
}

/** Materials we've already patched, so re-renders don't stack injections. */
const patched = new WeakMap<THREE.Material, PaintUniforms>();

const WHITE_PIXEL = (() => {
  let tex: THREE.DataTexture | null = null;
  return () => {
    if (!tex) {
      tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
    return tex;
  };
})();

/**
 * Patches a standard material so it samples and blends the paint layer.
 * Safe to call repeatedly; returns the uniform block for later mutation.
 */
export function makePaintable(
  material: THREE.Material,
  paintTexture: THREE.Texture | null
): PaintUniforms | null {
  if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return null;
  const std = material as THREE.MeshStandardMaterial;

  const existing = patched.get(std);
  if (existing) {
    existing.paintMap.value = paintTexture;
    return existing;
  }

  // `vMapUv` only exists when the material actually declares a base map, so
  // give untextured materials a 1x1 white one to guarantee the varying.
  if (!std.map) {
    std.map = WHITE_PIXEL();
  }

  const uniforms: PaintUniforms = {
    paintMap: { value: paintTexture },
    primerMix: { value: 0 },
    primerColor: { value: new THREE.Color('#e9e7e2') },
    paintRoughness: { value: 0.68 },
  };

  std.onBeforeCompile = (shader) => {
    shader.uniforms.paintMap = uniforms.paintMap;
    shader.uniforms.primerMix = uniforms.primerMix;
    shader.uniforms.primerColor = uniforms.primerColor;
    shader.uniforms.paintRoughness = uniforms.paintRoughness;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform sampler2D paintMap;
        uniform float primerMix;
        uniform vec3 primerColor;
        uniform float paintRoughness;
        float airoPaintAlpha = 0.0;
        `
      )
      // Blend right after the base albedo is resolved, so paint covers the
      // model's own texture but still receives full lighting below.
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        vec4 airoPaint = texture2D( paintMap, vMapUv );
        airoPaintAlpha = airoPaint.a;
        diffuseColor.rgb = mix( diffuseColor.rgb, primerColor, primerMix );
        diffuseColor.rgb = mix( diffuseColor.rgb, airoPaint.rgb, airoPaintAlpha );
        `
      )
      // Paint is matte and dielectric regardless of what it covers.
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, paintRoughness, airoPaintAlpha );
        `
      )
      .replace(
        '#include <metalnessmap_fragment>',
        /* glsl */ `
        #include <metalnessmap_fragment>
        metalnessFactor = mix( metalnessFactor, 0.0, airoPaintAlpha );
        `
      );
  };

  // Forces three.js to recompile the program with the injected chunks.
  std.customProgramCacheKey = () => 'airo-paintable-v1';
  std.needsUpdate = true;

  patched.set(std, uniforms);
  return uniforms;
}

/**
 * Walks a loaded model and makes every mesh paintable.
 * @returns the uniform blocks, so finish/primer can be toggled for the object.
 */
export function makeGroupPaintable(
  root: THREE.Object3D,
  paintTexture: THREE.Texture | null
): PaintUniforms[] {
  const blocks: PaintUniforms[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      const block = makePaintable(mat, paintTexture);
      if (block) blocks.push(block);
    }
  });
  return blocks;
}

/** 0 = keep the model's own texture, 1 = flat primer ready for fresh paint. */
export function setPrimerMix(blocks: PaintUniforms[], amount: number) {
  for (const block of blocks) block.primerMix.value = THREE.MathUtils.clamp(amount, 0, 1);
}
