import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface PhoneTool3DProps {
  tool: 'spray' | 'brush';
  isPressed: boolean;
  color: string;
  isShaking: boolean;
  orientation?: { alpha: number | null; beta: number | null; gamma: number | null };
}

const PARTICLE_COUNT = 300;

export const PhoneTool3D: React.FC<PhoneTool3DProps> = ({
  tool,
  isPressed,
  color,
  isShaking,
  orientation,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const nozzleRef = useRef<THREE.Mesh>(null);
  const bristlesRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.InstancedMesh>(null);

  // Particles data
  const particles = useRef(
    Array.from({ length: PARTICLE_COUNT }, () => ({
      life: 0,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      scale: 1,
    }))
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  // Materials
  const canBodyMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#18181c',
      roughness: 0.35,
      metalness: 0.85,
    });
  }, []);

  const chromeMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#e4e4e7',
      roughness: 0.15,
      metalness: 0.95,
    });
  }, []);

  const nozzleMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#27272a',
      roughness: 0.5,
      metalness: 0.25,
    });
  }, []);

  const brushHandleMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#1f140e',
      roughness: 0.45,
      metalness: 0.08,
    });
  }, []);

  const colorMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.25,
      metalness: 0.2,
      emissive: color,
      emissiveIntensity: 0.35,
    });
  }, [color]);

  const bristleBaseMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#382f25',
      roughness: 0.85,
      metalness: 0.05,
    });
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const time = state.clock.getElapsedTime();

    // Floating idle bobbing motion
    const idleY = Math.sin(time * 2.2) * 0.08;
    const idleRotZ = Math.cos(time * 1.5) * 0.04;
    const idleRotY = Math.sin(time * 1.2) * 0.06;

    // Gyro tilt integration if available
    let gyroRotX = 0;
    let gyroRotY = 0;
    if (orientation && orientation.beta !== null && orientation.gamma !== null) {
      gyroRotX = (orientation.beta - 45) * 0.005;
      gyroRotY = orientation.gamma * 0.005;
    }

    // Shake rattle bounce offset
    let shakeOffsetX = 0;
    let shakeOffsetY = 0;
    if (isShaking) {
      shakeOffsetX = (Math.random() - 0.5) * 0.35;
      shakeOffsetY = (Math.random() - 0.5) * 0.35;
    }

    // Target group position & rotation
    let targetZ = isPressed ? -0.4 : 0;
    let targetScale = isPressed ? 0.96 : 1.0;

    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, shakeOffsetX, delta * 15);
    groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, (tool === 'spray' ? -0.2 : -0.5) + idleY + shakeOffsetY, delta * 10);
    groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, targetZ, delta * 12);

    groupRef.current.scale.setScalar(THREE.MathUtils.lerp(groupRef.current.scale.x, targetScale, delta * 15));

    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, (tool === 'spray' ? 0.35 : 0.65) + gyroRotX, delta * 8);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, idleRotY + gyroRotY, delta * 8);
    groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, idleRotZ, delta * 8);

    // Depress spray nozzle on press
    if (nozzleRef.current) {
      const targetNozzleY = isPressed ? 1.0 : 1.15;
      nozzleRef.current.position.y = THREE.MathUtils.lerp(nozzleRef.current.position.y, targetNozzleY, delta * 25);
    }

    // Bristle flex on press
    if (bristlesRef.current) {
      const targetBristleAngle = isPressed ? -0.3 : 0;
      bristlesRef.current.rotation.x = THREE.MathUtils.lerp(bristlesRef.current.rotation.x, targetBristleAngle, delta * 20);
    }

    // Particle aerosol mist emission on press
    if (particlesRef.current) {
      if (tool === 'spray' && isPressed) {
        const spawnCount = 6;
        let spawned = 0;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          if (spawned >= spawnCount) break;
          const p = particles.current[i];
          if (p.life <= 0) {
            p.life = 0.5 + Math.random() * 0.3;
            p.pos.set(0, 1.15, 0.2); // Start at nozzle orifice
            const angle = Math.random() * Math.PI * 2;
            const spread = Math.random() * 1.5;
            p.vel.set(
              Math.cos(angle) * spread,
              1.5 + Math.random() * 1.8,
              2.0 + Math.random() * 2.0 // towards camera
            );
            p.scale = Math.random() * 0.1 + 0.04;
            spawned++;
          }
        }
      }

      colorObj.set(color);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = particles.current[i];
        if (p.life > 0) {
          p.life -= delta * 2.2;
          p.pos.addScaledVector(p.vel, delta);
          dummy.position.copy(p.pos);
          dummy.scale.setScalar(p.scale * Math.max(0, p.life));
          dummy.updateMatrix();
          particlesRef.current.setMatrixAt(i, dummy.matrix);
          particlesRef.current.setColorAt(i, colorObj);
        } else {
          dummy.position.set(0, 0, -100);
          dummy.updateMatrix();
          particlesRef.current.setMatrixAt(i, dummy.matrix);
        }
      }

      particlesRef.current.instanceMatrix.needsUpdate = true;
      if (particlesRef.current.instanceColor) {
        particlesRef.current.instanceColor.needsUpdate = true;
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* ========================================================
          3D SPRAY CAN ASSET
          ======================================================== */}
      {tool === 'spray' && (
        <group scale={[1.4, 1.4, 1.4]}>
          {/* Main Can Cylinder Body */}
          <mesh position={[0, 0, 0]} castShadow material={canBodyMaterial}>
            <cylinderGeometry args={[0.5, 0.5, 1.7, 32]} />
          </mesh>

          {/* Glowing Brand Label Wrap */}
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.505, 0.505, 0.85, 32]} />
            <primitive object={colorMaterial} attach="material" />
          </mesh>

          {/* Bottom Rim */}
          <mesh position={[0, -0.85, 0]} material={chromeMaterial}>
            <cylinderGeometry args={[0.5, 0.44, 0.12, 32]} />
          </mesh>

          {/* Top Dome Shoulder */}
          <mesh position={[0, 0.88, 0]} material={chromeMaterial}>
            <cylinderGeometry args={[0.3, 0.5, 0.18, 32]} />
          </mesh>

          {/* Valve Collar */}
          <mesh position={[0, 1.0, 0]} material={chromeMaterial}>
            <cylinderGeometry args={[0.18, 0.18, 0.08, 24]} />
          </mesh>

          {/* Active Pressable Spray Nozzle Cap */}
          <mesh ref={nozzleRef} position={[0, 1.15, 0]} castShadow material={nozzleMaterial}>
            <cylinderGeometry args={[0.13, 0.14, 0.22, 20]} />
          </mesh>

          {/* Front Spray Orifice Dot */}
          <mesh position={[0, 1.15, 0.135]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.04, 16]} />
            <primitive object={colorMaterial} attach="material" />
          </mesh>
        </group>
      )}

      {/* ========================================================
          3D PAINT BRUSH ASSET
          ======================================================== */}
      {tool === 'brush' && (
        <group scale={[1.6, 1.6, 1.6]} position={[0, 0.2, 0]}>
          {/* Long Sculpted Wooden Handle */}
          <mesh position={[0, 1.3, 0]} castShadow material={brushHandleMaterial}>
            <cylinderGeometry args={[0.07, 0.13, 2.2, 20]} />
          </mesh>

          {/* Handle End Accent Dip */}
          <mesh position={[0, 2.3, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 0.35, 20]} />
            <primitive object={colorMaterial} attach="material" />
          </mesh>

          {/* Chrome Ferrule */}
          <mesh position={[0, 0.15, 0]} material={chromeMaterial}>
            <cylinderGeometry args={[0.14, 0.13, 0.5, 24]} />
          </mesh>

          {/* Flexible Bristles Group */}
          <group ref={bristlesRef} position={[0, -0.1, 0]}>
            {/* Dark fiber body */}
            <mesh position={[0, -0.2, 0]} material={bristleBaseMaterial}>
              <coneGeometry args={[0.14, 0.45, 20]} />
            </mesh>

            {/* Dipped paint tip */}
            <mesh position={[0, -0.34, 0]}>
              <coneGeometry args={[0.1, 0.26, 20]} />
              <primitive object={colorMaterial} attach="material" />
            </mesh>
          </group>
        </group>
      )}

      {/* Aerosol Particle Burst */}
      <instancedMesh ref={particlesRef} args={[undefined, undefined, PARTICLE_COUNT]}>
        <circleGeometry args={[1, 8]} />
        <meshBasicMaterial transparent opacity={0.6} depthWrite={false} color="#ffffff" />
      </instancedMesh>
    </group>
  );
};
