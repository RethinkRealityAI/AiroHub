/**
 * The phone controller.
 *
 * Mode organisation is the main change here. Previously there were two
 * top-level modes plus a hidden 2D pad reachable only through an unlabelled
 * icon, a tool switcher, and a nine-item object strip all stacked above the
 * stage — five competing control rows on a phone screen.
 *
 * Now there is one primary segmented control with three peer modes:
 *
 *   Aim   — point the phone, hold to spray (gyro)
 *   Paint — touch the 3D object directly on your own screen
 *   Pad   — flat trackpad, for when you just want to draw
 *
 * Everything else lives in a single bottom dock, and object selection moved to
 * a bottom sheet so it scales past nine objects and is comfortable to hit.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Canvas, useThree } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls } from '@react-three/drei';
import { motion, AnimatePresence } from 'motion/react';
import * as THREE from 'three';
import {
  Crosshair, SprayCan, Brush, Sparkles, Volume2, VolumeX, Trash2, Smartphone,
  Pencil, User, Rotate3d, Square, Check, Loader2, Wifi, WifiOff, Hand,
} from 'lucide-react';

import { sounds } from '../utils/audio';
import { PaintTarget, Finish } from '../scene/PaintTarget';
import { StudioEnvironment } from '../scene/StudioEnvironment';
import { useFitCamera } from '../scene/useFitCamera';
import { GlassPanel, GlassIconButton, Segmented, Sheet } from '../ui/Glass';
import { ColorWell } from '../ui/ColorWell';
import { ObjectTrigger, ObjectPickerSheet } from '../ui/ObjectPicker';
import { PaintSurface, CANVAS_RES } from '../paint/PaintSurface';
import { OBJECT_BY_ID } from '../paint/objectCatalog';
import { AiroConnection, isRealtimeConfigured } from '../net/realtime';
import { AimTracker, ShakeDetector } from '../utils/motion';
import { TargetObjectType, PlayerInfo } from '../types';

type ControllerMode = 'aim' | 'paint' | 'pad';

/** Motion send rate. Higher just burns realtime quota; the studio interpolates. */
const MOTION_HZ = 30;
const MOTION_INTERVAL = 1000 / MOTION_HZ;

/* ------------------------------------------------------------------
   On-device 3D preview (Paint mode)
   ------------------------------------------------------------------ */

interface PreviewProps {
  objectId: TargetObjectType;
  paintSurface: PaintSurface;
  finish: Finish;
  color: string;
  size: number;
  interaction: 'paint' | 'orbit';
  onPaint: (type: 'start' | 'move' | 'end', u: number, v: number) => void;
  orbitRef: React.MutableRefObject<any>;
  onLoadingChange: (loading: boolean) => void;
}

function PreviewStage({
  objectId,
  paintSurface,
  finish,
  color,
  size,
  interaction,
  onPaint,
  orbitRef,
  onLoadingChange,
}: PreviewProps) {
  const { camera, raycaster, gl } = useThree();
  const meshRegistry = useRef<THREE.Object3D[]>([]);
  const painting = useRef(false);
  const reticle = useRef<THREE.Mesh>(null);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const [subjectRadius, setSubjectRadius] = useState<number | null>(null);
  // Phones are tall and narrow, so framing has to come from the live aspect
  // ratio rather than a fixed camera distance.
  useFitCamera(subjectRadius, orbitRef, 1.04);

  const castAt = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(meshRegistry.current, true);
      return hits.length > 0 ? hits[0] : null;
    },
    [camera, gl, ndc, raycaster]
  );

  useEffect(() => {
    if (interaction !== 'paint') return;
    const canvas = gl.domElement;

    const handle = (event: PointerEvent, phase: 'start' | 'move') => {
      const hit = castAt(event.clientX, event.clientY);
      if (!hit) return;
      if (reticle.current) {
        reticle.current.position.copy(hit.point);
        reticle.current.visible = true;
      }
      if (!hit.uv) return;
      onPaint(phase, hit.uv.x, 1 - hit.uv.y);
    };

    const onDown = (event: PointerEvent) => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      painting.current = true;
      handle(event, 'start');
    };
    const onMove = (event: PointerEvent) => {
      if (!painting.current) return;
      event.preventDefault();
      handle(event, 'move');
    };
    const onUp = (event: PointerEvent) => {
      if (!painting.current) return;
      painting.current = false;
      if (reticle.current) reticle.current.visible = false;
      canvas.releasePointerCapture?.(event.pointerId);
      onPaint('end', 0, 0);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [castAt, gl, interaction, onPaint]);

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 1, 19]} fov={44} />
      <OrbitControls
        ref={orbitRef}
        enabled={interaction === 'orbit'}
        enableDamping
        dampingFactor={0.09}
        enablePan={false}
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
        <sphereGeometry args={[0.16 * size, 14, 14]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} depthTest={false} />
      </mesh>
    </>
  );
}

