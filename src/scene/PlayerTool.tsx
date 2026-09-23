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
import { createToolRigSync, loadToolRig, ToolRig } from './toolRig';
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

/**
 * Footprint ring radius at size 1, in world units: where the visible body of
 * a stroke lands. `SurfacePainter` scatters its faintest grains out to 0.55,
 * but nearly all of the colour lands inside about 0.42, and the brush lays
 * about 0.25 either side of the path. Both scale with the nozzle size.
 */
export const FOOTPRINT_SPRAY = 0.42;
export const FOOTPRINT_BRUSH = 0.25;

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
  const footprintRef = useRef<THREE.Group>(null);
  const footprintMat = useRef<THREE.MeshBasicMaterial>(null);
  const reticleMats = useRef<THREE.MeshBasicMaterial[]>([]);
  const guideRef = useRef<THREE.Mesh>(null);
  const guideMat = useRef<THREE.MeshBasicMaterial>(null);
  // The can is built in code, so it is there on the very first frame; the
  // brush still arrives from the model registry.
  const [rigs, setRigs] = useState<Partial<Record<'spray' | 'brush', ToolRig>>>(() => {
    const spray = createToolRigSync('spray', player.color);
    return spray ? { spray } : {};
  });
  const rigsRef = useRef(rigs);
  rigsRef.current = rigs;
  useEffect(() => () => {
    for (const rig of Object.values(rigsRef.current)) rig?.dispose?.();
  }, []);
  const appliedColor = useRef('');
  const pressAmount = useRef(0);
  /** The reticle eases toward the nozzle size rather than snapping. */
  const reticleSize = useRef(player.sizeMultiplier ?? 1);

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
  /**
   * The surface normal, filtered. Hit normals come from single triangles, so
   * sweeping across a curved model makes them step from facet to facet; the
   * tool hovers a full unit off the surface along that normal, which turned
   * every step into a visible hop of the can. Filtering the normal (not the
   * contact point) keeps the paint exact and the can smooth.
   */
  const smoothNormal = useRef(new THREE.Vector3(0, 0, 1));
  const hadSurface = useRef(false);

  useEffect(() => {
    if (rigsRef.current[tool]) return;
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

    // The can wears the player's paint colour; only touch the material when
    // the colour actually changes.
    const rigNow = rigsRef.current[tool];
    if (rigNow?.setColor && appliedColor.current !== player.color) {
      rigNow.setColor(player.color);
      appliedColor.current = player.color;
    }
    if (rigNow?.setPressed) {
      const target = player.isPainting ? 1 : 0;
      pressAmount.current += (target - pressAmount.current) * (1 - Math.exp(-30 * delta));
      rigNow.setPressed(pressAmount.current);
    }

    const { surfacePoint, surfaceNormal, worldPos: position, isPainting: active } = player;
    const s = scratch;
    // Ease the footprint toward the nozzle size rather than snapping.
    const sizeTarget = THREE.MathUtils.clamp(player.sizeMultiplier ?? 1, 0.3, 2.5);
    reticleSize.current += (sizeTarget - reticleSize.current) * (1 - Math.exp(-12 * delta));
    // A wider fan is sprayed from further back, as it would be by hand.
    const reach = tool === 'spray' ? 0.8 + 0.2 * reticleSize.current : 1;
    const hover = (active ? HOVER[tool] : HOVER[tool] + 0.65) * reach;

    // Facing fallback: the camera's horizontal look direction.
    s.camHoriz.set(0, 0, -1).applyQuaternion(camera.quaternion);
    s.camHoriz.y = 0;
    if (s.camHoriz.lengthSq() < 1e-4) s.camHoriz.set(0, 0, -1);
    s.camHoriz.normalize();

    const hasSurface = Boolean(surfacePoint && surfaceNormal);
    if (hasSurface) {
      s.normal.set(surfaceNormal![0], surfaceNormal![1], surfaceNormal![2]).normalize();
      const n = smoothNormal.current;
      if (!hadSurface.current) n.copy(s.normal);
      else n.lerp(s.normal, 1 - Math.exp(-14 * delta));
      // Opposite normals can cancel to nothing mid-blend; take the new one.
      if (n.lengthSq() < 1e-4) n.copy(s.normal);
      n.normalize();
      s.normal.copy(n);
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

    hadSurface.current = hasSurface;

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
    // Published for the mist, which has to leave the nozzle rather than the
    // contact point. Written into one tuple per player, not reallocated.
    const tip = (player.toolTip ??= [0, 0, 0]);
    tip[0] = currentPos.current.x;
    tip[1] = currentPos.current.y;
    tip[2] = currentPos.current.z;

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
        // The footprint ring is the area the nozzle actually covers, so
        // turning the size up visibly widens what you are about to paint.
        const footprint = footprintRef.current;
        if (footprint) {
          const radius = (tool === 'spray' ? FOOTPRINT_SPRAY : FOOTPRINT_BRUSH) * reticleSize.current;
          footprint.scale.setScalar(radius / pulse / (active ? 0.92 : 1.12));
        }
        if (footprintMat.current) footprintMat.current.opacity = active ? 0.5 : 0.3;
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

          {/* Player-colour grip ring. The can is lacquered in the player's
              colour already; the brush handle is not. */}
          {rig && tool === 'brush' && (
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
        {/* Footprint: a unit ring plus a faint fill, scaled to the nozzle. */}
        <group ref={footprintRef}>
          <mesh>
            <ringGeometry args={[0.95, 1, 48]} />
            <meshBasicMaterial
              ref={footprintMat}
              color={color}
              transparent
              opacity={0.35}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <circleGeometry args={[0.95, 48]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.07}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </group>
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
