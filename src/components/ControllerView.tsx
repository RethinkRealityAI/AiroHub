import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { PerspectiveCamera, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
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
  User,
  Rotate3d,
  Move,
  Layers,
  MousePointer,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import { PhoneTool3D } from './PhoneTool3D';
import { DecorateObjects3D } from './DecorateObjects3D';
import { RadialColorPicker } from './RadialColorPicker';
import { TargetObjectType, PlayerInfo } from '../types';

const TARGET_OBJECTS: { id: TargetObjectType; label: string; icon: string }[] = [
  { id: 'easel', label: 'Easel', icon: '🎨' },
  { id: 'skateboard', label: 'Skate', icon: '🛹' },
  { id: 'subway', label: 'Train', icon: '🚇' },
  { id: 'boombox', label: 'Boombox', icon: '📻' },
  { id: 'wall', label: 'Wall', icon: '🧱' },
  { id: 'helmet', label: 'Helmet', icon: '🪖' },
  { id: 'sneaker', label: 'Sneaker', icon: '👟' },
  { id: 'vinyltoy', label: 'Toy', icon: '🧸' },
  { id: 'sculpture', label: 'Bust', icon: '🗿' },
];

const CANVAS_RES = 2048;

/**
 * 3D Interactive Drawing Scene for Controller Draw Mode
 */
interface Controller3DDrawSceneProps {
  targetObject: TargetObjectType;
  canvasTexture: THREE.CanvasTexture | null;
  selectedTool: 'spray' | 'brush';
  selectedColor: string;
  toolSize: number;
  drawSubMode: 'paint' | 'rotate';
  onDrawEvent: (type: 'start' | 'move' | 'end', normX: number, normY: number) => void;
  orbitControlsRef: React.MutableRefObject<any>;
}

function Controller3DDrawScene({
  targetObject,
  canvasTexture,
  selectedTool,
  selectedColor,
  toolSize,
  drawSubMode,
  onDrawEvent,
  orbitControlsRef,
}: Controller3DDrawSceneProps) {
  const { camera, raycaster, scene } = useThree();
  const objGroupRef = useRef<THREE.Group>(null);
  const isPaintingRef = useRef<boolean>(false);
  const toolCursorRef = useRef<THREE.Group>(null);
  const lastNormPos = useRef<{ x: number; y: number } | null>(null);

  // Collect target meshes for precision raycasting
  const getMeshes = useCallback(() => {
    if (!objGroupRef.current) return [];
    const meshes: THREE.Mesh[] = [];
    objGroupRef.current.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshes.push(child as THREE.Mesh);
      }
    });
    return meshes;
  }, []);

  const handlePointerDown = (e: any) => {
    if (drawSubMode !== 'paint') return;
    e.stopPropagation();
    isPaintingRef.current = true;

    const meshes = getMeshes();
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      let normX = 0.5;
      let normY = 0.5;
      if (hit.uv) {
        normX = hit.uv.x;
        normY = 1 - hit.uv.y;
      } else {
        // Fallback: estimate from bounding box
        normX = 0.5;
        normY = 0.5;
      }
      lastNormPos.current = { x: normX, y: normY };
      onDrawEvent('start', normX, normY);

      if (toolCursorRef.current) {
        toolCursorRef.current.position.copy(hit.point);
      }
    }
  };

  const handlePointerMove = (e: any) => {
    if (drawSubMode !== 'paint' || !isPaintingRef.current) return;
    e.stopPropagation();

    const meshes = getMeshes();
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      let normX = 0.5;
      let normY = 0.5;
      if (hit.uv) {
        normX = hit.uv.x;
        normY = 1 - hit.uv.y;
      } else if (lastNormPos.current) {
        normX = lastNormPos.current.x;
        normY = lastNormPos.current.y;
      }
      lastNormPos.current = { x: normX, y: normY };
      onDrawEvent('move', normX, normY);

      if (toolCursorRef.current) {
        toolCursorRef.current.position.copy(hit.point);
      }
    }
  };

  const handlePointerUp = (e: any) => {
    if (drawSubMode !== 'paint' || !isPaintingRef.current) return;
    e.stopPropagation();
    isPaintingRef.current = false;
    onDrawEvent('end', 0, 0);
    lastNormPos.current = null;
  };

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 8.0]} fov={50} />

      <OrbitControls
        ref={orbitControlsRef}
        enabled={drawSubMode === 'rotate'}
        enableDamping
        dampingFactor={0.08}
        minDistance={3.5}
        maxDistance={22}
      />

      {/* 3D Studio Lights */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 10, 8]} intensity={1.6} />
      <directionalLight position={[-6, -4, 4]} intensity={0.6} color={selectedColor} />
      <spotLight position={[0, 6, 8]} angle={0.6} intensity={1.4} color="#ffffff" />

      {/* Target Object Group with Pointer Events */}
      <group
        ref={objGroupRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <DecorateObjects3D objectType={targetObject} canvasTexture={canvasTexture} />
      </group>

      {/* 3D Live Surface Hover / Touch Indicator */}
      <group ref={toolCursorRef} visible={drawSubMode === 'paint'}>
        <mesh>
          <sphereGeometry args={[0.12 * toolSize, 16, 16]} />
          <meshBasicMaterial color={selectedColor} transparent opacity={0.8} />
        </mesh>
      </group>
    </>
  );
}

