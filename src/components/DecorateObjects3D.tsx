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
};

interface DecorateObjects3DProps {
  objectType: TargetObjectType;
  canvasTexture: THREE.CanvasTexture | null;
}

export const DecorateObjects3D: React.FC<DecorateObjects3DProps> = ({
  objectType,
  canvasTexture,
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

  return (
    <group position={[0, 0, 0]}>
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

          {/* Top Truck & Wheels */}
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

          {/* Bottom Truck & Wheels */}
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
          {/* Main Subway Car Body */}
          <mesh position={[0, 0, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[17.6, 10.4, 0.28]} />
          </mesh>

          {/* Stainless Steel Roof Dome */}
          <mesh position={[0, 5.6, -1.8]} material={metalDark} castShadow>
            <boxGeometry args={[18.8, 0.8, 3.8]} />
          </mesh>

          {/* Subway Roof HVAC Vents */}
          {[-5.2, 0, 5.2].map((x, i) => (
            <mesh key={i} position={[x, 6.3, -1.8]} material={chromeMaterial}>
              <boxGeometry args={[2.8, 0.6, 1.8]} />
            </mesh>
          ))}

          {/* Passenger Windows */}
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

          {/* Sliding Door Seams */}
          <mesh position={[-4.0, -1.8, 0.16]} material={metalDark}>
            <boxGeometry args={[0.12, 6.4, 0.05]} />
          </mesh>
          <mesh position={[4.0, -1.8, 0.16]} material={metalDark}>
            <boxGeometry args={[0.12, 6.4, 0.05]} />
          </mesh>

          {/* Undercarriage & Rails */}
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
          {/* Main Enclosure */}
          <mesh position={[0, 0, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[16.8, 10.0, 2.6]} />
          </mesh>

          {/* Top Carry Handle */}
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

          {/* Left Speaker Grille */}
          <group position={[-5.0, -0.6, 1.4]}>
            <mesh material={metalDark}>
              <cylinderGeometry args={[2.8, 2.8, 0.22, 32]} />
            </mesh>
            <mesh position={[0, 0.15, 0]} material={chromeMaterial}>
              <sphereGeometry args={[1.0, 20, 20]} />
            </mesh>
          </group>

          {/* Right Speaker Grille */}
          <group position={[5.0, -0.6, 1.4]}>
            <mesh material={metalDark}>
              <cylinderGeometry args={[2.8, 2.8, 0.22, 32]} />
            </mesh>
            <mesh position={[0, 0.15, 0]} material={chromeMaterial}>
              <sphereGeometry args={[1.0, 20, 20]} />
            </mesh>
          </group>

          {/* Dual Cassette Decks */}
          <mesh position={[0, -1.2, 1.4]} material={metalDark}>
            <boxGeometry args={[4.4, 2.8, 0.18]} />
          </mesh>
          {/* Radio Equalizer / Tuner Glass */}
          <mesh position={[0, 2.4, 1.4]} material={chromeMaterial}>
            <boxGeometry args={[5.0, 1.8, 0.15]} />
          </mesh>

          {/* Telescopic Antenna */}
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
          {/* Main Brick Wall Surface */}
          <mesh position={[0, 0, 0]} castShadow receiveShadow material={paintableMaterial}>
            <boxGeometry args={[17.2, 11.8, 0.6]} />
          </mesh>

          {/* Brick Roof Coping / Top Ledge */}
          <mesh position={[0, 6.3, 0.25]} material={brickMaterial} castShadow>
            <boxGeometry args={[18.8, 0.85, 1.1]} />
          </mesh>

          {/* Concrete Sidewalk Curb */}
          <mesh position={[0, -6.4, 2.2]} material={concreteMaterial} receiveShadow>
            <boxGeometry args={[19.6, 1.1, 4.8]} />
          </mesh>

          {/* Storm Drain Grate */}
          <mesh position={[4.8, -5.8, 2.8]} rotation={[-Math.PI / 2, 0, 0]} material={metalDark}>
            <planeGeometry args={[3.2, 1.8]} />
          </mesh>

          {/* Alley Industrial Gooseneck Lamp */}
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
    </group>
  );
};
