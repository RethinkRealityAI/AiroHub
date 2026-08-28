/**
 * The object being painted.
 *
 * Loads the requested model, keeps the paint overlay wired to its materials,
 * and exposes the mesh list used for raycasting. Also owns the finish toggle
 * (the model's own Meshy texture vs. a flat primer) and shows a lightweight
 * placeholder while an asset streams in.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TargetObjectType } from '../types';
import { loadModel, LoadedModel } from '../paint/modelRegistry';
import { setPrimerMix } from '../paint/paintMaterial';
import { makeGroupPaintable, PaintUniforms } from '../paint/paintMaterial';

export type Finish = 'original' | 'primer';

interface PaintTargetProps {
  objectId: TargetObjectType;
  paintTexture: THREE.Texture | null;
  finish: Finish;
  customGroup?: THREE.Group | null;
  onLoadedChange?: (loading: boolean) => void;
  onModelReady?: (model: LoadedModel | null) => void;
  /** Bounding radius of the loaded model, for camera framing. */
  onRadiusChange?: (radius: number) => void;
  /** Populated with the meshes to raycast against. */
  meshRegistry: React.MutableRefObject<THREE.Object3D[]>;
}

/** Placeholder shown while a model streams in. */
function LoadingProxy({ color = '#ffffff' }: { color?: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.rotation.y = t * 0.8;
    ref.current.rotation.x = Math.sin(t * 0.6) * 0.2;
    const pulse = 1 + Math.sin(t * 2.4) * 0.05;
    ref.current.scale.setScalar(pulse);
  });
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[3.2, 1]} />
      <meshStandardMaterial
        color={color}
        wireframe
        transparent
        opacity={0.35}
        emissive={color}
        emissiveIntensity={0.4}
      />
    </mesh>
  );
}

export const PaintTarget: React.FC<PaintTargetProps> = ({
  objectId,
  paintTexture,
  finish,
  customGroup,
  onLoadedChange,
  onModelReady,
  onRadiusChange,
  meshRegistry,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [loading, setLoading] = useState(true);
  const customBlocks = useRef<PaintUniforms[]>([]);

  const isCustom = objectId === 'custom3d';

  useEffect(() => {
    if (isCustom) {
      setModel(null);
      setLoading(false);
      onLoadedChange?.(false);
      onRadiusChange?.(6.4);
      return;
    }

    let cancelled = false;
    setLoading(true);
    onLoadedChange?.(true);

    loadModel(objectId, paintTexture)
      .then((loaded) => {
        if (cancelled) return;
        setModel(loaded);
        setLoading(false);
        onLoadedChange?.(false);
        onModelReady?.(loaded);
        onRadiusChange?.(loaded.radius);
      })
      .catch((err) => {
        console.error(`[PaintTarget] failed to load "${objectId}"`, err);
        if (cancelled) return;
        setLoading(false);
        onLoadedChange?.(false);
        onModelReady?.(null);
      });

    return () => {
      cancelled = true;
    };
  }, [objectId, isCustom, paintTexture, onLoadedChange, onModelReady, onRadiusChange]);

  // Keep an uploaded model's materials wired to the shared paint layer.
  useEffect(() => {
    if (isCustom && customGroup) {
      customBlocks.current = makeGroupPaintable(customGroup, paintTexture);
    }
  }, [isCustom, customGroup, paintTexture]);

  // Finish toggle: 0 keeps the generated PBR texture, 1 washes it to primer.
  useEffect(() => {
    const amount = finish === 'primer' ? 1 : 0;
    if (model) setPrimerMix(model.paintBlocks, amount);
    if (customBlocks.current.length) setPrimerMix(customBlocks.current, amount);
  }, [finish, model, customGroup]);

  // Republish the raycast target list whenever the visible object changes.
  useEffect(() => {
    const root = groupRef.current;
    if (!root) return;
    const meshes: THREE.Object3D[] = [];
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child);
    });
    meshRegistry.current = meshes;
  }, [model, customGroup, isCustom, meshRegistry]);

  const active = useMemo(() => {
    if (isCustom) return customGroup ?? null;
    return model?.root ?? null;
  }, [isCustom, customGroup, model]);

  return (
    <group ref={groupRef}>
      {active ? <primitive object={active} /> : loading ? <LoadingProxy /> : null}
    </group>
  );
};
