/**
 * A player's floating spray can / brush, plus their surface reticle.
 *
 * Posture matters: a real can is held *upright* — body vertical, nozzle on
 * top, leaning slightly toward the wall — not aimed down its axis like a
 * laser pointer. The spray can therefore stands vertical (blended a little
 * toward the surface normal so painting the top of an object still looks
 * natural), while the brush tilts like a held pen with its tip at the
 * contact point.
 *
 * Aiming clarity comes from two world-anchored guides rendered with the tool:
 *   - a crosshair reticle planted flat on the mesh exactly where paint lands
 *   - a faint "laser" line from the nozzle to that point
 * Both use the player's colour and brighten while painting.
 *
 * Everything positional reads the live player record inside useFrame — those
 * fields mutate every frame outside React, so value props would freeze the
 * tool between renders.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadToolRig, ToolRig } from './toolRig';
import { NameTag } from './NameTag';
import { PlayerState } from '../types';

export interface PlayerToolProps {
  /** The live player record — transforms are read imperatively per frame. */
  player: PlayerState;
  scale?: number;
}

/** How far the emitting tip hovers off the surface while painting. */
const HOVER = { spray: 1.05, brush: 0.14 } as const;

/**
 * Posture of the rig inside the tool group. The rig's barrel runs +Z with the
 * tip at the origin; rotating X by +90° stands the can upright (body hanging
 * below the nozzle), while -52° tilts the brush like a held pen.
 */
