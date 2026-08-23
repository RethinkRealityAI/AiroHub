import React, { useMemo } from 'react';
import * as THREE from 'three';
import { TargetObjectType } from '../types';

export interface ObjectSurfaceDim {
  width: number;
  height: number;
  zOffset: number;
}

export const OBJECT_SURFACE_DIMS: Record<TargetObjectType, ObjectSurfaceDim> = {
  easel: { width: 15.2, height: 11.2, zOffset: 0.05 },
  skateboard: { width: 7.2, height: 15.2, zOffset: 0.05 },
  subway: { width: 17.6, height: 10.4, zOffset: 0.05 },
  boombox: { width: 16.8, height: 10.0, zOffset: 0.05 },
  wall: { width: 17.2, height: 11.8, zOffset: 0.05 },
  helmet: { width: 11.0, height: 11.0, zOffset: 0.1 },
  sneaker: { width: 14.5, height: 8.5, zOffset: 0.1 },
  vinyltoy: { width: 9.5, height: 14.0, zOffset: 0.1 },
  sculpture: { width: 10.5, height: 13.5, zOffset: 0.1 },
  custom3d: { width: 13.0, height: 13.0, zOffset: 0.1 },
};

interface DecorateObjects3DProps {
  objectType: TargetObjectType;
  canvasTexture: THREE.CanvasTexture | null;
  custom3DGroup?: THREE.Group | null;
}

