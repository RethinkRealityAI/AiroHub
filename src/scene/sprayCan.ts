/**
 * The spray can, built from code rather than downloaded.
 *
 * The can used to be a generated GLB: 210 KB to fetch and meshopt-decode
 * before anything could draw, so every screen showed a dark stand-in first
 * and then swapped in a model whose baked textures were a streaky off-white
 * with a smeared label. A spray can is a lathe profile plus a few details,
 * which three.js can build in well under a millisecond. Building it here means:
 *
 *   - it exists on the first frame, on every screen, with no network at all;
 *   - it stays sharp at the size the landing page draws it;
 *   - the lacquered body and the actuator take the paint colour, the way a
 *     real can's cap tells you what is inside, so each painter's can on the
 *     stage is theirs at a glance;
 *   - it costs about 3k triangles and six draw calls.
 *
 * Geometry is modelled upright (Y up, base on y = 0, the nozzle orifice
 * facing -Z) and then wrapped to the tool-rig convention in `toolRig.ts`:
 * barrel along +Z with the tip at the origin. In that frame the orifice faces
 * -Y, which is "into the wall" in every view that stands the rig upright.
 *
 * Geometries, the label texture and the untinted materials are module-level
 * and shared by every can in every canvas; three keeps per-renderer GPU state
 * keyed by object, so one geometry can serve the studio, the tool card and the
 * landing page at once. Only the two tinted materials are per can.
 */
import * as THREE from 'three';

/** Upright height of the modelled can, before rig scaling. */
const MODEL_HEIGHT = 1.505;
/** Body radius. Real 400 ml cans are about 66 x 200 mm; this keeps that ratio. */
const R = 0.25;
const RADIAL = 48;

/** Label band, in upright model units. */
const LABEL_BOTTOM = 0.3;
const LABEL_TOP = 0.88;

/** Where the orifice sits on the actuator, in upright model units. */
const ORIFICE_Y = 1.445;
/** How far the actuator sinks into the valve cup when pressed. */
const ACTUATOR_TRAVEL = 0.016;

interface Shared {
  bottomRim: THREE.BufferGeometry;
  body: THREE.BufferGeometry;
  topSeam: THREE.BufferGeometry;
  shoulder: THREE.BufferGeometry;
  label: THREE.BufferGeometry;
  valve: THREE.BufferGeometry;
  actuator: THREE.BufferGeometry;
  orifice: THREE.BufferGeometry;
  metal: THREE.MeshStandardMaterial;
  labelMat: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
}

let shared: Shared | null = null;

const v2 = (x: number, y: number) => new THREE.Vector2(x, y);

/** Quarter-ellipse from (x0, y0) sweeping up and in to (x1, y1). */
function arc(x0: number, y0: number, x1: number, y1: number, steps: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    out.push(v2(x1 + (x0 - x1) * Math.cos(a), y0 + (y1 - y0) * Math.sin(a)));
  }
  return out;
}

/**
 * The printed wrap: a graphite band with the wordmark on the side the viewer
 * sees (+Z, where every view looks from), fine print and a barcode on the
 * side facing the wall, and a palette strip running all the way round. Drawn
 * once with system fonts, so it never waits on a webfont.
 */
