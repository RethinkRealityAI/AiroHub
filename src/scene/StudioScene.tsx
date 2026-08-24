/**
 * The studio 3D stage.
 *
 * Owns raycasting, paint application and the per-frame smoothing of remote
 * player cursors. All painting flows through `SurfacePainter`, which turns
 * aim movement into surface-anchored stamps — the studio derives paint for
 * itself (mouse) and for motion-mode phone players (their aim cursor), applies
 * it locally, and broadcasts the resulting stamps so every peer's texture
 * converges. Touch-paint stamps arriving *from* phones are applied by
 * `CanvasView`'s network layer, not here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { PaintSurface, CANVAS_RES } from '../paint/PaintSurface';
import { PaintStamp } from '../paint/stamps';
import { PaintTarget, Finish } from './PaintTarget';
import { PlayerTool } from './PlayerTool';
import { SprayMist } from './SprayMist';
import { StudioEnvironment } from './StudioEnvironment';
import { useFitCamera } from './useFitCamera';
import { SurfacePainter } from './SurfacePainter';
import { SmoothedCursor } from '../utils/motion';
import { TargetObjectType, PlayerState } from '../types';
import { sounds } from '../utils/audio';

export interface StudioSceneProps {
  objectId: TargetObjectType;
  finish: Finish;
  paintSurface: PaintSurface;
  players: PlayerState[];
  playersRef: React.MutableRefObject<PlayerState[]>;
  orbitRef: React.RefObject<any>;
  autoRotate: boolean;
  customGroup: THREE.Group | null;
  /** When true, dragging on the stage paints instead of orbiting. */
  hostPainting: boolean;
  hostTool: 'spray' | 'brush';
  hostColor: string;
  hostSize: number;
  onObjectLoadingChange: (loading: boolean) => void;
  /**
   * Called with every batch of stamps painted locally (host or motion players)
   * so the network layer can rebroadcast them to the other peers.
   */
  onStampsPainted: (
    playerId: string,
    tool: 'spray' | 'brush',
    color: string,
    stamps: PaintStamp[]
  ) => void;
}