export const DecorateObjects3D: React.FC<DecorateObjects3DProps> = ({
  objectType,
  canvasTexture,
  custom3DGroup,
}) => {
  const woodMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#281a12',
        roughness: 0.8,
        metalness: 0.1,
      }),
    []
  );

  const metalDark = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1a20',
        roughness: 0.35,
        metalness: 0.85,
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

  const paintableMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      map: canvasTexture || null,
      roughness: 0.4,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
  }, [canvasTexture]);

  const brickMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#422418',
        roughness: 0.95,
        metalness: 0.05,
      }),
    []
  );

  const concreteMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#222228',
        roughness: 0.9,
        metalness: 0.1,
      }),
    []
  );

  const goldMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#f59e0b',
        roughness: 0.25,
        metalness: 0.9,
      }),
    []
  );

  return (
    <group position={[0, 0, 0]}>
      {/* ========================================================
          0. CUSTOM USER-UPLOADED 3D MODEL
          ======================================================== */}
      {objectType === 'custom3d' && custom3DGroup && (
        <group position={[0, 0, 0]}>
          <primitive object={custom3DGroup} />
          {/* Gallery Pedestal */}
          <mesh position={[0, -4.2, 0]} material={concreteMaterial} receiveShadow>
            <cylinderGeometry args={[4.6, 5.0, 1.2, 32]} />
          </mesh>
          <mesh position={[0, -4.9, 0]} material={metalDark} receiveShadow>
            <cylinderGeometry args={[5.2, 5.5, 0.3, 32]} />
          </mesh>
        </group>
      )}

      {/* ========================================================
          1. LARGE STUDIO EASEL & STRETCHED CANVAS (15.2 x 11.2)
          ======================================================== */}
      {objectType === 'easel' && (
        <group>
          {/* Main Spine Mast */}
          <mesh position={[0, 0.6, -0.6]} material={woodMaterial} castShadow>
            <boxGeometry args={[0.45, 17.5, 0.3]} />
          </mesh>

          {/* Left Leg */}
          <mesh position={[-6.2, -1.2, -0.5]} rotation={[0, 0, 0.18]} material={woodMaterial} castShadow>
            <boxGeometry args={[0.38, 17.0, 0.3]} />
          </mesh>

          {/* Right Leg */}
          <mesh position={[6.2, -1.2, -0.5]} rotation={[0, 0, -0.18]} material={woodMaterial} castShadow>
            <boxGeometry args={[0.38, 17.0, 0.3]} />
          </mesh>

          {/* Rear Sturdy Support Leg */}
          <mesh position={[0, -1.2, -4.8]} rotation={[-0.42, 0, 0]} material={woodMaterial} castShadow>
            <boxGeometry args={[0.38, 17.2, 0.28]} />
          </mesh>

          {/* Bottom Shelf / Brush Tray */}
          <mesh position={[0, -5.8, 0.3]} material={woodMaterial} castShadow receiveShadow>
            <boxGeometry args={[16.6, 0.35, 1.0]} />
          </mesh>
          <mesh position={[0, -5.55, 0.78]} material={woodMaterial}>
            <boxGeometry args={[16.6, 0.22, 0.12]} />
          </mesh>

          {/* Top Canvas Clamp */}
          <mesh position={[0, 5.8, 0.2]} material={woodMaterial} castShadow>
            <boxGeometry args={[3.4, 0.38, 0.6]} />
          </mesh>

          {/* Main Stretched Fine Linen Canvas */}
          <mesh position={[0, 0, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[15.2, 11.2, 0.18]} />
          </mesh>
        </group>
      )}

      {/* ========================================================
          2. LARGE STREET SKATEBOARD DECK (7.2 x 15.2)
          ======================================================== */}
      {objectType === 'skateboard' && (
        <group position={[0, 0, 0]}>
          {/* Main Center Deck */}
          <mesh position={[0, 0, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[7.2, 12.8, 0.16]} />
          </mesh>

          {/* Top Curved Nose / Kicktail */}
          <mesh position={[0, 6.95, 0.42]} rotation={[-0.32, 0, 0]} castShadow material={paintableMaterial}>
            <boxGeometry args={[7.0, 2.2, 0.16]} />
          </mesh>

          {/* Bottom Curved Kicktail */}
          <mesh position={[0, -6.95, 0.42]} rotation={[0.32, 0, 0]} castShadow material={paintableMaterial}>
            <boxGeometry args={[7.0, 2.2, 0.16]} />
          </mesh>

          {/* Trucks & Wheels */}
          <group position={[0, 4.4, -0.6]}>
            <mesh material={metalDark} castShadow>
              <boxGeometry args={[3.2, 0.7, 0.4]} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0, -0.28]} material={chromeMaterial}>
              <cylinderGeometry args={[0.18, 0.18, 6.4, 16]} />
            </mesh>
            <mesh position={[-3.3, 0, -0.28]} rotation={[0, 0, Math.PI / 2]} material={chromeMaterial}>
              <cylinderGeometry args={[0.8, 0.8, 0.6, 20]} />
            </mesh>
            <mesh position={[3.3, 0, -0.28]} rotation={[0, 0, Math.PI / 2]} material={chromeMaterial}>
              <cylinderGeometry args={[0.8, 0.8, 0.6, 20]} />
            </mesh>
          </group>

          <group position={[0, -4.4, -0.6]}>
            <mesh material={metalDark} castShadow>
              <boxGeometry args={[3.2, 0.7, 0.4]} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0, -0.28]} material={chromeMaterial}>
              <cylinderGeometry args={[0.18, 0.18, 6.4, 16]} />
            </mesh>
            <mesh position={[-3.3, 0, -0.28]} rotation={[0, 0, Math.PI / 2]} material={chromeMaterial}>
              <cylinderGeometry args={[0.8, 0.8, 0.6, 20]} />
            </mesh>
            <mesh position={[3.3, 0, -0.28]} rotation={[0, 0, Math.PI / 2]} material={chromeMaterial}>
              <cylinderGeometry args={[0.8, 0.8, 0.6, 20]} />
            </mesh>
          </group>
        </group>
      )}

      {/* ========================================================
          3. LARGE SUBWAY TRAIN CAR (17.6 x 10.4)
          ======================================================== */}
      {objectType === 'subway' && (
        <group position={[0, 0, 0]}>
          <mesh position={[0, 0, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[17.6, 10.4, 0.28]} />
          </mesh>

          <mesh position={[0, 5.6, -1.8]} material={metalDark} castShadow>
            <boxGeometry args={[18.8, 0.8, 3.8]} />
          </mesh>

          {[-5.2, 0, 5.2].map((x, i) => (
            <mesh key={i} position={[x, 6.3, -1.8]} material={chromeMaterial}>
              <boxGeometry args={[2.8, 0.6, 1.8]} />
            </mesh>
          ))}

          {[-6.0, -2.0, 2.0, 6.0].map((x, i) => (
            <group key={i} position={[x, 2.4, 0.16]}>
              <mesh>
                <boxGeometry args={[2.8, 2.3, 0.06]} />
                <meshStandardMaterial color="#081426" roughness={0.1} metalness={0.9} />
              </mesh>
              <mesh position={[0, 0, 0.02]}>
                <boxGeometry args={[3.0, 2.5, 0.03]} />
                <meshStandardMaterial color="#222" />
              </mesh>
            </group>
          ))}

          <mesh position={[-4.0, -1.8, 0.16]} material={metalDark}>
            <boxGeometry args={[0.12, 6.4, 0.05]} />
          </mesh>
          <mesh position={[4.0, -1.8, 0.16]} material={metalDark}>
            <boxGeometry args={[0.12, 6.4, 0.05]} />
          </mesh>

          <mesh position={[0, -5.7, -1.5]} material={metalDark}>
            <boxGeometry args={[18.8, 1.0, 3.6]} />
          </mesh>
          <mesh position={[0, -6.5, 0.6]} rotation={[0, 0, Math.PI / 2]} material={chromeMaterial}>
            <cylinderGeometry args={[0.18, 0.18, 21.0, 16]} />
          </mesh>
          <mesh position={[0, -6.5, -3.0]} rotation={[0, 0, Math.PI / 2]} material={chromeMaterial}>
            <cylinderGeometry args={[0.18, 0.18, 21.0, 16]} />
          </mesh>
        </group>
      )}

      {/* ========================================================
          4. LARGE VINTAGE 1980S BOOMBOX (16.8 x 10.0)
          ======================================================== */}
      {objectType === 'boombox' && (
        <group position={[0, 0, 0]}>
          <mesh position={[0, 0, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[16.8, 10.0, 2.6]} />
          </mesh>

          <group position={[0, 5.9, 0]}>
            <mesh position={[0, 0, 0]} material={metalDark}>
              <boxGeometry args={[11.5, 0.55, 0.7]} />
            </mesh>
            <mesh position={[-5.5, -0.9, 0]} material={metalDark}>
              <boxGeometry args={[0.55, 1.8, 0.7]} />
            </mesh>
            <mesh position={[5.5, -0.9, 0]} material={metalDark}>
              <boxGeometry args={[0.55, 1.8, 0.7]} />
            </mesh>
          </group>

          <group position={[-5.0, -0.6, 1.4]}>
            <mesh material={metalDark}>
              <cylinderGeometry args={[2.8, 2.8, 0.22, 32]} />
            </mesh>
            <mesh position={[0, 0.15, 0]} material={chromeMaterial}>
              <sphereGeometry args={[1.0, 20, 20]} />
            </mesh>
          </group>

          <group position={[5.0, -0.6, 1.4]}>
            <mesh material={metalDark}>
              <cylinderGeometry args={[2.8, 2.8, 0.22, 32]} />
            </mesh>
            <mesh position={[0, 0.15, 0]} material={chromeMaterial}>
              <sphereGeometry args={[1.0, 20, 20]} />
            </mesh>
          </group>

          <mesh position={[0, -1.2, 1.4]} material={metalDark}>
            <boxGeometry args={[4.4, 2.8, 0.18]} />
          </mesh>
          <mesh position={[0, 2.4, 1.4]} material={chromeMaterial}>
            <boxGeometry args={[5.0, 1.8, 0.15]} />
          </mesh>

          <mesh position={[6.8, 6.8, -1.1]} rotation={[0, 0, -0.35]} material={chromeMaterial}>
            <cylinderGeometry args={[0.11, 0.11, 7.8, 16]} />
          </mesh>
        </group>
      )}

      {/* ========================================================
          5. LARGE URBAN BRICK ALLEY WALL (17.2 x 11.8)
          ======================================================== */}
      {objectType === 'wall' && (
        <group position={[0, 0, 0]}>
          <mesh position={[0, 0, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[17.2, 11.8, 0.6]} />
          </mesh>

          <mesh position={[0, 6.3, 0.25]} material={brickMaterial} castShadow>
            <boxGeometry args={[18.8, 0.85, 1.1]} />
          </mesh>

          <mesh position={[0, -6.4, 2.2]} material={concreteMaterial} receiveShadow>
            <boxGeometry args={[19.6, 1.1, 4.8]} />
          </mesh>

          <mesh position={[4.8, -5.8, 2.8]} rotation={[-Math.PI / 2, 0, 0]} material={metalDark}>
            <planeGeometry args={[3.2, 1.8]} />
          </mesh>

          <group position={[-6.8, 3.8, 1.8]}>
            <mesh rotation={[0, 0, 0.3]} material={metalDark}>
              <cylinderGeometry args={[0.15, 0.15, 3.6, 16]} />
            </mesh>
            <mesh position={[1.2, 1.1, 0]} rotation={[Math.PI, 0, 0]} material={metalDark}>
              <coneGeometry args={[1.0, 0.75, 16]} />
            </mesh>
            <pointLight position={[1.2, 0.7, 0]} color="#fde68a" intensity={3.5} distance={12} />
          </group>
        </group>
      )}

      {/* ========================================================
          6. CYBER MOTORCYCLE / ASTRONAUT HELMET (11.0 x 11.0)
          ======================================================== */}
      {objectType === 'helmet' && (
        <group position={[0, 0, 0]}>
          {/* Main Paintable Outer Shell Dome */}
          <mesh position={[0, 0.5, 0]} castShadow receiveShadow material={paintableMaterial}>
            <sphereGeometry args={[4.8, 48, 48]} />
          </mesh>

          {/* Chin Guard / Mouth Aerodynamic Filter */}
          <mesh position={[0, -2.4, 2.8]} rotation={[0.2, 0, 0]} castShadow material={paintableMaterial}>
            <boxGeometry args={[4.4, 2.2, 2.8]} />
          </mesh>

          {/* Reflective Dark Gold / Chrome Visor Shield */}
          <mesh position={[0, 0.6, 2.8]} rotation={[0.12, 0, 0]} castShadow material={goldMaterial}>
            <boxGeometry args={[6.2, 3.2, 2.2]} />
          </mesh>

          {/* Pedestal Stand */}
          <mesh position={[0, -5.8, 0]} material={metalDark} receiveShadow>
            <cylinderGeometry args={[3.5, 4.2, 1.4, 32]} />
          </mesh>
        </group>
      )}

      {/* ========================================================
          7. STREETWEAR SNEAKER / HIGH-TOP (14.5 x 8.5)
          ======================================================== */}
      {objectType === 'sneaker' && (
        <group position={[0, -0.5, 0]} rotation={[0, -0.2, 0]}>
          {/* Main Shoe Upper / Side Panels */}
          <mesh position={[0, 0.8, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[13.2, 4.4, 5.0]} />
          </mesh>

          {/* High-Top Ankle Collar */}
          <mesh position={[-2.8, 3.4, 0]} castShadow receiveShadow material={paintableMaterial}>
            <cylinderGeometry args={[2.5, 2.7, 3.2, 24]} />
          </mesh>

          {/* Toe Cap Curve */}
          <mesh position={[5.4, 0.2, 0]} rotation={[0, 0, -0.3]} castShadow material={paintableMaterial}>
            <sphereGeometry args={[2.4, 24, 24]} />
          </mesh>

          {/* Chunky Rubber Sole */}
          <mesh position={[0, -2.2, 0]} material={concreteMaterial} receiveShadow>
            <boxGeometry args={[14.2, 1.6, 5.6]} />
          </mesh>

          {/* Chrome Eyelets */}
          {[-1, 1, 3].map((x, i) => (
            <mesh key={i} position={[x, 2.2, 2.6]} material={chromeMaterial}>
              <sphereGeometry args={[0.22, 12, 12]} />
            </mesh>
          ))}
        </group>
      )}

      {/* ========================================================
          8. VINYL URBAN ART TOY / BEARBRICK STYLE (9.5 x 14.0)
          ======================================================== */}
      {objectType === 'vinyltoy' && (
        <group position={[0, -0.6, 0]}>
          {/* Head */}
          <mesh position={[0, 3.6, 0]} castShadow receiveShadow material={paintableMaterial}>
            <sphereGeometry args={[2.8, 36, 36]} />
          </mesh>
          {/* Bear Ears */}
          <mesh position={[-2.2, 5.6, 0]} castShadow material={paintableMaterial}>
            <sphereGeometry args={[1.2, 24, 24]} />
          </mesh>
          <mesh position={[2.2, 5.6, 0]} castShadow material={paintableMaterial}>
            <sphereGeometry args={[1.2, 24, 24]} />
          </mesh>

          {/* Torso */}
          <mesh position={[0, -0.2, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[4.4, 5.2, 2.8]} />
          </mesh>

          {/* Left Arm */}
          <mesh position={[-3.0, -0.2, 0]} rotation={[0, 0, 0.2]} castShadow material={paintableMaterial}>
            <cylinderGeometry args={[0.85, 0.85, 4.4, 16]} />
          </mesh>

          {/* Right Arm */}
          <mesh position={[3.0, -0.2, 0]} rotation={[0, 0, -0.2]} castShadow material={paintableMaterial}>
            <cylinderGeometry args={[0.85, 0.85, 4.4, 16]} />
          </mesh>

          {/* Legs */}
          <mesh position={[-1.4, -4.2, 0]} castShadow material={paintableMaterial}>
            <cylinderGeometry args={[0.95, 0.95, 4.2, 16]} />
          </mesh>
          <mesh position={[1.4, -4.2, 0]} castShadow material={paintableMaterial}>
            <cylinderGeometry args={[0.95, 0.95, 4.2, 16]} />
          </mesh>
        </group>
      )}

      {/* ========================================================
          9. CLASSICAL ROMAN SCULPTURE BUST (10.5 x 13.5)
          ======================================================== */}
      {objectType === 'sculpture' && (
        <group position={[0, -0.8, 0]}>
          {/* Sculpted Head */}
          <mesh position={[0, 3.4, 0]} castShadow receiveShadow material={paintableMaterial}>
            <sphereGeometry args={[2.5, 32, 32]} />
          </mesh>

          {/* Hair Curls Volume */}
          <mesh position={[0, 4.4, -0.4]} castShadow material={paintableMaterial}>
            <sphereGeometry args={[2.6, 24, 24]} />
          </mesh>

          {/* Classical Nose & Features */}
          <mesh position={[0, 3.2, 2.4]} rotation={[0.4, 0, 0]} material={paintableMaterial}>
            <coneGeometry args={[0.5, 1.2, 8]} />
          </mesh>

          {/* Torso / Draped Toga Shoulders */}
          <mesh position={[0, -0.4, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[7.2, 5.0, 3.2]} />
          </mesh>

          {/* Museum Pedestal Stand */}
          <mesh position={[0, -4.6, 0]} material={concreteMaterial} receiveShadow>
            <boxGeometry args={[4.8, 4.0, 4.8]} />
          </mesh>
        </group>
      )}
    </group>
  );
};
