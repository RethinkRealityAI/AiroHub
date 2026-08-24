/**
 * SurfacePainter — turns aim movement into paint stamps.
 *
 * The core correctness rule: **all path logic happens in screen space, and all
 * paint lands via raycasts.** A stroke is resampled along the screen-space
 * segment between the previous and current aim point; each sample fires a ray
 * and deposits a stamp at the UV of *that ray's own hit*. Spray additionally
 * scatters jittered rays inside the spray cone around each sample and drops a
 * grain dot per hit.
 *
 * Two properties fall out of this design, and both were broken before:
 *
 *  1. **No UV-seam smearing.** Atlased models map neighbouring surface points
 *     to distant UV islands. Because every stamp is anchored to a real ray
 *     hit and stays tiny, paint can never bleed across island boundaries or
 *     streak across the atlas — a stroke over a seam stays a stroke.
 *
 *  2. **Uniform physical stroke width.** UV islands pack at wildly different
 *     texel densities, so a fixed pixel radius paints fat on one part of a
 *     model and thin on another. Each stamp's pixel radius is derived from
 *     the hit triangle's own texels-per-world-unit, so a 6&nbsp;cm spray line is
 *     6&nbsp;cm everywhere on the object.
 *
 * Raycast volume (path samples × cone rays) is made affordable by three-mesh-bvh,
 * installed globally in `modelRegistry`.
 */
import * as THREE from 'three';
import { PaintStamp } from '../paint/stamps';

export interface PainterStrokeConfig {
  tool: 'spray' | 'brush';
  /** Tool size multiplier, 0.4..2. */
  size: number;
}

export interface PainterFrameResult {
  stamps: PaintStamp[];
  /** Latest central hit, for tool placement; null when aiming off the model. */
  hit: {
    point: THREE.Vector3;
    normal: THREE.Vector3;
    uv: THREE.Vector2;
  } | null;
}

/** World-space radii the tools paint at (before the size multiplier). */
const SPRAY_WORLD_RADIUS = 0.55;
const SPRAY_DOT_WORLD_RADIUS = 0.055;
const BRUSH_WORLD_RADIUS = 0.17;

/** Screen-space resampling step along the stroke path, in pixels. */
const PATH_STEP_PX = 5;
/** Hard cap on path samples per frame so a teleporting cursor can't stall. */
const MAX_STEPS_PER_FRAME = 36;
/** Cone rays per spray path sample. */
const SPRAY_RAYS_PER_STEP = 14;

const CANVAS_RES = 2048;

export class SurfacePainter {
  private raycaster = new THREE.Raycaster();
  private lastNdc: THREE.Vector2 | null = null;
  private config: PainterStrokeConfig = { tool: 'spray', size: 1 };
  private active = false;

  /** texels-per-world-unit cache, keyed per geometry face. */
  private texelScaleCache = new Map<string, number>();

  // Scratch objects — this runs every frame, allocations are not welcome.
  private scratch = {
    ndc: new THREE.Vector2(),
    stepNdc: new THREE.Vector2(),
    hitPoint: new THREE.Vector3(),
    hitNormal: new THREE.Vector3(),
    hitUv: new THREE.Vector2(),
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    c: new THREE.Vector3(),
    uvA: new THREE.Vector2(),
    uvB: new THREE.Vector2(),
    uvC: new THREE.Vector2(),
    toCamera: new THREE.Vector3(),
  };

  constructor(
    private getMeshes: () => THREE.Object3D[],
    private getCamera: () => THREE.Camera,
    /** Viewport height in CSS pixels, used to convert px steps to NDC. */
    private getViewportHeight: () => number
  ) {
    // With BVH installed, first-hit-only raycasts skip full traversal.
    (this.raycaster as any).firstHitOnly = true;
  }

  begin(config: PainterStrokeConfig) {
    this.config = config;
    this.active = true;
    this.lastNdc = null;
  }

  end() {
    this.active = false;
    this.lastNdc = null;
  }

  get isActive() {
    return this.active;
  }

  /** Clears cached texel densities — call when the target object changes. */
  invalidate() {
    this.texelScaleCache.clear();
  }

