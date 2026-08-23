import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';

interface Tool3DProps {
  targetPosition: [number, number, number];
  surfacePoint?: [number, number, number];
  surfaceNormal?: [number, number, number];
  activeTool: 'spray' | 'brush' | null;
  isTriggerActive: boolean;
  color: string;
  toolSize?: number;
  playerName?: string;
  playerSlot?: number;
}

export const Tools3D: React.FC<Tool3DProps> = ({
  targetPosition,
  surfacePoint,
  surfaceNormal,
  activeTool,
  isTriggerActive,
  color,
  toolSize = 1.0,
  playerName,
  playerSlot = 1,
}) => {
  const toolGroupRef = useRef<THREE.Group>(null);
  const sprayCapRef = useRef<THREE.Mesh>(null);
  const brushBristlesRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  // Position & Quaternion refs for ultra-smooth 6DOF interpolation
  const currentPos = useRef(new THREE.Vector3(targetPosition[0], targetPosition[1], targetPosition[2]));
  const currentQuat = useRef(new THREE.Quaternion());
  const targetPosVec = useMemo(() => new THREE.Vector3(), []);
  const lookTargetVec = useMemo(() => new THREE.Vector3(), []);
  const tempMatrix = useMemo(() => new THREE.Matrix4(), []);
  const targetQuat = useMemo(() => new THREE.Quaternion(), []);
  const upVec = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  // Materials
  const canBodyMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1a1f',
        roughness: 0.35,
        metalness: 0.8,
      }),
    []
  );

  const chromeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#e4e4e7',
        roughness: 0.15,
        metalness: 0.95,
      }),
    []
  );

  const nozzleMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#27272a',
        roughness: 0.5,
        metalness: 0.3,
      }),
    []
  );

  const brushHandleMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2b1d14',
        roughness: 0.45,
        metalness: 0.05,
      }),
    []
  );

  const colorMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.3,
      metalness: 0.2,
      emissive: color,
      emissiveIntensity: 0.3,
    });
  }, [color]);

  const bristleBaseMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3d3126',
        roughness: 0.95,
        metalness: 0.05,
      }),
    []
  );

  useFrame((_, delta) => {
    if (!toolGroupRef.current) return;

    targetPosVec.set(targetPosition[0], targetPosition[1], targetPosition[2]);

    // Calculate orientation: Tool points towards the 3D surface point being aimed at
    if (surfacePoint) {
      lookTargetVec.set(surfacePoint[0], surfacePoint[1], surfacePoint[2]);
    } else {
      // Default: face the scene center (0, 0, 0)
      lookTargetVec.set(0, 0, 0);
    }

    // Orient tool: look from current position towards surface point
    const camUp = camera.up ? camera.up.clone().normalize() : upVec;
    const dir = lookTargetVec.clone().sub(targetPosVec);
    if (dir.lengthSq() > 0.0001) {
      dir.normalize();
      tempMatrix.lookAt(targetPosVec, lookTargetVec, camUp);
      targetQuat.setFromRotationMatrix(tempMatrix);
    }

    const posLerp = Math.min(delta * 24, 1.0);
    const rotLerp = Math.min(delta * 22, 1.0);

    // If tool target jumps more than 2.0 units (e.g. new stroke start or mode change), snap immediately without laggy swing
    if (currentPos.current.distanceTo(targetPosVec) > 2.0) {
      currentPos.current.copy(targetPosVec);
    } else {
      currentPos.current.lerp(targetPosVec, posLerp);
    }
    currentQuat.current.slerp(targetQuat, rotLerp);

    toolGroupRef.current.position.copy(currentPos.current);
    toolGroupRef.current.quaternion.copy(currentQuat.current);

    // Nozzle depression on trigger
    if (sprayCapRef.current) {
      const capTargetY = isTriggerActive ? 0.02 : 0.06;
      sprayCapRef.current.position.y = THREE.MathUtils.lerp(
        sprayCapRef.current.position.y,
        capTargetY,
        delta * 24
      );
    }

    // Brush bristles flex on trigger contact
    if (brushBristlesRef.current) {
      const bristleTargetScaleZ = isTriggerActive ? 0.8 : 1.0;
      const bristleTargetRotX = isTriggerActive ? -0.2 : 0;
      brushBristlesRef.current.scale.z = THREE.MathUtils.lerp(
        brushBristlesRef.current.scale.z,
        bristleTargetScaleZ,
        delta * 24
      );
      brushBristlesRef.current.rotation.x = THREE.MathUtils.lerp(
        brushBristlesRef.current.rotation.x,
        bristleTargetRotX,
        delta * 24
      );
    }
  });

  return (
    <group ref={toolGroupRef}>
      {/* Multiplayer Player Name Badge (Always Billboards towards the Camera) */}
      {playerName && (
        <Billboard position={[0, 1.5, 0]}>
          <Text
            fontSize={0.22}
            color={color}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.035}
            outlineColor="#000000"
          >
            {`P${playerSlot} • ${playerName}`}
          </Text>
        </Billboard>
      )}

      {/* ========================================================
          3D SPRAY CAN (Aligned so Nozzle orifice points forward along -Z towards surface)
          ======================================================== */}
      {activeTool === 'spray' && (
        <group scale={[0.85 * toolSize, 0.85 * toolSize, 0.85 * toolSize]} rotation={[0.18, 0, 0]}>
          <group position={[0, -0.85, 0.2]}>
            <mesh position={[0, 0, 0]} castShadow material={canBodyMaterial}>
              <cylinderGeometry args={[0.34, 0.34, 1.3, 24]} />
            </mesh>

            <mesh position={[0, 0.02, 0]}>
              <cylinderGeometry args={[0.345, 0.345, 0.7, 24]} />
              <primitive object={colorMaterial} attach="material" />
            </mesh>

            <mesh position={[0, -0.65, 0]} material={chromeMaterial}>
              <cylinderGeometry args={[0.34, 0.31, 0.08, 24]} />
            </mesh>

            <mesh position={[0, 0.67, 0]} material={chromeMaterial}>
              <cylinderGeometry args={[0.18, 0.34, 0.14, 24]} />
            </mesh>

            <mesh position={[0, 0.77, 0]} material={chromeMaterial}>
              <cylinderGeometry args={[0.13, 0.13, 0.07, 20]} />
            </mesh>

            <mesh ref={sprayCapRef} position={[0, 0.92, 0]} castShadow material={nozzleMaterial}>
              <cylinderGeometry args={[0.1, 0.11, 0.18, 16]} />
            </mesh>

            {/* Nozzle opening dot */}
            <mesh position={[0, 0.92, -0.105]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.035, 12]} />
              <primitive object={colorMaterial} attach="material" />
            </mesh>
          </group>

          {/* Aim Crosshair Reticle projected onto surface */}
          <mesh position={[0, 0, -0.5]}>
            <ringGeometry args={[0.04, 0.07, 16]} />
            <meshBasicMaterial color={color} transparent opacity={0.65} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}

      {/* ========================================================
          3D PAINT BRUSH (Bristle tip is positioned precisely at [0, 0, 0] with 0 offset)
          ======================================================== */}
      {activeTool === 'brush' && (
        <group scale={[0.9 * toolSize, 0.9 * toolSize, 0.9 * toolSize]}>
          {/* Angled brush body extending back and up away from contact tip [0,0,0] */}
          <group rotation={[0.42, 0, 0]}>
            {/* Fine Bristles (Tip touches exactly [0, 0, 0]) */}
            <group ref={brushBristlesRef} position={[0, 0, 0.15]}>
              <mesh position={[0, 0, -0.07]} rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.08, 0.22, 16]} />
                <primitive object={colorMaterial} attach="material" />
              </mesh>
              <mesh position={[0, 0, 0.06]} rotation={[Math.PI / 2, 0, 0]} material={bristleBaseMaterial}>
                <cylinderGeometry args={[0.1, 0.08, 0.16, 16]} />
              </mesh>
            </group>

            {/* Metal Ferrule */}
            <mesh position={[0, 0, 0.38]} rotation={[Math.PI / 2, 0, 0]} material={chromeMaterial}>
              <cylinderGeometry args={[0.11, 0.1, 0.32, 16]} />
            </mesh>

            {/* Ergonomic Wooden Handle */}
            <mesh position={[0, 0, 1.25]} rotation={[Math.PI / 2, 0, 0]} castShadow material={brushHandleMaterial}>
              <cylinderGeometry args={[0.05, 0.1, 1.5, 16]} />
            </mesh>

            {/* Handle Dipped Color Accent Tip */}
            <mesh position={[0, 0, 2.05]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.045, 0.055, 0.24, 16]} />
              <primitive object={colorMaterial} attach="material" />
            </mesh>
          </group>

          {/* Precision Surface Touch Ring */}
          <mesh position={[0, 0, 0]}>
            <ringGeometry args={[0.03, 0.06, 16]} />
            <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
    </group>
  );
};

