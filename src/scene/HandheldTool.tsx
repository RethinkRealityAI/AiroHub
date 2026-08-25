/**
 * The handheld tool — the phone *is* the spray can.
 *
 * Renders the same generated can/brush models the studio uses, floating on the
 * controller screen and rotating live with the phone's motion sensors. Tilt
 * the phone and the can tilts; pull the trigger and the can recoils, the mist
 * pours from the nozzle, and the aim ring lights up; shake the phone and it
 * rattles. This mirror between what the hand does and what both screens show
 * is the core feel of the app.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { loadToolRig, ToolRig } from './toolRig';

const PARTICLES = 260;

/**
 * Base display lean. The rig is stood upright inside the group (see
 * POSTURE_X), so identity orientation shows the can vertical, nozzle on top.
 * A slight negative X lean tips the top *away from the viewer, into the
 * screen* — you're holding the phone with its camera facing the studio, so
 * the can naturally leans toward the canvas you're spraying.
 */
const BASE_LEAN = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.16, 0, 0));

/**
 * Stand the rig upright inside the group — both tools are held the way a
 * person actually holds them at a wall: can nozzle on top, brush bristles
 * pointing up over the handle (not dangling tip-down like a pen).
 */
const POSTURE_X = { spray: Math.PI / 2, brush: Math.PI / 2 } as const;

/**
 * Spin about the can's own vertical axis. The generated can model bakes
 * nozzle-orifice detail on several sides, so no spin can hide it entirely
 * (screenshot-verified sweep); zero avoids dragging the texture seam into
 * view. The *spray direction* cues — mist and halo — always point into the
 * screen regardless.
 */
const SPIN_Z = { spray: 0, brush: 0 } as const;

/**
 * The can is the hero of Aim mode, so it fills most of the viewport: nozzle
 * near the top of the screen, body running past the bottom edge. The brush
 * sits lower and smaller so the whole tool (tip to handle) stays visible.
 */
const SCALE = { spray: 2.6, brush: 2.15 } as const;
const BASE_Y = { spray: 1.25, brush: 1.05 } as const;

interface HandheldToolProps {
  tool: 'spray' | 'brush';
  color: string;
  pressed: boolean;
  shaking: boolean;
  /** Live device rotation relative to the calibration pose. */
  getOrientation: (out: THREE.Quaternion) => void;
}

