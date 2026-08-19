import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface Tool3DProps {
  targetPosition: [number, number, number];
  activeTool: 'spray' | 'brush' | null;
  isTriggerActive: boolean;
  color: string;
  toolSize?: number;
  rotation?: [number, number, number];
}

export const Tools3D: React.FC<Tool3DProps> = ({
  targetPosition,
  activeTool,
  isTriggerActive,
  color,
  toolSize = 1.0,
}) => {
  const toolGroupRef = useRef<THREE.Group>(null);
  const sprayCapRef = useRef<THREE.Mesh>(null);
  const brushBristlesRef = useRef<THREE.Group>(null);

  // Position & rotation refs
  const currentPos = useRef(new THREE.Vector3(targetPosition[0], targetPosition[1], targetPosition[2] + 0.8));
  const currentRot = useRef(new THREE.Euler(0, 0, 0));

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

    // We align the tool group so that (0, 0, 0) inside the model corresponds to the exact NOZZLE or BRISTLE TIP.
    // In spray mode: can sits slightly back (z + 0.45) and tilted towards the target point.
    // In brush mode: bristle tip touches directly on the target surface (z + 0.1).
    let targetX = targetPosition[0];
    let targetY = targetPosition[1];
    let targetZ = targetPosition[2] + 0.5;
    let targetRotX = 0.2;
    let targetRotY = -0.25;
    let targetRotZ = -0.15;

    if (activeTool === 'spray') {
      targetZ = targetPosition[2] + (isTriggerActive ? 0.35 : 0.65);
      targetRotX = isTriggerActive ? 0.25 : 0.15;
      targetRotY = -0.3;
      targetRotZ = -0.1;
    } else if (activeTool === 'brush') {
      targetZ = targetPosition[2] + (isTriggerActive ? 0.08 : 0.45);
      targetRotX = isTriggerActive ? 0.55 : 0.35;
      targetRotY = -0.2;
      targetRotZ = -0.25;
    }

    const lerpSpeed = Math.min(delta * 18, 1.0);
    currentPos.current.x = THREE.MathUtils.lerp(currentPos.current.x, targetX, lerpSpeed);
    currentPos.current.y = THREE.MathUtils.lerp(currentPos.current.y, targetY, lerpSpeed);
    currentPos.current.z = THREE.MathUtils.lerp(currentPos.current.z, targetZ, lerpSpeed);

    currentRot.current.x = THREE.MathUtils.lerp(currentRot.current.x, targetRotX, lerpSpeed);
    currentRot.current.y = THREE.MathUtils.lerp(currentRot.current.y, targetRotY, lerpSpeed);
    currentRot.current.z = THREE.MathUtils.lerp(currentRot.current.z, targetRotZ, lerpSpeed);

    toolGroupRef.current.position.copy(currentPos.current);
    toolGroupRef.current.rotation.copy(currentRot.current);

    // Nozzle depression on trigger
    if (sprayCapRef.current) {
      const capTargetY = isTriggerActive ? 0.02 : 0.06;
      sprayCapRef.current.position.y = THREE.MathUtils.lerp(
        sprayCapRef.current.position.y,
        capTargetY,
        delta * 22
      );
    }

    // Brush bristles bend
    if (brushBristlesRef.current) {
      const bristleTargetRotX = isTriggerActive ? -0.3 : 0;
      brushBristlesRef.current.rotation.x = THREE.MathUtils.lerp(
        brushBristlesRef.current.rotation.x,
        bristleTargetRotX,
        delta * 20
      );
    }
  });

  return (
    <group ref={toolGroupRef}>
      {/* ========================================================
          3D SPRAY CAN (Calibrated so Nozzle Orifice is at 0, 0, 0)
          ======================================================== */}
      {activeTool === 'spray' && (
        <group scale={[0.9 * toolSize, 0.9 * toolSize, 0.9 * toolSize]}>
          {/* Nozzle Orifice centered at (0, 0, 0) */}
          <group position={[0, -0.96, -0.08]}>
            {/* Main Can Cylinder */}
            <mesh position={[0, 0, 0]} castShadow material={canBodyMaterial}>
              <cylinderGeometry args={[0.36, 0.36, 1.35, 24]} />
            </mesh>

            {/* Color Identity Label Wrap */}
            <mesh position={[0, 0.02, 0]}>
              <cylinderGeometry args={[0.365, 0.365, 0.72, 24]} />
              <primitive object={colorMaterial} attach="material" />
            </mesh>

            {/* Bottom concave rim */}
            <mesh position={[0, -0.68, 0]} material={chromeMaterial}>
              <cylinderGeometry args={[0.36, 0.33, 0.08, 24]} />
            </mesh>

            {/* Top dome shoulder */}
            <mesh position={[0, 0.7, 0]} material={chromeMaterial}>
              <cylinderGeometry args={[0.2, 0.36, 0.14, 24]} />
            </mesh>

            {/* Valve collar ring */}
            <mesh position={[0, 0.8, 0]} material={chromeMaterial}>
              <cylinderGeometry args={[0.14, 0.14, 0.07, 20]} />
            </mesh>

            {/* Pressable Spray Actuator */}
            <mesh ref={sprayCapRef} position={[0, 0.95, 0]} castShadow material={nozzleMaterial}>
              <cylinderGeometry args={[0.1, 0.11, 0.18, 16]} />
            </mesh>

            {/* Colored Spray Tip Dot on front of nozzle */}
            <mesh position={[0, 0.95, 0.105]} rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.035, 12]} />
              <primitive object={colorMaterial} attach="material" />
            </mesh>
          </group>

          {/* Precision laser aim ring directly at canvas surface */}
          <mesh position={[0, 0, -0.35]}>
            <ringGeometry args={[0.05, 0.08, 16]} />
            <meshBasicMaterial color={color} transparent opacity={0.65} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}

      {/* ========================================================
          3D PAINT BRUSH (Calibrated so Bristle Tip is at 0, 0, 0)
          ======================================================== */}
      {activeTool === 'brush' && (
        <group scale={[toolSize, toolSize, toolSize]}>
          {/* Bristle Tip centered at (0, 0, 0) */}
          <group position={[0, 0.25, 0]}>
            {/* Wooden handle */}
            <mesh position={[0, 1.45, 0]} castShadow material={brushHandleMaterial}>
              <cylinderGeometry args={[0.06, 0.1, 1.9, 16]} />
            </mesh>

            {/* Handle dipped end */}
            <mesh position={[0, 2.3, 0]}>
              <cylinderGeometry args={[0.05, 0.07, 0.28, 16]} />
              <primitive object={colorMaterial} attach="material" />
            </mesh>

            {/* Metal ferrule */}
            <mesh position={[0, 0.35, 0]} material={chromeMaterial}>
              <cylinderGeometry args={[0.11, 0.1, 0.42, 16]} />
            </mesh>

            {/* Bristles (Tip reaches down to 0, -0.25, 0 -> 0, 0, 0 in parent) */}
            <group ref={brushBristlesRef} position={[0, 0.12, 0]}>
              <mesh position={[0, -0.15, 0]} material={bristleBaseMaterial}>
                <coneGeometry args={[0.1, 0.32, 16]} />
              </mesh>
              <mesh position={[0, -0.26, 0]}>
                <coneGeometry args={[0.07, 0.2, 16]} />
                <primitive object={colorMaterial} attach="material" />
              </mesh>
            </group>
          </group>

          {/* Contact indicator ring */}
          <mesh position={[0, 0, -0.05]}>
            <ringGeometry args={[0.035, 0.065, 16]} />
            <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
    </group>
  );
};
