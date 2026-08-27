/**
 * Landing hero — the spray can you get to play with before ever joining a room.
 *
 * A full-viewport R3F scene built around one commanding object: the real
 * spray-can model, scaled to own roughly half the stage. It floats over a
 * paintable backdrop, follows the pointer on a critically-damped spring, banks
 * into its own velocity, and sprays while it moves — an additive particle cone
 * out of the nozzle plus soft paint splats stamped into a CanvasTexture on the
 * backdrop. Paint accumulates, so visitors literally tag the page.
 *
 * The can does not sit *on* the pointer: the pointer is remapped into a
 * "stage zone" (right-hand third on wide screens, upper-middle when stacked)
 * so a can this large can never bulldoze the headline. It still tracks every
 * move, just inside its own box. Everything it paints is derived from where
 * the can actually is, so mist, splats and drips always agree with each other.
 *
 * Layers, back to front:
 *   backdrop      CanvasTexture wall — procedural concrete, faded old tags,
 *                 live splats and gravity drips
 *   motes         slow additive dust drifting through the volume
 *   halo          soft paint-coloured bloom behind the can
 *   can           rigged GLB with a fresnel rim injected into its materials
 *   mist          instanced additive puffs, pooled and capped
 *
 * Deliberately self-contained: no CDN environment maps (StudioEnvironment is
 * Lightformer-based), no font-fetching text, and the paint is a plain 2D
 * canvas rather than the app's paint engine — this page must render even if
 * everything but the bundle fails to load.
 *
 * Performance contract: nothing allocates inside useFrame. Particles, drips
 * and motes are fixed-size pools; every vector, colour and matrix used per
 * frame is created once in a useMemo scratch block.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadToolRig } from './toolRig';
import { AimTracker } from '../utils/motion';
import { StudioEnvironment } from './StudioEnvironment';

/** Splat colours, cycled slowly. Matches the app's controller palette. */
const PALETTE = ['#FF4D1C', '#FFB020', '#D9F32B', '#34D399', '#22D3EE', '#A78BFA', '#E879F9'];
const PALETTE_RGB = PALETTE.map((hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
});

const BACK_Z = -4; // backdrop plane depth
const CAN_Z = 1.6; // depth the can floats at
const CAN_LENGTH = 1.55; // world-units barrel length of the unscaled rig
const CAN_ASPECT = 0.4; // barrel width / barrel length, for stroke sizing
const POOL = 360; // mist pool — bounded, instanced
const MOTE_COUNT = 72; // ambient dust — one draw call
const DRIP_POOL = 18; // simultaneous running drips
const TEX_SIZE = 1024; // splat texture resolution
const IDLE_AFTER_MS = 2500; // pointer silence before the lissajous drift kicks in
const MAX_STAMPS_PER_FRAME = 6;
const PARALLAX = 0.34; // world units the camera drifts with the pointer

/**
 * Interpolated palette sample; t in "palette indices" (wraps). Writes into a
 * caller-owned triple rather than returning one — this runs several times a
 * frame and the hero's frame budget allows no garbage.
 */
function samplePalette(t: number, out: Float32Array | number[]) {
  const n = PALETTE_RGB.length;
  const f = ((t % n) + n) % n;
  const i = Math.floor(f);
  const a = PALETTE_RGB[i];
  const b = PALETTE_RGB[(i + 1) % n];
  const k = f - i;
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
}

/**
 * Soft round paint splat: a radial gradient blob, drawn as an ellipse so that
 * a square texture stretched over a non-square plane still shows circles.
 */
