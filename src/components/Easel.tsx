import React, { useMemo } from 'react';
import * as THREE from 'three';

interface EaselProps {
  canvasTexture: THREE.CanvasTexture;
  canvasWidth?: number;
  canvasHeight?: number;
}

export const Easel: React.FC<EaselProps> = ({
  canvasTexture,
  canvasWidth = 14,
  canvasHeight = 10,
}) => {
  // Rich studio dark walnut wood material
  const woodMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#2a1a12',
      roughness: 0.75,
      metalness: 0.05,
    });
  }, []);

  const woodLightMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#3d261a',
      roughness: 0.7,
      metalness: 0.05,
    });
  }, []);

  // Metallic brass/steel hardware (knobs, pins, screws)
  const metalMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#c5a059',
      roughness: 0.35,
      metalness: 0.85,
    });
  }, []);

  // Canvas wrapped border material
  const canvasBorderMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#ece8de',
      roughness: 0.95,
      metalness: 0.02,
    });
  }, []);

  const canvasFrontMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      map: canvasTexture,
      roughness: 0.85,
      metalness: 0.02,
    });
  }, [canvasTexture]);

  // Easel dimensions
  const legHeight = 18;
  const legThickness = 0.45;
  const legWidth = 0.5;

  return (
    <group position={[0, 0, 0]}>
      {/* ========================================================
          EASEL WOODEN STRUCTURE (A-Frame Studio Easel)
          ======================================================== */}

      {/* Central Mast */}
      <mesh position={[0, 0.5, -0.45]} castShadow receiveShadow material={woodMaterial}>
        <boxGeometry args={[legWidth * 1.3, legHeight + 1, legThickness]} />
      </mesh>

      {/* Mast Height Adjustment Track groove */}
      <mesh position={[0, 0.5, -0.22]} material={woodLightMaterial}>
        <boxGeometry args={[0.2, legHeight - 2, 0.05]} />
      </mesh>

      {/* Left Front Leg */}
      <mesh
        position={[-3.6, -0.5, -0.45]}
        rotation={[0, 0, -0.16]}
        castShadow
        receiveShadow
        material={woodMaterial}
      >
        <boxGeometry args={[legWidth, legHeight, legThickness]} />
      </mesh>

      {/* Right Front Leg */}
      <mesh
        position={[3.6, -0.5, -0.45]}
        rotation={[0, 0, 0.16]}
        castShadow
        receiveShadow
        material={woodMaterial}
      >
        <boxGeometry args={[legWidth, legHeight, legThickness]} />
      </mesh>

      {/* Back Support Leg (tilted back into Z-) */}
      <mesh
        position={[0, -0.8, -3.2]}
        rotation={[-0.32, 0, 0]}
        castShadow
        receiveShadow
        material={woodMaterial}
      >
        <boxGeometry args={[legWidth * 1.1, legHeight, legThickness]} />
      </mesh>

      {/* Lower Crossbar connecting front legs */}
      <mesh position={[0, -5.5, -0.45]} castShadow receiveShadow material={woodMaterial}>
        <boxGeometry args={[8.2, 0.6, 0.4]} />
      </mesh>

      {/* Middle Crossbar */}
      <mesh position={[0, -1.8, -0.45]} castShadow receiveShadow material={woodMaterial}>
        <boxGeometry args={[5.6, 0.5, 0.35]} />
      </mesh>

      {/* Top Cross Peak Connector */}
      <mesh position={[0, 8.2, -0.45]} castShadow material={woodMaterial}>
        <boxGeometry args={[2.2, 0.8, 0.6]} />
      </mesh>

      {/* Brass Hardware Knobs & Screws */}
      <mesh position={[0, 8.2, -0.1]} rotation={[Math.PI / 2, 0, 0]} material={metalMaterial}>
        <cylinderGeometry args={[0.22, 0.22, 0.3, 16]} />
      </mesh>
      <mesh position={[0, -5.5, -0.2]} rotation={[Math.PI / 2, 0, 0]} material={metalMaterial}>
        <cylinderGeometry args={[0.18, 0.18, 0.25, 16]} />
      </mesh>

      {/* ========================================================
          CANVAS SHELF / TRAY (Holds brushes & bottom of canvas)
          ======================================================== */}
      <group position={[0, -canvasHeight / 2 - 0.25, 0]}>
        {/* Main horizontal shelf bar */}
        <mesh position={[0, 0, 0.2]} castShadow receiveShadow material={woodMaterial}>
          <boxGeometry args={[canvasWidth + 2.5, 0.55, 1.4]} />
        </mesh>
        {/* Front safety lip */}
        <mesh position={[0, 0.35, 0.8]} castShadow material={woodLightMaterial}>
          <boxGeometry args={[canvasWidth + 2.5, 0.35, 0.2]} />
        </mesh>
        {/* Left and right shelf adjustment brass cranks */}
        <mesh position={[-2.8, -0.3, -0.2]} rotation={[0, 0, Math.PI / 2]} material={metalMaterial}>
          <cylinderGeometry args={[0.2, 0.2, 0.6, 16]} />
        </mesh>
        <mesh position={[2.8, -0.3, -0.2]} rotation={[0, 0, Math.PI / 2]} material={metalMaterial}>
          <cylinderGeometry args={[0.2, 0.2, 0.6, 16]} />
        </mesh>
      </group>

      {/* ========================================================
          TOP MAST CANVAS CLAMP
          ======================================================== */}
      <group position={[0, canvasHeight / 2 + 0.3, 0]}>
        {/* Clamp Block */}
        <mesh position={[0, 0, 0.15]} castShadow material={woodMaterial}>
          <boxGeometry args={[3.2, 0.6, 1.1]} />
        </mesh>
        {/* Downward lip securing top edge */}
        <mesh position={[0, -0.3, 0.6]} castShadow material={woodLightMaterial}>
          <boxGeometry args={[3.2, 0.3, 0.2]} />
        </mesh>
        {/* Tightening Wing Nut Screw */}
        <mesh position={[0, 0.5, 0.15]} material={metalMaterial}>
          <cylinderGeometry args={[0.2, 0.2, 0.4, 16]} />
        </mesh>
        <mesh position={[0, 0.65, 0.15]} rotation={[0, 0, Math.PI / 2]} material={metalMaterial}>
          <boxGeometry args={[0.15, 0.9, 0.2]} />
        </mesh>
      </group>

      {/* ========================================================
          THE 3D STRETCHED CANVAS BOARD
          ======================================================== */}
      <group position={[0, 0, 0.3]}>
        {/* Canvas Frame / Body with wrapped canvas edges */}
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[canvasWidth, canvasHeight, 0.45]} />
          {/* Apply front canvas texture to face index + border material elsewhere */}
          <primitive object={canvasBorderMaterial} attach="material" />
        </mesh>

        {/* Front Painting Surface (Slightly offset in Z to eliminate z-fighting) */}
        <mesh position={[0, 0, 0.23]} receiveShadow>
          <planeGeometry args={[canvasWidth - 0.02, canvasHeight - 0.02]} />
          <primitive object={canvasFrontMaterial} attach="material" />
        </mesh>

        {/* Canvas wooden stretcher bars on back */}
        <group position={[0, 0, -0.24]}>
          <mesh material={woodLightMaterial}>
            <boxGeometry args={[canvasWidth - 0.8, 0.3, 0.08]} />
          </mesh>
          <mesh material={woodLightMaterial}>
            <boxGeometry args={[0.3, canvasHeight - 0.8, 0.08]} />
          </mesh>
        </group>
      </group>

      {/* ========================================================
          STUDIO CONCRETE / WOOD FLOOR & SHADOW CATCHER
          ======================================================== */}
      <mesh position={[0, -9.4, -1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial
          color="#0d0d0f"
          roughness={0.88}
          metalness={0.12}
        />
      </mesh>
      {/* Studio Floor Grid Lines Accent */}
      <gridHelper
        args={[50, 50, '#FF3D00', '#1a1a24']}
        position={[0, -9.39, -1]}
      />
    </group>
  );
};