export const HandheldTool: React.FC<HandheldToolProps> = ({
  tool,
  color,
  pressed,
  shaking,
  getOrientation,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const recoilRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.InstancedMesh>(null);
  const [rigs, setRigs] = useState<Partial<Record<'spray' | 'brush', ToolRig>>>({});

  const deviceQuat = useMemo(() => new THREE.Quaternion(), []);
  const displayQuat = useRef(new THREE.Quaternion());
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);
  const nozzleWorld = useMemo(() => new THREE.Vector3(), []);
  const sprayDir = useMemo(() => new THREE.Vector3(), []);

  const particles = useRef(
    Array.from({ length: PARTICLES }, () => ({
      life: 0,
      maxLife: 1,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      scale: 0.05,
    }))
  );
  const freeList = useRef<number[]>(Array.from({ length: PARTICLES }, (_, i) => i));
  const spawnDebt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadToolRig(tool)
      .then((rig) => {
        if (!cancelled) setRigs((prev) => ({ ...prev, [tool]: rig }));
      })
      .catch((err) => console.error('[HandheldTool] rig load failed', err));
    return () => {
      cancelled = true;
    };
  }, [tool]);

  // Park the whole particle pool off-screen before the first frame.
  useEffect(() => {
    const mesh = particlesRef.current;
    if (!mesh) return;
    dummy.position.set(0, 0, -1000);
    dummy.scale.setScalar(0.0001);
    dummy.updateMatrix();
    for (let i = 0; i < PARTICLES; i++) mesh.setMatrixAt(i, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  useFrame((state, rawDelta) => {
    const group = groupRef.current;
    if (!group) return;
    const delta = Math.min(rawDelta, 0.05);
    const time = state.clock.elapsedTime;

    // ---- Orientation: live sensors inside the display pose ----
    getOrientation(deviceQuat);
    deviceQuat.premultiply(BASE_LEAN);
    displayQuat.current.slerp(deviceQuat, 1 - Math.exp(-16 * delta));
    group.quaternion.copy(displayQuat.current);

    // Idle float + shake rattle.
    const idleY = Math.sin(time * 1.9) * 0.05;
    let shakeX = 0;
    let shakeY = 0;
    if (shaking) {
      shakeX = (Math.random() - 0.5) * 0.28;
      shakeY = (Math.random() - 0.5) * 0.28;
    }
    group.position.set(shakeX, idleY + shakeY + BASE_Y[tool], 0);

    // Trigger recoil: the can dips slightly into the grip when pressed.
    const recoil = recoilRef.current;
    if (recoil) {
      const target = pressed ? -0.07 : 0;
      recoil.position.y = THREE.MathUtils.lerp(recoil.position.y, target, 1 - Math.exp(-20 * delta));
      const targetScale = pressed ? 0.985 : 1;
      const s = THREE.MathUtils.lerp(recoil.scale.x, targetScale, 1 - Math.exp(-20 * delta));
      recoil.scale.setScalar(s);
    }

    // ---- Aerosol mist from the nozzle while spraying ----
    const mesh = particlesRef.current;
    if (mesh) {
      if (pressed && tool === 'spray') {
        spawnDebt.current += 190 * delta;
        const toSpawn = Math.floor(spawnDebt.current);
        spawnDebt.current -= toSpawn;

        // The nozzle sits at the group origin (top of the upright can). Mist
        // spawns *behind* the can and rushes into the screen toward the
        // studio — the viewer only ever sees it leaving. The particle pool
        // lives outside the scaled group, so the offset scales manually.
        const s = SCALE[tool];
        nozzleWorld.set(0, 0.12 * s, -0.32 * s).applyQuaternion(displayQuat.current).add(group.position);
        sprayDir.set(0, 0.18, -1).normalize().applyQuaternion(displayQuat.current);

        for (let n = 0; n < toSpawn; n++) {
          const index = freeList.current.pop();
          if (index === undefined) break;
          const p = particles.current[index];
          p.pos.copy(nozzleWorld);
          const spread = 0.55;
          p.vel
            .copy(sprayDir)
            .multiplyScalar(4.2 + Math.random() * 1.6)
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * spread,
                (Math.random() - 0.5) * spread,
                (Math.random() - 0.5) * spread
              )
            );
          p.maxLife = 0.24 + Math.random() * 0.2;
          p.life = p.maxLife;
          p.scale = 0.035 + Math.random() * 0.075;
        }
      }

      colorObj.set(color);
      for (let i = 0; i < PARTICLES; i++) {
        const p = particles.current[i];
        if (p.life <= 0) continue;
        p.life -= delta;
        if (p.life <= 0) {
          freeList.current.push(i);
          dummy.position.set(0, 0, -1000);
          dummy.scale.setScalar(0.0001);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }
        p.pos.addScaledVector(p.vel, delta);
        p.vel.multiplyScalar(1 - 2.6 * delta);
        const t = p.life / p.maxLife;
        dummy.position.copy(p.pos);
        dummy.scale.setScalar(p.scale * (2 - t) * t);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, colorObj);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  const rig = rigs[tool];

  return (
    <>
      <group ref={groupRef} scale={SCALE[tool]}>
        <group ref={recoilRef}>
          <group rotation={[POSTURE_X[tool], 0, 0]}>
            <group rotation={[0, 0, SPIN_Z[tool]]}>
              {rig ? (
                <primitive object={rig.root} />
              ) : (
                <mesh position={[0, 0, 0.8]}>
                  <capsuleGeometry args={[0.22, 0.9, 4, 14]} />
                  <meshStandardMaterial color={color} roughness={0.4} metalness={0.4} />
                </mesh>
              )}
            </group>

            {/* Player-colour band around the body, matching the studio view.
                The brush handle is far thinner than the can, so its band is a
                slim grip ring rather than a can collar. */}
            <mesh position={[0, 0, tool === 'spray' ? 0.55 : 0.72]}>
              <torusGeometry args={tool === 'spray' ? [0.24, 0.05, 12, 28] : [0.09, 0.028, 12, 28]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={pressed ? 1.1 : 0.5}
                roughness={0.3}
              />
            </mesh>
          </group>

          {/* Aim halo just behind the nozzle, tilted into the screen — it
              hints at where the aerosol goes, and lights up while painting. */}
          <mesh position={[0, 0.14, -0.34]} rotation={[-Math.PI / 2.6, 0, 0]}>
            <ringGeometry args={[0.12, 0.16, 26]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={pressed ? 0.95 : 0.35}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      </group>

      <instancedMesh ref={particlesRef} args={[undefined, undefined, PARTICLES]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 5]} />
        <meshBasicMaterial
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color="#ffffff"
        />
      </instancedMesh>
    </>
  );
};
