import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import {
  Crosshair,
  SprayCan,
  PenTool,
  Sparkles,
  Volume2,
  VolumeX,
  Trash2,
  Smartphone,
  Edit3,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import { PhoneTool3D } from './PhoneTool3D';
import { TargetObjectType } from '../types';

const PALETTE = [
  { name: 'Electric Orange', hex: '#FF3D00' },
  { name: 'Cyber Cyan', hex: '#06B6D4' },
  { name: 'Acid Lime', hex: '#10B981' },
  { name: 'Hot Pink', hex: '#EC4899' },
  { name: 'Bright Gold', hex: '#F59E0B' },
  { name: 'Ultra Violet', hex: '#8B5CF6' },
  { name: 'Pure White', hex: '#FFFFFF' },
  { name: 'Matte Charcoal', hex: '#18181B' },
];

const TARGET_OBJECTS: { id: TargetObjectType; label: string; icon: string }[] = [
  { id: 'easel', label: 'Easel', icon: '🎨' },
  { id: 'skateboard', label: 'Skate', icon: '🛹' },
  { id: 'subway', label: 'Train', icon: '🚇' },
  { id: 'boombox', label: 'Boombox', icon: '📻' },
  { id: 'wall', label: 'Wall', icon: '🧱' },
];

export default function ControllerView() {
  const { roomId } = useParams<{ roomId: string }>();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);

  // Controller Core Mode: 'motion' (gyro pointer) vs 'projection' (touch drawing canvas)
  const [controllerMode, setControllerMode] = useState<'motion' | 'projection'>('motion');

  // Tool states
  const [selectedTool, setSelectedTool] = useState<'spray' | 'brush'>('spray');
  const [selectedColor, setSelectedColor] = useState<string>('#FF3D00');
  const [toolSize, setToolSize] = useState<number>(1.0);
  const [targetObject, setTargetObject] = useState<TargetObjectType>('easel');

  const [isTriggerActive, setIsTriggerActive] = useState<boolean>(false);
  const [isShaking, setIsShaking] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Motion sensor states
  const [orientationData, setOrientationData] = useState<{
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  }>({ alpha: null, beta: null, gamma: null });

  const lastEmitTime = useRef(0);
  const THROTTLE_MS = 14;
  const lastShakeTime = useRef(0);
  const shakeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Projection Drawing Canvas Refs
  const projCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const projCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isProjDrawing = useRef<boolean>(false);
  const lastProjPos = useRef<{ x: number; y: number } | null>(null);

  // WebSocket Connection
  useEffect(() => {
    const newSocket = io();

    newSocket.on('connect', () => {
      setConnected(true);
      if (roomId) {
        newSocket.emit('join-room', { roomId, role: 'controller' });
      }
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    newSocket.on('change-object', (data) => {
      if (data.objectType) setTargetObject(data.objectType);
    });

    newSocket.on('clear-canvas', () => {
      clearProjectionCanvasLocal();
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [roomId]);

  // Motion Sensor Handlers
  const handleOrientation = useCallback(
    (event: DeviceOrientationEvent) => {
      if (!socket || !roomId) return;

      const alpha = event.alpha;
      const beta = event.beta;
      const gamma = event.gamma;

      setOrientationData({ alpha, beta, gamma });

      const now = Date.now();
      if (now - lastEmitTime.current < THROTTLE_MS) return;

      // Always emit motion so cursor tracks properly
      socket.emit('motion', { roomId, alpha, beta, gamma });
      lastEmitTime.current = now;
    },
    [socket, roomId]
  );

  const handleMotion = useCallback(
    (event: DeviceMotionEvent) => {
      if (!socket || !roomId) return;
      const accel = event.accelerationIncludingGravity || event.acceleration;
      if (!accel || accel.x === null || accel.y === null || accel.z === null) return;

      const magnitude = Math.sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z);
      const now = Date.now();

      if (magnitude > 18 && now - lastShakeTime.current > 260) {
        lastShakeTime.current = now;
        setIsShaking(true);
        if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
        shakeTimeoutRef.current = setTimeout(() => setIsShaking(false), 450);

        sounds.playCanRattle();
        if (navigator.vibrate) navigator.vibrate([30, 20, 35, 15, 30]);
        socket.emit('shake', { roomId, intensity: magnitude });
      }
    },
    [socket, roomId]
  );

  const requestAccess = async () => {
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const permission = await (DeviceOrientationEvent as any).requestPermission();
        if (permission === 'granted') {
          setPermissionGranted(true);
          window.addEventListener('deviceorientation', handleOrientation);
          if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
            await (DeviceMotionEvent as any).requestPermission();
          }
          window.addEventListener('devicemotion', handleMotion);
        } else {
          setPermissionGranted(false);
        }
      } catch (error) {
        console.error('Permission error:', error);
        setPermissionGranted(false);
      }
    } else {
      setPermissionGranted(true);
      window.addEventListener('deviceorientation', handleOrientation);
      window.addEventListener('devicemotion', handleMotion);
    }
  };

  useEffect(() => {
    if (permissionGranted) {
      window.addEventListener('deviceorientation', handleOrientation);
      window.addEventListener('devicemotion', handleMotion);
    }
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleMotion);
      if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
    };
  }, [permissionGranted, handleOrientation, handleMotion]);

  // Motion Mode Trigger Press
  const handleTriggerDown = useCallback(
    (e?: React.PointerEvent) => {
      if (e) e.preventDefault();
      setIsTriggerActive(true);
      if (navigator.vibrate) navigator.vibrate(25);

      if (selectedTool === 'spray') sounds.startSpray(1.0);
      else sounds.startBrush();

      if (socket && roomId) {
        socket.emit('action', {
          roomId,
          action: selectedTool,
          state: 'start',
          color: selectedColor,
        });
      }
    },
    [socket, roomId, selectedTool, selectedColor]
  );

  const handleTriggerUp = useCallback(
    (e?: React.PointerEvent) => {
      if (e) e.preventDefault();
      setIsTriggerActive(false);

      if (selectedTool === 'spray') sounds.stopSpray();
      else sounds.stopBrush();

      if (socket && roomId) {
        socket.emit('action', { roomId, action: selectedTool, state: 'stop' });
      }
    },
    [socket, roomId, selectedTool]
  );

  // ==========================================================
  // DIRECT PROJECTION DRAWING ENGINE (HIGH PRECISION TOUCH)
  // ==========================================================
  const initProjectionCanvas = useCallback(() => {
    if (!projCanvasRef.current) return;
    const canvas = projCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 2;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    projCtxRef.current = ctx;

    ctx.fillStyle = '#0f0f14';
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  useEffect(() => {
    if (controllerMode === 'projection') {
      setTimeout(initProjectionCanvas, 40);
    }
  }, [controllerMode, initProjectionCanvas]);

  const clearProjectionCanvasLocal = () => {
    if (!projCanvasRef.current || !projCtxRef.current) return;
    const rect = projCanvasRef.current.getBoundingClientRect();
    projCtxRef.current.fillStyle = '#0f0f14';
    projCtxRef.current.fillRect(0, 0, rect.width, rect.height);
  };

  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = projCanvasRef.current;
    if (!canvas) return { x: 0, y: 0, normX: 0, normY: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const normX = Math.max(0, Math.min(1, x / rect.width));
    const normY = Math.max(0, Math.min(1, y / rect.height));
    return { x, y, normX, normY };
  };

  const handleProjPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isProjDrawing.current = true;
    const { x, y, normX, normY } = getCanvasCoords(e);
    lastProjPos.current = { x, y };

    if (navigator.vibrate) navigator.vibrate(15);
    if (selectedTool === 'spray') sounds.startSpray(1.0);
    else sounds.startBrush();

    const ctx = projCtxRef.current;
    if (ctx) {
      if (selectedTool === 'spray') {
        drawSprayLocal(ctx, x, y, selectedColor, toolSize);
      } else {
        ctx.strokeStyle = selectedColor;
        ctx.lineWidth = 14 * toolSize;
        ctx.beginPath();
        ctx.arc(x, y, (14 * toolSize) / 2, 0, Math.PI * 2);
        ctx.fillStyle = selectedColor;
        ctx.fill();
      }
    }

    if (socket && roomId) {
      socket.emit('projection-draw', {
        roomId,
        type: 'start',
        tool: selectedTool,
        x: normX,
        y: normY,
        color: selectedColor,
        size: toolSize,
      });
    }
  };

  const handleProjPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isProjDrawing.current) return;
    e.preventDefault();
    const { x, y, normX, normY } = getCanvasCoords(e);
    const ctx = projCtxRef.current;
    const prev = lastProjPos.current || { x, y };

    if (ctx) {
      if (selectedTool === 'spray') {
        drawSprayLocal(ctx, x, y, selectedColor, toolSize);
      } else {
        ctx.strokeStyle = selectedColor;
        ctx.lineWidth = 16 * toolSize;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
    lastProjPos.current = { x, y };

    if (socket && roomId) {
      socket.emit('projection-draw', {
        roomId,
        type: 'move',
        tool: selectedTool,
        x: normX,
        y: normY,
        color: selectedColor,
        size: toolSize,
      });
    }
  };

  const handleProjPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    isProjDrawing.current = false;
    lastProjPos.current = null;
    sounds.stopSpray();
    sounds.stopBrush();

    if (socket && roomId) {
      socket.emit('projection-draw', {
        roomId,
        type: 'end',
        tool: selectedTool,
        x: 0,
        y: 0,
        color: selectedColor,
        size: toolSize,
      });
    }
  };

  const drawSprayLocal = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    size: number
  ) => {
    const density = Math.floor(30 * size);
    const radius = 24 * size;
    ctx.fillStyle = color;
    for (let i = 0; i < density; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 1.6) * radius;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      ctx.globalAlpha = Math.random() * 0.5 + 0.2;
      ctx.beginPath();
      ctx.arc(px, py, Math.random() * 2.0 + 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  };

  const handleModeSwitch = (mode: 'motion' | 'projection') => {
    setControllerMode(mode);
    sounds.playClick(1.2);
    if (socket && roomId) {
      socket.emit('calibrate', { roomId });
    }
  };

  const handleToolSelect = (tool: 'spray' | 'brush') => {
    setSelectedTool(tool);
    sounds.playClick(1.2);
    if (navigator.vibrate) navigator.vibrate(15);
    if (socket && roomId) socket.emit('settings', { roomId, tool, color: selectedColor });
  };

  const handleColorSelect = (hex: string) => {
    setSelectedColor(hex);
    sounds.playClick(1.4);
    if (navigator.vibrate) navigator.vibrate(10);
    if (socket && roomId) socket.emit('settings', { roomId, color: hex });
  };

  const handleObjectChange = (obj: TargetObjectType) => {
    setTargetObject(obj);
    sounds.playClick(1.3);
    if (socket && roomId) {
      socket.emit('change-object', { roomId, objectType: obj });
      socket.emit('calibrate', { roomId });
    }
  };

  const handleRecenter = () => {
    sounds.playClick(1.8);
    if (navigator.vibrate) navigator.vibrate([15, 30, 15]);
    if (socket && roomId) socket.emit('calibrate', { roomId });
  };

  const handleClear = () => {
    sounds.playWhoosh();
    clearProjectionCanvasLocal();
    if (navigator.vibrate) navigator.vibrate(40);
    if (socket && roomId) socket.emit('clear-canvas', { roomId });
  };

  const toggleMute = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
    if (!muted) sounds.playClick(1.2);
  };

  if (permissionGranted === null) {
    return (
      <div className="min-h-screen bg-[#080808] text-[#D1D1D1] flex flex-col items-center justify-center p-6 text-center font-sans select-none">
        <div className="w-20 h-20 bg-[#141414] rounded-2xl flex items-center justify-center text-[#FF3D00] mb-6 border border-[#222] shadow-[0_0_30px_rgba(255,61,0,0.25)]">
          <SprayCan size={40} strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-bold mb-3 text-white tracking-tighter">
          AERO•CANVAS CONTROLLER
        </h1>
        <p className="text-[#888] mb-8 max-w-xs text-xs leading-relaxed">
          Enable motion & touch sensors for 3D gyro pointing and high-precision live projection drawing.
        </p>
        <button
          onClick={requestAccess}
          className="w-full max-w-xs py-4 bg-[#FF3D00] hover:bg-orange-600 rounded-xl text-[11px] font-bold uppercase tracking-widest text-white shadow-xl transition-all active:scale-95"
        >
          Connect Mobile Device
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] text-[#D1D1D1] flex flex-col fixed inset-0 overscroll-none touch-none font-sans select-none overflow-hidden">
      {/* ========================================================
          TOP BAR: ROOM & MAIN CONTROLLER MODE
          ======================================================== */}
      <header className="h-14 px-3 bg-[#0A0A0A] border-b border-[#1A1A1A] flex items-center justify-between z-30">
        <div className="flex items-center space-x-1.5 bg-[#141414] px-2.5 py-1 rounded-full border border-[#222]">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-[#AAA]">
            {roomId}
          </span>
        </div>

        {/* Mode Switch: Gyro Motion vs Projection */}
        <div className="flex items-center bg-[#141414] p-0.5 rounded-lg border border-[#222]">
          <button
            onClick={() => handleModeSwitch('motion')}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${
              controllerMode === 'motion'
                ? 'bg-[#FF3D00] text-white shadow-sm'
                : 'text-[#666] hover:text-white'
            }`}
          >
            <Smartphone size={11} />
            <span>3D Gyro Motion</span>
          </button>

          <button
            onClick={() => handleModeSwitch('projection')}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${
              controllerMode === 'projection'
                ? 'bg-[#06B6D4] text-white shadow-sm'
                : 'text-[#666] hover:text-white'
            }`}
          >
            <Edit3 size={11} />
            <span>Projection</span>
          </button>
        </div>

        {/* Recenter & Audio */}
        <div className="flex items-center space-x-1">
          {controllerMode === 'motion' && (
            <button
              onClick={handleRecenter}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-[#1A1A1A] border border-[#222] rounded-lg text-[9px] font-bold uppercase text-white active:scale-95"
              title="Calibrate Center"
            >
              <Crosshair size={11} className="text-[#FF3D00]" />
              <span>Zero</span>
            </button>
          )}

          <button
            onClick={toggleMute}
            className="p-1.5 bg-[#141414] border border-[#222] rounded-lg text-[#888]"
          >
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} className="text-[#FF3D00]" />}
          </button>
        </div>
      </header>

      {/* ========================================================
          SUB-HEADER: TOOL SELECTOR & 3D OBJECT PICKER
          ======================================================== */}
      <div className="px-3 pt-2 pb-1.5 z-20 bg-[#0C0C0E] border-b border-[#1A1A1A] flex items-center justify-between gap-2">
        {/* Tool Switch (Spray Can vs Paint Brush) */}
        <div className="flex bg-[#16161C] p-0.5 rounded-lg border border-[#262630]">
          <button
            onClick={() => handleToolSelect('spray')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${
              selectedTool === 'spray'
                ? 'bg-[#FF3D00] text-white shadow-[0_0_10px_rgba(255,61,0,0.3)]'
                : 'text-[#777]'
            }`}
          >
            <SprayCan size={12} />
            <span>Spray</span>
          </button>
          <button
            onClick={() => handleToolSelect('brush')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${
              selectedTool === 'brush'
                ? 'bg-[#06B6D4] text-white shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                : 'text-[#777]'
            }`}
          >
            <PenTool size={12} />
            <span>Brush</span>
          </button>
        </div>

        {/* 3D Target Object Quick Switch */}
        <div className="flex items-center space-x-1 overflow-x-auto">
          {TARGET_OBJECTS.map((obj) => (
            <button
              key={obj.id}
              onClick={() => handleObjectChange(obj.id)}
              className={`px-2 py-1 rounded-md text-[8px] font-bold uppercase transition-all flex items-center gap-1 ${
                targetObject === obj.id
                  ? 'bg-[#282834] text-white border border-[#444]'
                  : 'text-[#666] hover:text-white'
              }`}
            >
              <span>{obj.icon}</span>
              <span className="hidden xs:inline">{obj.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ========================================================
          MODE A: 3D GYRO MOTION CONTROLLER
          ======================================================== */}
      {controllerMode === 'motion' && (
        <main
          className="flex-1 relative flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden touch-none"
          onPointerDown={handleTriggerDown}
          onPointerUp={handleTriggerUp}
          onPointerCancel={handleTriggerUp}
          onPointerLeave={handleTriggerUp}
          style={{
            background: isTriggerActive
              ? selectedTool === 'spray'
                ? 'radial-gradient(circle at center, rgba(255,61,0,0.25) 0%, #080808 70%)'
                : 'radial-gradient(circle at center, rgba(6,182,212,0.25) 0%, #080808 70%)'
              : '#080808',
          }}
        >
          {/* 3D Floating Tool Scene on Phone */}
          <div className="absolute inset-0 pointer-events-none z-10">
            <Canvas className="w-full h-full">
              <PerspectiveCamera makeDefault position={[0, 0, 4.2]} fov={50} />
              <ambientLight intensity={0.6} />
              <directionalLight position={[5, 8, 5]} intensity={1.5} />
              <directionalLight position={[-5, -2, 3]} intensity={0.5} color={selectedColor} />
              <spotLight position={[0, 5, 4]} angle={0.6} intensity={1.2} color="#ffffff" />
              <PhoneTool3D
                tool={selectedTool}
                isPressed={isTriggerActive}
                color={selectedColor}
                isShaking={isShaking}
                orientation={orientationData}
              />
            </Canvas>
          </div>

          <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center pointer-events-none z-20">
            <span
              className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${
                isTriggerActive
                  ? selectedTool === 'spray'
                    ? 'bg-[#FF3D00] text-white shadow-[0_0_15px_#FF3D00]'
                    : 'bg-[#06B6D4] text-white shadow-[0_0_15px_#06B6D4]'
                  : 'bg-black/70 backdrop-blur border border-white/10 text-[#AAA]'
              }`}
            >
              {isTriggerActive
                ? selectedTool === 'spray'
                  ? 'EMITTING AEROSOL...'
                  : 'PAINTING STROKE...'
                : 'AIM PHONE & HOLD SCREEN TO SPRAY'}
            </span>
          </div>
        </main>
      )}

      {/* ========================================================
          MODE B: DIRECT PROJECTION DRAWING CANVAS
          ======================================================== */}
      {controllerMode === 'projection' && (
        <div className="flex-1 relative flex flex-col bg-[#0A0A0E] overflow-hidden">
          <canvas
            ref={projCanvasRef}
            className="flex-1 w-full h-full cursor-crosshair touch-none"
            onPointerDown={handleProjPointerDown}
            onPointerMove={handleProjPointerMove}
            onPointerUp={handleProjPointerUp}
            onPointerCancel={handleProjPointerUp}
          />

          <div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none z-10">
            <span className="px-3 py-1 rounded-full bg-black/80 backdrop-blur border border-white/10 text-[9px] font-bold uppercase tracking-widest text-[#AAA]">
              TOUCH & DRAW ON SCREEN • PROJECTING LIVE TO {targetObject.toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* ========================================================
          BOTTOM DOCK: PALETTE & ACTIONS
          ======================================================== */}
      <footer className="p-3 bg-[#0A0A0A] border-t border-[#1A1A1A] flex flex-col gap-2 z-30">
        {/* Palette Swatches */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto py-0.5">
          {PALETTE.map((c) => (
            <button
              key={c.hex}
              onClick={() => handleColorSelect(c.hex)}
              className={`w-7 h-7 rounded-full flex-shrink-0 transition-transform ${
                selectedColor === c.hex
                  ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-[#0A0A0A]'
                  : 'opacity-80 active:scale-95'
              }`}
              style={{ backgroundColor: c.hex }}
              title={c.name}
            />
          ))}
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => {
              setIsShaking(true);
              if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
              shakeTimeoutRef.current = setTimeout(() => setIsShaking(false), 450);
              sounds.playCanRattle();
              if (navigator.vibrate) navigator.vibrate([30, 20, 35, 15, 30]);
              if (socket && roomId) socket.emit('shake', { roomId });
            }}
            className="py-2.5 px-3 bg-[#141414] hover:bg-[#1C1C1C] border border-[#222] rounded-xl flex items-center justify-center gap-1.5 text-white active:scale-95 transition-all"
          >
            <Sparkles size={14} className="text-[#FF3D00]" />
            <span className="text-[9px] font-bold uppercase tracking-wider">
              Shake Can (Rattle)
            </span>
          </button>

          <button
            onClick={handleClear}
            className="py-2.5 px-3 bg-[#141414] hover:bg-red-950/30 border border-[#222] hover:border-red-900/50 rounded-xl flex items-center justify-center gap-1.5 text-[#AAA] hover:text-red-400 active:scale-95 transition-all"
          >
            <Trash2 size={14} />
            <span className="text-[9px] font-bold uppercase tracking-wider">
              Clear Canvas
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
}
