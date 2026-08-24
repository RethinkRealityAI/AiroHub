/**
 * The phone controller.
 *
 * Three peer modes on one segmented switch:
 *
 *   Aim   — the phone *is* the spray can. The real 3D can/brush floats on
 *           screen, rotating live with the motion sensors; hold anywhere to
 *           paint on the studio canvas where you're pointing.
 *   Paint — touch the 3D object directly on your own screen.
 *   Pad   — flat trackpad mapped straight onto the texture.
 *
 * All painting produces surface-anchored stamps (see `SurfacePainter`), which
 * are applied locally and broadcast so every peer's texture stays identical.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls } from '@react-three/drei';
import { motion, AnimatePresence } from 'motion/react';
import * as THREE from 'three';
import {
  Crosshair, SprayCan, Brush, Sparkles, Volume2, VolumeX, Trash2, Smartphone,
  Pencil, User, Rotate3d, Square, Check, Loader2, Wifi, WifiOff, Hand, Undo2, Eye, EyeOff,
} from 'lucide-react';

import { sounds } from '../utils/audio';
import { PaintTarget, Finish } from '../scene/PaintTarget';
import { StudioEnvironment } from '../scene/StudioEnvironment';
import { useFitCamera } from '../scene/useFitCamera';
import { HandheldTool } from '../scene/HandheldTool';
import { SurfacePainter } from '../scene/SurfacePainter';
import { GlassPanel, GlassIconButton, Segmented, Sheet } from '../ui/Glass';
import { ColorWell } from '../ui/ColorWell';
import { ObjectTrigger, ObjectPickerSheet } from '../ui/ObjectPicker';
import { PaintSurface, CANVAS_RES } from '../paint/PaintSurface';
import { StampBatcher, StampPacket, PaintStamp, BatchContext, packStamps, unpackStamps } from '../paint/stamps';
import { OBJECT_BY_ID } from '../paint/objectCatalog';
import { AiroConnection, isRealtimeConfigured } from '../net/realtime';
import { AimTracker, ShakeDetector } from '../utils/motion';
import { TargetObjectType, PlayerInfo } from '../types';

type ControllerMode = 'aim' | 'paint' | 'pad';

/** Motion send rate; the studio interpolates the remainder to frame rate. */
const MOTION_HZ = 40;
const MOTION_INTERVAL = 1000 / MOTION_HZ;

/* ------------------------------------------------------------------
   Aim mode: the handheld 3D tool scene
   ------------------------------------------------------------------ */

function AimStage({
  tool,
  color,
  pressed,
  shaking,
  trackerRef,
}: {
  tool: 'spray' | 'brush';
  color: string;
  pressed: boolean;
  shaking: boolean;
  trackerRef: React.MutableRefObject<AimTracker>;
}) {
  const getOrientation = useCallback(
    (out: THREE.Quaternion) => trackerRef.current.getRelativeQuaternion(out),
    [trackerRef]
  );

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 4.6]} fov={46} />
      <StudioEnvironment intensity={0.5} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 7, 5]} intensity={1.9} />
      <directionalLight position={[-5, -2, 3]} intensity={0.6} color={color} />
      <HandheldTool
        tool={tool}
        color={color}
        pressed={pressed}
        shaking={shaking}
        getOrientation={getOrientation}
      />
    </>
  );
}

/* ------------------------------------------------------------------
   Paint mode: on-device 3D preview with surface painting
   ------------------------------------------------------------------ */

interface PreviewProps {
  objectId: TargetObjectType;
  paintSurface: PaintSurface;
  finish: Finish;
  color: string;
  tool: 'spray' | 'brush';
  size: number;
  interaction: 'paint' | 'orbit';
  onStamps: (stamps: PaintStamp[], state: 'start' | 'paint' | 'end', context?: BatchContext) => void;
  /** Fired (throttled) whenever this phone's preview camera moves. */
  onCameraChange?: (azimuth: number, polar: number, distanceRatio: number) => void;
  orbitRef: React.MutableRefObject<any>;
  onLoadingChange: (loading: boolean) => void;
}