const POSTURE_X = { spray: Math.PI / 2, brush: -0.92 } as const;

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export const PlayerTool: React.FC<PlayerToolProps> = ({ player, scale = 1 }) => {
  const { color, name: playerName, slot: playerSlot } = player;
  // The tool is tracked as state driven from the LIVE player object each
  // frame: roster handlers mutate players outside the React render path, so
  // binding the tool at render time is how a phone's spray→brush switch used
  // to get stuck until an unrelated re-render came along.
  const [tool, setTool] = useState<'spray' | 'brush'>(player.tool);
  const { camera } = useThree();

  const groupRef = useRef<THREE.Group>(null);
  const reticleRef = useRef<THREE.Group>(null);
  const reticleMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const guideRef = useRef<THREE.Mesh>(null);
  const guideMat = useRef<THREE.MeshBasicMaterial>(null);
  const [rigs, setRigs] = useState<Partial<Record<'spray' | 'brush', ToolRig>>>({});

  const currentPos = useRef(new THREE.Vector3(...player.worldPos));
  const currentQuat = useRef(new THREE.Quaternion());
  const scratch = useMemo(
    () => ({
      targetPos: new THREE.Vector3(),
      targetQuat: new THREE.Quaternion(),
      normal: new THREE.Vector3(0, 0, 1),
      face: new THREE.Vector3(),
      up: new THREE.Vector3(),
      surface: new THREE.Vector3(),
      matrix: new THREE.Matrix4(),
      zero: new THREE.Vector3(),
      guideDir: new THREE.Vector3(),
      guideQuat: new THREE.Quaternion(),
      axis: new THREE.Vector3(),
      camHoriz: new THREE.Vector3(),
    }),
    []
  );

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
    if (player.tool !== tool) setTool(player.tool);
    const group = groupRef.current;
    if (!group) return;

    const { surfacePoint, surfaceNormal, worldPos: position, isPainting: active } = player;
    const s = scratch;
    const hover = active ? HOVER[tool] : HOVER[tool] + 0.65;

    // Facing fallback: the camera's horizontal look direction.
    s.camHoriz.set(0, 0, -1).applyQuaternion(camera.quaternion);
    s.camHoriz.y = 0;
    if (s.camHoriz.lengthSq() < 1e-4) s.camHoriz.set(0, 0, -1);
    s.camHoriz.normalize();

    const hasSurface = Boolean(surfacePoint && surfaceNormal);
    if (hasSurface) {
      s.normal.set(surfaceNormal![0], surfaceNormal![1], surfaceNormal![2]).normalize();
      s.surface.set(surfacePoint![0], surfacePoint![1], surfacePoint![2]);
      s.targetPos.copy(s.surface).addScaledVector(s.normal, hover);

      // Face the wall: horizontal component of the inverse normal; when the
      // surface is horizontal (painting a top), fall back to the camera view.
      s.face.set(-s.normal.x, 0, -s.normal.z);
      if (s.face.lengthSq() < 0.04) s.face.copy(s.camHoriz);
      s.face.normalize();

      // Mostly world-upright, tipped slightly away from the surface so the
      // body clears it — and naturally upright when spraying downward.
      s.up.copy(WORLD_UP).addScaledVector(s.normal, 0.28).normalize();
    } else {
      // Floating off-model on the camera plane.
      s.targetPos.set(position[0], position[1], position[2]);
      s.face.copy(s.camHoriz);
      s.up.copy(WORLD_UP);
    }

    s.matrix.lookAt(s.zero, s.face, s.up);
    s.targetQuat.setFromRotationMatrix(s.matrix);

    // Frame-rate independent smoothing; snap on big jumps (object switches).
    const posBlend = 1 - Math.exp(-26 * delta);
    const rotBlend = 1 - Math.exp(-20 * delta);
    if (currentPos.current.distanceTo(s.targetPos) > 5) currentPos.current.copy(s.targetPos);
    else currentPos.current.lerp(s.targetPos, posBlend);
    currentQuat.current.slerp(s.targetQuat, rotBlend);

    group.position.copy(currentPos.current);
    group.quaternion.copy(currentQuat.current);

    /* ---------- surface reticle + guide line (world-anchored) ---------- */

    const reticle = reticleRef.current;
    const guide = guideRef.current;

    if (reticle) {
      reticle.visible = hasSurface;
      if (hasSurface) {
        reticle.position.copy(s.surface).addScaledVector(s.normal, 0.035);
        reticle.quaternion.setFromUnitVectors(s.axis.set(0, 0, 1), s.normal);
        const pulse = active ? 1 + Math.sin(performance.now() / 90) * 0.08 : 1;
        reticle.scale.setScalar(pulse * (active ? 0.92 : 1.12));
        for (const mat of reticleMats.current) mat.opacity = active ? 0.95 : 0.55;
      }
    }

    if (guide && guideMat.current) {
      guide.visible = hasSurface;
      if (hasSurface) {
        s.guideDir.copy(s.surface).sub(currentPos.current);
        const len = s.guideDir.length();
        if (len > 0.2) {
          // Start 35% of the way out so the beam reads as leaving the nozzle
          // instead of overlapping the can body.
          const visibleLen = len * 0.65;
          guide.position.copy(currentPos.current).addScaledVector(s.guideDir, 0.35 + 0.325);
          s.guideQuat.setFromUnitVectors(s.axis.set(0, 1, 0), s.guideDir.normalize());
          guide.quaternion.copy(s.guideQuat);
          guide.scale.set(1, visibleLen, 1);
          guideMat.current.opacity = active ? 0.5 : 0.18;
        } else {
          guide.visible = false;
        }
      }
    }
  });

  const rig = rigs[tool];
  const registerReticleMat = (mat: THREE.MeshBasicMaterial | null) => {
    if (mat && !reticleMats.current.includes(mat)) reticleMats.current.push(mat);
  };

  return (
    <>
      {/* ------------------------------ tool ------------------------------ */}
      <group ref={groupRef} scale={scale}>
        <group rotation={[POSTURE_X[tool], 0, 0]}>
          {rig ? (
            <primitive object={rig.root} />
          ) : (
            <mesh position={[0, 0, 0.6]}>
              <capsuleGeometry args={[0.16, 0.7, 4, 12]} />
              <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} />
            </mesh>
          )}

          {/* Player-colour band around the body. */}
          {rig && (
            <mesh position={[0, 0, rig.length * 0.38]}>
              <torusGeometry args={[0.21, 0.05, 10, 24]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.35} />
            </mesh>
          )}
        </group>

        {playerName && (
          <NameTag text={`P${playerSlot} · ${playerName}`} color={color} position={[0, 1.55, 0]} />
        )}
      </group>

      {/* --------------------- world-anchored aim guides --------------------- */}
      <group ref={reticleRef} visible={false}>
        <mesh>
          <ringGeometry args={[0.16, 0.2, 28]} />
          <meshBasicMaterial
            ref={registerReticleMat}
            color={color}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <mesh>
          <circleGeometry args={[0.035, 12]} />
          <meshBasicMaterial
            ref={registerReticleMat}
            color={color}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle) => (
          <mesh
            key={angle}
            rotation={[0, 0, angle]}
            position={[Math.cos(angle) * 0.27, Math.sin(angle) * 0.27, 0]}
          >
            <planeGeometry args={[0.11, 0.028]} />
            <meshBasicMaterial
              ref={registerReticleMat}
              color={color}
              transparent
              opacity={0.55}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* Guide line from nozzle to surface. */}
      <mesh ref={guideRef} visible={false}>
        <cylinderGeometry args={[0.016, 0.016, 1, 6, 1, true]} />
        <meshBasicMaterial
          ref={guideMat}
          color={color}
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </>
  );
};
