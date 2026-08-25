/**
 * Landing hero — the spray can you get to play with before ever joining a room.
 *
 * A full-viewport R3F scene: the real spray-can model floats over a dark
 * backdrop plane, follows the pointer on a critically-damped spring, banks
 * into its own velocity, and *sprays* while you move — an additive particle
 * cone out of the nozzle plus soft paint splats stamped into a CanvasTexture
 * on the backdrop. Paint accumulates, so visitors literally tag the page.
 *
 * Deliberately self-contained: no CDN environment maps (StudioEnvironment is
 * Lightformer-based), no font-fetching text, and the paint is a plain 2D
 * canvas rather than the app's paint engine — this page must render even if
 * everything but the bundle fails to load.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadToolRig } from './toolRig';
import { StudioEnvironment } from './StudioEnvironment';

/** Splat colours, cycled slowly. Matches the app's controller palette. */
const PALETTE = ['#FF4D1C', '#FFB020', '#D9F32B', '#34D399', '#22D3EE', '#A78BFA', '#E879F9'];
const PALETTE_RGB = PALETTE.map((hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
});

const BACK_Z = -4; // backdrop plane depth
const CAN_Z = 1.6; // depth the can floats at
const CAN_LENGTH = 1.55; // world-units barrel length (matches the spray rig)
const POOL = 300; // particle pool — bounded, instanced
const TEX_SIZE = 1024; // splat texture resolution
const IDLE_AFTER_MS = 2500; // pointer silence before the lissajous drift kicks in
const MAX_STAMPS_PER_FRAME = 6;

/** Interpolated palette sample; t in "palette indices" (wraps). */
function samplePalette(t: number): [number, number, number] {
  const n = PALETTE_RGB.length;
  const f = ((t % n) + n) % n;
  const i = Math.floor(f);
  const a = PALETTE_RGB[i];
  const b = PALETTE_RGB[(i + 1) % n];
  const k = f - i;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
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
  const grad = ctx.createRadialGradient(0, 0, ry * 0.05, 0, 0, ry);
  grad.addColorStop(0, `rgba(${rr},${gg},${bb},${alpha})`);
  grad.addColorStop(0.55, `rgba(${rr},${gg},${bb},${alpha * 0.55})`);
  grad.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, ry, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Dark backdrop base with a subtle centre glow, plus a few faint seed splats. */
function createSplatCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0a0a13';
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    const glow = ctx.createRadialGradient(
      TEX_SIZE * 0.62,
      TEX_SIZE * 0.44,
      TEX_SIZE * 0.05,
      TEX_SIZE * 0.6,
      TEX_SIZE * 0.5,
      TEX_SIZE * 0.85
    );
    glow.addColorStop(0, 'rgba(40,40,60,0.85)');
    glow.addColorStop(0.55, 'rgba(20,20,33,0.45)');
    glow.addColorStop(1, 'rgba(8,8,14,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    // Faint pre-seeded tags so the wall never reads as empty on first paint.
    for (let i = 0; i < 7; i++) {
      const [r, g, b] = PALETTE_RGB[i % PALETTE_RGB.length];
      const px = TEX_SIZE * (0.42 + Math.random() * 0.5);
      const py = TEX_SIZE * (0.15 + Math.random() * 0.7);
      const rad = TEX_SIZE * (0.028 + Math.random() * 0.05);
      stampSplat(ctx, px, py, rad, rad, r, g, b, 0.09 + Math.random() * 0.07);
    }
  }
  return { canvas, ctx };
}

/** Project an NDC pointer position onto the world plane z = planeZ. */
function ndcToPlane(nx: number, ny: number, camera: THREE.Camera, planeZ: number, out: THREE.Vector3) {
  out.set(nx, ny, 0.5).unproject(camera);
  out.sub(camera.position);
  const t = (planeZ - camera.position.z) / (out.z || -1e-6);
  out.multiplyScalar(t).add(camera.position);
  out.z = planeZ;
}