function buildLabelTexture(): THREE.Texture {
  const W = 1024;
  // Circumference : label height, so type is not stretched on the cylinder.
  const H = Math.round((W * (LABEL_TOP - LABEL_BOTTOM)) / (2 * Math.PI * R));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (!ctx) return texture;

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1a1a22');
  bg.addColorStop(0.5, '#121218');
  bg.addColorStop(1, '#1a1a22');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Printed grain, so the band reads as a label and not as a flat colour.
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.01 + Math.random() * 0.025})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }

  // Palette strip, top and bottom, all the way round.
  const palette = ['#FF4D1C', '#FFB020', '#D9F32B', '#34D399', '#22D3EE', '#A78BFA', '#E879F9'];
  const strip = (y: number, h: number) => {
    const seg = W / (palette.length * 3);
    for (let i = 0; i < palette.length * 3; i++) {
      ctx.fillStyle = palette[i % palette.length];
      ctx.fillRect(i * seg, y, seg + 1, h);
    }
  };
  strip(H * 0.06, H * 0.035);
  strip(H * 0.905, H * 0.035);

  // The front is canvas x = W/2 (the geometry starts its wrap at -Z).
  const cx = W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // A splat behind the wordmark, in the house flame, so the front has one
  // loud shape on it even when the body is a quiet colour.
  const splat = ctx.createRadialGradient(cx, H * 0.47, 4, cx, H * 0.47, H * 0.5);
  splat.addColorStop(0, 'rgba(255,77,28,0.5)');
  splat.addColorStop(0.6, 'rgba(232,121,249,0.18)');
  splat.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = splat;
  ctx.fillRect(cx - H, 0, H * 2, H);

  ctx.fillStyle = '#ffffff';
  // Kept inside about 50 degrees either side of the front, where the
  // cylinder is still close to facing the viewer; wider type wraps out of
  // sight and reads as clipped.
  const fit = (text: string, weight: number, px: number, maxW: number, family: string) => {
    let size = px;
    ctx.font = `${weight} ${size}px ${family}`;
    const w = ctx.measureText(text).width;
    if (w > maxW) {
      size = Math.floor((size * maxW) / w);
      ctx.font = `${weight} ${size}px ${family}`;
    }
  };
  const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  fit('AIRO', 900, Math.round(H * 0.34), W * 0.26, `"Arial Black", Impact, ${SANS}`);
  ctx.fillText('AIRO', cx, H * 0.55);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  fit('H U B', 800, Math.round(H * 0.1), W * 0.12, SANS);
  ctx.fillText('H U B', cx, H * 0.7);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  fit('HIGH PRESSURE · MATT', 700, Math.round(H * 0.06), W * 0.2, SANS);
  ctx.fillText('HIGH PRESSURE · MATT', cx, H * 0.82);

  // Drips off the wordmark.
  ctx.fillStyle = '#FF4D1C';
  for (const [dx, len] of [
    [-0.085, 0.07],
    [-0.01, 0.13],
    [0.07, 0.05],
  ] as const) {
    const x = cx + dx * W;
    ctx.fillRect(x - 3, H * 0.565, 6, H * len);
    ctx.beginPath();
    ctx.arc(x, H * (0.565 + len), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // The back: fine print and a barcode (canvas x = 0 / W is the seam).
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `600 ${Math.round(H * 0.045)}px system-ui, sans-serif`;
  const lines = ['400 ml  ·  shake well', 'hold 15–30 cm away', 'paint in light coats'];
  lines.forEach((line, i) => ctx.fillText(line, W * 0.06, H * (0.3 + i * 0.075)));
  let bx = W * 0.8;
  const barTop = H * 0.28;
  const barH = H * 0.3;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  while (bx < W * 0.93) {
    const w = 1 + Math.floor(Math.random() * 4);
    ctx.fillRect(bx, barTop, w, barH);
    bx += w + 1 + Math.floor(Math.random() * 3);
  }

  texture.needsUpdate = true;
  return texture;
}

function getShared(): Shared {
  if (shared) return shared;

  const bottomRim = new THREE.LatheGeometry(
    [
      v2(0, 0.04), // concave base, pushed up in the middle
      v2(0.12, 0.028),
      v2(0.2, 0.012),
      v2(0.235, 0.002),
      v2(R + 0.003, 0.012),
      v2(R + 0.005, 0.03),
      v2(R, 0.05),
    ],
    RADIAL
  );

  const body = new THREE.CylinderGeometry(R, R, 1.1 - 0.05, RADIAL, 1, true);
  body.translate(0, 0.05 + (1.1 - 0.05) / 2, 0);

  const topSeam = new THREE.LatheGeometry(
    [v2(R, 1.1), v2(R + 0.005, 1.115), v2(R + 0.006, 1.13), v2(R - 0.004, 1.15)],
    RADIAL
  );

  const shoulder = new THREE.LatheGeometry(arc(R - 0.004, 1.15, 0.108, 1.325, 14), RADIAL);

  // thetaStart = PI starts the wrap at -Z, so the middle of the texture (the
  // wordmark) lands at +Z, the side every view of the can looks at.
  const label = new THREE.CylinderGeometry(
    R + 0.0015,
    R + 0.0015,
    LABEL_TOP - LABEL_BOTTOM,
    RADIAL,
    1,
    true,
    Math.PI
  );
  label.translate(0, (LABEL_TOP + LABEL_BOTTOM) / 2, 0);

  // Valve cup: the crimped ring the actuator sits in.
  const valve = new THREE.LatheGeometry(
    [
      v2(0.106, 1.322),
      v2(0.116, 1.336),
      v2(0.112, 1.352),
      v2(0.094, 1.357),
      v2(0.086, 1.35),
      v2(0.078, 1.343),
      v2(0.04, 1.347),
    ],
    RADIAL
  );

  const actuator = new THREE.LatheGeometry(
    [
      v2(0.04, 1.344),
      v2(0.07, 1.346),
      v2(0.075, 1.36),
      v2(0.075, 1.475),
      v2(0.071, 1.492),
      v2(0.058, 1.502),
      v2(0.03, 1.5), // shallow finger dimple
      v2(0, 1.497),
    ],
    32
  );

  // The orifice insert: a short dark stub on the -Z face of the actuator.
  const orifice = new THREE.CylinderGeometry(0.02, 0.022, 0.024, 16);
  orifice.rotateX(Math.PI / 2);
  orifice.translate(0, ORIFICE_Y, -0.074);

  const metal = new THREE.MeshStandardMaterial({
    color: '#d7dbe3',
    metalness: 1,
    roughness: 0.26,
    envMapIntensity: 1.2,
  });
  const labelMat = new THREE.MeshStandardMaterial({
    map: buildLabelTexture(),
    metalness: 0.05,
    roughness: 0.42,
  });
  const dark = new THREE.MeshStandardMaterial({ color: '#0b0b10', roughness: 0.6 });

  shared = { bottomRim, body, topSeam, shoulder, label, valve, actuator, orifice, metal, labelMat, dark };
  return shared;
}

export interface SprayCanModel {
  /** Upright can: base at y = 0, top of the actuator at y = MODEL_HEIGHT. */
  group: THREE.Group;
  height: number;
  /** Recolours the lacquered body and the actuator. Cheap enough per frame. */
  setColor: (color: THREE.ColorRepresentation) => void;
  /** Pushes the actuator into the valve, 0 (released) to 1 (fully down). */
  setPressed: (amount: number) => void;
  /** The per-can materials (the shared ones are never disposed). */
  ownMaterials: THREE.MeshStandardMaterial[];
  dispose: () => void;
}

/** Builds one can. Geometry is shared; the two paint-coloured materials are its own. */
export function createSprayCan(color: THREE.ColorRepresentation = '#FF4D1C'): SprayCanModel {
  const s = getShared();

  // Gloss lacquer: a clear coat over a slightly metallic flake, which is what
  // makes a real can catch a highlight down its whole length.
  const lacquer = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.35,
    roughness: 0.38,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.1,
  });
  const cap = new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.48 });

  const group = new THREE.Group();
  group.name = 'airo-spray-can';
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  };
  add(s.bottomRim, s.metal);
  add(s.body, lacquer);
  add(s.label, s.labelMat);
  add(s.topSeam, s.metal);
  add(s.shoulder, lacquer);
  add(s.valve, s.metal);
  const actuator = add(s.actuator, cap);
  const orifice = add(s.orifice, s.dark);

  // Tools never own a raycast target: painting must never hit its own can.
  group.traverse((child) => {
    (child as THREE.Mesh).raycast = () => undefined;
  });

  return {
    group,
    height: MODEL_HEIGHT,
    setColor: (c) => {
      lacquer.color.set(c);
      cap.color.set(c);
    },
    setPressed: (amount) => {
      // About 2 mm of travel on a real can, which is what you see a finger do.
      const y = -ACTUATOR_TRAVEL * THREE.MathUtils.clamp(amount, 0, 1);
      actuator.position.y = y;
      orifice.position.y = y;
    },
    ownMaterials: [lacquer, cap],
    dispose: () => {
      lacquer.dispose();
      cap.dispose();
    },
  };
}
