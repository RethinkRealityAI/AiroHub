/**
 * The studio 3D stage.
 *
 * Owns raycasting, paint application and the per-frame smoothing of remote
 * player cursors. Networking and UI state live in `CanvasView`; this component
 * only consumes them.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { PaintSurface, CANVAS_RES } from '../paint/PaintSurface';
import { PaintTarget, Finish } from './PaintTarget';
import { PlayerTool } from './PlayerTool';
import { SprayMist } from './SprayMist';
import { StudioEnvironment } from './StudioEnvironment';
import { useFitCamera } from './useFitCamera';
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
}) => {
  const { camera, raycaster, gl } = useThree();
  const meshRegistry = useRef<THREE.Object3D[]>([]);
  const [subjectRadius, setSubjectRadius] = useState<number | null>(null);
  useFitCamera(subjectRadius, orbitRef);

  /** Per-player receive-side smoothing of the networked cursor. */
  const cursors = useRef(new Map<string, SmoothedCursor>());

  const hostDragging = useRef(false);
  const hostPointer = useRef(new THREE.Vector2());

  const scratch = useMemo(
    () => ({
      normal: new THREE.Vector3(),
      toCamera: new THREE.Vector3(),
      ndc: new THREE.Vector2(),
      plane: new THREE.Plane(),
      planeHit: new THREE.Vector3(),
      camDir: new THREE.Vector3(),
    }),
    []
  );

  /** Casts through the current NDC point and paints where it lands. */
  const castAndPaint = useCallback(
    (
      ndcX: number,
      ndcY: number,
      player: PlayerState,
      shouldPaint: boolean
    ) => {
      scratch.ndc.set(ndcX, ndcY);
      raycaster.setFromCamera(scratch.ndc, camera);

      const hits =
        meshRegistry.current.length > 0
          ? raycaster.intersectObjects(meshRegistry.current, true)
          : [];

      if (hits.length > 0) {
        const hit = hits[0];
        scratch.normal.set(0, 0, 1);
        if (hit.face) {
          scratch.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
        }
        // Flip back-facing normals so the tool never buries itself in the mesh.
        scratch.toCamera.subVectors(camera.position, hit.point).normalize();
        if (scratch.normal.dot(scratch.toCamera) < 0) scratch.normal.negate();

        player.surfacePoint = [hit.point.x, hit.point.y, hit.point.z];
        player.surfaceNormal = [scratch.normal.x, scratch.normal.y, scratch.normal.z];
        player.worldPos = [hit.point.x, hit.point.y, hit.point.z];

        if (shouldPaint && hit.uv) {
          paintSurface.stroke(
            player.id,
            {
              x: hit.uv.x * CANVAS_RES,
              // glTF UVs are bottom-up; the paint canvas is top-down.
              y: (1 - hit.uv.y) * CANVAS_RES,
              pressure: player.pressure || 1,
            },
            player.tool,
            player.color,
            player.sizeMultiplier ?? 1
          );
        }
        return true;
      }

      // Nothing under the cursor: park the tool on the plane through the origin
      // so it stays visible and correctly oriented instead of snapping away.
      scratch.camDir.copy(camera.position).normalize();
      scratch.plane.setFromNormalAndCoplanarPoint(scratch.camDir, new THREE.Vector3(0, 0, 0));
      if (raycaster.ray.intersectPlane(scratch.plane, scratch.planeHit)) {
        player.worldPos = [scratch.planeHit.x, scratch.planeHit.y, scratch.planeHit.z];
        player.surfacePoint = undefined;
        player.surfaceNormal = undefined;
      }
      return false;
    },
    [camera, raycaster, paintSurface, scratch]
  );

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
      paintSurface.beginStroke(host.id);
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
        paintSurface.endStroke(host.id);
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
  }, [gl, hostPainting, paintSurface, playersRef]);

  /* ------------------------------ frame ------------------------------ */

  useFrame((_, delta) => {
    const roster = playersRef.current;

    for (const player of roster) {
      if (player.isHost) {
        // The host aims with the mouse, so no network smoothing is involved.
        player.tool = hostTool;
        player.color = hostColor;
        player.sizeMultiplier = hostSize;
        castAndPaint(
          hostPointer.current.x,
          hostPointer.current.y,
          player,
          hostPainting && hostDragging.current
        );
        continue;
      }

      let cursor = cursors.current.get(player.id);
      if (!cursor) {
        cursor = new SmoothedCursor();
        cursors.current.set(player.id, cursor);
      }
      cursor.setTarget(player.cursorPx.x / CANVAS_RES, player.cursorPx.y / CANVAS_RES);
      const smoothed = cursor.step(delta);

      // Projection-mode players paint via UVs sent from their own device, so
      // the studio only positions their tool rather than re-deriving paint.
      castAndPaint(
        smoothed.x * 2 - 1,
        -(smoothed.y * 2 - 1),
        player,
        player.isPainting && player.mode === 'motion'
      );
    }

    // Prune smoothers for players who have left.
    if (cursors.current.size > roster.length + 2) {
      const live = new Set(roster.map((p) => p.id));
      for (const id of [...cursors.current.keys()]) {
        if (!live.has(id)) cursors.current.delete(id);
      }
    }

    // Single texture upload per frame regardless of how many players painted.
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

      {/* Image-based lighting makes the generated PBR materials read properly;
          the directional keys then add shape and colour. */}
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
