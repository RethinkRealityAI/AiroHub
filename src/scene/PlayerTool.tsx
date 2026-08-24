/**
 * A player's floating spray can / brush.
 *
 * Two things the previous version got wrong, both of which showed up as the
 * tool feeling "off" from where paint actually lands:
 *
 *  1. **Tip alignment.** The tool was oriented with `lookAt`, which aims the
 *     model's -Z axis at the surface, but the primitive can was modelled along
 *     +Y with the nozzle on top. The nozzle therefore pointed 90° away from the
 *     spray. Generated models have their own arbitrary axes too, so each is
 *     measured on load and re-anchored so its emitting tip sits exactly at the
 *     contact point, pointing down the surface normal.
 *
 *  2. **Rotation damping.** A fixed lerp factor is frame-rate dependent, so the
 *     tool lagged differently at 60 Hz and 120 Hz. Smoothing is now
 *     exponential in delta time.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { loadToolRig, ToolRig } from './toolRig';
import { NameTag } from './NameTag';

import { PlayerState } from '../types';

export interface PlayerToolProps {
  /**
   * The live player record. The frame loop mutates its transform fields every
   * frame without going through React, so this component reads them inside
   * useFrame — taking them as value props would freeze the tool between React
   * renders (which is exactly how the "can doesn't follow the mouse" bug
   * looked).
   */
  player: PlayerState;
  scale?: number;
}

const HOVER = { spray: 1.15, brush: 0.12 } as const;

/**
 * Lateral offset of the tool body from the contact point, as a fraction of the
 * hover distance.
 *
 * Without this the tool sits exactly on the surface normal, so whenever the
 * camera looks along that normal you see the flat base of the can end-on — a
 * white disc parked over the artwork. Offsetting it up and to the right makes
 * the tool approach at an angle, the way a hand actually holds a can, which
 * both reads correctly and keeps the contact point visible.
 */
const APPROACH = { up: 0.62, right: 0.42 } as const;

export const PlayerTool: React.FC<PlayerToolProps> = ({ player, scale = 1 }) => {
  const { tool, color, name: playerName, slot: playerSlot } = player;
  const groupRef = useRef<THREE.Group>(null);
  const [rigs, setRigs] = useState<Partial<Record<'spray' | 'brush', ToolRig>>>({});

  const reticleMat = useRef<THREE.MeshBasicMaterial>(null);
  const currentPos = useRef(new THREE.Vector3(...player.worldPos));
  const currentQuat = useRef(new THREE.Quaternion());
  const targetPos = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const normalVec = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const tangentRight = useMemo(() => new THREE.Vector3(), []);
  const tangentUp = useMemo(() => new THREE.Vector3(), []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const targetQuat = useMemo(() => new THREE.Quaternion(), []);
  const upHint = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useEffect(() => {
    let cancelled = false;
    loadToolRig(tool)
      .then((rig) => {
        if (!cancelled) setRigs((prev) => ({ ...prev, [tool]: rig }));
      })
      .catch((err) => console.error(`[PlayerTool] ${tool} rig failed to load`, err));
    return () => {
      cancelled = true;
    };
  }, [tool]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Live reads — these fields mutate every frame outside React.
    const { surfacePoint, surfaceNormal, worldPos: position, isPainting: active } = player;
    const hover = active ? HOVER[tool] : HOVER[tool] + 0.7;

    if (surfacePoint && surfaceNormal) {
      // Plant the tip on the surface, back the body off along the normal, then
      // swing it up and across so the can is held at an angle rather than
      // pointing straight down the camera axis.
      normalVec.set(surfaceNormal[0], surfaceNormal[1], surfaceNormal[2]).normalize();
      lookAt.set(surfacePoint[0], surfacePoint[1], surfacePoint[2]);

      const upRef = Math.abs(normalVec.dot(upHint)) > 0.95 ? new THREE.Vector3(0, 0, 1) : upHint;
      tangentRight.crossVectors(upRef, normalVec).normalize();
      tangentUp.crossVectors(normalVec, tangentRight).normalize();

      targetPos
        .copy(lookAt)
        .addScaledVector(normalVec, hover)
        .addScaledVector(tangentUp, hover * APPROACH.up)
        .addScaledVector(tangentRight, hover * APPROACH.right);
    } else {
      targetPos.set(position[0], position[1], position[2]);
      lookAt.set(0, 0, 0);
    }

    // Guard against a degenerate up vector when aiming straight up or down.
    const forward = lookAt.clone().sub(targetPos);
    if (forward.lengthSq() > 1e-6) {
      forward.normalize();
      const up = Math.abs(forward.dot(upHint)) > 0.985 ? new THREE.Vector3(0, 0, 1) : upHint;
      matrix.lookAt(targetPos, lookAt, up);
      targetQuat.setFromRotationMatrix(matrix);
    }

    // Frame-rate independent smoothing. Snap on large jumps so switching
    // objects or recentring does not produce a long swooping arc.
    const posBlend = 1 - Math.exp(-26 * delta);
    const rotBlend = 1 - Math.exp(-22 * delta);
    if (currentPos.current.distanceTo(targetPos) > 4) currentPos.current.copy(targetPos);
    else currentPos.current.lerp(targetPos, posBlend);
    currentQuat.current.slerp(targetQuat, rotBlend);

    group.position.copy(currentPos.current);
    group.quaternion.copy(currentQuat.current);

    if (reticleMat.current) reticleMat.current.opacity = active ? 0.95 : 0.4;
  });

  const rig = rigs[tool];

  return (
    <group ref={groupRef} scale={scale}>
      {rig ? (
        <primitive object={rig.root} />
      ) : (
        // Minimal stand-in until the model lands, so aim is never invisible.
        <mesh position={[0, 0, 0.5]}>
          <capsuleGeometry args={[0.16, 0.7, 4, 12]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} />
        </mesh>
      )}

      {/* Colour band so each player's can reads as theirs at a glance. The
          rig puts the emitting tip at the origin with the body running back
          along -Z, so the band has to sit at negative Z to be *on* the tool
          rather than floating in front of its nozzle. */}
      {rig && (
        <mesh position={[0, 0, rig.length * 0.4]}>
          <torusGeometry args={[0.2, 0.05, 10, 24]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.5}
            roughness={0.35}
          />
        </mesh>
      )}

      {/* Contact reticle sitting exactly where paint lands. */}
      <mesh>
        <ringGeometry args={[0.06, 0.1, 20]} />
        <meshBasicMaterial
          ref={reticleMat}
          color={color}
          transparent
          opacity={0.4}
          side={THREE.DoubleSide}
          depthTest={false}
        />
      </mesh>

      {playerName && (
        <NameTag text={`P${playerSlot} · ${playerName}`} color={color} />
      )}
    </group>
  );
};