  /**
   * Advances the stroke to a new aim point (NDC, -1..1) and returns the stamps
   * this movement deposited. Call once per frame while the stroke is active;
   * also callable with `paint=false` just to probe the surface for tool
   * placement.
   */
  frame(ndcX: number, ndcY: number, paint: boolean): PainterFrameResult {
    const stamps: PaintStamp[] = [];
    const central = this.castCentral(ndcX, ndcY);

    if (!paint || !this.active) {
      this.lastNdc = null;
      return { stamps, hit: central };
    }

    const viewportH = Math.max(this.getViewportHeight(), 1);
    const stepNdcSize = (PATH_STEP_PX / viewportH) * 2;

    if (!this.lastNdc) {
      this.lastNdc = new THREE.Vector2(ndcX, ndcY);
      this.depositAt(ndcX, ndcY, stamps);
      return { stamps, hit: central };
    }

    const from = this.lastNdc;
    const dx = ndcX - from.x;
    const dy = ndcY - from.y;
    const distance = Math.hypot(dx, dy);

    if (distance < stepNdcSize * 0.4) {
      // Holding still: real aerosol keeps building up paint.
      if (this.config.tool === 'spray') this.depositAt(ndcX, ndcY, stamps);
      return { stamps, hit: central };
    }

    const steps = Math.min(Math.ceil(distance / stepNdcSize), MAX_STEPS_PER_FRAME);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.depositAt(from.x + dx * t, from.y + dy * t, stamps);
    }
    this.lastNdc.set(ndcX, ndcY);
    return { stamps, hit: central };
  }

  /* ------------------------------------------------------------------ */

  private castCentral(ndcX: number, ndcY: number): PainterFrameResult['hit'] {
    const hit = this.cast(ndcX, ndcY);
    if (!hit) return null;
    const { scratch } = this;
    scratch.hitPoint.copy(hit.point);
    scratch.hitNormal.set(0, 0, 1);
    if (hit.face) {
      scratch.hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
      // Flip back-facing normals so tools never sink into the mesh.
      scratch.toCamera.copy((this.getCamera() as THREE.Camera).position).sub(hit.point).normalize();
      if (scratch.hitNormal.dot(scratch.toCamera) < 0) scratch.hitNormal.negate();
    }
    if (hit.uv) scratch.hitUv.copy(hit.uv);
    return {
      point: scratch.hitPoint,
      normal: scratch.hitNormal,
      uv: scratch.hitUv,
    };
  }

  private cast(ndcX: number, ndcY: number): THREE.Intersection | null {
    const meshes = this.getMeshes();
    if (meshes.length === 0) return null;
    this.scratch.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.scratch.ndc, this.getCamera());
    const hits = this.raycaster.intersectObjects(meshes, true);
    return hits.length > 0 ? hits[0] : null;
  }

  /** Deposits one path sample: brush dab, or a burst of spray grains. */
  private depositAt(ndcX: number, ndcY: number, out: PaintStamp[]) {
    const { tool, size } = this.config;
    const camera = this.getCamera() as THREE.PerspectiveCamera;
    const viewportH = Math.max(this.getViewportHeight(), 1);

    const central = this.cast(ndcX, ndcY);
    if (!central || !central.uv) return;

    if (tool === 'brush') {
      const scale = this.texelsPerWorldUnit(central);
      const r = THREE.MathUtils.clamp(BRUSH_WORLD_RADIUS * size * scale, 2, 70);
      out.push({ u: central.uv.x, v: central.uv.y, r, o: 0.85 });
      return;
    }

    // Spray: scatter rays inside the cone's screen-space footprint. The cone
    // radius is a world-space size at the hit distance, converted to NDC.
    const worldRadius = SPRAY_WORLD_RADIUS * size;
    const distance = central.distance || 10;
    const fovScale =
      camera.isPerspectiveCamera
        ? viewportH / (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
        : 50;
    const screenRadiusPx = worldRadius * fovScale;
    const ndcRadiusX = ((screenRadiusPx / viewportH) * 2) / (camera as any).aspect || 0.02;
    const ndcRadiusY = (screenRadiusPx / viewportH) * 2;

    for (let i = 0; i < SPRAY_RAYS_PER_STEP; i++) {
      const angle = Math.random() * Math.PI * 2;
      // pow-biased toward the centre — matches a real can's density falloff.
      const rand = Math.pow(Math.random(), 1.6);
      const jx = Math.cos(angle) * rand * ndcRadiusX;
      const jy = Math.sin(angle) * rand * ndcRadiusY;

      const hit = i === 0 ? central : this.cast(ndcX + jx, ndcY + jy);
      if (!hit || !hit.uv) continue;

      const scale = this.texelsPerWorldUnit(hit);
      const dotR = THREE.MathUtils.clamp(
        SPRAY_DOT_WORLD_RADIUS * size * scale * (0.7 + Math.random() * 0.9),
        0.8,
        9
      );
      out.push({
        u: hit.uv.x,
        v: hit.uv.y,
        r: dotR,
        // Denser core, lighter overspray at the rim.
        o: (1 - rand * 0.55) * (0.32 + Math.random() * 0.3),
      });
    }
  }

  /**
   * Texture pixels per world unit at the hit triangle — the ratio of the
   * triangle's UV-space area (in pixels) to its world-space area. This is
   * what keeps stroke width physically uniform across islands packed at
   * different densities.
   */
  private texelsPerWorldUnit(hit: THREE.Intersection): number {
    const mesh = hit.object as THREE.Mesh;
    const face = hit.face;
    if (!face || !mesh.geometry) return 60;

    const key = `${mesh.uuid}:${face.a}`;
    const cached = this.texelScaleCache.get(key);
    if (cached !== undefined) return cached;

    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.getAttribute('position');
    const uv = geom.getAttribute('uv');
    if (!pos || !uv) return 60;

    const { a, b, c, uvA, uvB, uvC } = this.scratch;
    a.fromBufferAttribute(pos, face.a).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, face.b).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, face.c).applyMatrix4(mesh.matrixWorld);
    uvA.fromBufferAttribute(uv as THREE.BufferAttribute, face.a);
    uvB.fromBufferAttribute(uv as THREE.BufferAttribute, face.b);
    uvC.fromBufferAttribute(uv as THREE.BufferAttribute, face.c);

    const worldArea =
      b.sub(a).cross(c.sub(a)).length() / 2;
    const uvArea =
      Math.abs((uvB.x - uvA.x) * (uvC.y - uvA.y) - (uvC.x - uvA.x) * (uvB.y - uvA.y)) / 2;

    let scale = 60;
    if (worldArea > 1e-10 && uvArea > 1e-12) {
      scale = Math.sqrt((uvArea * CANVAS_RES * CANVAS_RES) / worldArea);
    }
    scale = THREE.MathUtils.clamp(scale, 4, 600);

    if (this.texelScaleCache.size > 20000) this.texelScaleCache.clear();
    this.texelScaleCache.set(key, scale);
    return scale;
  }
}
