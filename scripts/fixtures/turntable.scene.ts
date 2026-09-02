/**
 * Turntable scene — the imperative half of the visual-QA fixture pair.
 *
 * The asset review gallery judges a model the way a paint shop does: one fixed
 * three-quarter camera, one shared turntable phase for every cell, and an
 * environment strong enough that a clearcoat actually looks like clearcoat.
 * None of that is testable through the React tree, because none of it is React
 * — it is a scene graph. So this module builds the same rig imperatively, out
 * of primitives, with no renderer of its own.
 *
 * Two rules it keeps, and why:
 *
 *  - **Synchronous.** It never awaits a GLB. An async fixture drags the whole
 *    asset pipeline (fetch, SPA-fallback 404 traps, draco, BVH) into a harness
 *    that has no dev server behind it, and then a failed fetch reads as a
 *    scene-graph bug. A primitive stand-in fails for exactly one reason: the
 *    scene is wrong. Real GLBs belong in `scripts/preview/verify-*.mjs`, which
 *    drives the actual build.
 *  - **Plain `three` only.** No harness import, no R3F, no `src/` import. This
 *    file is a scene factory; anything that can call it can use it, and
 *    `npm run lint` (`tsc --noEmit` over the whole tree) typechecks it for
 *    free. See docs/AGENT-VISUAL-QA.md.
 *
 * The return shape — `{ scene, camera }` plus optional `targets`, `seek` and
 * `dispose` — is a structural contract, not an imported one. A visual harness
 * that recognises it gets named targets and a deterministic time axis; anything
 * else can ignore the extras and just render the scene.
 */
import {
  BackSide,
  Box3,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  FloatType,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';

export interface TurntableSceneProps {
  /** Turntable phase in milliseconds. Same value in, same frame out. */
  phaseMs?: number;
  /** Milliseconds per full revolution. */
  periodMs?: number;
  /** Accent sprayed on the subject's label band — the thing under review. */
  accent?: string;
  /** Flat unlit override: shape only, no material, no lighting. */
  silhouette?: boolean;
  /** Plinth and curved cyclorama. Off leaves the subject alone in the void. */
  backdrop?: boolean;
  /** Scene background colour, or `'transparent'` for an alpha render. */
  background?: string;
  /** Multiplier on the procedural environment. */
  environmentIntensity?: number;
}

/**
 * Structural stand-in for a harness fixture context. Declared here rather than
 * imported so the module stays tool-agnostic; extra properties on the real
 * thing are ignored.
 */
export interface TurntableSceneContext {
  props?: TurntableSceneProps;
}

/** Studio default: the flame the app sprays with unless told otherwise. */
const DEFAULT_ACCENT = '#FF4D1C';
/** One revolution every six seconds, matching the gallery's attract loop. */
const DEFAULT_PERIOD_MS = 6000;

/** Equirectangular blobs standing in for a three-light softbox rig. */
const LIGHTFORMS = [
  // Key: broad, warm-neutral, high and to the camera's left.
  { u: 0.17, v: 0.26, du: 0.1, dv: 0.17, intensity: 9, color: [1, 0.97, 0.92] },
  // Rim: a tall cool strip behind the subject, which is what separates a dark
  // model from a dark backdrop.
  { u: 0.63, v: 0.32, du: 0.045, dv: 0.27, intensity: 5, color: [0.84, 0.92, 1] },
  // Bounce: low, warm, wide — keeps the underside from going to black.
  { u: 0.88, v: 0.66, du: 0.18, dv: 0.16, intensity: 1.5, color: [1, 0.86, 0.7] },
] as const;

/**
 * A procedural equirectangular environment, built as float texels.
 *
 * Deliberately not `RoomEnvironment`: that needs a `WebGLRenderer` to run PMREM
 * against, and this fixture does not own one. A float `DataTexture` tagged
 * `EquirectangularReflectionMapping` lets whichever renderer picks the scene up
 * do its own PMREM pass, so the fixture stays renderer-free and still gives
 * glossy materials something real to reflect.
 */
function createStudioEnvironment(): DataTexture {
  const width = 128;
  const height = 64;
  const data = new Float32Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    // Cool overhead falling away to a near-black floor.
    const sky = 0.34 * (1 - v) ** 1.7 + 0.015;
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      let r = sky * 0.8;
      let g = sky * 0.87;
      let b = sky;

      for (const form of LIGHTFORMS) {
        // Longitude wraps, so the shorter way round is the real distance.
        const raw = Math.abs(u - form.u);
        const du = Math.min(raw, 1 - raw) / form.du;
        const dv = (v - form.v) / form.dv;
        const falloff = Math.exp(-(du * du + dv * dv));
        if (falloff < 0.002) continue;
        const amount = form.intensity * falloff;
        r += amount * form.color[0];
        g += amount * form.color[1];
        b += amount * form.color[2];
      }

      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 1;
    }
  }

  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  // DataTexture defaults to nearest sampling, which bands badly once PMREM
  // blurs it into roughness mips.
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Builds the review rig.
 *
 * @param context Optional harness context; only `props` is read.
 */
