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
import { loadModel } from '../paint/modelRegistry';
import { NameTag } from './NameTag';

export interface PlayerToolProps {
  /** Where the tool body should hover. */
  position: [number, number, number];
  /** Point on the object the tool is aimed at. */
  surfacePoint?: [number, number, number];
  surfaceNormal?: [number, number, number];
  tool: 'spray' | 'brush';
  active: boolean;
  color: string;
  playerName?: string;
  playerSlot?: number;
  scale?: number;
}

interface ToolRig {
  root: THREE.Group;
  /** Distance from the model origin to its emitting tip, after alignment. */
  tipOffset: number;
}

/**
 * Wraps a generated tool model so that:
 *   - its long axis runs along -Z (the direction it points)
 *   - its emitting tip sits at the wrapper origin
 *
 * Meshy has no notion of "this end is the nozzle", so the longest axis is
 * treated as the barrel and the tip is taken as the end of it.
 */
function buildRig(source: THREE.Object3D, targetLength: number, flip: boolean): ToolRig {
  const model = source.clone(true);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Longest axis is the barrel/handle.
  const axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
  const length = size[axis] || 1;
  const scale = targetLength / length;

  const aligner = new THREE.Group();
  model.position.set(-center.x, -center.y, -center.z);
  aligner.add(model);

  // Rotate the barrel axis onto -Z.
  if (axis === 'y') aligner.rotation.x = flip ? -Math.PI / 2 : Math.PI / 2;
  else if (axis === 'x') aligner.rotation.y = flip ? -Math.PI / 2 : Math.PI / 2;
  else if (flip) aligner.rotation.y = Math.PI;

  const scaler = new THREE.Group();
  scaler.scale.setScalar(scale);
  scaler.add(aligner);

  // Push the model back so its front face lands on the wrapper origin — that
  // origin is what gets planted on the painted surface.
  const tipOffset = (length * scale) / 2;
  scaler.position.z = -tipOffset;

  const root = new THREE.Group();
  root.add(scaler);
  return { root, tipOffset };
}

const TOOL_ASSET = { spray: 'tool-spraycan', brush: 'tool-brush' } as const;
/** How far the body floats off the surface while painting. */
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

export const PlayerTool: React.FC<PlayerToolProps> = ({
  position,
  surfacePoint,
  surfaceNormal,
  tool,
  active,
  color,
  playerName,
  playerSlot = 1,
  scale = 1,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const [rigs, setRigs] = useState<Partial<Record<'spray' | 'brush', ToolRig>>>({});

  const currentPos = useRef(new THREE.Vector3(...position));
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
    const asset = TOOL_ASSET[tool];
    // Tools are framed small; targetSize here is world units of barrel length.
    loadModel(asset, null, tool === 'spray' ? 1.55 : 2.0)
      .then((loaded) => {
        if (cancelled) return;
        setRigs((prev) => ({
          ...prev,
          [tool]: buildRig(loaded.root, tool === 'spray' ? 1.55 : 2.0, tool === 'spray'),
        }));
      })
      .catch((err) => console.error(`[PlayerTool] ${asset} failed to load`, err));
    return () => {
      cancelled = true;
    };
  }, [tool]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

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
        <mesh position={[0, 0, -rig.tipOffset]}>
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
          color={color}
          transparent
          opacity={active ? 0.95 : 0.4}
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