function stampSplat(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  rx: number,
  ry: number,
  r: number,
  g: number,
  b: number,
  alpha: number
) {
  const rr = Math.round(r);
  const gg = Math.round(g);
  const bb = Math.round(b);
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(Math.max(rx, 0.5) / Math.max(ry, 0.5), 1);
  // Weighted toward a solid core with a fast falloff at the edge. A gentler
  // ramp turns overlapping stamps into one undifferentiated glow instead of
  // a stroke you can see the shape of.
  const grad = ctx.createRadialGradient(0, 0, ry * 0.05, 0, 0, ry);
  grad.addColorStop(0, `rgba(${rr},${gg},${bb},${alpha})`);
  grad.addColorStop(0.42, `rgba(${rr},${gg},${bb},${alpha * 0.8})`);
  grad.addColorStop(0.72, `rgba(${rr},${gg},${bb},${alpha * 0.3})`);
  grad.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, ry, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The wall before anybody touches it: a lit concrete slab carrying faded
 * older tags, so the stage reads as a place that gets painted rather than an
 * empty void. Everything here is drawn once, under the vignette — live paint
 * lands on top of it and therefore stays the brightest thing on screen.
 */
function createSplatCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, ctx };

  const S = TEX_SIZE;
  ctx.fillStyle = '#06060d';
  ctx.fillRect(0, 0, S, S);

  const bloom = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  };
  bloom(S * 0.66, S * 0.36, S * 0.62, 'rgba(70,50,112,0.72)');
  bloom(S * 0.2, S * 0.76, S * 0.55, 'rgba(16,66,86,0.56)');
  bloom(S * 0.5, S * 0.52, S * 0.3, 'rgba(86,58,42,0.3)');

  // Concrete grain. Cheap, one-time, and it stops the wall reading as a
  // flat gradient once the camera parallax starts moving across it.
  for (let i = 0; i < 2400; i++) {
    const light = Math.random() > 0.52;
    ctx.fillStyle = light
      ? `rgba(255,255,255,${0.012 + Math.random() * 0.03})`
      : `rgba(0,0,0,${0.03 + Math.random() * 0.08})`;
    const s = 1 + Math.random() * 2.2;
    ctx.fillRect(Math.random() * S, Math.random() * S, s, s);
  }

  // Faded older tags — broad soft curves, three passes each so they read as
  // aerosol rather than as a stroked path.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 7; i++) {
    const [r, g, b] = PALETTE_RGB[(i * 3) % PALETTE_RGB.length];
    const x0 = S * (0.06 + Math.random() * 0.82);
    const y0 = S * (0.08 + Math.random() * 0.82);
    // Angle-and-length, not two loose endpoints: a short stroke at this
    // line width would bake a rounded bar into the wall, not a tag.
    const angle = Math.random() * Math.PI * 2;
    const length = S * (0.3 + Math.random() * 0.35);
    const x1 = x0 + Math.cos(angle) * length;
    const y1 = y0 + Math.sin(angle) * length * 0.7;
    const cx = (x0 + x1) / 2 + S * (Math.random() - 0.5) * 0.3;
    const cy = (y0 + y1) / 2 + S * (Math.random() - 0.5) * 0.3;
    for (let pass = 0; pass < 3; pass++) {
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.018 + pass * 0.02})`;
      ctx.lineWidth = S * 0.055 * (1 - pass * 0.3);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.stroke();
    }
  }

  // Seed splats, a few of them with a dried run hanging off the bottom. The
  // runs are drawn wide and soft on purpose — a thin hard stroke at this
  // texture-to-world ratio reads as a scratch on the lens, not as paint.
  for (let i = 0; i < 10; i++) {
    const [r, g, b] = PALETTE_RGB[(i * 2) % PALETTE_RGB.length];
    const px = S * (0.08 + Math.random() * 0.84);
    const py = S * (0.1 + Math.random() * 0.74);
    const rad = S * (0.03 + Math.random() * 0.055);
    const alpha = 0.09 + Math.random() * 0.11;
    stampSplat(ctx, px, py, rad, rad, r, g, b, alpha);
    if (Math.random() < 0.55) {
      const runLength = rad * (0.7 + Math.random() * 1.5);
      const width = rad * (0.16 + Math.random() * 0.16);
      ctx.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * (pass === 0 ? 0.3 : 0.8)})`;
        ctx.lineWidth = width * (pass === 0 ? 2.1 : 1);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + runLength);
        ctx.stroke();
      }
      stampSplat(ctx, px, py + runLength, width * 1.5, width * 1.5, r, g, b, alpha);
    }
  }

  // Vignette: corners fall away so the overlay copy keeps its contrast, and
  // the centre stays open for fresh paint.
  const vg = ctx.createRadialGradient(S * 0.5, S * 0.46, S * 0.16, S * 0.5, S * 0.5, S * 0.8);
  vg.addColorStop(0, 'rgba(4,4,9,0)');
  vg.addColorStop(0.6, 'rgba(4,4,9,0.24)');
  vg.addColorStop(1, 'rgba(3,3,7,0.86)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, S, S);

  return { canvas, ctx };
}

/** Soft white radial sprite, reused for the can's halo and the dust motes. */
function radialSprite(size: number, stops: [number, number][]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [pos, a] of stops) g.addColorStop(pos, `rgba(255,255,255,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Project the ray camera→point onward onto the plane z = planeZ. */
function throughPointToPlane(
  camera: THREE.Camera,
  point: THREE.Vector3,
  planeZ: number,
  out: THREE.Vector3
) {
  out.copy(point).sub(camera.position);
  const t = (planeZ - camera.position.z) / (out.z || -1e-6);
  out.multiplyScalar(t).add(camera.position);
  out.z = planeZ;
}

interface RimUniforms {
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uRimPower: { value: number };
}

/**
 * Gives the loaded rig its hero finish: private copies of every material (the
 * GLB cache is shared with the studio, so the originals must not be touched)
 * carrying a fresnel rim term injected straight into MeshStandardMaterial's
 * fragment shader. The rim is what turns a white aerosol can into a neon
 * object without adding a single extra draw call or light.
 */
function applyHeroSkin(root: THREE.Object3D, rim: RimUniforms): THREE.MeshStandardMaterial[] {
  const owned: THREE.MeshStandardMaterial[] = [];

  const skin = (material: THREE.Material): THREE.Material => {
    const std = material as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) return material;
    const clone = std.clone();
    clone.envMapIntensity = 1.45;
    clone.emissiveIntensity = 1;
    clone.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = rim.uRimColor;
      shader.uniforms.uRimStrength = rim.uRimStrength;
      shader.uniforms.uRimPower = rim.uRimPower;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform vec3 uRimColor;
           uniform float uRimStrength;
           uniform float uRimPower;`
        )
        // `normal` and `vViewPosition` are both still in scope here, and
        // `outgoingLight` has just been assembled — the last chance to add
        // light before tone mapping.
        .replace(
          '#include <opaque_fragment>',
          `float airoRim = pow( 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) ), uRimPower );
           outgoingLight += uRimColor * airoRim * uRimStrength;
           #include <opaque_fragment>`
        );
    };
    // Distinct from the paint-compositing key the shared materials use, so
    // three compiles this variant instead of reusing their program.
    clone.customProgramCacheKey = () => 'airo-hero-rim-v1';
    clone.needsUpdate = true;
    owned.push(clone);
    return clone;
  };

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    // No shadow-casting lights on this stage; skip the bookkeeping.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(skin)
      : skin(mesh.material);
  });

  return owned;
}

interface Puff {
  life: number;
  maxLife: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: number;
  color: THREE.Color;
}