export function createTurntableScene(context: TurntableSceneContext = {}) {
  const props = context.props ?? {};
  const accent = props.accent ?? DEFAULT_ACCENT;
  const periodMs = props.periodMs && props.periodMs > 0 ? props.periodMs : DEFAULT_PERIOD_MS;
  const showBackdrop = props.backdrop ?? true;

  const scene = new Scene();
  scene.name = 'turntable';
  scene.background =
    props.background === 'transparent' ? null : new Color(props.background ?? '#05050a');

  const environment = createStudioEnvironment();
  scene.environment = environment;
  scene.environmentIntensity = props.environmentIntensity ?? 1;

  // Everything the fixture allocates, so `dispose()` can be exhaustive rather
  // than a walk that guesses at ownership.
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  const geometry = <T extends BufferGeometry>(value: T): T => {
    geometries.push(value);
    return value;
  };
  const material = <T extends Material>(value: T): T => {
    materials.push(value);
    return value;
  };

  /* ---------------------------------------------------------------
     Subject — a spray can in primitives.

     A stand-in, and it says so: cylinders and a torus, no imported
     geometry. What it has to reproduce is not the catalog model's shape
     but its material behaviour — a clearcoated painted shell, a bare
     metal collar, and one matte accent band that stands for the sprayed
     surface a reviewer is actually judging.
     --------------------------------------------------------------- */
  const subject = new Group();
  subject.name = 'subject';

  const shell = material(
    new MeshPhysicalMaterial({
      color: '#d8dae2',
      metalness: 0.15,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    })
  );
  const metal = material(
    new MeshStandardMaterial({ color: '#8e9099', metalness: 1, roughness: 0.22 })
  );
  const paint = material(
    new MeshStandardMaterial({ color: new Color(accent), metalness: 0, roughness: 0.62 })
  );

  const body = new Mesh(geometry(new CylinderGeometry(0.34, 0.34, 1.0, 48)), shell);
  body.name = 'body';
  body.position.y = 0.54;

  // Open-ended sleeve a hair proud of the body: the accent reads as sprayed on
  // rather than as a second solid.
  const band = new Mesh(
    geometry(new CylinderGeometry(0.3425, 0.3425, 0.36, 48, 1, true)),
    paint
  );
  band.name = 'band';
  band.position.y = 0.5;

  const shoulder = new Mesh(geometry(new CylinderGeometry(0.17, 0.34, 0.22, 48)), shell);
  shoulder.name = 'shoulder';
  shoulder.position.y = 1.15;

  const collar = new Mesh(geometry(new TorusGeometry(0.175, 0.032, 16, 48)), metal);
  collar.name = 'collar';
  collar.position.y = 1.26;
  collar.rotation.x = Math.PI / 2;

  const cap = new Mesh(geometry(new CylinderGeometry(0.155, 0.175, 0.18, 32)), shell);
  cap.name = 'cap';
  cap.position.y = 1.36;

  const nozzle = new Mesh(geometry(new CylinderGeometry(0.038, 0.05, 0.07, 20)), metal);
  nozzle.name = 'nozzle';
  nozzle.position.set(0, 1.47, 0.05);

  subject.add(body, band, shoulder, collar, cap, nozzle);

  /* The turntable itself. Nothing else rotates — the camera, the lights and
     the backdrop are fixed, so two cells at the same phase are comparable. */
  const turntable = new Group();
  turntable.name = 'turntable-pivot';
  turntable.add(subject);
  scene.add(turntable);

  /* ---------------------------------------------------------------
     Context — plinth and cyclorama.
     --------------------------------------------------------------- */
  const contextObjects: Object3D[] = [];

  if (showBackdrop) {
    const plinth = new Mesh(
      geometry(new CylinderGeometry(0.92, 1.0, 0.08, 64)),
      material(new MeshStandardMaterial({ color: '#15151f', metalness: 0.1, roughness: 0.85 }))
    );
    plinth.name = 'plinth';
    plinth.position.y = -0.04;

    const cyc = new Mesh(
      geometry(new CylinderGeometry(4, 4, 6, 64, 1, true)),
      material(
        new MeshStandardMaterial({
          color: '#0b0b14',
          roughness: 1,
          metalness: 0,
          side: BackSide,
        })
      )
    );
    cyc.name = 'cyclorama';
    cyc.position.y = 1.6;

    scene.add(plinth, cyc);
    contextObjects.push(plinth, cyc);
  }

  /* Two directional lights on top of the environment. The environment alone
     gives a soft, shadowless read; these put an actual specular terminator on
     the shell, which is what makes a dent or a seam visible. */
  const key = new DirectionalLight('#fff4e8', 2.1);
  key.name = 'key';
  key.position.set(2.6, 3.4, 2.2);

  const rim = new DirectionalLight('#bcd6ff', 1.4);
  rim.name = 'rim';
  rim.position.set(-2.8, 1.9, -2.4);

  scene.add(key, rim);

  if (props.silhouette) {
    // Shape only. Reading a silhouette is how you catch a model that is
    // subtly the wrong proportion while its materials look fine.
    scene.overrideMaterial = material(new MeshBasicMaterial({ color: '#ffffff' }));
  }

  /* ---------------------------------------------------------------
     Camera — the gallery's fixed review angle.
     --------------------------------------------------------------- */
  const camera = new PerspectiveCamera(32, 16 / 9, 0.1, 100);
  camera.name = 'review';
  camera.position.set(2.05, 1.55, 2.55);
  camera.lookAt(0, 0.72, 0);
  camera.updateMatrixWorld();

  /** Places the turntable at an absolute phase. Idempotent, not incremental. */
  const seek = (timeMs: number) => {
    turntable.rotation.y = ((timeMs % periodMs) / periodMs) * Math.PI * 2;
    turntable.updateMatrixWorld(true);
  };

  seek(props.phaseMs ?? 0);

  return {
    scene,
    camera,

    /**
     * One logical item, spread over six meshes. Without this a harness frames
     * whichever primitive it happened to select and the shot is of a cylinder.
     */
    targets: [
      {
        id: 'subject',
        label: 'Review subject',
        members: [{ object: subject }],
        context: contextObjects.map((object) => ({ object })),
        bounds: () => new Box3().setFromObject(subject),
        focus: () => subject.getWorldPosition(new Vector3()).setY(0.72),
      },
    ],

    seek,

    /** Advances to the phase the gallery parks an un-hovered card at. */
    settle: () => seek(0),

    dispose() {
      for (const item of geometries) item.dispose();
      for (const item of materials) item.dispose();
      environment.dispose();
      scene.overrideMaterial = null;
      scene.environment = null;
      geometries.length = 0;
      materials.length = 0;
    },
  };
}

export default createTurntableScene;
