/**
 * The tool card's hero: the tool you are holding, as the real 3D model.
 *
 * A small second WebGL canvas renders the same spray can and brush the
 * studio floats over the stage, standing upright and drifting
 * gently, so a glance at the card tells you what you are painting with. In
 * stamp mode it shows the selected stencil as a floating plate in the paint
 * colour — literally what the next tap lays down. Tap the tool to shake it:
 * the can rattles and the model rocks.
 *
 * Cheap on purpose: a low DPR cap, one procedural environment, a can built in
 * code (so it is there on the first frame, lacquered in the paint colour) and
 * a brush from the shared registry cache.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { createToolRigSync, loadToolRig, ToolRig, TOOL_RIGS } from '../../scene/toolRig';
import { StudioEnvironment } from '../../scene/StudioEnvironment';
import type { StampAsset } from '../../paint/stampAssets';
import { sounds } from '../../utils/audio';

export type PreviewTool = 'spray' | 'brush' | 'stamp';

/** Shared drift + shake, applied to whatever is on the turntable. */
function useDrift(
  group: React.RefObject<THREE.Group | null>,
  shakeAt: React.MutableRefObject<number>,
  spin = 0.45,
  /** Resting sideways lean, so a tool reads as held rather than stood up. */
  lean = 0
) {
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    const since = performance.now() - shakeAt.current;
    // Guarded rather than multiplied out: before the first tap `since` is not
    // finite, and a NaN from sin() would poison the matrix and hide the model.
    const shaking = since < 700 ? Math.exp(-since / 220) : 0;
    const wobble = shaking > 0 ? Math.sin(since / 22) * 0.35 * shaking : 0;
    const rock = shaking > 0 ? Math.sin(since / 28) * 0.22 * shaking : 0;
    g.position.y = Math.sin(t * 1.6) * 0.05;
    g.rotation.y = t * spin + wobble;
    g.rotation.z = lean + rock;
    g.rotation.x = Math.sin(t * 0.9) * 0.05;
  });
}

const RiggedTool: React.FC<{
  tool: 'spray' | 'brush';
  color: string;
  shakeAt: React.MutableRefObject<number>;
}> = ({ tool, color, shakeAt }) => {
  // The can is built synchronously for the current tool (ready on the first
  // frame); the brush arrives from the model cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const syncRig = useMemo(() => createToolRigSync(tool, color), [tool]);
  useEffect(() => () => syncRig?.dispose?.(), [syncRig]);
  const [loadedRig, setLoadedRig] = useState<ToolRig | null>(null);
  const rig = syncRig ?? loadedRig;
  const group = useRef<THREE.Group>(null);
  useDrift(group, shakeAt, 0.45, tool === 'brush' ? 0.3 : 0.12);

  useEffect(() => {
    if (syncRig) return;
    let live = true;
    setLoadedRig(null);
    loadToolRig(tool)
      .then((r) => live && setLoadedRig(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tool, syncRig]);

  useEffect(() => {
    rig?.setColor?.(color);
  }, [rig, color]);

  const length = TOOL_RIGS[tool].length;
  // Stand the rig upright with the business end on top and the body centred
  // on the turntable (the rig origin is the tip, body running along +Z).
  const scale = tool === 'brush' ? 0.78 : 0.92;
  return (
    <group ref={group}>
      {rig && (
        <primitive
          object={rig.root}
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, (length * scale) / 2, 0]}
          scale={scale}
        />
      )}
    </group>
  );
};

const StencilPlate: React.FC<{
  asset: StampAsset;
  tint: string;
  shakeAt: React.MutableRefObject<number>;
}> = ({ asset, tint, shakeAt }) => {
  const texture = useLoader(THREE.TextureLoader, asset.src);
  const group = useRef<THREE.Group>(null);
  useDrift(group, shakeAt, 0.7);
  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }, [texture]);
  return (
    <group ref={group}>
      <mesh>
        <planeGeometry args={[1.5, 1.5]} />
        <meshBasicMaterial
          map={texture}
          transparent
          alphaTest={0.04}
          side={THREE.DoubleSide}
          color={asset.tintable ? tint : '#ffffff'}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
};

export const ToolPreview: React.FC<{
  tool: PreviewTool;
  color: string;
  stamp: StampAsset | null;
  className?: string;
}> = ({ tool, color, stamp, className = '' }) => {
  const shakeAt = useRef(-1e9);
  const shake = () => {
    shakeAt.current = performance.now();
    if (tool === 'spray') sounds.playCanRattle();
    else sounds.playClick(1.2);
  };
  const label = tool === 'spray' ? 'spray can' : tool === 'brush' ? 'brush' : 'stencil';

  return (
    <button
      type="button"
      onClick={shake}
      title={tool === 'spray' ? 'Tap to shake the can' : `Tap to rock the ${label}`}
      aria-label={`Shake the ${label}`}
      className={`tap relative block w-full overflow-hidden rounded-[20px] outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${className}`}
      style={{
        height: 'var(--tool-stage, 150px)',
        background:
          'radial-gradient(ellipse 60% 55% at 50% 60%, color-mix(in srgb, var(--studio-accent) 28%, transparent), transparent 70%), rgba(0,0,0,0.18)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -18px 30px -24px rgba(0,0,0,0.9)',
      }}
    >
      {/* Soft floor under the tool. */}
      <span
        aria-hidden
        className="absolute left-1/2 bottom-[14%] h-3 w-[46%] -translate-x-1/2 rounded-[100%]"
        style={{ background: 'radial-gradient(ellipse, rgba(0,0,0,0.55), transparent 70%)' }}
      />
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        className="!absolute inset-0"
        style={{ pointerEvents: 'none' }}
      >
        <PerspectiveCamera makeDefault position={[0, 0.15, 4.4]} fov={32} near={0.1} far={50} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[3, 5, 4]} intensity={1.6} />
        <directionalLight position={[-4, 2, -3]} intensity={0.5} color="#c4b5fd" />
        <Suspense fallback={null}>
          <StudioEnvironment intensity={0.7} />
          {tool === 'stamp' && stamp ? (
            <StencilPlate key={stamp.id} asset={stamp} tint={color} shakeAt={shakeAt} />
          ) : (
            <RiggedTool tool={tool === 'stamp' ? 'spray' : tool} color={color} shakeAt={shakeAt} />
          )}
        </Suspense>
      </Canvas>
      <span className="mono-caps pointer-events-none absolute bottom-2 right-3 text-[7.5px] text-white/35">
        Tap to shake
      </span>
    </button>
  );
};