export default function ControllerView() {
  const { roomId } = useParams<{ roomId: string }>();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [isDesktopDevice, setIsDesktopDevice] = useState<boolean>(false);

  // Multiplayer Player Identity State
  const [myPlayerInfo, setMyPlayerInfo] = useState<PlayerInfo>({
    id: '',
    slot: 1,
    name: 'Tagger 1',
    color: '#FF3D00',
    tool: 'spray',
    mode: 'motion',
  });
  const [taggerNameModal, setTaggerNameModal] = useState<boolean>(false);
  const [editNameInput, setEditNameInput] = useState<string>('');

  // Controller Core Mode: 'motion' (gyro pointer) vs 'projection' (draw on 3D object / canvas)
  const [controllerMode, setControllerMode] = useState<'motion' | 'projection'>('motion');
  const [drawViewType, setDrawViewType] = useState<'3d_model' | '2d_flat'>('3d_model');
  const [drawSubMode, setDrawSubMode] = useState<'paint' | 'rotate'>('paint');

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

  // OrbitControls ref for 3D Draw View
  const orbitControlsRef = useRef<any>(null);

  // Local Texture & Buffer for Direct 3D Draw Rendering
  const localCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const localCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [localTexture, setLocalTexture] = useState<THREE.CanvasTexture | null>(null);

  // 2D Flat Pad Canvas Refs
  const flatCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const flatCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isFlatDrawing = useRef<boolean>(false);
  const lastFlatPos = useRef<{ x: number; y: number } | null>(null);

  // Initialize Local 2048 Texture Buffer
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_RES;
    canvas.height = CANVAS_RES;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0f0f14';
      ctx.fillRect(0, 0, CANVAS_RES, CANVAS_RES);
      localCtxRef.current = ctx;
      localCanvasRef.current = canvas;
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      setLocalTexture(tex);
    }

    // Detect if running on a desktop / non-motion device
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!hasTouch) {
      setIsDesktopDevice(true);
    }
  }, []);

  // WebSocket Connection & Multiplayer Player Assignment
  useEffect(() => {
    const newSocket = io();

    newSocket.on('connect', () => {
      setConnected(true);
      if (roomId) {
        newSocket.emit('join-room', { roomId, role: 'controller', playerName: myPlayerInfo.name });
      }
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    newSocket.on('player-assigned', (player: PlayerInfo) => {
      setMyPlayerInfo(player);
      setSelectedColor(player.color);
      setSelectedTool(player.tool);
      sounds.playClick(1.5);
    });

    newSocket.on('change-object', (data) => {
      if (data.objectType) setTargetObject(data.objectType);
    });

    newSocket.on('clear-canvas', () => {
      clearLocalCanvas();
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

      socket.emit('motion', {
        roomId,
        playerId: myPlayerInfo.id,
        playerSlot: myPlayerInfo.slot,
        playerName: myPlayerInfo.name,
        color: selectedColor,
        alpha,
        beta,
        gamma,
      });
      lastEmitTime.current = now;
    },
    [socket, roomId, myPlayerInfo, selectedColor]
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
        socket.emit('shake', { roomId, playerId: myPlayerInfo.id, intensity: magnitude });
      }
    },
    [socket, roomId, myPlayerInfo]
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
          setControllerMode('projection'); // fallback to Draw Mode if denied
        }
      } catch (error) {
        console.error('Permission error:', error);
        setPermissionGranted(false);
        setControllerMode('projection');
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
          playerId: myPlayerInfo.id,
          playerSlot: myPlayerInfo.slot,
          playerName: myPlayerInfo.name,
          action: selectedTool,
          state: 'start',
          color: selectedColor,
        });
      }
    },
    [socket, roomId, selectedTool, selectedColor, myPlayerInfo]
  );

  const handleTriggerUp = useCallback(
    (e?: React.PointerEvent) => {
      if (e) e.preventDefault();
      setIsTriggerActive(false);

      if (selectedTool === 'spray') sounds.stopSpray();
      else sounds.stopBrush();

      if (socket && roomId) {
        socket.emit('action', {
          roomId,
          playerId: myPlayerInfo.id,
          playerSlot: myPlayerInfo.slot,
          playerName: myPlayerInfo.name,
          action: selectedTool,
          state: 'stop',
          color: selectedColor,
        });
      }
    },
    [socket, roomId, selectedTool, selectedColor, myPlayerInfo]
  );

  // Clear local texture
  const clearLocalCanvas = () => {
    if (localCtxRef.current && localCanvasRef.current) {
      localCtxRef.current.fillStyle = '#0f0f14';
      localCtxRef.current.fillRect(0, 0, CANVAS_RES, CANVAS_RES);
      if (localTexture) localTexture.needsUpdate = true;
    }
    if (flatCtxRef.current && flatCanvasRef.current) {
      const rect = flatCanvasRef.current.getBoundingClientRect();
      flatCtxRef.current.fillStyle = '#0f0f14';
      flatCtxRef.current.fillRect(0, 0, rect.width, rect.height);
    }
  };

  // ==========================================================
  // 3D MODEL DIRECT DRAW HANDLER (From 3D Mesh Raycaster)
  // ==========================================================
  const handle3DDrawEvent = (type: 'start' | 'move' | 'end', normX: number, normY: number) => {
    const px = normX * CANVAS_RES;
    const py = normY * CANVAS_RES;

    const ctx = localCtxRef.current;
    if (ctx && type !== 'end') {
      if (selectedTool === 'spray') {
        drawSprayBuffer(ctx, px, py, selectedColor, toolSize);
      } else {
        ctx.strokeStyle = selectedColor;
        ctx.lineWidth = 18 * toolSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.arc(px, py, (18 * toolSize) / 2, 0, Math.PI * 2);
        ctx.fillStyle = selectedColor;
        ctx.fill();
      }
      if (localTexture) localTexture.needsUpdate = true;
    }

    if (type === 'start') {
      if (navigator.vibrate) navigator.vibrate(15);
      if (selectedTool === 'spray') sounds.startSpray(1.0);
      else sounds.startBrush();
    } else if (type === 'end') {
      sounds.stopSpray();
      sounds.stopBrush();
    }

    if (socket && roomId) {
      socket.emit('projection-draw', {
        roomId,
        playerId: myPlayerInfo.id,
        playerSlot: myPlayerInfo.slot,
        playerName: myPlayerInfo.name,
        type,
        tool: selectedTool,
        x: normX,
        y: normY,
        color: selectedColor,
        size: toolSize,
      });
    }
  };

  const drawSprayBuffer = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    size: number
  ) => {
    const density = Math.floor(45 * size);
    const radius = 35 * size;
    ctx.fillStyle = color;
    for (let i = 0; i < density; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 1.6) * radius;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      ctx.globalAlpha = Math.random() * 0.55 + 0.25;
      ctx.beginPath();
      ctx.arc(px, py, Math.random() * 2.8 + 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  };

  // Camera presets for 3D Draw View
  const setControllerCameraAngle = (azimuth: number, polar: number) => {
    if (!orbitControlsRef.current) return;
    sounds.playClick(1.2);
    orbitControlsRef.current.setAzimuthalAngle(azimuth);
    orbitControlsRef.current.setPolarAngle(polar);
    orbitControlsRef.current.update();
  };

  // ==========================================================
  // 2D FLAT PAD DRAWING HANDLER (Optional Fallback)
  // ==========================================================
  const initFlatCanvas = useCallback(() => {
    if (!flatCanvasRef.current) return;
    const canvas = flatCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 2;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    flatCtxRef.current = ctx;

    ctx.fillStyle = '#0f0f14';
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  useEffect(() => {
    if (controllerMode === 'projection' && drawViewType === '2d_flat') {
      setTimeout(initFlatCanvas, 40);
    }
  }, [controllerMode, drawViewType, initFlatCanvas]);

  const handleFlatPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isFlatDrawing.current = true;
    const canvas = flatCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const normX = Math.max(0, Math.min(1, x / rect.width));
    const normY = Math.max(0, Math.min(1, y / rect.height));
    lastFlatPos.current = { x, y };

    handle3DDrawEvent('start', normX, normY);
  };

  const handleFlatPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isFlatDrawing.current) return;
    e.preventDefault();
    const canvas = flatCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const normX = Math.max(0, Math.min(1, x / rect.width));
    const normY = Math.max(0, Math.min(1, y / rect.height));
    lastFlatPos.current = { x, y };

    handle3DDrawEvent('move', normX, normY);
  };

  const handleFlatPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    isFlatDrawing.current = false;
    lastFlatPos.current = null;
    handle3DDrawEvent('end', 0, 0);
  };

  const handleModeSwitch = (mode: 'motion' | 'projection') => {
    setControllerMode(mode);
    sounds.playClick(1.2);
    if (socket && roomId) {
      socket.emit('calibrate', { roomId, playerId: myPlayerInfo.id });
    }
  };

  const handleToolSelect = (tool: 'spray' | 'brush') => {
    setSelectedTool(tool);
    sounds.playClick(1.2);
    if (navigator.vibrate) navigator.vibrate(15);
    if (socket && roomId) {
      socket.emit('settings', { roomId, playerId: myPlayerInfo.id, tool, color: selectedColor });
    }
  };

  const handleColorSelect = (hex: string) => {
    setSelectedColor(hex);
    if (socket && roomId) {
      socket.emit('settings', { roomId, playerId: myPlayerInfo.id, color: hex });
    }
  };

  const handleObjectChange = (obj: TargetObjectType) => {
    setTargetObject(obj);
    sounds.playClick(1.3);
    if (socket && roomId) {
      socket.emit('change-object', { roomId, objectType: obj });
      socket.emit('calibrate', { roomId, playerId: myPlayerInfo.id });
    }
  };

  const handleSaveTaggerName = () => {
    if (editNameInput.trim()) {
      const newName = editNameInput.trim().slice(0, 12);
      setMyPlayerInfo((prev) => ({ ...prev, name: newName }));
      if (socket && roomId) {
        socket.emit('settings', { roomId, playerId: myPlayerInfo.id, playerName: newName });
      }
    }
    setTaggerNameModal(false);
  };

  const handleRecenter = () => {
    sounds.playClick(1.8);
    if (navigator.vibrate) navigator.vibrate([15, 30, 15]);
    if (socket && roomId) socket.emit('calibrate', { roomId, playerId: myPlayerInfo.id });
  };

  const handleClear = () => {
    sounds.playWhoosh();
    clearLocalCanvas();
    if (navigator.vibrate) navigator.vibrate(40);
    if (socket && roomId) socket.emit('clear-canvas', { roomId });
  };

  const toggleMute = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
    if (!muted) sounds.playClick(1.2);
  };

  if (permissionGranted === null && !isDesktopDevice) {
    return (
      <div className="min-h-screen bg-[#080808] text-[#D1D1D1] flex flex-col items-center justify-center p-6 text-center font-sans select-none">
        <div className="w-20 h-20 bg-[#141414] rounded-2xl flex items-center justify-center text-[#FF3D00] mb-6 border border-[#222] shadow-[0_0_30px_rgba(255,61,0,0.25)]">
          <SprayCan size={40} strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-bold mb-2 text-white tracking-tighter">
          AERO•CANVAS CONTROLLER
        </h1>
        <p className="text-[#888] mb-8 max-w-xs text-xs leading-relaxed">
          Connect your device as a 3D spray can or paint brush with Gyro Motion or Interactive 3D Draw Mode.
        </p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={requestAccess}
            className="w-full py-4 bg-[#FF3D00] hover:bg-orange-600 rounded-xl text-[11px] font-bold uppercase tracking-widest text-white shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Smartphone size={16} />
            <span>Enable 3D Motion Sensors</span>
          </button>
          <button
            onClick={() => {
              setPermissionGranted(false);
              setControllerMode('projection');
            }}
            className="w-full py-3 bg-[#141414] hover:bg-[#1E1E1E] border border-[#2A2A2A] rounded-xl text-[10px] font-bold uppercase tracking-wider text-[#AAA] transition-all"
          >
            Use Direct 3D Draw / Pointer Mode
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] text-[#D1D1D1] flex flex-col fixed inset-0 overscroll-none touch-none font-sans select-none overflow-hidden">
      {/* ========================================================
          TOP BAR: ROOM & MULTIPLAYER PLAYER BADGE
          ======================================================== */}
      <header className="h-14 px-3 bg-[#0A0A0A] border-b border-[#1A1A1A] flex items-center justify-between z-30">
        {/* Player Badge / Alias Customizer */}
        <button
          onClick={() => {
            setEditNameInput(myPlayerInfo.name);
            setTaggerNameModal(true);
          }}
          className="flex items-center space-x-1.5 bg-[#141414] px-2.5 py-1 rounded-full border border-[#222] hover:border-[#444] transition-all"
        >
          <div
            className="w-2.5 h-2.5 rounded-full animate-pulse shadow-sm"
            style={{ backgroundColor: selectedColor }}
          />
          <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-white truncate max-w-[85px]">
            {`P${myPlayerInfo.slot}: ${myPlayerInfo.name}`}
          </span>
          <User size={10} className="text-[#666]" />
        </button>

        {/* Mode Switch: Gyro Motion vs 3D Draw */}
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
            <span>3D Gyro</span>
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
            <span>3D Draw</span>
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
        <div className="flex bg-[#16161C] p-0.5 rounded-lg border border-[#262630] flex-shrink-0">
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
              className={`px-2 py-1 rounded-md text-[8px] font-bold uppercase transition-all flex items-center gap-1 flex-shrink-0 ${
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
          MODE A: 3D GYRO MOTION CONTROLLER (OR DESKTOP POINTER)
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

          <div className="absolute bottom-20 left-0 right-0 flex flex-col items-center pointer-events-none z-20 px-4">
            <span
              className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] transition-all text-center ${
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
                : isDesktopDevice
                ? 'CLICK & HOLD SCREEN TO SPRAY'
                : 'AIM PHONE & HOLD SCREEN TO SPRAY'}
            </span>
          </div>
        </main>
      )}

      {/* ========================================================
          MODE B: INTERACTIVE 3D OBJECT DRAWING VIEW
          ======================================================== */}
      {controllerMode === 'projection' && (
        <div className="flex-1 relative flex flex-col bg-[#0A0A0E] overflow-hidden">
          {/* Top Floating Control Bar for 3D Draw Mode */}
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-30 pointer-events-auto">
            {/* Draw vs Rotate 3D Object Switch */}
            <div className="flex bg-black/80 backdrop-blur-md p-1 rounded-xl border border-[#2A2A38] shadow-xl">
              <button
                onClick={() => {
                  setDrawSubMode('paint');
                  sounds.playClick(1.2);
                }}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all ${
                  drawSubMode === 'paint'
                    ? 'bg-cyan-500 text-black shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                    : 'text-[#888] hover:text-white'
                }`}
              >
                <Edit3 size={11} />
                <span>Draw on 3D</span>
              </button>

              <button
                onClick={() => {
                  setDrawSubMode('rotate');
                  sounds.playClick(1.2);
                }}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all ${
                  drawSubMode === 'rotate'
                    ? 'bg-orange-500 text-white shadow-[0_0_12px_rgba(255,61,0,0.4)]'
                    : 'text-[#888] hover:text-white'
                }`}
              >
                <Rotate3d size={11} />
                <span>Rotate 360°</span>
              </button>
            </div>

            {/* Quick Camera Angle Buttons */}
            {drawViewType === '3d_model' && (
              <div className="flex items-center space-x-1 bg-black/80 backdrop-blur-md p-1 rounded-xl border border-[#2A2A38]">
                <button
                  onClick={() => setControllerCameraAngle(0, Math.PI / 2)}
                  className="px-2 py-1 rounded bg-[#181822] hover:bg-[#252535] text-[8px] font-bold text-[#DDD]"
                >
                  Front
                </button>
                <button
                  onClick={() => setControllerCameraAngle(1.3, Math.PI / 2)}
                  className="px-2 py-1 rounded bg-[#181822] hover:bg-[#252535] text-[8px] font-bold text-[#DDD]"
                >
                  Side
                </button>
                <button
                  onClick={() => setControllerCameraAngle(0, 0.2)}
                  className="px-2 py-1 rounded bg-[#181822] hover:bg-[#252535] text-[8px] font-bold text-[#DDD]"
                >
                  Top
                </button>
              </div>
            )}

            {/* 3D vs 2D Pad Switch */}
            <button
              onClick={() => {
                setDrawViewType((prev) => (prev === '3d_model' ? '2d_flat' : '3d_model'));
                sounds.playClick(1.3);
              }}
              className="p-2 bg-black/80 backdrop-blur-md border border-[#2A2A38] rounded-xl text-[#AAA] hover:text-white"
              title={drawViewType === '3d_model' ? 'Switch to 2D Pad' : 'Switch to 3D Model'}
            >
              <Layers size={13} />
            </button>
          </div>

          {/* 1. Direct 3D Object Stage */}
          {drawViewType === '3d_model' ? (
            <div className="flex-1 w-full h-full relative cursor-crosshair">
              <Canvas className="w-full h-full">
                <Controller3DDrawScene
                  targetObject={targetObject}
                  canvasTexture={localTexture}
                  selectedTool={selectedTool}
                  selectedColor={selectedColor}
                  toolSize={toolSize}
                  drawSubMode={drawSubMode}
                  onDrawEvent={handle3DDrawEvent}
                  orbitControlsRef={orbitControlsRef}
                />
              </Canvas>

              <div className="absolute bottom-20 left-0 right-0 flex justify-center pointer-events-none z-10 px-4">
                <span className="px-3.5 py-1.5 rounded-full bg-black/80 backdrop-blur-md border border-cyan-500/30 text-[9px] font-bold uppercase tracking-widest text-cyan-300 shadow-lg text-center">
                  {drawSubMode === 'paint'
                    ? `TOUCH & COLOR DIRECTLY ON ${targetObject.toUpperCase()}`
                    : 'SWIPE SCREEN TO ROTATE 3D OBJECT'}
                </span>
              </div>
            </div>
          ) : (
            /* 2. Optional 2D Flat Pad */
            <div className="flex-1 w-full h-full relative flex flex-col">
              <canvas
                ref={flatCanvasRef}
                className="flex-1 w-full h-full cursor-crosshair touch-none"
                onPointerDown={handleFlatPointerDown}
                onPointerMove={handleFlatPointerMove}
                onPointerUp={handleFlatPointerUp}
                onPointerCancel={handleFlatPointerUp}
              />
              <div className="absolute bottom-20 left-0 right-0 flex justify-center pointer-events-none z-10">
                <span className="px-3 py-1 rounded-full bg-black/80 backdrop-blur border border-white/10 text-[9px] font-bold uppercase tracking-widest text-[#AAA]">
                  2D FLAT PROJECTION PAD
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          BOTTOM ACTIONS BAR (CLEAN & NON-INTERFERING)
          ======================================================== */}
      <footer className="p-3 bg-[#0A0A0A] border-t border-[#1A1A1A] flex items-center justify-between gap-2 z-30">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setIsShaking(true);
              if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
              shakeTimeoutRef.current = setTimeout(() => setIsShaking(false), 450);
              sounds.playCanRattle();
              if (navigator.vibrate) navigator.vibrate([30, 20, 35, 15, 30]);
              if (socket && roomId) socket.emit('shake', { roomId, playerId: myPlayerInfo.id });
            }}
            className="py-2.5 px-3 bg-[#141414] hover:bg-[#1C1C1C] border border-[#222] rounded-xl flex items-center gap-1.5 text-white active:scale-95 transition-all"
          >
            <Sparkles size={13} className="text-[#FF3D00]" />
            <span className="text-[9px] font-bold uppercase tracking-wider">Rattle</span>
          </button>

          <button
            onClick={handleClear}
            className="py-2.5 px-3 bg-[#141414] hover:bg-red-950/30 border border-[#222] hover:border-red-900/50 rounded-xl flex items-center gap-1.5 text-[#AAA] hover:text-red-400 active:scale-95 transition-all"
          >
            <Trash2 size={13} />
            <span className="text-[9px] font-bold uppercase tracking-wider">Clear</span>
          </button>
        </div>

        {/* Selected Tool Indicator & Size */}
        <div className="flex items-center gap-2 font-mono text-[9px] text-[#777] pr-16">
          <div
            className="w-2.5 h-2.5 rounded-full border border-black shadow"
            style={{ backgroundColor: selectedColor }}
          />
          <span className="text-[#CCC] font-bold uppercase">
            {selectedTool} • P{myPlayerInfo.slot}
          </span>
        </div>
      </footer>

      {/* ========================================================
          SLICK RADIAL COLOR PICKER (ALWAYS VISIBLE IN BOTTOM RIGHT)
          ======================================================== */}
      <RadialColorPicker
        selectedColor={selectedColor}
        onSelectColor={handleColorSelect}
        className="bottom-4 right-4"
      />

      {/* ========================================================
          MODAL: EDIT TAGGER ALIAS
          ======================================================== */}
      {taggerNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="w-full max-w-xs bg-[#121218] border border-[#282836] rounded-2xl p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-white mb-1">Customize Tagger Alias</h3>
            <p className="text-[10px] text-[#777] mb-3">Your name will appear floating above your 3D tool.</p>
            <input
              type="text"
              maxLength={12}
              value={editNameInput}
              onChange={(e) => setEditNameInput(e.target.value)}
              className="w-full px-3 py-2 bg-[#1A1A24] border border-[#333] rounded-xl text-xs text-white mb-4 focus:outline-none focus:border-cyan-500 font-mono"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setTaggerNameModal(false)}
                className="flex-1 py-2 bg-[#222] rounded-xl text-xs text-[#AAA] font-bold uppercase"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTaggerName}
                className="flex-1 py-2 bg-[#FF3D00] hover:bg-orange-600 rounded-xl text-xs text-white font-bold uppercase"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
