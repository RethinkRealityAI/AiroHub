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
import { InterpolatedCursor } from '../utils/motion';
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
    stamps: PaintStamp[],
    strokeId: string
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

  // Painters live across renders, so they must dereference the CURRENT default
  // camera through a ref — capturing `camera` in their construction closure
  // pins them to R3F's initial default camera and every raycast lands scaled
  // toward the screen centre (that was the paint-offset bug).
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  /** One painter per active painter identity (host + each remote player). */
  const painters = useRef(new Map<string, SurfacePainter>());
  /** Current stroke id per painter, for undo grouping across peers. */
  const strokeIds = useRef(new Map<string, string>());
  const strokeSeq = useRef(0);
  /** Receive-side jitter-buffer interpolation of each remote cursor. */
  const cursors = useRef(new Map<string, InterpolatedCursor>());

  const hostDragging = useRef(false);
  const hostPointer = useRef(new THREE.Vector2());
  const hostPointers = useRef(new Set<number>());
  const hostGestureLock = useRef(false);

  const sizeRef = useRef(size);
  sizeRef.current = size;

  const getPainter = useCallback(
    (id: string) => {
      let painter = painters.current.get(id);
      if (!painter) {
        painter = new SurfacePainter(
          () => meshRegistry.current,
          () => cameraRef.current,
          () => sizeRef.current.height
        );
        painters.current.set(id, painter);
      }
      return painter;
    },
    []
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

    const endStroke = () => {
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

    const onDown = (event: PointerEvent) => {
      hostPointers.current.add(event.pointerId);
      // A second finger means "gesture": abort the stroke and let the orbit
      // controls' two-finger rotate/pinch take over. No stroke restarts until
      // every finger lifts.
      if (hostPointers.current.size > 1) {
        endStroke();
        hostGestureLock.current = true;
        return;
      }
      if (!hostPainting || hostGestureLock.current || event.button !== 0) return;
      toNdc(event);
      hostDragging.current = true;
      const host = playersRef.current.find((p) => p.isHost);
      if (!host) return;
      host.isPainting = true;
      // The stroke id must be minted HERE, where the host's stroke begins.
      // The frame loop only mints ids on its own begin() transition, which
      // this pre-empts — without this line every host stroke shared one id,
      // so undo swallowed them together and replay repainted them in the
      // first stroke's colour.
      strokeIds.current.set(host.id, `${host.id}#${++strokeSeq.current}`);
      getPainter(host.id).begin({ tool: host.tool, size: host.sizeMultiplier ?? 1 });
      if (host.tool === 'spray') sounds.startSpray(1);
      else sounds.startBrush();
    };

    const onMove = (event: PointerEvent) => {
      // Track in every stage mode — the host's floating can should follow the
      // mouse whether or not a stroke is active.
      toNdc(event);
    };

    const onUp = (event: PointerEvent) => {
      hostPointers.current.delete(event.pointerId);
      if (hostPointers.current.size === 0) hostGestureLock.current = false;
      endStroke();
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
          cursor = new InterpolatedCursor();
          cursors.current.set(player.id, cursor);
        }
        // Drain the packets that arrived since the last frame (with their
        // true arrival stamps) and render ~90ms behind, so uneven network
        // delivery interpolates into a continuous path instead of lurching.
        const queued = player.cursorSamples;
        if (queued && queued.length > 0) {
          for (const s of queued) cursor.push(s.x, s.y, s.at);
          queued.length = 0;
        }
        const smoothed = cursor.step(performance.now());
        ndcX = smoothed.x * 2 - 1;
        ndcY = -(smoothed.y * 2 - 1);
        // The studio derives paint only for motion-mode (gyro) players; players
        // painting by touch send their own surface-anchored stamps.
        painting = player.isPainting && player.mode === 'motion';
      }

      const painter = getPainter(player.id);
      if (painting && !painter.isActive) {
        painter.begin({ tool: player.tool, size: player.sizeMultiplier ?? 1 });
        strokeIds.current.set(player.id, `${player.id}#${++strokeSeq.current}`);
      } else if (!painting && painter.isActive) {
        painter.end();
      }

      const result = painter.frame(ndcX, ndcY, painting, delta);

      if (result.stamps.length > 0) {
        const strokeId = strokeIds.current.get(player.id) ?? `${player.id}#0`;
        paintSurface.applyStamps(result.stamps, player.tool, player.color, strokeId);
        onStampsPainted(player.id, player.tool, player.color, result.stamps, strokeId);
      }

      // Position the floating tool from the central hit, or float it smoothly
      // on the camera-facing plane when aiming past the model.
      if (result.hit) {
        player.surfacePoint = [result.hit.point.x, result.hit.point.y, result.hit.point.z];
        player.surfaceNormal = [result.hit.normal.x, result.hit.normal.y, result.hit.normal.z];
        player.worldPos = [result.hit.point.x, result.hit.point.y, result.hit.point.z];
      } else {
        player.surfacePoint = undefined;
        player.surfaceNormal = undefined;
        player.worldPos = [result.planePoint.x, result.planePoint.y, result.planePoint.z];
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
        // One finger paints; two fingers always rotate/pinch, no mode toggle.
        touches={
          hostPainting
            ? { ONE: undefined as any, TWO: THREE.TOUCH.DOLLY_ROTATE }
            : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
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
        <PlayerTool key={player.id} player={player} />
      ))}

      <SprayMist players={players} />

      <ContactShadows position={[0, -7.4, 0]} opacity={0.6} scale={44} blur={2.6} far={18} />
    </>
  );
};
