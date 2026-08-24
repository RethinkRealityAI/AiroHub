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
 * Base display pose. The rig points its nozzle along -Z (into the screen), so
 * with no tilt applied the camera stares at the can's base end-on — a circle.
 * Pitching the assembly ~64° brings it to the iconic hold: can nearly upright,
 * nozzle up, leaning gently toward the canvas, label facing the player. Device
 * rotation is applied inside this pose, so phone tilt still reads naturally.
 */
const BASE_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(64), 0, 0));

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
    deviceQuat.premultiply(BASE_TILT);
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
    group.position.set(shakeX, idleY + shakeY - 0.55, 0);

    // Trigger recoil: the can kicks back along its own +Z when pressed.
    const recoil = recoilRef.current;
    if (recoil) {
      const target = pressed ? 0.16 : 0;
      recoil.position.z = THREE.MathUtils.lerp(recoil.position.z, target, 1 - Math.exp(-20 * delta));
      const targetScale = pressed ? 0.97 : 1;
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

        // Nozzle sits at the rig origin; spray leaves along the tool's -Z.
        nozzleWorld.set(0, 0, 0).applyQuaternion(displayQuat.current).add(group.position);
        sprayDir.set(0, 0, -1).applyQuaternion(displayQuat.current);

        for (let n = 0; n < toSpawn; n++) {
          const index = freeList.current.pop();
          if (index === undefined) break;
          const p = particles.current[index];
          p.pos.copy(nozzleWorld);
          const spread = 0.55;
          p.vel
            .copy(sprayDir)
            .multiplyScalar(3.6 + Math.random() * 1.4)
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * spread,
                (Math.random() - 0.5) * spread,
                (Math.random() - 0.5) * spread
              )
            );
          p.maxLife = 0.3 + Math.random() * 0.25;
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
      <group ref={groupRef} scale={1.12}>
        <group ref={recoilRef}>
          {rig ? (
            <primitive object={rig.root} />
          ) : (
            <mesh position={[0, 0, 0.8]}>
              <capsuleGeometry args={[0.22, 0.9, 4, 14]} />
              <meshStandardMaterial color={color} roughness={0.4} metalness={0.4} />
            </mesh>
          )}

          {/* Player-colour band near the tip, matching the studio view. */}
          <mesh position={[0, 0, 0.16]}>
            <torusGeometry args={[0.24, 0.045, 12, 28]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={pressed ? 1.1 : 0.5}
              roughness={0.3}
            />
          </mesh>

          {/* Aim ring floating just off the nozzle — lights up while painting. */}
          <mesh position={[0, 0, -0.55]}>
            <ringGeometry args={[0.1, 0.14, 26]} />
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