interface Drip {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  w: number;
  life: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

function HeroScene() {
  const { camera, viewport, gl } = useThree();

  const canGroupRef = useRef<THREE.Group>(null);
  const nozzleRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Sprite>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const rimLightRef = useRef<THREE.PointLight>(null);
  const puffMeshRef = useRef<THREE.InstancedMesh>(null);
  const motesRef = useRef<THREE.Points>(null);

  const [rig, setRig] = useState<THREE.Group | null>(null);

  // ---- fresnel rim, shared by every material on the rig
  const rim = useMemo<RimUniforms>(
    () => ({
      uRimColor: { value: new THREE.Color('#ff4d1c') },
      uRimStrength: { value: 0.8 },
      uRimPower: { value: 2.6 },
    }),
    []
  );
  const heroMats = useRef<THREE.MeshStandardMaterial[]>([]);

  // ---- spray-can model (async; fallback stand-in until it lands / if it fails)
  useEffect(() => {
    let cancelled = false;
    let mine: THREE.MeshStandardMaterial[] = [];
    loadToolRig('spray')
      .then(({ root }) => {
        if (cancelled) return;
        // The rig plants the nozzle tip at its origin with the body running
        // along +Z; rotating X by +PI/2 stands it upright, nozzle on top.
        root.rotation.x = Math.PI / 2;
        mine = applyHeroSkin(root, rim);
        heroMats.current = mine;
        setRig(root);
      })
      .catch((err) => console.warn('[LandingHero] spray can failed to load, using stand-in', err));
    return () => {
      cancelled = true;
      heroMats.current = [];
      for (const material of mine) material.dispose();
    };
  }, [rim]);

  // ---- splat texture (plain 2D canvas → CanvasTexture on the backdrop)
  const splat = useMemo(() => {
    const { canvas, ctx } = createSplatCanvas();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { canvas, ctx, texture };
  }, []);
  useEffect(() => () => splat.texture.dispose(), [splat]);

  // ---- generated sprite art: the can's bloom, the muzzle flash, the motes
  const sprites = useMemo(() => {
    const halo = radialSprite(256, [
      [0, 0.95],
      [0.16, 0.42],
      [0.42, 0.1],
      [1, 0],
    ]);
    const mote = radialSprite(64, [
      [0, 1],
      [0.35, 0.35],
      [1, 0],
    ]);
    return { halo, mote };
  }, []);
  useEffect(
    () => () => {
      sprites.halo.dispose();
      sprites.mote.dispose();
    },
    [sprites]
  );

  const haloMat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: sprites.halo,
        transparent: true,
        // Depth-tested on purpose: the can occludes the near half of the
        // bloom, which is what makes it read as light *behind* the object.
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 0.25,
      }),
    [sprites]
  );
  const flashMat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: sprites.halo,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 0.5,
      }),
    [sprites]
  );
  useEffect(
    () => () => {
      haloMat.dispose();
      flashMat.dispose();
    },
    [haloMat, flashMat]
  );

  /**
   * Input — the hero is a miniature of the phone controller:
   *
   *  · mouse hover paints automatically as it moves (as before), and holding
   *    the button is a full trigger pull;
   *  · a finger on the stage IS the trigger — the can follows it, sprays the
   *    whole time it is down (pooling paint when held still), and the gesture
   *    is claimed with preventDefault so painting never scrolls the page.
   *    Touches that start on the copy or the glass card never reach the
   *    canvas element, so the page scrolls normally there;
   *  · device rotation drives the can through the same AimTracker the real
   *    controller uses — move the phone and it sprays automatically as it
   *    sweeps. iOS gates orientation events behind a permission that must be
   *    requested from a user gesture, so the first touch on the stage doubles
   *    as the opt-in; Android needs no permission and simply starts working.
   */
  const pointerRef = useRef({ x: 0, y: 0, active: false, pressed: false, lastMoveMs: 0 });
  /** Test hook (only with ?debug in the URL): lets the input-regression
   *  harness read the can's live state without depending on pixels. */
  const probeState = useRef({ x: 0, y: 0, intensity: 0, pressed: false, idle: true });
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    (window as any).__airoHeroProbe = () => ({ ...probeState.current });
    return () => {
      delete (window as any).__airoHeroProbe;
    };
  }, []);
  const gyro = useRef({
    tracker: null as AimTracker | null,
    x: 0,
    y: 0,
    seeded: false,
    permissionAsked: false,
  });
  useEffect(() => {
    const setFrom = (clientX: number, clientY: number) => {
      const p = pointerRef.current;
      p.x = (clientX / window.innerWidth) * 2 - 1;
      p.y = -(clientY / window.innerHeight) * 2 + 1;
      p.active = true;
      p.lastMoveMs = performance.now();
    };
    const onPointer = (e: PointerEvent) => setFrom(e.clientX, e.clientY);
    const requestMotionPermission = () => {
      const g = gyro.current;
      if (g.permissionAsked) return;
      g.permissionAsked = true;
      const api = (DeviceOrientationEvent as any)?.requestPermission;
      if (typeof api === 'function') {
        api.call(DeviceOrientationEvent).catch(() => {
          /* denied — touch keeps working */
        });
      }
    };

    // Trigger pulls. Mouse presses arrive as pointerdown on the canvas; touch
    // is handled through raw touch events so the gesture can be claimed.
    const canvas = gl.domElement;
    const press = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return; // the touch handlers own this
      setFrom(e.clientX, e.clientY);
      pointerRef.current.pressed = true;
    };
    const release = () => {
      pointerRef.current.pressed = false;
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      requestMotionPermission();
      setFrom(e.touches[0].clientX, e.touches[0].clientY);
      pointerRef.current.pressed = true;
      e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      setFrom(e.touches[0].clientX, e.touches[0].clientY);
      if (pointerRef.current.pressed) e.preventDefault();
    };
    const onTouchEnd = () => {
      pointerRef.current.pressed = false;
    };

    // Gyro aim, sharing the controller's tracker. Only meaningful deltas
    // count as movement, so a phone at rest still settles into the idle
    // drift instead of pinning the can wherever it last aimed.
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      const g = gyro.current;
      if (!g.tracker) g.tracker = new AimTracker();
      const sample = g.tracker.update(e.alpha, e.beta, e.gamma, performance.now());
      const nx = sample.x * 2 - 1;
      const ny = 1 - sample.y * 2;
      const moved = Math.hypot(nx - g.x, ny - g.y);
      g.x = nx;
      g.y = ny;
      if (!g.seeded) {
        g.seeded = true;
        return;
      }
      if (moved > 0.004) {
        const p = pointerRef.current;
        p.x = nx;
        p.y = ny;
        p.active = true;
        p.lastMoveMs = performance.now();
      }
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    canvas.addEventListener('pointerdown', press);
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [gl]);

  // ---- world-space extents at the two working depths
  const backAnchor = useMemo(() => new THREE.Vector3(0, 0, BACK_Z), []);
  const canAnchor = useMemo(() => new THREE.Vector3(0, 0, CAN_Z), []);
  const backVp = viewport.getCurrentViewport(camera, backAnchor);
  const canVp = viewport.getCurrentViewport(camera, canAnchor);
  // Generous overscan: the camera parallaxes across this plane, and an edge
  // sliding into frame would give the whole illusion away.
  const planeW = backVp.width * 1.34;
  const planeH = backVp.height * 1.34;

  /**
   * Where the can lives and how big it is. Wide screens hand it the right
   * third and 58% of the stage height. Stacked screens centre it and size it
   * by whichever budget runs out first: 46% of the height (portrait tablets,
   * where height is plentiful) or a barrel a third of the viewport wide
   * (phones, where it is not). Either way it clears the copy above it and
   * only feathers into the top of the glass card below.
   */
  const wide = canVp.width >= canVp.height * 1.2;
  const canHeight = wide
    ? canVp.height * 0.58
    : Math.min(canVp.height * 0.46, canVp.width * 0.8);
  const canScale = canHeight / CAN_LENGTH;
  const layout = useRef({
    scale: canScale,
    cx: 0,
    cy: 0,
    rx: 1,
    ry: 1,
    stroke: CAN_LENGTH * canScale * CAN_ASPECT,
  });
  const planeDims = useRef({ w: 0, h: 0 });
  const canDims = useRef({ w: 12, h: 7 });
  useEffect(() => {
    planeDims.current = { w: planeW, h: planeH };
    canDims.current = { w: canVp.width, h: canVp.height };
    layout.current = {
      scale: canScale,
      // Travel is clamped tight enough that the can can never reach the
      // headline (wide) or the copy above it (stacked), while still leaving
      // it obviously alive under the pointer.
      // The stacked radii were originally 0.13/0.05 — tight enough that a
      // finger drag on a phone read as "nothing happened" and the aim-speed
      // spray gate never opened. The can may now brush the copy at the
      // extremes; feeling alive under the finger matters more.
      cx: wide ? canVp.width * 0.18 : 0,
      cy: canVp.height * (wide ? 0 : -0.04),
      rx: canVp.width * (wide ? 0.2 : 0.32),
      ry: canVp.height * (wide ? 0.16 : 0.17),
      stroke: CAN_LENGTH * canScale * CAN_ASPECT,
    };
  });

  // ---- simulation state (refs: none of this should re-render React)
  const canPos = useRef(new THREE.Vector3(2.5, 0, CAN_Z));
  const canVel = useRef(new THREE.Vector3());
  const prevAim = useRef(new THREE.Vector3(0, 0, BACK_Z));
  const hasPrevAim = useRef(false);
  const lastStamp = useRef(new THREE.Vector2());
  const intensityRef = useRef(0);
  const cycleT = useRef(Math.random() * PALETTE.length);
  const spawnDebt = useRef(0);
  const appliedScale = useRef(0);
  // Re-uploading a 1024² canvas is by far the most expensive thing this scene
  // does per frame, so paint accumulates freely but only reaches the GPU at
  // ~30Hz. The mist runs at full rate over the top and hides the seam.
  const texClock = useRef(0);
  const texPending = useRef(false);

  const scratch = useMemo(
    () => ({
      targetPos: new THREE.Vector3(),
      accel: new THREE.Vector3(),
      aim: new THREE.Vector3(),
      nozzle: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      spread: new THREE.Vector3(),
      worldUp: new THREE.Vector3(0, 1, 0),
      altUp: new THREE.Vector3(1, 0, 0),
      nozzleAxis: new THREE.Vector3(0, 1, 0),
      tint: new THREE.Color(),
      rimTint: new THREE.Color(),
      puffTint: new THREE.Color(),
      paintRgb: new Float32Array(3),
      rimRgb: new Float32Array(3),
    }),
    []
  );

  // ---- mist pool (bounded, instanced, free-list — same shape as SprayMist)
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const puffs = useMemo<Puff[]>(
    () =>
      Array.from({ length: POOL }, () => ({
        life: 0,
        maxLife: 1,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        scale: 0.06,
        color: new THREE.Color(),
      })),
    []
  );
  const freeList = useRef<number[]>(Array.from({ length: POOL }, (_, i) => i));

  // ---- drip pool (2D, lives on the splat canvas rather than in the scene)
  const drips = useMemo<Drip[]>(
    () =>
      Array.from({ length: DRIP_POOL }, () => ({
        active: false,
        x: 0,
        y: 0,
        vy: 0,
        w: 1,
        life: 0,
        r: 255,
        g: 255,
        b: 255,
        a: 0.4,
      })),
    []
  );

  // ---- ambient motes: one Points object, positions mutated in place
  const motes = useMemo(() => {
    const positions = new Float32Array(MOTE_COUNT * 3);
    const colors = new Float32Array(MOTE_COUNT * 3);
    const rise = new Float32Array(MOTE_COUNT);
    const phase = new Float32Array(MOTE_COUNT);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, MOTE_COUNT);
    // Bounding sphere is set once by hand: the motes never leave this volume,
    // and recomputing it every frame would be pure waste.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    return { geometry, positions, colors, rise, phase, seeded: false };
  }, []);
  useEffect(() => () => motes.geometry.dispose(), [motes]);

  // Park every mist instance off-screen before the first frame — otherwise the
  // whole unused pool renders as unit spheres piled on the origin.
  useEffect(() => {
    const mesh = puffMeshRef.current;
    if (!mesh) return;
    dummy.position.set(0, 0, -10000);
    dummy.scale.setScalar(0.0001);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    for (let i = 0; i < POOL; i++) mesh.setMatrixAt(i, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const t = state.clock.elapsedTime;
    const now = performance.now();
    const p = pointerRef.current;
    // A pressed trigger never idles — holding a finger still must keep the
    // can pinned and pooling paint, not hand it back to the drift.
    const idle = !p.active || (!p.pressed && now - p.lastMoveMs > IDLE_AFTER_MS);
    const cd = canDims.current;
    const L = layout.current;

    // ----- camera parallax: the wall and the can separate as you move, which
    // is most of what makes a flat backdrop read as a room.
    const parallax = Math.min(PARALLAX, cd.w * 0.045);
    const px = idle ? Math.sin(t * 0.21) * parallax * 0.6 : p.x * parallax;
    const py = idle ? Math.sin(t * 0.17 + 2) * parallax * 0.35 : p.y * parallax * 0.6;
    camera.position.x += (px - camera.position.x) * (1 - Math.exp(-2.4 * delta));
    camera.position.y += (py - camera.position.y) * (1 - Math.exp(-2.4 * delta));
    camera.updateMatrixWorld();

    // ----- where the can wants to be. The pointer is remapped into the stage
    // zone rather than followed literally: at this size a 1:1 follow would
    // park the can on top of the headline.
    if (idle) {
      scratch.targetPos.set(
        L.cx + Math.sin(t * 0.5) * L.rx * 0.85,
        L.cy + Math.sin(t * 0.33 + 1.4) * L.ry * 0.9,
        CAN_Z
      );
    } else {
      scratch.targetPos.set(L.cx + p.x * L.rx, L.cy + p.y * L.ry, CAN_Z);
    }

    // Critically damped spring — position feels alive, velocity drives tilt.
    const stiffness = 42;
    const damping = 2 * Math.sqrt(stiffness);
    scratch.accel.copy(scratch.targetPos).sub(canPos.current).multiplyScalar(stiffness);
    scratch.accel.addScaledVector(canVel.current, -damping);
    canVel.current.addScaledVector(scratch.accel, delta);
    canPos.current.addScaledVector(canVel.current, delta);

    // ----- aim point: straight behind the can on the wall, led slightly by its
    // own velocity so the stroke trails out of the sweep instead of sitting
    // dead centre. Everything painted this frame derives from here.
    throughPointToPlane(camera, canPos.current, BACK_Z, scratch.aim);
    scratch.aim.x += canVel.current.x * 0.12;
    scratch.aim.y += canVel.current.y * 0.12;

    // ----- spray intensity from aim-point speed (attack fast, decay slow).
    // A pressed trigger (finger down, mouse button held) is a full pull:
    // the can sprays hard even when held perfectly still.
    const speed = hasPrevAim.current
      ? scratch.aim.distanceTo(prevAim.current) / Math.max(delta, 1e-4)
      : 0;
    prevAim.current.copy(scratch.aim);
    hasPrevAim.current = true;
    const pressed = p.pressed;
    const targetIntensity = pressed
      ? Math.max(0.85, Math.min(1, speed / 5.5))
      : idle
        ? 0.34
        : Math.min(1, speed / 5.5);
    const k = targetIntensity > intensityRef.current ? 10 : 3.2;
    intensityRef.current += (targetIntensity - intensityRef.current) * (1 - Math.exp(-k * delta));
    const intensity = intensityRef.current;

    probeState.current.x = canPos.current.x;
    probeState.current.y = canPos.current.y;
    probeState.current.intensity = intensity;
    probeState.current.pressed = pressed;
    probeState.current.idle = idle;

    // ----- colour cycle
    cycleT.current += delta * (0.14 + intensity * 0.1);
    samplePalette(cycleT.current, scratch.paintRgb);
    const cr = scratch.paintRgb[0];
    const cg = scratch.paintRgb[1];
    const cb = scratch.paintRgb[2];
    scratch.tint.setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
    // The rim runs a third of the wheel ahead of the paint, so the can is
    // never outlined in the same colour it is spraying.
    samplePalette(cycleT.current + 2.4, scratch.rimRgb);
    scratch.rimTint.setRGB(
      scratch.rimRgb[0] / 255,
      scratch.rimRgb[1] / 255,
      scratch.rimRgb[2] / 255,
      THREE.SRGBColorSpace
    );

    // ----- pose the can: upright, banking into its velocity and leaning
    // toward whatever it is painting.
    const group = canGroupRef.current;
    if (group) {
      // Scale eases in so a resize (or the very first frame) does not snap.
      if (appliedScale.current === 0) appliedScale.current = L.scale;
      appliedScale.current += (L.scale - appliedScale.current) * (1 - Math.exp(-6 * delta));
      group.scale.setScalar(appliedScale.current);

      group.position.copy(canPos.current);
      const lean = THREE.MathUtils.clamp(-(scratch.aim.x - canPos.current.x) * 0.05, -0.3, 0.3);
      const tiltZ = THREE.MathUtils.clamp(-canVel.current.x * 0.05, -0.45, 0.45) + lean;
      // Leaned well back toward the wall: it reads as a can aimed at what it
      // is painting, and it swings the nozzle axis away from the camera so
      // the mist plume is not hidden behind the can's own body.
      const tiltX = -0.38 + THREE.MathUtils.clamp(canVel.current.y * 0.035, -0.32, 0.32);
      const blend = 1 - Math.exp(-10 * delta);
      group.rotation.z += (tiltZ - group.rotation.z) * blend;
      group.rotation.x += (tiltX - group.rotation.x) * blend;
      group.rotation.y = Math.sin(t * 0.6) * 0.22;
      // Where the nozzle is actually pointing, in world space.
      scratch.nozzleAxis.set(0, 1, 0).applyQuaternion(group.quaternion);
    }

    // ----- neon: fresnel rim on the shell, emissive wash inside it, and a
    // bloom sprite behind the whole thing.
    rim.uRimColor.value.copy(scratch.rimTint);
    rim.uRimStrength.value = 0.55 + intensity * 0.85;
    for (const material of heroMats.current) {
      material.emissive.copy(scratch.tint);
      material.emissiveIntensity = 0.05 + intensity * 0.16;
    }
    if (haloRef.current) {
      const halo = haloRef.current;
      halo.position.set(canPos.current.x, canPos.current.y, canPos.current.z - 1.2);
      const s = CAN_LENGTH * appliedScale.current * (1.55 + intensity * 0.35);
      halo.scale.set(s, s, 1);
      haloMat.color.copy(scratch.rimTint);
      haloMat.opacity = 0.19 + intensity * 0.24;
    }
    if (flashRef.current) {
      const s = 0.32 + intensity * 0.5;
      flashRef.current.scale.set(s, s, 1);
      flashMat.color.copy(scratch.tint);
      flashMat.opacity = 0.1 + intensity * 0.34;
    }
    if (lightRef.current) {
      lightRef.current.color.copy(scratch.tint);
      lightRef.current.intensity = (0.5 + intensity * 1.8) * appliedScale.current;
    }
    if (rimLightRef.current) {
      rimLightRef.current.color.copy(scratch.rimTint);
      rimLightRef.current.intensity = (0.35 + intensity * 0.9) * appliedScale.current;
    }

    // ----- everything that writes to the wall texture
    const ctx = splat.ctx;
    const pd = planeDims.current;
    let dirty = false;
    if (ctx && pd.w > 0) {
      const step = L.stroke * (idle ? 0.26 : 0.19);

      if (intensity > 0.06) {
        // A pulled trigger held (nearly) still pools paint: one soft dab per
        // frame at the aim point, like a real can hovering over one spot.
        // The movement loop below only fires once the aim clears a full
        // step, so without this a stationary press painted nothing at all.
        if (pressed) {
          const dwell = Math.hypot(
            scratch.aim.x - lastStamp.current.x,
            scratch.aim.y - lastStamp.current.y
          );
          if (dwell < step) {
            const sx = ((scratch.aim.x + pd.w / 2) / pd.w) * TEX_SIZE;
            const sy = ((pd.h / 2 - scratch.aim.y) / pd.h) * TEX_SIZE;
            const rWorld = L.stroke * (0.15 + intensity * 0.2) * (0.8 + Math.random() * 0.35);
            stampSplat(
              ctx,
              sx + (Math.random() - 0.5) * 5,
              sy + (Math.random() - 0.5) * 5,
              (rWorld * TEX_SIZE) / pd.w,
              (rWorld * TEX_SIZE) / pd.h,
              cr,
              cg,
              cb,
              0.16 + intensity * 0.14
            );
            dirty = true;
          }
        }
        for (let n = 0; n < MAX_STAMPS_PER_FRAME; n++) {
          const dx = scratch.aim.x - lastStamp.current.x;
          const dy = scratch.aim.y - lastStamp.current.y;
          const d = Math.hypot(dx, dy);
          if (d < step) break;
          lastStamp.current.x += (dx / d) * step;
          lastStamp.current.y += (dy / d) * step;

          const sx = ((lastStamp.current.x + pd.w / 2) / pd.w) * TEX_SIZE;
          const sy = ((pd.h / 2 - lastStamp.current.y) / pd.h) * TEX_SIZE;
          if (sx < -80 || sx > TEX_SIZE + 80 || sy < -80 || sy > TEX_SIZE + 80) continue;

          const rWorld =
            L.stroke * (idle ? 0.17 : 0.17 + intensity * 0.24) * (0.78 + Math.random() * 0.44);
          const rx = (rWorld * TEX_SIZE) / pd.w;
          const ry = (rWorld * TEX_SIZE) / pd.h;
          const alpha = idle ? 0.2 : 0.34 + intensity * 0.46;
          stampSplat(
            ctx,
            sx + (Math.random() - 0.5) * 4,
            sy + (Math.random() - 0.5) * 4,
            rx,
            ry,
            cr,
            cg,
            cb,
            alpha
          );
          // Occasional satellite speck sells the aerosol overspray.
          if (Math.random() < 0.3) {
            stampSplat(
              ctx,
              // Offsets are per-axis: rx and ry are the same world radius
              // measured in a texture whose texels are not square.
              sx + (Math.random() - 0.5) * rx * 3,
              sy + (Math.random() - 0.5) * ry * 3,
              rx * 0.28,
              ry * 0.28,
              cr,
              cg,
              cb,
              alpha * 0.8
            );
          }
          // Heavy patches run. Only fresh, high-intensity paint drips.
          if (!idle && intensity > 0.45 && Math.random() < 0.045) {
            for (let f = 0; f < drips.length; f++) {
              const free = drips[f];
              if (free.active) continue;
              free.active = true;
              free.x = sx;
              free.y = sy + ry * 0.5;
              free.vy = 13 + Math.random() * 30;
              // Width comes off the *x* radius: the square texture is
              // stretched over a non-square plane, so a width taken from ry
              // would come out hair-thin in portrait and fat in landscape.
              free.w = Math.max(1.5, rx * (0.16 + Math.random() * 0.18));
              free.life = 1.2 + Math.random() * 1.9;
              free.r = cr;
              free.g = cg;
              free.b = cb;
              free.a = 0.3 + Math.random() * 0.28;
              break;
            }
          }
          dirty = true;
        }
        // Never build an unbounded backlog after a pointer teleport.
        if (
          Math.hypot(scratch.aim.x - lastStamp.current.x, scratch.aim.y - lastStamp.current.y) >
          step * 5
        ) {
          lastStamp.current.set(scratch.aim.x, scratch.aim.y);
        }
      } else {
        lastStamp.current.set(scratch.aim.x, scratch.aim.y);
      }

      // Drips keep running after the spray stops — that is the whole point.
      // Two passes per segment (wide + faint, narrow + solid) fake a soft
      // edge without paying for a gradient per drip per frame.
      const aniso = pd.w / pd.h; // texel aspect, for the round bead below
      ctx.lineCap = 'round';
      for (let i = 0; i < drips.length; i++) {
        const d = drips[i];
        if (!d.active) continue;
        const ny = d.y + d.vy * delta;
        const dr = Math.round(d.r);
        const dg = Math.round(d.g);
        const db = Math.round(d.b);
        ctx.strokeStyle = `rgba(${dr},${dg},${db},${d.a * 0.3})`;
        ctx.lineWidth = d.w * 2.2;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x, ny);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${dr},${dg},${db},${d.a})`;
        ctx.lineWidth = d.w;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x, ny);
        ctx.stroke();
        d.y = ny;
        d.life -= delta;
        d.vy *= 1 - 0.65 * delta; // paint thins out as it runs
        d.w *= 1 - 0.2 * delta;
        if (d.life <= 0 || d.y > TEX_SIZE + 24 || d.w < 1.2) {
          // A bead of paint always collects at the end of a run.
          stampSplat(ctx, d.x, d.y, d.w * 1.9, d.w * 1.9 * aniso, d.r, d.g, d.b, d.a);
          d.active = false;
        }
        dirty = true;
      }
    }
    if (dirty) texPending.current = true;
    texClock.current += delta;
    if (texPending.current && texClock.current >= 1 / 30) {
      splat.texture.needsUpdate = true;
      texPending.current = false;
      texClock.current = 0;
    }

    // ----- mist: additive cone out of the nozzle, carried by the sweep
    const mesh = puffMeshRef.current;
    if (mesh) {
      if (nozzleRef.current) nozzleRef.current.getWorldPosition(scratch.nozzle);
      else scratch.nozzle.copy(canPos.current).add(scratch.worldUp);

      // Steady-state population is rate * mean life (~0.47s). Kept under the
      // pool size on purpose: starving the free list would make the plume
      // flicker rather than simply cap.
      const rate = idle ? 70 : 60 + 540 * intensity;
      spawnDebt.current += delta * rate;
      let toSpawn = Math.floor(spawnDebt.current);
      spawnDebt.current -= toSpawn;

      // Spray direction is a blend: mostly at the wall the paint lands on,
      // partly along the nozzle's own axis. Pure wall-aim would fire the
      // whole plume straight away from the camera, where the can's body
      // hides it; the axis term lifts it into view without breaking the
      // agreement between where the mist goes and where the paint lands.
      scratch.dir.copy(scratch.aim).sub(scratch.nozzle);
      if (scratch.dir.lengthSq() < 1e-6) scratch.dir.set(0, 0, -1);
      scratch.dir.normalize().addScaledVector(scratch.nozzleAxis, 0.62).normalize();
      const upRef =
        Math.abs(scratch.dir.dot(scratch.worldUp)) > 0.95 ? scratch.altUp : scratch.worldUp;
      scratch.right.crossVectors(upRef, scratch.dir).normalize();
      scratch.up.crossVectors(scratch.dir, scratch.right).normalize();

      // Two separate scales: the cone widens with the can so the plume stays
      // in proportion, but the individual droplets grow far more slowly —
      // scaling them 1:1 turns fine mist into a handful of beach balls.
      const coneScale = 0.5 + appliedScale.current * 0.3;
      const puffScale = 0.5 + appliedScale.current * 0.22;

      while (toSpawn-- > 0) {
        const index = freeList.current.pop();
        if (index === undefined) break;
        const puff = puffs[index];

        const angle = Math.random() * Math.PI * 2;
        // sqrt keeps the cone cross-section evenly filled, not centre-heavy.
        const radius = Math.sqrt(Math.random()) * (0.3 + intensity * 0.45) * coneScale;
        scratch.spread
          .copy(scratch.right)
          .multiplyScalar(Math.cos(angle) * radius)
          .addScaledVector(scratch.up, Math.sin(angle) * radius);

        puff.position.copy(scratch.nozzle).addScaledVector(scratch.dir, 0.1);
        puff.velocity
          .copy(scratch.dir)
          .multiplyScalar(6.5 + Math.random() * 3.6)
          .add(scratch.spread)
          // Paint gets dragged along by the can, which is what turns the cone
          // into a streak when you sweep fast.
          .addScaledVector(canVel.current, 0.8);
        puff.maxLife = 0.32 + Math.random() * 0.3;
        puff.life = puff.maxLife;
        puff.scale = ((idle ? 0.035 : 0.045) + Math.random() * 0.075) * puffScale;
        puff.color.copy(scratch.tint);
      }

      for (let i = 0; i < POOL; i++) {
        const puff = puffs[i];
        if (puff.life <= 0) continue;
        puff.life -= delta;
        if (puff.life <= 0) {
          freeList.current.push(i);
          dummy.position.set(0, 0, -10000);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }
        puff.position.addScaledVector(puff.velocity, delta);
        puff.velocity.multiplyScalar(1 - 2.4 * delta); // air drag
        puff.velocity.y += 0.3 * delta; // faint lift, so mist hangs

        const lifeT = puff.life / puff.maxLife;
        dummy.position.copy(puff.position);
        dummy.scale.setScalar(puff.scale * (1.9 - lifeT * 0.9) * lifeT);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // Young puffs burn out toward white; additive blending turns that
        // into a hot core at the nozzle and a coloured tail behind it.
        scratch.puffTint.copy(puff.color).multiplyScalar(0.55 + lifeT * lifeT * 1.15);
        mesh.setColorAt(i, scratch.puffTint);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // ----- ambient motes drifting up through the volume
    const points = motesRef.current;
    if (points && cd.w > 0) {
      const halfW = cd.w * 0.72;
      const halfH = cd.h * 0.62;
      const pos = motes.positions;
      if (!motes.seeded) {
        for (let i = 0; i < MOTE_COUNT; i++) {
          pos[i * 3] = (Math.random() * 2 - 1) * halfW;
          pos[i * 3 + 1] = (Math.random() * 2 - 1) * halfH;
          pos[i * 3 + 2] = BACK_Z + 0.8 + Math.random() * (CAN_Z - BACK_Z);
          samplePalette(Math.random() * PALETTE.length, scratch.paintRgb);
          const dim = 0.25 + Math.random() * 0.55;
          motes.colors[i * 3] = (scratch.paintRgb[0] / 255) * dim;
          motes.colors[i * 3 + 1] = (scratch.paintRgb[1] / 255) * dim;
          motes.colors[i * 3 + 2] = (scratch.paintRgb[2] / 255) * dim;
          motes.rise[i] = 0.05 + Math.random() * 0.16;
          motes.phase[i] = Math.random() * Math.PI * 2;
        }
        motes.geometry.attributes.color.needsUpdate = true;
        motes.seeded = true;
      }
      for (let i = 0; i < MOTE_COUNT; i++) {
        const base = i * 3;
        pos[base] += Math.sin(t * 0.32 + motes.phase[i]) * 0.06 * delta * 12;
        pos[base + 1] += motes.rise[i] * delta * 6;
        if (pos[base + 1] > halfH) {
          pos[base + 1] = -halfH;
          pos[base] = (Math.random() * 2 - 1) * halfW;
        }
        if (pos[base] > halfW) pos[base] = -halfW;
        else if (pos[base] < -halfW) pos[base] = halfW;
      }
      motes.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <>
      {/* Backdrop wall the paint lands on. Basic material + toneMapped off
          keeps the splats exactly as vivid as they were drawn. */}
      <mesh position={[0, 0, BACK_Z]}>
        <planeGeometry args={[planeW, planeH]} />
        <meshBasicMaterial map={splat.texture} toneMapped={false} />
      </mesh>

      {/* Ambient paint dust. One Points draw call for the whole volume. */}
      <points ref={motesRef} geometry={motes.geometry} frustumCulled={false}>
        <pointsMaterial
          size={0.17}
          map={sprites.mote}
          vertexColors
          transparent
          opacity={0.85}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          sizeAttenuation
        />
      </points>

      {/* Neon bloom behind the can — drawn before the mist so puffs stay on
          top of it. */}
      <sprite ref={haloRef} material={haloMat} renderOrder={-1} />

      {/* The spray can (or a stand-in until the GLB lands / if it never does).
          The rig's origin is the nozzle with the body hanging below after the
          upright rotation, so it is lifted by half its length to centre the
          body on the group origin — tilts pivot around the can's middle.
          Group scale is driven per-frame from the layout. */}
      <group ref={canGroupRef} position={[2.5, 0, CAN_Z]}>
        {rig ? (
          <group position={[0, CAN_LENGTH / 2, 0]}>
            <primitive object={rig} />
          </group>
        ) : (
          <group>
            <mesh position={[0, -0.12, 0]}>
              <cylinderGeometry args={[0.24, 0.24, 1.1, 24]} />
              <meshStandardMaterial color="#1d1d2a" roughness={0.32} metalness={0.65} />
            </mesh>
            <mesh position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.15, 0.21, 0.14, 20]} />
              <meshStandardMaterial color="#3a3a4c" roughness={0.4} metalness={0.5} />
            </mesh>
            <mesh position={[0, 0.62, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.12, 12]} />
              <meshStandardMaterial color="#f4f4f7" roughness={0.5} />
            </mesh>
          </group>
        )}

        {/* Nozzle anchor: particle origin plus the muzzle flash. */}
        <group ref={nozzleRef} position={[0, CAN_LENGTH * 0.55, 0]}>
          <sprite ref={flashRef} material={flashMat} />
        </group>

        {/* Paint light: in front of the nozzle rather than behind it, so the
            colour currently being sprayed actually washes the can's body. */}
        <pointLight
          ref={lightRef}
          position={[0, CAN_LENGTH * 0.5, 0.75]}
          intensity={0.6}
          distance={7}
          decay={1.6}
          color="#FF4D1C"
        />
        {/* Counter-rim from behind and camera-right: grazes the silhouette so
            the can separates from the wall even when it is not spraying. */}
        <pointLight
          ref={rimLightRef}
          position={[0.9, -CAN_LENGTH * 0.2, -0.9]}
          intensity={0.4}
          distance={6}
          decay={1.7}
          color="#22D3EE"
        />
      </group>

      {/* Aerosol puffs. */}
      <instancedMesh ref={puffMeshRef} args={[undefined, undefined, POOL]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 5]} />
        <meshBasicMaterial
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          color="#ffffff"
        />
      </instancedMesh>
    </>
  );
}

/**
 * Full-viewport hero canvas. The parent positions it absolute inset-0 behind
 * the overlay UI; pointer tracking is on window, so overlays never block it.
 */
const LandingHero: React.FC = () => (
  <Canvas
    dpr={[1, 2]}
    camera={{ fov: 42, position: [0, 0, 10], near: 0.1, far: 60 }}
    gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    style={{ width: '100%', height: '100%' }}
  >
    <ambientLight intensity={0.35} />
    <directionalLight position={[5, 7, 6]} intensity={1.1} color="#fff1e0" />
    <directionalLight position={[-6, -2, 4]} intensity={0.35} color="#8fd8ff" />
    <Suspense fallback={null}>
      <StudioEnvironment intensity={0.55} />
      <HeroScene />
    </Suspense>
  </Canvas>
);

export default LandingHero;