/** Project the ray camera→point onward onto the plane z = planeZ. */
function throughPointToPlane(camera: THREE.Camera, point: THREE.Vector3, planeZ: number, out: THREE.Vector3) {
  out.copy(point).sub(camera.position);
  const t = (planeZ - camera.position.z) / (out.z || -1e-6);
  out.multiplyScalar(t).add(camera.position);
  out.z = planeZ;
}

interface Puff {
  life: number;
  maxLife: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: number;
  color: THREE.Color;
}

function HeroScene() {
  const { camera, viewport } = useThree();

  const canGroupRef = useRef<THREE.Group>(null);
  const nozzleRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const puffMeshRef = useRef<THREE.InstancedMesh>(null);

  const [rig, setRig] = useState<THREE.Group | null>(null);

  // ---- spray-can model (async; fallback stand-in until it lands / if it fails)
  useEffect(() => {
    let cancelled = false;
    loadToolRig('spray')
      .then(({ root }) => {
        if (cancelled) return;
        // The rig plants the nozzle tip at its origin with the body running
        // along +Z; rotating X by +PI/2 stands it upright, nozzle on top.
        root.rotation.x = Math.PI / 2;
        setRig(root);
      })
      .catch((err) => console.warn('[LandingHero] spray can failed to load, using stand-in', err));
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- splat texture (plain 2D canvas → CanvasTexture on the backdrop)
  const splat = useMemo(() => {
    const { canvas, ctx } = createSplatCanvas();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { canvas, ctx, texture };
  }, []);
  useEffect(() => () => splat.texture.dispose(), [splat]);

  // ---- pointer, tracked on window so the overlay UI never blocks the hero
  const pointerRef = useRef({ x: 0, y: 0, active: false, lastMoveMs: 0 });
  useEffect(() => {
    const setFrom = (clientX: number, clientY: number) => {
      const p = pointerRef.current;
      p.x = (clientX / window.innerWidth) * 2 - 1;
      p.y = -(clientY / window.innerHeight) * 2 + 1;
      p.active = true;
      p.lastMoveMs = performance.now();
    };
    const onPointer = (e: PointerEvent) => setFrom(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length > 0) setFrom(e.touches[0].clientX, e.touches[0].clientY);
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('touchstart', onTouch, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('touchstart', onTouch);
    };
  }, []);

  // ---- world-space extents at the two working depths
  const backAnchor = useMemo(() => new THREE.Vector3(0, 0, BACK_Z), []);
  const canAnchor = useMemo(() => new THREE.Vector3(0, 0, CAN_Z), []);
  const backVp = viewport.getCurrentViewport(camera, backAnchor);
  const canVp = viewport.getCurrentViewport(camera, canAnchor);
  const planeW = backVp.width * 1.15;
  const planeH = backVp.height * 1.15;
  const planeDims = useRef({ w: 0, h: 0 });
  const canDims = useRef({ w: 12, h: 7 });
  useEffect(() => {
    planeDims.current = { w: planeW, h: planeH };
    canDims.current = { w: canVp.width, h: canVp.height };
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
    }),
    []
  );

  // ---- particle pool (bounded, instanced, free-list — same shape as SprayMist)
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

  // Park every instance off-screen before the first frame — otherwise the
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
    const idle = !p.active || now - p.lastMoveMs > IDLE_AFTER_MS;

    // ----- where the can wants to be
    const cd = canDims.current;
    if (idle) {
      // Slow lissajous drift, biased centre-right on wide screens, so the
      // page never looks dead when nobody is moving the pointer.
      const cx = cd.w > cd.h ? cd.w * 0.17 : 0;
      const cy = cd.h * 0.04;
      scratch.targetPos.set(
        cx + Math.sin(t * 0.55) * cd.w * 0.21,
        cy + Math.sin(t * 0.34 + 1.4) * cd.h * 0.2,
        CAN_Z
      );
    } else {
      ndcToPlane(p.x, p.y, camera, CAN_Z, scratch.targetPos);
    }

    // Critically damped spring — position feels alive, velocity drives tilt.
    const stiffness = 42;
    const damping = 2 * Math.sqrt(stiffness);
    scratch.accel.copy(scratch.targetPos).sub(canPos.current).multiplyScalar(stiffness);
    scratch.accel.addScaledVector(canVel.current, -damping);
    canVel.current.addScaledVector(scratch.accel, delta);
    canPos.current.addScaledVector(canVel.current, delta);

    // ----- aim point on the backdrop
    if (idle) {
      throughPointToPlane(camera, canPos.current, BACK_Z, scratch.aim);
    } else {
      ndcToPlane(p.x, p.y, camera, BACK_Z, scratch.aim);
    }

    // ----- spray intensity from aim-point speed (attack fast, decay slow)
    const speed = hasPrevAim.current
      ? scratch.aim.distanceTo(prevAim.current) / Math.max(delta, 1e-4)
      : 0;
    prevAim.current.copy(scratch.aim);
    hasPrevAim.current = true;
    const targetIntensity = idle ? 0.28 : Math.min(1, speed / 7);
    const k = targetIntensity > intensityRef.current ? 10 : 3.2;
    intensityRef.current += (targetIntensity - intensityRef.current) * (1 - Math.exp(-k * delta));
    const intensity = intensityRef.current;

    // ----- colour cycle
    cycleT.current += delta * (0.14 + intensity * 0.1);
    const [cr, cg, cb] = samplePalette(cycleT.current);

    // ----- pose the can: upright, banking into its velocity
    const group = canGroupRef.current;
    if (group) {
      group.position.copy(canPos.current);
      const tiltZ = THREE.MathUtils.clamp(-canVel.current.x * 0.055, -0.5, 0.5);
      const tiltX = -0.16 + THREE.MathUtils.clamp(canVel.current.y * 0.035, -0.32, 0.32);
      const blend = 1 - Math.exp(-10 * delta);
      group.rotation.z += (tiltZ - group.rotation.z) * blend;
      group.rotation.x += (tiltX - group.rotation.x) * blend;
      group.rotation.y = Math.sin(t * 0.6) * 0.22;
    }
    if (lightRef.current) {
      lightRef.current.color.setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
      lightRef.current.intensity = 0.4 + intensity * 1.5;
    }

    // ----- stamp splats onto the backdrop, throttled by travelled distance
    const ctx = splat.ctx;
    const pd = planeDims.current;
    if (ctx && pd.w > 0 && intensity > 0.06) {
      const step = idle ? 0.5 : 0.24;
      let drew = false;
      for (let n = 0; n < MAX_STAMPS_PER_FRAME; n++) {
        const dx = scratch.aim.x - lastStamp.current.x;
        const dy = scratch.aim.y - lastStamp.current.y;
        const d = Math.hypot(dx, dy);
        if (d < step) break;
        lastStamp.current.x += (dx / d) * step;
        lastStamp.current.y += (dy / d) * step;

        const px = ((lastStamp.current.x + pd.w / 2) / pd.w) * TEX_SIZE;
        const py = ((pd.h / 2 - lastStamp.current.y) / pd.h) * TEX_SIZE;
        if (px < -60 || px > TEX_SIZE + 60 || py < -60 || py > TEX_SIZE + 60) continue;

        const rWorld = (idle ? 0.16 : 0.14 + intensity * 0.22) * (0.75 + Math.random() * 0.5);
        const rx = (rWorld * TEX_SIZE) / pd.w;
        const ry = (rWorld * TEX_SIZE) / pd.h;
        const alpha = idle ? 0.13 : 0.2 + intensity * 0.35;
        stampSplat(
          ctx,
          px + (Math.random() - 0.5) * 4,
          py + (Math.random() - 0.5) * 4,
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
            px + (Math.random() - 0.5) * ry * 3,
            py + (Math.random() - 0.5) * ry * 3,
            rx * 0.28,
            ry * 0.28,
            cr,
            cg,
            cb,
            alpha * 0.8
          );
        }
        drew = true;
      }
      // Never build an unbounded backlog after a pointer teleport.
      if (
        Math.hypot(scratch.aim.x - lastStamp.current.x, scratch.aim.y - lastStamp.current.y) >
        step * 5
      ) {
        lastStamp.current.set(scratch.aim.x, scratch.aim.y);
      }
      if (drew) splat.texture.needsUpdate = true;
    } else {
      lastStamp.current.set(scratch.aim.x, scratch.aim.y);
    }

    // ----- particles: additive cone out of the nozzle toward the aim point
    const mesh = puffMeshRef.current;
    if (mesh) {
      if (nozzleRef.current) nozzleRef.current.getWorldPosition(scratch.nozzle);
      else scratch.nozzle.copy(canPos.current).add(scratch.worldUp);

      const rate = idle ? 40 : 30 + 300 * intensity;
      spawnDebt.current += delta * rate;
      let toSpawn = Math.floor(spawnDebt.current);
      spawnDebt.current -= toSpawn;

      scratch.dir.copy(scratch.aim).sub(scratch.nozzle);
      if (scratch.dir.lengthSq() < 1e-6) scratch.dir.set(0, 0, -1);
      scratch.dir.normalize();
      const upRef = Math.abs(scratch.dir.dot(scratch.worldUp)) > 0.95 ? scratch.altUp : scratch.worldUp;
      scratch.right.crossVectors(upRef, scratch.dir).normalize();
      scratch.up.crossVectors(scratch.dir, scratch.right).normalize();

      while (toSpawn-- > 0) {
        const index = freeList.current.pop();
        if (index === undefined) break;
        const puff = puffs[index];

        const angle = Math.random() * Math.PI * 2;
        // sqrt keeps the cone cross-section evenly filled, not centre-heavy.
        const radius = Math.sqrt(Math.random()) * (0.35 + intensity * 0.5);
        scratch.spread
          .copy(scratch.right)
          .multiplyScalar(Math.cos(angle) * radius)
          .addScaledVector(scratch.up, Math.sin(angle) * radius);

        puff.position.copy(scratch.nozzle).addScaledVector(scratch.dir, 0.1);
        puff.velocity.copy(scratch.dir).multiplyScalar(5 + Math.random() * 2.6).add(scratch.spread);
        puff.maxLife = 0.3 + Math.random() * 0.28;
        puff.life = puff.maxLife;
        puff.scale = (idle ? 0.035 : 0.045) + Math.random() * 0.075;
        puff.color.setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
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
        puff.velocity.multiplyScalar(1 - 3 * delta); // air drag
        puff.velocity.y += 0.3 * delta; // faint lift, so mist hangs

        const lifeT = puff.life / puff.maxLife;
        dummy.position.copy(puff.position);
        dummy.scale.setScalar(puff.scale * (1.9 - lifeT * 0.9) * lifeT);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, puff.color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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

      {/* The spray can (or a stand-in until the GLB lands / if it never does).
          The rig's origin is the nozzle with the body hanging below after the
          upright rotation, so it is lifted by half its length to centre the
          body on the group origin — tilts pivot around the can's middle. */}
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
        {/* Nozzle anchor: particle origin + a paint-coloured glow. */}
        <group ref={nozzleRef} position={[0, CAN_LENGTH * 0.55, 0]} />
        <pointLight
          ref={lightRef}
          position={[0, CAN_LENGTH * 0.55, -0.4]}
          intensity={0.6}
          distance={7}
          decay={1.6}
          color="#FF4D1C"
        />
      </group>

      {/* Aerosol puffs. */}
      <instancedMesh ref={puffMeshRef} args={[undefined, undefined, POOL]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 5]} />
        <meshBasicMaterial
          transparent
          opacity={0.45}
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