export const StudioScene: React.FC<StudioSceneProps> = ({
  objectId,
  finish,
  paintSurface,
  players,
  playersRef,
  orbitRef,
  autoRotate,
  customGroup,
  hostPainting,
  hostTool,
  hostColor,
  hostSize,
  onObjectLoadingChange,
  onStampsPainted,
}) => {
  const { camera, gl, size } = useThree();
  const meshRegistry = useRef<THREE.Object3D[]>([]);
  const [subjectRadius, setSubjectRadius] = useState<number | null>(null);
  useFitCamera(subjectRadius, orbitRef);

  /** One painter per active painter identity (host + each remote player). */
  const painters = useRef(new Map<string, SurfacePainter>());
  /** Receive-side smoothing of each remote cursor. */
  const cursors = useRef(new Map<string, SmoothedCursor>());

  const hostDragging = useRef(false);
  const hostPointer = useRef(new THREE.Vector2());

  const sizeRef = useRef(size);
  sizeRef.current = size;

  const getPainter = useCallback(
    (id: string) => {
      let painter = painters.current.get(id);
      if (!painter) {
        painter = new SurfacePainter(
          () => meshRegistry.current,
          () => camera,
          () => sizeRef.current.height
        );
        painters.current.set(id, painter);
      }
      return painter;
    },
    [camera]
  );

  // Texel-density caches go stale when the object swaps.
  useEffect(() => {
    for (const painter of painters.current.values()) painter.invalidate();
  }, [objectId, customGroup]);

  /* ----------------------- host pointer painting ----------------------- */

  useEffect(() => {
    const canvas = gl.domElement;

    const toNdc = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      hostPointer.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
    };

    const onDown = (event: PointerEvent) => {
      if (!hostPainting || event.button !== 0) return;
      toNdc(event);
      hostDragging.current = true;
      const host = playersRef.current.find((p) => p.isHost);
      if (!host) return;
      host.isPainting = true;
      getPainter(host.id).begin({ tool: host.tool, size: host.sizeMultiplier ?? 1 });
      if (host.tool === 'spray') sounds.startSpray(1);
      else sounds.startBrush();
    };

    const onMove = (event: PointerEvent) => {
      if (!hostPainting) return;
      toNdc(event);
    };

    const onUp = () => {
      if (!hostDragging.current) return;
      hostDragging.current = false;
      const host = playersRef.current.find((p) => p.isHost);
      if (host) {
        host.isPainting = false;
        getPainter(host.id).end();
      }
      sounds.stopSpray();
      sounds.stopBrush();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [gl, hostPainting, getPainter, playersRef]);

  /* ------------------------------ frame ------------------------------ */

  useFrame((_, delta) => {
    const roster = playersRef.current;

    for (const player of roster) {
      let ndcX: number;
      let ndcY: number;
      let painting: boolean;

      if (player.isHost) {
        player.tool = hostTool;
        player.color = hostColor;
        player.sizeMultiplier = hostSize;
        ndcX = hostPointer.current.x;
        ndcY = hostPointer.current.y;
        painting = hostPainting && hostDragging.current;
      } else if (player.mode === 'projection') {
        // Their tool position arrives with their stamp packets; nothing to
        // derive here. Just make sure any stale painter is closed.
        const painter = painters.current.get(player.id);
        if (painter?.isActive) painter.end();
        continue;
      } else {
        let cursor = cursors.current.get(player.id);
        if (!cursor) {
          cursor = new SmoothedCursor();
          cursors.current.set(player.id, cursor);
        }
        cursor.setTarget(player.cursorPx.x / CANVAS_RES, player.cursorPx.y / CANVAS_RES);
        const smoothed = cursor.step(delta);
        ndcX = smoothed.x * 2 - 1;
        ndcY = -(smoothed.y * 2 - 1);
        // The studio derives paint only for motion-mode (gyro) players; players
        // painting by touch send their own surface-anchored stamps.
        painting = player.isPainting && player.mode === 'motion';
      }

      const painter = getPainter(player.id);
      if (painting && !painter.isActive) {
        painter.begin({ tool: player.tool, size: player.sizeMultiplier ?? 1 });
      } else if (!painting && painter.isActive) {
        painter.end();
      }

      const result = painter.frame(ndcX, ndcY, painting);

      if (result.stamps.length > 0) {
        paintSurface.applyStamps(result.stamps, player.tool, player.color);
        onStampsPainted(player.id, player.tool, player.color, result.stamps);
      }

      // Position the floating tool from the central hit.
      if (result.hit) {
        player.surfacePoint = [result.hit.point.x, result.hit.point.y, result.hit.point.z];
        player.surfaceNormal = [result.hit.normal.x, result.hit.normal.y, result.hit.normal.z];
        player.worldPos = [result.hit.point.x, result.hit.point.y, result.hit.point.z];
      } else {
        // Off-model: park the tool on the origin plane so it stays visible.
        player.surfacePoint = undefined;
        player.surfaceNormal = undefined;
        player.worldPos = [ndcX * 7, ndcY * 5, 2.5];
      }
    }

    // Drop painters and smoothers for players who have left.
    if (painters.current.size > roster.length + 2) {
      const live = new Set(roster.map((p) => p.id));
      for (const id of [...painters.current.keys()]) {
        if (!live.has(id)) painters.current.delete(id);
      }
      for (const id of [...cursors.current.keys()]) {
        if (!live.has(id)) cursors.current.delete(id);
      }
    }

    // One texture upload per frame no matter how many players painted.
    paintSurface.commit();
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 1.5, 17]} fov={45} near={0.1} far={200} />
      <OrbitControls
        ref={orbitRef}
        enableDamping
        dampingFactor={0.07}
        autoRotate={autoRotate}
        autoRotateSpeed={1.1}
        maxPolarAngle={Math.PI / 2 + 0.22}
        target={[0, 0, 0]}
        // While pointer-painting, left-drag paints and right-drag orbits.
        mouseButtons={
          hostPainting
            ? { LEFT: undefined as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
            : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
        }
      />

      <StudioEnvironment intensity={0.62} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[9, 14, 10]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-11, 5, -6]} intensity={0.7} color="#7dd3fc" />
      <spotLight position={[0, 10, 13]} angle={0.7} penumbra={0.85} intensity={1.3} color="#fff6ec" />

      <PaintTarget
        objectId={objectId}
        paintTexture={paintSurface.texture}
        finish={finish}
        customGroup={customGroup}
        meshRegistry={meshRegistry}
        onLoadedChange={onObjectLoadingChange}
        onRadiusChange={setSubjectRadius}
      />

      {players.map((player) => (
        <PlayerTool
          key={player.id}
          position={player.worldPos}
          surfacePoint={player.surfacePoint}
          surfaceNormal={player.surfaceNormal}
          tool={player.tool}
          active={player.isPainting}
          color={player.color}
          playerName={player.name}
          playerSlot={player.slot}
        />
      ))}

      <SprayMist players={players} />

      <ContactShadows position={[0, -7.4, 0]} opacity={0.6} scale={44} blur={2.6} far={18} />
    </>
  );
};
