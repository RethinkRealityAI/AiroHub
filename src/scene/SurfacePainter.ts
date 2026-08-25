/**
 * SurfacePainter — turns aim movement into paint stamps.
 *
 * The core correctness rule: **all path logic happens in screen space, and all
 * paint lands via raycasts.** A stroke is resampled along the screen-space
 * segment between the previous and current aim point; each sample fires rays
 * and deposits stamps at each ray's own hit UV.
 *
 * Both tools are built from *small* ray-anchored dabs — spray as a scattered
 * cone, brush as a deterministic 3-dab ribbon — because the generated models
 * are UV-atlased:
 * a single large disc stamped in texture space can cross an island boundary
 * and bleed paint onto an unrelated part of the model. Small per-ray dabs
 * cannot.
 *
 * Stamp radii scale by the hit triangle's texels-per-world-unit, so stroke
 * width is physically uniform across islands packed at different densities.
 *
 * Holding the spray in one spot builds up paint and eventually spawns **drips**
 * that run down the surface in screen space — each drip step raycasts too, so
 * runs follow the actual object.
 *
 * Raycast volume is made affordable by three-mesh-bvh (see `modelRegistry`).
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
  /** Fallback float position on the camera-facing plane when off the model. */
  planePoint: THREE.Vector3;
}

/** World-space radii the tools paint at (before the size multiplier). */
const SPRAY_WORLD_RADIUS = 0.55;
const SPRAY_DOT_WORLD_RADIUS = 0.055;
const BRUSH_WORLD_RADIUS = 0.17;
const BRUSH_DAB_WORLD_RADIUS = 0.075;

/** Screen-space resampling step along the stroke path, in pixels. */
const PATH_STEP_PX = 4;
/** Hard cap on path samples per frame so a teleporting cursor can't stall. */
const MAX_STEPS_PER_FRAME = 36;
/** Rays per spray path sample; the brush uses a fixed 3-dab ribbon instead. */
const SPRAY_RAYS_PER_STEP = 14;

/** Drip tuning. */
const DRIP_HOLD_BEFORE_MS = 420;
const DRIP_MAX_ACTIVE = 5;
const DRIP_SPAWN_PER_SECOND = 2.6;

const CANVAS_RES = 2048;

interface Drip {
  ndcX: number;
  ndcY: number;
  /** Screen px per second, downward. */
  speed: number;
  /** Remaining travel in screen px. */
  remaining: number;
  /** Width factor relative to a spray dot. */
  thickness: number;
}

export class SurfacePainter {
  private raycaster = new THREE.Raycaster();
  private lastNdc: THREE.Vector2 | null = null;
  private config: PainterStrokeConfig = { tool: 'spray', size: 1 };
  private active = false;

  private drips: Drip[] = [];
  private holdMs = 0;
  private dripDebt = 0;

  /** texels-per-world-unit cache, keyed per geometry face. */
  private texelScaleCache = new Map<string, number>();

  // Scratch objects — this runs every frame, allocations are not welcome.
  private scratch = {
    ndc: new THREE.Vector2(),
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
    plane: new THREE.Plane(),
    planePoint: new THREE.Vector3(),
    camDir: new THREE.Vector3(),
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
    this.holdMs = 0;
  }

  end() {
    this.active = false;
    this.lastNdc = null;
    this.holdMs = 0;
    // Drips are part of the stroke; what they already painted stays.
    this.drips = [];
    this.dripDebt = 0;
  }

  get isActive() {
    return this.active;
  }

  /** Clears cached texel densities — call when the target object changes. */
  invalidate() {
    this.texelScaleCache.clear();
    this.drips = [];
  }

