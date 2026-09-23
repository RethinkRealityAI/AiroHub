/**
 * Aerosol mist particles.
 *
 * Rebuilt around a fixed-capacity instanced pool with a free list. The previous
 * version scanned the whole 2400-particle array looking for dead slots on every
 * frame for every player, and allocated fresh Vector3s inside the frame loop —
 * both of which cost more than the effect is worth.
 *
 * Particles are also soft-additive and cone-distributed along the actual spray
 * direction, so the mist reads as coming *out of the nozzle* rather than as a
 * cloud centred on the tool.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PlayerState } from '../types';
import { FOOTPRINT_SPRAY } from './PlayerTool';

const POOL = 1400;
const SPAWN_PER_SECOND = 320;
/** Mean speed along the spray axis, world units per second. */
const FORWARD_SPEED = 5.9;

interface Particle {
  life: number;
  maxLife: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: number;
  color: THREE.Color;
}

export const SprayMist: React.FC<{ players: PlayerState[] }> = ({ players }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const camera = useThree((state) => state.camera);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: POOL }, () => ({
        life: 0,
        maxLife: 1,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        scale: 0.1,
        color: new THREE.Color(),
      })),
    []
  );

  /** Indices of dead particles, so spawning is O(1) instead of a scan. */
  const freeList = useRef<number[]>(Array.from({ length: POOL }, (_, i) => i));
  const spawnDebt = useRef(0);

  // Scratch vectors, allocated once.
  const scratch = useMemo(
    () => ({
      origin: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      spread: new THREE.Vector3(),
      worldUp: new THREE.Vector3(0, 1, 0),
      altUp: new THREE.Vector3(1, 0, 0),
    }),
    []
  );

  // An InstancedMesh starts with every instance on the identity matrix, which
  // renders the whole unused pool as unit spheres piled on the origin. Park
  // them all off-screen before the first frame.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    dummy.position.set(0, 0, -10000);
    dummy.scale.setScalar(0.0001);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    for (let i = 0; i < POOL; i++) mesh.setMatrixAt(i, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // Clamp so a stalled tab doesn't teleport every particle on resume.
    const delta = Math.min(rawDelta, 0.05);

    const spraying = players.filter((p) => p.isPainting && p.tool === 'spray');

    if (spraying.length > 0) {
      spawnDebt.current += SPAWN_PER_SECOND * delta * spraying.length;
      const toSpawn = Math.floor(spawnDebt.current);
      spawnDebt.current -= toSpawn;

      for (let n = 0; n < toSpawn; n++) {
        const index = freeList.current.pop();
        if (index === undefined) break;

        const player = spraying[n % spraying.length];
        const p = particles[index];

        // From the can's nozzle to where the paint lands. `worldPos` is the
        // contact point itself, so spawning there (as this used to) put the
        // mist on the surface, flying off along a fixed axis.
        const from = player.toolTip ?? player.worldPos;
        scratch.origin.set(from[0], from[1], from[2]);
        if (player.surfacePoint) {
          scratch.dir
            .set(player.surfacePoint[0], player.surfacePoint[1], player.surfacePoint[2])
            .sub(scratch.origin);
        } else {
          scratch.dir.set(0, 0, 0);
        }
        const reach = scratch.dir.length();
        if (reach < 1e-3) camera.getWorldDirection(scratch.dir);
        scratch.dir.normalize();

        // Orthonormal basis around the spray axis for the cone spread.
        const upRef =
          Math.abs(scratch.dir.dot(scratch.worldUp)) > 0.95 ? scratch.altUp : scratch.worldUp;
        scratch.right.crossVectors(upRef, scratch.dir).normalize();
        scratch.up.crossVectors(scratch.dir, scratch.right).normalize();

        const angle = Math.random() * Math.PI * 2;
        // The fan widens with the nozzle size, matching the paint footprint.
        const fan = THREE.MathUtils.clamp(player.sizeMultiplier ?? 1, 0.3, 2.5);
        // sqrt keeps the cone cross-section evenly filled rather than centre-heavy.
        // Sized so the cone meets the surface at the painted footprint (the
        // same radius PlayerTool rings): lateral / forward speed = radius / reach.
        const cone = reach > 0.2 ? (FOOTPRINT_SPRAY * fan * FORWARD_SPEED) / reach : 0.75 * fan;
        const radius = Math.sqrt(Math.random()) * Math.min(cone, 4.5);
        scratch.spread
          .copy(scratch.right)
          .multiplyScalar(Math.cos(angle) * radius)
          .addScaledVector(scratch.up, Math.sin(angle) * radius);

        p.position.copy(scratch.origin).addScaledVector(scratch.dir, 0.12);
        p.velocity
          .copy(scratch.dir)
          .multiplyScalar(FORWARD_SPEED + (Math.random() - 0.5) * 1.6)
          .add(scratch.spread);
        p.maxLife = 0.34 + Math.random() * 0.22;
        p.life = p.maxLife;
        p.scale = (0.05 + Math.random() * 0.11) * (0.75 + 0.25 * fan);
        p.color.set(player.color);
      }
    }

    for (let i = 0; i < POOL; i++) {
      const p = particles[i];
      if (p.life <= 0) continue;

      p.life -= delta;
      if (p.life <= 0) {
        freeList.current.push(i);
        dummy.position.set(0, 0, -10000);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      p.position.addScaledVector(p.velocity, delta);
      // Air drag plus a touch of lift, so mist hangs instead of shooting off.
      p.velocity.multiplyScalar(1 - 3.2 * delta);
      p.velocity.y += 0.35 * delta;

      const t = p.life / p.maxLife;
      dummy.position.copy(p.position);
      // Expand as they fade — that read is what makes it look like a mist.
      dummy.scale.setScalar(p.scale * (1.9 - t * 0.9) * t);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, p.color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, POOL]} frustumCulled={false}>
      <sphereGeometry args={[1, 6, 5]} />
      <meshBasicMaterial
        transparent
        opacity={0.42}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        color="#ffffff"
      />
    </instancedMesh>
  );
};