/* ------------------------------------------------------------------
   Aim mode visual
   ------------------------------------------------------------------ */

/**
 * Aim mode deliberately shows a 2D HUD rather than a 3D can. The player is
 * looking at the *studio* screen while aiming, so the phone only needs to
 * confirm state at a glance — and dropping the second WebGL context saves a
 * meaningful amount of battery and heat on a phone.
 */
const AimHud: React.FC<{
  tool: 'spray' | 'brush';
  color: string;
  active: boolean;
  calibrated: boolean;
  aim: { x: number; y: number };
}> = ({ tool, color, active, calibrated, aim }) => (
  <div className="absolute inset-0 grid place-items-center pointer-events-none">
    {/* Aim field: shows where the studio cursor currently sits. */}
    <div className="relative w-[74vw] max-w-[320px] aspect-square">
      <div className="absolute inset-0 rounded-[32px] border border-white/12 bg-white/[0.03]" />
      <div className="absolute inset-x-6 top-1/2 h-px bg-white/10" />
      <div className="absolute inset-y-6 left-1/2 w-px bg-white/10" />

      <motion.div
        className="absolute w-16 h-16 -ml-8 -mt-8 rounded-full grid place-items-center"
        animate={{ left: `${aim.x * 100}%`, top: `${aim.y * 100}%` }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      >
        <div
          className="absolute inset-0 rounded-full border-2 transition-all"
          style={{
            borderColor: color,
            boxShadow: active ? `0 0 34px ${color}, inset 0 0 18px ${color}55` : `0 0 12px ${color}55`,
            transform: active ? 'scale(1.16)' : 'scale(1)',
          }}
        />
        <div
          className="w-2.5 h-2.5 rounded-full transition-transform"
          style={{ background: color, transform: active ? 'scale(1.7)' : 'scale(1)' }}
        />
      </motion.div>
    </div>

    <div className="absolute bottom-6 inset-x-0 flex justify-center px-6">
      <div
        className={`glass glass-sheen rounded-full px-4 py-2 text-[10px] font-bold tracking-[0.14em] uppercase text-center transition-colors ${
          active ? 'text-white' : 'text-white/60'
        }`}
        style={active ? { background: `${color}33`, borderColor: `${color}88` } : undefined}
      >
        {active
          ? tool === 'spray'
            ? 'Spraying'
            : 'Painting'
          : calibrated
          ? 'Hold anywhere to paint'
          : 'Tap centre to calibrate'}
      </div>
    </div>
  </div>
);

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
  const [triggerActive, setTriggerActive] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [objectLoading, setObjectLoading] = useState(false);
  const [aim, setAim] = useState({ x: 0.5, y: 0.5 });

  const [objectSheet, setObjectSheet] = useState(false);
  const [nameSheet, setNameSheet] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const orbitRef = useRef<any>(null);
  const tracker = useRef(new AimTracker());
  const shakeDetector = useRef(new ShakeDetector());
  const lastMotionSend = useRef(0);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live mirrors of state that the sensor callbacks read. Those callbacks are
  // registered once, so closing over React state directly would freeze them at
  // their initial values.
  const live = useRef({ tool, color, toolSize, mode });
  useEffect(() => {
    live.current = { tool, color, toolSize, mode };
  }, [tool, color, toolSize, mode]);

  const padRef = useRef<HTMLCanvasElement>(null);
  const padDrawing = useRef(false);

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

    return () => {
      conn.disconnect();
      connectionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, paintSurface]);

  /* ----------------------------- sensors ----------------------------- */

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const { alpha, beta, gamma } = event;
    if (alpha === null || beta === null || gamma === null) return;

    const sample = tracker.current.update(alpha, beta, gamma, performance.now());
    setAim({ x: sample.x, y: sample.y });

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

  // Tell the studio which mode we are in, so it knows whether to derive paint
  // from our cursor (aim) or apply the UVs we send (paint/pad).
  useEffect(() => {
    const netMode = mode === 'aim' ? 'motion' : 'projection';
    connectionRef.current?.updatePresence({ mode: netMode, tool });
  }, [mode, tool]);

  /* ------------------------------ actions ------------------------------ */

  const recalibrate = () => {
    tracker.current.calibrate();
    setCalibrated(true);
    sounds.playClick(1.8);
    navigator.vibrate?.([14, 28, 14]);
    connectionRef.current?.emit('calibrate', { playerId: playerIdRef.current });
  };

  const startTrigger = (event?: React.PointerEvent) => {
    event?.preventDefault();
    if (!calibrated) {
      recalibrate();
      return;
    }
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

  /** Shared by the 3D preview and the flat pad. */
  const emitPaint = useCallback(
    (type: 'start' | 'move' | 'end', u: number, v: number) => {
      const { tool: t, color: c, toolSize: s } = live.current;

      if (type === 'start') {
        paintSurface.beginStroke('self');
        navigator.vibrate?.(12);
        if (t === 'spray') sounds.startSpray(1);
        else sounds.startBrush();
      } else if (type === 'end') {
        paintSurface.endStroke('self');
        sounds.stopSpray();
        sounds.stopBrush();
      }

      if (type !== 'end') {
        paintSurface.stroke('self', { x: u * CANVAS_RES, y: v * CANVAS_RES, pressure: 1 }, t, c, s);
        paintSurface.commit();
      }

      connectionRef.current?.emit('projection-draw', {
        playerId: playerIdRef.current,
        playerName: player.name,
        type,
        tool: t,
        x: u,
        y: v,
        color: c,
        size: s,
      });
    },
    [paintSurface, player.name]
  );

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

  // The pad mirrors the shared paint layer so a player can see their own work
  // without looking up at the studio screen.
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

  /* ------------------------------- gating ------------------------------- */

  const needsPermission = sensorState === 'idle';

  if (needsPermission) {
    return (
      <div className="fixed inset-0 stage-vignette text-white grid place-items-center p-6 safe-top safe-bottom">
        <GlassPanel className="w-full max-w-sm p-7 text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-[22px] bg-gradient-to-tr from-[#FF4D1C] to-[#FFB020] grid place-items-center shadow-[0_0_34px_rgba(255,77,28,0.5)]">
            <SprayCan size={30} className="text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight mb-1.5">Become the spray can</h1>
          <p className="text-[12px] text-white/55 leading-relaxed mb-6">
            Allow motion access to aim by pointing your phone at the studio screen. You can also paint
            directly on your own screen instead.
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
          {/* -------- Aim -------- */}
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
                  ? `radial-gradient(circle at 50% 45%, ${color}2e 0%, transparent 62%)`
                  : undefined,
              }}
            >
              <AimHud tool={tool} color={color} active={triggerActive} calibrated={calibrated} aim={aim} />

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
                  size={toolSize}
                  interaction={interaction}
                  onPaint={emitPaint}
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
                    ? `Touch the ${activeObject?.short ?? 'object'} to paint`
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
                    const { u, v } = padCoords(e);
                    emitPaint('start', u, v);
                  }}
                  onPointerMove={(e) => {
                    if (!padDrawing.current) return;
                    e.preventDefault();
                    const { u, v } = padCoords(e);
                    emitPaint('move', u, v);
                  }}
                  onPointerUp={(e) => {
                    if (!padDrawing.current) return;
                    padDrawing.current = false;
                    e.currentTarget.releasePointerCapture?.(e.pointerId);
                    emitPaint('end', 0, 0);
                  }}
                  onPointerCancel={() => {
                    if (!padDrawing.current) return;
                    padDrawing.current = false;
                    emitPaint('end', 0, 0);
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