function PreviewStage({
  objectId,
  paintSurface,
  finish,
  color,
  tool,
  size,
  interaction,
  onStamps,
  onCameraChange,
  orbitRef,
  onLoadingChange,
}: PreviewProps) {
  /* eslint-disable react-hooks/exhaustive-deps */
  const { camera, gl, size: viewport } = useThree();
  const meshRegistry = useRef<THREE.Object3D[]>([]);
  const reticle = useRef<THREE.Mesh>(null);
  const [subjectRadius, setSubjectRadius] = useState<number | null>(null);
  useFitCamera(subjectRadius, orbitRef, 1.04);

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const painter = useMemo(
    () =>
      new SurfacePainter(
        () => meshRegistry.current,
        () => cameraRef.current,
        () => viewportRef.current.height
      ),
    []
  );
  useEffect(() => painter.invalidate(), [painter, objectId]);

  // Report orbit changes so the studio can (optionally) mirror this player's
  // view. Throttled — camera sync is cosmetic, not telemetry.
  useEffect(() => {
    const controls = orbitRef.current;
    if (!controls || !onCameraChange) return;
    let last = 0;
    const onChange = () => {
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      const distance = camera.position.distanceTo(controls.target);
      const min = controls.minDistance || 1;
      const max = controls.maxDistance || min + 1;
      onCameraChange(
        controls.getAzimuthalAngle(),
        controls.getPolarAngle(),
        THREE.MathUtils.clamp((distance - min) / Math.max(max - min, 0.001), 0, 1)
      );
    };
    controls.addEventListener('change', onChange);
    return () => controls.removeEventListener('change', onChange);
  }, [onCameraChange, camera, orbitRef, interaction]);

  /** Latest pointer NDC; painting is driven per-frame like the studio. */
  const pointerNdc = useRef(new THREE.Vector2());
  const pointerDown = useRef(false);
  /** Multi-touch tracking: a second finger turns the gesture into orbit. */
  const activePointers = useRef(new Set<number>());
  const gestureLock = useRef(false);

  const liveConfig = useRef({ tool, size, color });
  useEffect(() => {
    liveConfig.current = { tool, size, color };
  }, [tool, size, color]);

  useEffect(() => {
    if (interaction !== 'paint') return;
    const canvas = gl.domElement;

    const toNdc = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerNdc.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
    };

    const abortStroke = () => {
      if (!pointerDown.current) return;
      pointerDown.current = false;
      painter.end();
      onStamps([], 'end');
      if (reticle.current) reticle.current.visible = false;
      sounds.stopSpray();
      sounds.stopBrush();
    };

    const onDown = (event: PointerEvent) => {
      activePointers.current.add(event.pointerId);
      // Second finger = rotate/pinch gesture: hand the touch pair to the
      // orbit controls and cancel any stroke in progress. Painting stays
      // locked out until every finger lifts, so a sloppy pinch can't smear.
      if (activePointers.current.size > 1) {
        abortStroke();
        gestureLock.current = true;
        return;
      }
      if (gestureLock.current) return;
      event.preventDefault();
      toNdc(event);
      pointerDown.current = true;
      painter.begin({ tool: liveConfig.current.tool, size: liveConfig.current.size });
      onStamps([], 'start');
      navigator.vibrate?.(12);
      if (liveConfig.current.tool === 'spray') sounds.startSpray(1);
      else sounds.startBrush();
    };
    const onMove = (event: PointerEvent) => {
      if (!pointerDown.current) return;
      toNdc(event);
    };
    const onUp = (event: PointerEvent) => {
      activePointers.current.delete(event.pointerId);
      if (activePointers.current.size === 0) gestureLock.current = false;
      abortStroke();
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
      painter.end();
    };
  }, [gl, interaction, painter, onStamps]);

  useFrame((_, delta) => {
    if (interaction !== 'paint') return;
    const painting = pointerDown.current;
    const result = painter.frame(pointerNdc.current.x, pointerNdc.current.y, painting, delta);

    if (result.stamps.length > 0) {
      const last = result.hit;
      onStamps(
        result.stamps,
        'paint',
        last
          ? {
              cursor: [last.uv.x, last.uv.y],
              point: [last.point.x, last.point.y, last.point.z],
              normal: [last.normal.x, last.normal.y, last.normal.z],
            }
          : undefined
      );
    }

    if (reticle.current) {
      if (result.hit && painting) {
        reticle.current.visible = true;
        reticle.current.position.copy(result.hit.point);
      } else {
        reticle.current.visible = false;
      }
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 1, 19]} fov={44} />
      <OrbitControls
        ref={orbitRef}
        enableDamping
        dampingFactor={0.09}
        enablePan={false}
        // In paint mode one finger paints while two fingers rotate/pinch —
        // no toggling needed. The toggle still exists for one-finger orbit.
        touches={
          interaction === 'paint'
            ? { ONE: undefined as any, TWO: THREE.TOUCH.DOLLY_ROTATE }
            : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
        }
        mouseButtons={
          interaction === 'paint'
            ? { LEFT: undefined as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
            : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
        }
      />
      <StudioEnvironment intensity={0.55} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 10, 8]} intensity={1.9} />
      <directionalLight position={[-6, -2, 4]} intensity={0.55} color={color} />

      <PaintTarget
        objectId={objectId}
        paintTexture={paintSurface.texture}
        finish={finish}
        meshRegistry={meshRegistry}
        onLoadedChange={onLoadingChange}
        onRadiusChange={setSubjectRadius}
      />

      <mesh ref={reticle} visible={false}>
        <sphereGeometry args={[0.14 * size, 14, 14]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} depthTest={false} />
      </mesh>
    </>
  );
}