  /**
   * Advances the stroke to a new aim point (NDC, -1..1) and returns the stamps
   * this movement deposited. Call once per frame — also with `paint=false`,
   * which still probes the surface for tool placement and lets active drips
   * keep running.
   */
  frame(ndcX: number, ndcY: number, paint: boolean, deltaSeconds = 1 / 60): PainterFrameResult {
    const stamps: PaintStamp[] = [];
    const central = this.castCentral(ndcX, ndcY);
    const planePoint = this.floatOnPlane(ndcX, ndcY);

    // Drips outlive the movement that spawned them.
    this.updateDrips(deltaSeconds, stamps);

    if (!paint || !this.active) {
      this.lastNdc = null;
      return { stamps, hit: central, planePoint };
    }

    const viewportH = Math.max(this.getViewportHeight(), 1);
    const stepNdcSize = (PATH_STEP_PX / viewportH) * 2;

    if (!this.lastNdc) {
      this.lastNdc = new THREE.Vector2(ndcX, ndcY);
      this.depositAt(ndcX, ndcY, stamps, 0, 0);
      return { stamps, hit: central, planePoint };
    }

    const from = this.lastNdc;
    const dx = ndcX - from.x;
    const dy = ndcY - from.y;
    const distance = Math.hypot(dx, dy);

    if (distance < stepNdcSize * 0.4) {
      // Held still: aerosol keeps depositing, builds up, and starts to run.
      if (this.config.tool === 'spray') {
        this.depositAt(ndcX, ndcY, stamps, 0, 0);
        this.holdMs += deltaSeconds * 1000;
        this.maybeSpawnDrips(ndcX, ndcY, deltaSeconds);
      }
      return { stamps, hit: central, planePoint };
    }

    this.holdMs = 0;
    const dirX = dx / distance;
    const dirY = dy / distance;
    const steps = Math.min(Math.ceil(distance / stepNdcSize), MAX_STEPS_PER_FRAME);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.depositAt(from.x + dx * t, from.y + dy * t, stamps, dirX, dirY);
    }
    this.lastNdc.set(ndcX, ndcY);
    return { stamps, hit: central, planePoint };
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
      scratch.toCamera.copy(this.getCamera().position).sub(hit.point).normalize();
      if (scratch.hitNormal.dot(scratch.toCamera) < 0) scratch.hitNormal.negate();
    }
    if (hit.uv) scratch.hitUv.copy(hit.uv);
    return { point: scratch.hitPoint, normal: scratch.hitNormal, uv: scratch.hitUv };
  }

  /** Where the tool floats when aiming past the model: the plane through the
   *  origin facing the camera, so it slides smoothly instead of jumping. */
  private floatOnPlane(ndcX: number, ndcY: number): THREE.Vector3 {
    const { scratch } = this;
    const camera = this.getCamera();
    this.scratch.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.scratch.ndc, camera);
    scratch.camDir.copy(camera.position).normalize();
    scratch.plane.setFromNormalAndCoplanarPoint(scratch.camDir, ZERO);
    if (!this.raycaster.ray.intersectPlane(scratch.plane, scratch.planePoint)) {
      scratch.planePoint.set(0, 0, 0);
    }
    return scratch.planePoint;
  }

  private cast(ndcX: number, ndcY: number): THREE.Intersection | null {
    const meshes = this.getMeshes();
    if (meshes.length === 0) return null;
    this.scratch.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.scratch.ndc, this.getCamera());
    const hits = this.raycaster.intersectObjects(meshes, true);
    return hits.length > 0 ? hits[0] : null;
  }

  /** Screen px covered by one world unit at the given camera distance. */
  private pxPerWorldUnit(distance: number): number {
    const camera = this.getCamera() as THREE.PerspectiveCamera;
    const viewportH = Math.max(this.getViewportHeight(), 1);
    if (!camera.isPerspectiveCamera) return 50;
    return viewportH / (2 * Math.max(distance, 0.01) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  /**
   * Deposits one path sample: a solid brush ribbon segment, or a burst of
   * spray grains. `dirX/dirY` is the stroke's screen direction (NDC,
   * normalised) — zero for a stationary tap.
   */
  private depositAt(ndcX: number, ndcY: number, out: PaintStamp[], dirX: number, dirY: number) {
    const { tool, size } = this.config;
    const camera = this.getCamera() as THREE.PerspectiveCamera;
    const viewportH = Math.max(this.getViewportHeight(), 1);

    const central = this.cast(ndcX, ndcY);
    if (!central || !central.uv) return;

    const fovScale = this.pxPerWorldUnit(central.distance || 10);
    const aspect = (camera as any).aspect || 1;

    if (tool === 'brush') {
      // A brush lays a *continuous ribbon*: one full-width dab on the path
      // centre plus two half-offset dabs across the stroke, all fully
      // deterministic — per-dab jitter is what used to read as spray blotches.
      // Each dab is still anchored to its own raycast hit, so the ribbon can
      // never bleed across a UV island edge the way one large disc could.
      const dab = (x: number, y: number, dabWorldRadius: number) => {
        const hit = x === ndcX && y === ndcY ? central : this.cast(x, y);
        if (!hit || !hit.uv) return;
        const scale = this.texelsPerWorldUnit(hit);
        const r = THREE.MathUtils.clamp(dabWorldRadius * size * scale, 1, 30);
        out.push({ u: hit.uv.x, v: hit.uv.y, r, o: 0.95 });
      };

      dab(ndcX, ndcY, BRUSH_DAB_WORLD_RADIUS * 1.35);

      // Side dabs sit perpendicular to the stroke in *pixel* space (NDC is
      // aspect-squashed); a stationary tap just uses a horizontal pair.
      let tx = dirX * aspect;
      let ty = dirY;
      const tLen = Math.hypot(tx, ty);
      let perpX = 1;
      let perpY = 0;
      if (tLen > 1e-6) {
        perpX = -ty / tLen;
        perpY = tx / tLen;
      }
      const offsetPx = 0.5 * BRUSH_WORLD_RADIUS * size * fovScale;
      const offsetNdcX = (perpX * offsetPx * 2) / (viewportH * aspect);
      const offsetNdcY = (perpY * offsetPx * 2) / viewportH;
      dab(ndcX + offsetNdcX, ndcY + offsetNdcY, BRUSH_DAB_WORLD_RADIUS * 1.1);
      dab(ndcX - offsetNdcX, ndcY - offsetNdcY, BRUSH_DAB_WORLD_RADIUS * 1.1);
      return;
    }

    // Spray: a scattered cone of grains, dense in the middle, wispy outside.
    const screenRadiusPx = SPRAY_WORLD_RADIUS * size * fovScale;
    const ndcRadiusY = (screenRadiusPx / viewportH) * 2;
    const ndcRadiusX = ndcRadiusY / aspect;

    for (let i = 0; i < SPRAY_RAYS_PER_STEP; i++) {
      const angle = Math.random() * Math.PI * 2;
      const rand = i === 0 ? 0 : Math.pow(Math.random(), 1.6);
      const hit =
        i === 0
          ? central
          : this.cast(ndcX + Math.cos(angle) * rand * ndcRadiusX, ndcY + Math.sin(angle) * rand * ndcRadiusY);
      if (!hit || !hit.uv) continue;

      const scale = this.texelsPerWorldUnit(hit);
      const r = THREE.MathUtils.clamp(
        SPRAY_DOT_WORLD_RADIUS * size * scale * (0.7 + Math.random() * 0.8),
        0.8,
        9
      );
      out.push({ u: hit.uv.x, v: hit.uv.y, r, o: (1 - rand * 0.55) * (0.32 + Math.random() * 0.3) });
    }
  }

  /* ------------------------------- drips ------------------------------- */

  private maybeSpawnDrips(ndcX: number, ndcY: number, deltaSeconds: number) {
    if (this.holdMs < DRIP_HOLD_BEFORE_MS || this.drips.length >= DRIP_MAX_ACTIVE) return;
    this.dripDebt += DRIP_SPAWN_PER_SECOND * deltaSeconds;
    while (this.dripDebt >= 1 && this.drips.length < DRIP_MAX_ACTIVE) {
      this.dripDebt -= 1;
      const viewportH = Math.max(this.getViewportHeight(), 1);
      const jitter = ((Math.random() - 0.5) * 26) / viewportH;
      this.drips.push({
        ndcX: ndcX + jitter,
        ndcY,
        speed: 55 + Math.random() * 90,
        remaining: 40 + Math.random() * 130,
        thickness: 0.7 + Math.random() * 0.7,
      });
    }
  }

  private updateDrips(deltaSeconds: number, out: PaintStamp[]) {
    if (this.drips.length === 0) return;
    const viewportH = Math.max(this.getViewportHeight(), 1);

    for (const drip of this.drips) {
      let travel = drip.speed * deltaSeconds;
      travel = Math.min(travel, drip.remaining);
      // March in ~2px steps so the run is continuous, raycasting each step —
      // gravity is screen-down, but the paint still lands on the real surface.
      while (travel > 0 && drip.remaining > 0) {
        const step = Math.min(2, travel);
        drip.ndcY -= (step / viewportH) * 2;
        travel -= step;
        drip.remaining -= step;

        const hit = this.cast(drip.ndcX, drip.ndcY);
        if (!hit || !hit.uv) {
          drip.remaining = 0;
          break;
        }
        const scale = this.texelsPerWorldUnit(hit);
        // Taper as the drip runs out.
        const taper = 0.45 + 0.55 * Math.min(drip.remaining / 60, 1);
        const r = THREE.MathUtils.clamp(
          SPRAY_DOT_WORLD_RADIUS * this.config.size * drip.thickness * taper * scale,
          0.7,
          6
        );
        out.push({ u: hit.uv.x, v: hit.uv.y, r, o: 0.55 + Math.random() * 0.25 });
      }
    }
    this.drips = this.drips.filter((d) => d.remaining > 0);
  }

  /* ------------------------------------------------------------------ */

  /**
   * Texture pixels per world unit at the hit triangle — the ratio of the
   * triangle's UV-space area (in pixels) to its world-space area. This keeps
   * stroke width physically uniform across islands packed at different
   * densities.
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

    const worldArea = b.sub(a).cross(c.sub(a)).length() / 2;
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

const ZERO = new THREE.Vector3(0, 0, 0);