/* ------------------------------------------------------------------
   Controller
   ------------------------------------------------------------------ */

export default function ControllerView() {
  const { roomId } = useParams<{ roomId: string }>();

  const paintSurface = useMemo(() => new PaintSurface(CANVAS_RES), []);
  const connectionRef = useRef<AiroConnection | null>(null);
  const playerIdRef = useRef(
    `ctrl-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`
  );

  const [mode, setMode] = useState<ControllerMode>('aim');
  const [interaction, setInteraction] = useState<'paint' | 'orbit'>('paint');
  const [tool, setTool] = useState<'spray' | 'brush'>('spray');
  const [color, setColor] = useState('#FF4D1C');
  const [toolSize, setToolSize] = useState(1);
  const [objectId, setObjectId] = useState<TargetObjectType>('skateboard');
  const [finish, setFinish] = useState<Finish>('original');

  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [player, setPlayer] = useState<PlayerInfo>({
    id: playerIdRef.current,
    slot: 1,
    name: 'Tagger',
    color: '#FF4D1C',
    tool: 'spray',
    mode: 'motion',
  });

  const [sensorState, setSensorState] = useState<'idle' | 'granted' | 'denied' | 'unsupported'>('idle');
  const [showCan, setShowCan] = useState(true);
  const [triggerActive, setTriggerActive] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [objectLoading, setObjectLoading] = useState(false);

  const [objectSheet, setObjectSheet] = useState(false);
  const [nameSheet, setNameSheet] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const orbitRef = useRef<any>(null);
  const trackerRef = useRef(new AimTracker());
  const shakeDetector = useRef(new ShakeDetector());
  const lastMotionSend = useRef(0);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live mirrors read by sensor callbacks (registered once).
  const live = useRef({ tool, color, toolSize, mode });
  useEffect(() => {
    live.current = { tool, color, toolSize, mode };
  }, [tool, color, toolSize, mode]);

  const padRef = useRef<HTMLCanvasElement>(null);
  const padDrawing = useRef(false);
  const padLast = useRef<{ u: number; v: number } | null>(null);

  /* --------------------------- connection --------------------------- */

  useEffect(() => {
    if (!roomId) return;
    if (!isRealtimeConfigured()) {
      setConnection('offline');
      return;
    }

    const conn = new AiroConnection(roomId, {
      id: playerIdRef.current,
      role: 'controller',
      name: player.name,
      tool: 'spray',
      mode: 'motion',
    }).connect();
    connectionRef.current = conn;

    conn.on('connection', ({ status }) =>
      setConnection(status === 'connected' ? 'connected' : status === 'error' ? 'offline' : 'connecting')
    );
    conn.on('player-assigned', (assigned: PlayerInfo) => {
      setPlayer(assigned);
      setColor(assigned.color);
      sounds.playClick(1.5);
    });
    conn.on('change-object', ({ objectType }) => objectType && setObjectId(objectType));
    conn.on('clear-canvas', () => {
      paintSurface.clear();
      paintSurface.commit();
    });
    // Paint made elsewhere (studio pointer, motion players, other phones)
    // keeps this phone's local texture identical to the studio's.
    // Applies every peer's paint — including strokes the studio derives for
    // *this* phone's motion aiming (they carry our own playerId; broadcast
    // self:false already filters the packets we sent ourselves).
    conn.on('paint-stamps', (packet: StampPacket) => {
      if (packet.stamps?.length) {
        paintSurface.applyStamps(unpackStamps(packet.stamps), packet.tool, packet.color, packet.strokeId);
        paintSurface.commit();
      }
    });
    conn.on('undo-stroke', ({ strokeId }) => {
      if (strokeId && paintSurface.undoStroke(strokeId)) paintSurface.commit();
    });

    // Late-join sync: ask the studio for the artwork as it stands, and bake
    // the reply in as a baseline layer under our own stroke log.
    conn.on('connection', ({ status }) => {
      if (status === 'connected') {
        conn.emit('request-state', { playerId: playerIdRef.current });
      }
    });
    conn.on('canvas-state', ({ target, dataUrl }) => {
      if (target !== playerIdRef.current || typeof dataUrl !== 'string') return;
      const image = new Image();
      image.onload = () => {
        paintSurface.setBaseline(image);
        paintSurface.commit();
      };
      image.src = dataUrl;
    });

    return () => {
      conn.disconnect();
      connectionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, paintSurface]);

  /** Broadcasts stamps painted on this phone, tagged with the stroke id. */
  const strokeSeq = useRef(0);
  const strokeIdRef = useRef<string | null>(null);
  const stampBatcher = useMemo(
    () =>
      new StampBatcher((stamps, state, context) => {
        connectionRef.current?.emit('paint-stamps', {
          playerId: playerIdRef.current,
          playerName: player.name,
          tool: live.current.tool,
          color: live.current.color,
          state,
          strokeId: strokeIdRef.current ?? undefined,
          stamps: packStamps(stamps),
          ...context,
        } satisfies StampPacket as unknown as Record<string, unknown>);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useEffect(() => () => stampBatcher.dispose(), [stampBatcher]);

  /** Applies stamps locally AND queues them for the room — one code path for
   *  both the 3D preview and the flat pad, so the textures cannot diverge. */
  const handleStamps = useCallback(
    (stamps: PaintStamp[], state: 'start' | 'paint' | 'end', context?: BatchContext) => {
      if (state === 'start') {
        strokeIdRef.current = `${playerIdRef.current}#${++strokeSeq.current}`;
        stampBatcher.begin();
      }
      if (stamps.length) {
        const { tool: t, color: c } = live.current;
        paintSurface.applyStamps(stamps, t, c, strokeIdRef.current ?? undefined);
        paintSurface.commit();
        stampBatcher.push(stamps, context);
      }
      if (state === 'end') {
        stampBatcher.end();
        strokeIdRef.current = null;
      }
    },
    [stampBatcher, paintSurface]
  );

  /* ----------------------------- sensors ----------------------------- */

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const { alpha, beta, gamma } = event;
    if (alpha === null || beta === null || gamma === null) return;

    const sample = trackerRef.current.update(alpha, beta, gamma, performance.now());

    const now = performance.now();
    if (now - lastMotionSend.current < MOTION_INTERVAL) return;
    lastMotionSend.current = now;

    connectionRef.current?.emit('motion', {
      playerId: playerIdRef.current,
      x: sample.x,
      y: sample.y,
      yaw: sample.yaw,
      pitch: sample.pitch,
      roll: sample.roll,
    });
  }, []);

  const handleDeviceMotion = useCallback((event: DeviceMotionEvent) => {
    const accel = event.accelerationIncludingGravity || event.acceleration;
    if (!accel || accel.x === null || accel.y === null || accel.z === null) return;

    const intensity = shakeDetector.current.push(accel.x, accel.y, accel.z, performance.now());
    if (intensity <= 0) return;

    setShaking(true);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShaking(false), 450);

    sounds.playCanRattle();
    navigator.vibrate?.([28, 18, 32, 14, 28]);
    connectionRef.current?.emit('shake', { playerId: playerIdRef.current, intensity });
  }, []);

  const requestSensors = async () => {
    const orientationApi = (DeviceOrientationEvent as any)?.requestPermission;
    try {
      if (typeof orientationApi === 'function') {
        const result = await orientationApi.call(DeviceOrientationEvent);
        if (result !== 'granted') {
          setSensorState('denied');
          setMode('paint');
          return;
        }
        const motionApi = (DeviceMotionEvent as any)?.requestPermission;
        if (typeof motionApi === 'function') await motionApi.call(DeviceMotionEvent);
      } else if (!('DeviceOrientationEvent' in window)) {
        setSensorState('unsupported');
        setMode('paint');
        return;
      }
      setSensorState('granted');
      sounds.playClick(1.6);
    } catch (err) {
      console.error('[controller] sensor permission failed', err);
      setSensorState('denied');
      setMode('paint');
    }
  };

  useEffect(() => {
    if (sensorState !== 'granted') return;
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('devicemotion', handleDeviceMotion);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleDeviceMotion);
    };
  }, [sensorState, handleOrientation, handleDeviceMotion]);

  useEffect(
    () => () => {
      if (shakeTimer.current) clearTimeout(shakeTimer.current);
      sounds.stopSpray();
      sounds.stopBrush();
    },
    []
  );

  // Tell the studio whether paint should be derived from our aim cursor
  // (motion) or arrives as our own stamps (projection).
  useEffect(() => {
    const netMode = mode === 'aim' ? 'motion' : 'projection';
    connectionRef.current?.updatePresence({ mode: netMode, tool });
  }, [mode, tool]);

  /* ------------------------------ actions ------------------------------ */

  const handleCameraChange = useCallback((azimuth: number, polar: number, distanceRatio: number) => {
    connectionRef.current?.emit('camera-sync', {
      playerId: playerIdRef.current,
      azimuth,
      polar,
      distanceRatio,
    });
  }, []);

  const undoLast = () => {
    const strokeId = paintSurface.lastStrokeId();
    if (!strokeId) return;
    paintSurface.undoStroke(strokeId);
    paintSurface.commit();
    sounds.playClick(1.1);
    navigator.vibrate?.(14);
    connectionRef.current?.emit('undo-stroke', { strokeId });
  };

  const recalibrate = () => {
    trackerRef.current.calibrate();
    sounds.playClick(1.8);
    navigator.vibrate?.([14, 28, 14]);
    connectionRef.current?.emit('calibrate', { playerId: playerIdRef.current });
  };

  const startTrigger = (event?: React.PointerEvent) => {
    event?.preventDefault();
    setTriggerActive(true);
    navigator.vibrate?.(22);
    if (live.current.tool === 'spray') sounds.startSpray(1);
    else sounds.startBrush();
    connectionRef.current?.emit('action', {
      playerId: playerIdRef.current,
      action: live.current.tool,
      state: 'start',
      color: live.current.color,
      size: live.current.toolSize,
    });
  };

  const stopTrigger = (event?: React.PointerEvent) => {
    event?.preventDefault();
    if (!triggerActive) return;
    setTriggerActive(false);
    sounds.stopSpray();
    sounds.stopBrush();
    connectionRef.current?.emit('action', {
      playerId: playerIdRef.current,
      action: live.current.tool,
      state: 'stop',
      color: live.current.color,
    });
  };

  /* ------------------------------- flat pad ------------------------------- */

  const syncPadSize = useCallback(() => {
    const canvas = padRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }, []);

  useEffect(() => {
    if (mode !== 'pad') return;
    const raf = requestAnimationFrame(syncPadSize);
    window.addEventListener('resize', syncPadSize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', syncPadSize);
    };
  }, [mode, syncPadSize]);

  // The pad mirrors the shared texture live.
  useEffect(() => {
    if (mode !== 'pad') return;
    let raf = 0;
    const draw = () => {
      const canvas = padRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(paintSurface.canvas, 0, 0, canvas.width, canvas.height);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode, paintSurface]);

  const padCoords = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      u: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      v: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
    };
  };

  /**
   * The pad maps 1:1 onto texture space (one continuous chart), so path
   * resampling in UV space is exact here — unlike on the atlased models.
   */
  const padStroke = (u: number, v: number, isFirst: boolean) => {
    const { tool: t, color: c, toolSize: s } = live.current;
    const stamps: PaintStamp[] = [];
    const baseR = t === 'spray' ? 34 * s : 22 * s;

    const emitDab = (du: number, dv: number) => {
      if (t === 'spray') {
        for (let i = 0; i < 12; i++) {
          const angle = Math.random() * Math.PI * 2;
          const rand = Math.pow(Math.random(), 1.6);
          stamps.push({
            u: du + (Math.cos(angle) * rand * baseR) / CANVAS_RES,
            v: dv + (Math.sin(angle) * rand * baseR) / CANVAS_RES,
            r: 1.2 + Math.random() * 2.6,
            o: (1 - rand * 0.5) * (0.3 + Math.random() * 0.3),
          });
        }
      } else {
        stamps.push({ u: du, v: dv, r: baseR, o: 0.85 });
      }
    };

    const last = padLast.current;
    if (isFirst || !last) {
      emitDab(u, v);
    } else {
      const dist = Math.hypot(u - last.u, v - last.v) * CANVAS_RES;
      const steps = Math.min(Math.max(Math.ceil(dist / (baseR * 0.35)), 1), 30);
      for (let i = 1; i <= steps; i++) {
        const t2 = i / steps;
        emitDab(last.u + (u - last.u) * t2, last.v + (v - last.v) * t2);
      }
    }
    padLast.current = { u, v };
    handleStamps(stamps, 'paint', { cursor: [u, v] });
  };

  /* ------------------------------- gating ------------------------------- */

  if (sensorState === 'idle') {
    return (
      <div className="fixed inset-0 stage-vignette text-white grid place-items-center p-6 safe-top safe-bottom">
        <GlassPanel className="w-full max-w-sm p-7 text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-[22px] bg-gradient-to-tr from-[#FF4D1C] to-[#FFB020] grid place-items-center shadow-[0_0_34px_rgba(255,77,28,0.5)]">
            <SprayCan size={30} className="text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight mb-1.5">Become the spray can</h1>
          <p className="text-[12px] text-white/55 leading-relaxed mb-6">
            Allow motion access and your phone turns into the can — point it at the studio screen,
            hold to spray, shake to rattle.
          </p>
          <button
            onClick={requestSensors}
            className="tap w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#FF4D1C] to-[#FF7A34] text-[12px] font-bold tracking-wide flex items-center justify-center gap-2 shadow-[0_10px_28px_-8px_rgba(255,77,28,0.8)] mb-2.5"
          >
            <Smartphone size={16} />
            Enable motion aiming
          </button>
          <button
            onClick={() => {
              setSensorState('denied');
              setMode('paint');
            }}
            className="tap w-full py-3 rounded-2xl bg-white/[0.07] border border-white/12 text-[11px] font-semibold text-white/75"
          >
            Just paint on my screen
          </button>
          <p className="mt-4 text-[10px] font-mono text-white/30">ROOM {roomId}</p>
        </GlassPanel>
      </div>
    );
  }

  const sensorsReady = sensorState === 'granted';
  const activeObject = OBJECT_BY_ID.get(objectId);

  const modeOptions = [
    { value: 'aim' as const, label: 'Aim', icon: <Crosshair size={13} />, accent: '#FF4D1C' },
    { value: 'paint' as const, label: 'Paint', icon: <Pencil size={13} />, accent: '#22D3EE' },
    { value: 'pad' as const, label: 'Pad', icon: <Square size={13} />, accent: '#A78BFA' },
  ].filter((option) => option.value !== 'aim' || sensorsReady);

  return (
    <div className="fixed inset-0 stage-vignette text-white flex flex-col overflow-hidden touch-none select-none">
      {/* ------------------------------ header ------------------------------ */}
      <header className="shrink-0 px-3 pt-2 pb-2 flex items-center gap-2 safe-top z-30">
        <button
          onClick={() => {
            setNameDraft(player.name);
            setNameSheet(true);
          }}
          className="tap glass glass-sheen rounded-full pl-2 pr-2.5 py-1.5 flex items-center gap-1.5 min-w-0"
        >
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${triggerActive ? 'airo-breathe' : ''}`}
            style={{ background: color }}
          />
          <span className="text-[11px] font-semibold truncate max-w-[92px]">
            P{player.slot} {player.name}
          </span>
          <User size={10} className="text-white/40 shrink-0" />
        </button>

        <div className="flex-1 flex justify-center min-w-0">
          <ObjectTrigger
            objectId={objectId}
            compact
            onClick={() => {
              setObjectSheet(true);
              sounds.playClick(1.2);
            }}
          />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="glass rounded-full w-8 h-8 grid place-items-center"
            title={connection === 'connected' ? 'Connected' : 'Not connected'}
          >
            {connection === 'connected' ? (
              <Wifi size={13} className="text-emerald-400" />
            ) : connection === 'connecting' ? (
              <Loader2 size={13} className="animate-spin text-white/50" />
            ) : (
              <WifiOff size={13} className="text-amber-400" />
            )}
          </span>
          <GlassIconButton
            size={32}
            onClick={() => setMuted(sounds.toggleMute())}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} className="text-[var(--color-airo-flame)]" />}
          </GlassIconButton>
        </div>
      </header>

      {/* --------------------------- mode selector --------------------------- */}
      <div className="shrink-0 px-3 pb-2 z-30">
        <Segmented
          layoutId="controller-mode"
          size="lg"
          className="w-full"
          value={mode}
          onChange={(next) => {
            setMode(next);
            sounds.playClick(1.25);
            navigator.vibrate?.(10);
          }}
          options={modeOptions}
        />
      </div>

      {/* ------------------------------- stage ------------------------------- */}
      <main className="flex-1 relative min-h-0">
        <AnimatePresence mode="wait">
          {/* -------- Aim: the phone IS the can -------- */}
          {mode === 'aim' && (
            <motion.div
              key="aim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="absolute inset-0 touch-none"
              onPointerDown={startTrigger}
              onPointerUp={stopTrigger}
              onPointerCancel={stopTrigger}
              onPointerLeave={stopTrigger}
              style={{
                background: triggerActive
                  ? `radial-gradient(circle at 50% 42%, ${color}30 0%, transparent 60%)`
                  : undefined,
              }}
            >
              {/* The handheld 3D tool, driven live by the motion sensors. */}
              {showCan && (
                <div className="absolute inset-0 pointer-events-none">
                  <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
                    <Suspense fallback={null}>
                      <AimStage
                        tool={tool}
                        color={color}
                        pressed={triggerActive}
                        shaking={shaking}
                        trackerRef={trackerRef}
                      />
                    </Suspense>
                  </Canvas>
                </div>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  recalibrate();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                className="tap absolute top-3 right-3 glass glass-sheen rounded-full px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-bold z-20"
              >
                <Crosshair size={12} className="text-[var(--color-airo-flame)]" />
                Recentre
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCan((v) => !v);
                  sounds.playClick(1.1);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                title={showCan ? 'Hide the 3D can' : 'Show the 3D can'}
                className="tap absolute top-3 left-3 glass glass-sheen rounded-full w-9 h-9 grid place-items-center z-20 text-white/70"
              >
                {showCan ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>

              <div className="absolute bottom-4 inset-x-0 flex justify-center px-6 pointer-events-none">
                <div
                  className={`glass glass-sheen rounded-full px-4 py-2 text-[10px] font-bold tracking-[0.14em] uppercase text-center transition-colors ${
                    triggerActive ? 'text-white' : 'text-white/60'
                  }`}
                  style={triggerActive ? { background: `${color}33`, borderColor: `${color}88` } : undefined}
                >
                  {triggerActive
                    ? tool === 'spray'
                      ? 'Spraying'
                      : 'Painting'
                    : 'Point at the screen · hold to paint'}
                </div>
              </div>
            </motion.div>
          )}

          {/* -------- Paint on 3D -------- */}
          {mode === 'paint' && (
            <motion.div
              key="paint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="absolute inset-0"
            >
              <Canvas dpr={[1, 2]} gl={{ antialias: true }} className="absolute inset-0">
                <Suspense fallback={null}>
                  <PreviewStage
                    objectId={objectId}
                    paintSurface={paintSurface}
                    finish={finish}
                    color={color}
                    tool={tool}
                    size={toolSize}
                    interaction={interaction}
                    onStamps={handleStamps}
                    onCameraChange={handleCameraChange}
                    orbitRef={orbitRef}
                    onLoadingChange={setObjectLoading}
                  />
                </Suspense>
              </Canvas>

              <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2 z-20">
                <Segmented
                  layoutId="controller-interaction"
                  size="sm"
                  value={interaction}
                  onChange={(next) => {
                    setInteraction(next);
                    sounds.playClick(1.2);
                  }}
                  options={[
                    { value: 'paint', label: 'Paint', icon: <Pencil size={11} />, accent: '#22D3EE' },
                    { value: 'orbit', label: 'Rotate', icon: <Rotate3d size={11} />, accent: '#FF4D1C' },
                  ]}
                />
                <AnimatePresence>
                  {objectLoading && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="glass rounded-full px-2.5 py-1.5 flex items-center gap-1.5 text-[9px] font-semibold"
                    >
                      <Loader2 size={10} className="animate-spin" />
                      Loading
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              <div className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none z-10 px-4">
                <span className="glass glass-sheen rounded-full px-3.5 py-1.5 text-[9px] font-bold tracking-[0.14em] uppercase text-white/70 text-center">
                  {interaction === 'paint'
                    ? `One finger paints · two fingers rotate & zoom`
                    : 'Drag to orbit'}
                </span>
              </div>
            </motion.div>
          )}

          {/* -------- Flat pad -------- */}
          {mode === 'pad' && (
            <motion.div
              key="pad"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="absolute inset-0 p-3"
            >
              <div className="relative w-full h-full rounded-[26px] overflow-hidden glass">
                <canvas
                  ref={padRef}
                  className="absolute inset-0 w-full h-full touch-none"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    padDrawing.current = true;
                    padLast.current = null;
                    handleStamps([], 'start');
                    navigator.vibrate?.(12);
                    if (live.current.tool === 'spray') sounds.startSpray(1);
                    else sounds.startBrush();
                    const { u, v } = padCoords(e);
                    padStroke(u, v, true);
                  }}
                  onPointerMove={(e) => {
                    if (!padDrawing.current) return;
                    e.preventDefault();
                    const { u, v } = padCoords(e);
                    padStroke(u, v, false);
                  }}
                  onPointerUp={(e) => {
                    if (!padDrawing.current) return;
                    padDrawing.current = false;
                    padLast.current = null;
                    e.currentTarget.releasePointerCapture?.(e.pointerId);
                    handleStamps([], 'end');
                    sounds.stopSpray();
                    sounds.stopBrush();
                  }}
                  onPointerCancel={() => {
                    if (!padDrawing.current) return;
                    padDrawing.current = false;
                    padLast.current = null;
                    handleStamps([], 'end');
                    sounds.stopSpray();
                    sounds.stopBrush();
                  }}
                />
                <span className="absolute bottom-3 inset-x-0 text-center text-[9px] font-bold tracking-[0.14em] uppercase text-white/35 pointer-events-none">
                  Flat pad · maps to the object's texture
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* -------------------------------- dock -------------------------------- */}
      <footer className="shrink-0 p-3 safe-bottom z-30">
        <GlassPanel className="p-2.5 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Segmented
              layoutId="controller-tool"
              className="flex-1"
              value={tool}
              onChange={(next) => {
                setTool(next);
                sounds.playClick(1.2);
                navigator.vibrate?.(12);
                connectionRef.current?.emit('settings', {
                  playerId: playerIdRef.current,
                  tool: next,
                  color,
                });
              }}
              options={[
                { value: 'spray', label: 'Spray', icon: <SprayCan size={13} />, accent: '#FF4D1C' },
                { value: 'brush', label: 'Brush', icon: <Brush size={13} />, accent: '#22D3EE' },
              ]}
            />
            <ColorWell
              color={color}
              onChange={(hex) => {
                setColor(hex);
                connectionRef.current?.emit('settings', { playerId: playerIdRef.current, color: hex });
              }}
              size={40}
            />
          </div>

          <div className="flex items-center gap-3 px-1">
            <span className="label-caps text-white/40 shrink-0">Size</span>
            <input
              type="range"
              min={0.4}
              max={2}
              step={0.05}
              value={toolSize}
              onChange={(e) => {
                const value = Number(e.target.value);
                setToolSize(value);
                connectionRef.current?.emit('settings', { playerId: playerIdRef.current, size: value });
              }}
              className="airo-slider flex-1"
              aria-label="Tool size"
            />
            <span className="text-[10px] font-mono text-white/50 w-8 text-right shrink-0">
              {toolSize.toFixed(1)}×
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShaking(true);
                if (shakeTimer.current) clearTimeout(shakeTimer.current);
                shakeTimer.current = setTimeout(() => setShaking(false), 450);
                sounds.playCanRattle();
                navigator.vibrate?.([28, 18, 32, 14, 28]);
                connectionRef.current?.emit('shake', { playerId: playerIdRef.current });
              }}
              className={`tap flex-1 py-2.5 rounded-2xl flex items-center justify-center gap-1.5 text-[10px] font-bold border transition-colors ${
                shaking
                  ? 'bg-[var(--color-airo-ember)]/25 border-[var(--color-airo-ember)]/50 text-[var(--color-airo-ember)]'
                  : 'bg-white/[0.06] border-white/12 text-white/75'
              }`}
            >
              <Sparkles size={13} />
              Shake
            </button>

            <button
              onClick={undoLast}
              className="tap flex-1 py-2.5 rounded-2xl bg-white/[0.06] border border-white/12 text-white/75 flex items-center justify-center gap-1.5 text-[10px] font-bold"
            >
              <Undo2 size={13} />
              Undo
            </button>

            <button
              onClick={() => {
                sounds.playWhoosh();
                paintSurface.clear();
                paintSurface.commit();
                navigator.vibrate?.(36);
                connectionRef.current?.emit('clear-canvas', {});
              }}
              className="tap flex-1 py-2.5 rounded-2xl bg-white/[0.06] border border-white/12 text-white/75 hover:text-red-300 flex items-center justify-center gap-1.5 text-[10px] font-bold"
            >
              <Trash2 size={13} />
              Clear
            </button>

            {mode !== 'aim' && (
              <button
                onClick={() => {
                  setFinish((f) => (f === 'original' ? 'primer' : 'original'));
                  sounds.playClick(1.15);
                }}
                className={`tap flex-1 py-2.5 rounded-2xl flex items-center justify-center gap-1.5 text-[10px] font-bold border transition-colors ${
                  finish === 'primer'
                    ? 'bg-white/20 border-white/35 text-white'
                    : 'bg-white/[0.06] border-white/12 text-white/75'
                }`}
                title="Toggle between the model's texture and a blank primer coat"
              >
                <Hand size={13} />
                {finish === 'primer' ? 'Primer' : 'Textured'}
              </button>
            )}
          </div>
        </GlassPanel>
      </footer>

      {/* ------------------------------- sheets ------------------------------- */}

      <ObjectPickerSheet
        open={objectSheet}
        onClose={() => setObjectSheet(false)}
        objectId={objectId}
        onSelect={(next) => {
          setObjectId(next);
          sounds.playClick(1.3);
          connectionRef.current?.emit('change-object', { objectType: next });
        }}
      />

      <Sheet
        open={nameSheet}
        onClose={() => setNameSheet(false)}
        centered
        title="Your tag"
        subtitle="Shown floating above your can in the studio"
      >
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          maxLength={14}
          autoFocus
          className="w-full px-4 py-3 rounded-2xl bg-black/40 border border-white/15 text-[15px] font-semibold focus:outline-none focus:border-[var(--color-airo-aqua)] mb-3"
          placeholder="Tagger"
        />
        <div className="flex gap-2">
          <button
            onClick={() => setNameSheet(false)}
            className="tap flex-1 py-3 rounded-2xl bg-white/[0.07] border border-white/12 text-[12px] font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const next = nameDraft.trim().slice(0, 14);
              if (next) {
                setPlayer((prev) => ({ ...prev, name: next }));
                connectionRef.current?.updatePresence({ name: next });
                connectionRef.current?.emit('settings', {
                  playerId: playerIdRef.current,
                  playerName: next,
                });
              }
              setNameSheet(false);
            }}
            className="tap flex-1 py-3 rounded-2xl bg-gradient-to-r from-[#FF4D1C] to-[#FF7A34] text-[12px] font-bold flex items-center justify-center gap-1.5"
          >
            <Check size={14} />
            Save
          </button>
        </div>
      </Sheet>
    </div>
  );
}
