import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { DecorateObjects3D, OBJECT_SURFACE_DIMS } from './DecorateObjects3D';
import { Tools3D } from './Tools3D';
import { sounds } from '../utils/audio';
import { TargetObjectType, ProjectionDrawData } from '../types';
import {
  Volume2,
  VolumeX,
  Download,
  Trash2,
  Sparkles,
  Maximize,
  Minimize,
  Sparkle,
  X,
  Zap,
  Rotate3d,
  RefreshCw,
  Wand2,
  Layers,
  Palette,
  Eye,
  Sliders,
  Check,
} from 'lucide-react';

const CANVAS_PIXEL_RES = 2048;

// 2D Canvas Surface Manager with Stylistic Transformers
export class PaintSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;

  constructor(size: number = CANVAS_PIXEL_RES) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    this.clear();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
  }

  clear() {
    // Primed fine artist linen base
    this.ctx.fillStyle = '#f6f3eb';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Natural woven canvas grain
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.015)';
    for (let x = 0; x < this.canvas.width; x += 4) {
      this.ctx.fillRect(x, 0, 1.5, this.canvas.height);
    }
    for (let y = 0; y < this.canvas.height; y += 4) {
      this.ctx.fillRect(0, y, this.canvas.width, 1.5);
    }

    if (this.texture) this.texture.needsUpdate = true;
  }

  spray(x: number, y: number, color: string, sizeMultiplier = 1.0) {
    const baseRadius = 55 * sizeMultiplier;
    const density = Math.floor(75 * sizeMultiplier);
    this.ctx.fillStyle = color;

    for (let i = 0; i < density; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 1.7) * baseRadius;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;

      const dotRadius = Math.random() * 3.2 * sizeMultiplier + 0.6;
      this.ctx.globalAlpha = Math.random() * 0.55 + 0.2;

      this.ctx.beginPath();
      this.ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1.0;
    this.texture.needsUpdate = true;
  }

  brush(x0: number, y0: number, x1: number, y1: number, color: string, sizeMultiplier = 1.0) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 36 * sizeMultiplier;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();

    this.texture.needsUpdate = true;
  }

  stampSymbol(symbol: string, x: number, y: number, color: string, text?: string) {
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.font = 'bold 260px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = 35;
    this.ctx.fillText(symbol, x, y - (text ? 80 : 0));

    if (text) {
      this.ctx.font = '900 110px sans-serif';
      this.ctx.fillText(text.toUpperCase(), x, y + 120);
    }
    this.ctx.restore();
    this.texture.needsUpdate = true;
  }

  // ========================================================
  // ARTISTIC STYLISTIC TRANSFORMERS
  // ========================================================

  applyCyberpunkStyle(accentColor = '#06B6D4', secondaryColor = '#EC4899', tagText = 'CYBERPUNK') {
    this.ctx.save();
    // 1. Dark glowing vignette overlay
    const gradient = this.ctx.createRadialGradient(1024, 1024, 400, 1024, 1024, 1400);
    gradient.addColorStop(0, 'rgba(10, 10, 20, 0)');
    gradient.addColorStop(1, 'rgba(2, 6, 23, 0.65)');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, 2048, 2048);

    // 2. Cyber isometric grid overlay
    this.ctx.strokeStyle = 'rgba(6, 182, 212, 0.08)';
    this.ctx.lineWidth = 2;
    for (let x = 0; x <= 2048; x += 128) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, 2048);
      this.ctx.stroke();
    }
    for (let y = 0; y <= 2048; y += 128) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(2048, y);
      this.ctx.stroke();
    }

    // 3. Chromatic glow tag stamp
    this.ctx.shadowColor = accentColor;
    this.ctx.shadowBlur = 40;
    this.ctx.fillStyle = secondaryColor;
    this.ctx.font = '900 130px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`// ${tagText} //`, 1024, 1750);

    this.ctx.restore();
    this.texture.needsUpdate = true;
  }

  applyWildstyleDrips(accentColor = '#FF3D00', tagText = 'WILDSTYLE') {
    this.ctx.save();
    // 1. Realistic vertical paint drips
    this.ctx.fillStyle = accentColor;
    for (let i = 0; i < 28; i++) {
      const startX = Math.random() * 1800 + 124;
      const startY = Math.random() * 800 + 400;
      const dripLength = Math.random() * 320 + 80;
      const dripWidth = Math.random() * 8 + 3;

      this.ctx.beginPath();
      this.ctx.moveTo(startX - dripWidth / 2, startY);
      this.ctx.lineTo(startX + dripWidth / 2, startY);
      this.ctx.lineTo(startX + dripWidth / 3, startY + dripLength);
      this.ctx.arc(startX, startY + dripLength, dripWidth * 0.9, 0, Math.PI);
      this.ctx.closePath();
      this.ctx.fill();
    }

    // 2. Thick fat-cap wildstyle tag
    this.ctx.shadowColor = '#000000';
    this.ctx.shadowBlur = 25;
    this.ctx.fillStyle = '#F59E0B';
    this.ctx.font = '900 140px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`★ ${tagText} ★`, 1024, 1720);

    this.ctx.restore();
    this.texture.needsUpdate = true;
  }

  applyBanksyFilter(accentColor = '#FF3D00', tagText = 'HOPE') {
    this.ctx.save();
    // 1. Asphalt grit & desaturation wash
    this.ctx.fillStyle = 'rgba(24, 24, 27, 0.45)';
    this.ctx.fillRect(0, 0, 2048, 2048);

    // 2. High contrast stencil speckle
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    for (let i = 0; i < 400; i++) {
      const rx = Math.random() * 2048;
      const ry = Math.random() * 2048;
      this.ctx.fillRect(rx, ry, Math.random() * 4 + 1, Math.random() * 4 + 1);
    }

    // 3. Red beacon heart / balloon accent
    this.ctx.fillStyle = accentColor;
    this.ctx.font = 'bold 220px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.shadowColor = accentColor;
    this.ctx.shadowBlur = 20;
    this.ctx.fillText('♥', 1024, 750);

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '900 95px monospace';
    this.ctx.fillText(`"${tagText.toUpperCase()}"`, 1024, 1680);

    this.ctx.restore();
    this.texture.needsUpdate = true;
  }

  applyPopArtDots(accentColor = '#F59E0B', tagText = 'POW!') {
    this.ctx.save();
    // 1. Ben-Day comic dots pattern
    this.ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
    const spacing = 32;
    for (let x = 0; x < 2048; x += spacing) {
      for (let y = 0; y < 2048; y += spacing) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, 4, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    // 2. Comic burst bubble stamp
    this.ctx.fillStyle = accentColor;
    this.ctx.strokeStyle = '#18181B';
    this.ctx.lineWidth = 14;
    this.ctx.font = '900 180px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.strokeText(tagText, 1024, 1700);
    this.ctx.fillText(tagText, 1024, 1700);

    this.ctx.restore();
    this.texture.needsUpdate = true;
  }

  applyCosmicNebula(accentColor = '#8B5CF6', secondaryColor = '#06B6D4', tagText = 'COSMOS') {
    this.ctx.save();
    // 1. Deep space violet wash
    const nebGrad = this.ctx.createRadialGradient(1024, 1024, 100, 1024, 1024, 1200);
    nebGrad.addColorStop(0, 'rgba(139, 92, 246, 0.25)');
    nebGrad.addColorStop(0.6, 'rgba(6, 182, 212, 0.15)');
    nebGrad.addColorStop(1, 'rgba(10, 5, 25, 0.55)');
    this.ctx.fillStyle = nebGrad;
    this.ctx.fillRect(0, 0, 2048, 2048);

    // 2. Star cluster splatters
    this.ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 350; i++) {
      const sx = Math.random() * 2048;
      const sy = Math.random() * 2048;
      const sr = Math.random() * 3.5 + 0.8;
      this.ctx.globalAlpha = Math.random() * 0.8 + 0.2;
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1.0;

    // 3. Stardust constellation typography
    this.ctx.shadowColor = accentColor;
    this.ctx.shadowBlur = 45;
    this.ctx.fillStyle = secondaryColor;
    this.ctx.font = '900 130px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`✦ ${tagText} ✦`, 1024, 1720);

    this.ctx.restore();
    this.texture.needsUpdate = true;
  }
}

// Particle System for Aerosol Mist
const MAX_PARTICLES = 1600;

function SprayParticles({
  activeTool,
  cursorPosition,
  color,
}: {
  activeTool: 'spray' | 'brush' | null;
  cursorPosition: [number, number, number];
  color: string;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const particleData = useRef(
    Array.from({ length: MAX_PARTICLES }, () => ({
      life: 0,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      scale: 1,
    }))
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    if (activeTool === 'spray') {
      const spawnCount = 30;
      let spawned = 0;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (spawned >= spawnCount) break;
        if (particleData.current[i].life <= 0) {
          particleData.current[i].life = 0.8 + Math.random() * 0.4;

          particleData.current[i].position.set(
            cursorPosition[0] + (Math.random() - 0.5) * 0.2,
            cursorPosition[1] + (Math.random() - 0.5) * 0.2,
            cursorPosition[2] + 0.4
          );

          const angle = Math.random() * Math.PI * 2;
          const spread = Math.random() * 1.6;

          particleData.current[i].velocity.set(
            Math.cos(angle) * spread,
            Math.sin(angle) * spread,
            -2.8
          );

          particleData.current[i].scale = Math.random() * 0.16 + 0.06;
          spawned++;
        }
      }
    }

    colorObj.set(color);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particleData.current[i];
      if (p.life > 0) {
        p.life -= delta * 1.8;
        p.position.addScaledVector(p.velocity, delta);

        if (p.position.z < cursorPosition[2] + 0.05) {
          p.position.z = cursorPosition[2] + 0.05;
          p.velocity.set(p.velocity.x * 0.2, p.velocity.y * 0.2, 0);
          p.scale += delta * 0.25;
        }

        dummy.position.copy(p.position);
        dummy.scale.setScalar(p.scale * Math.max(0, p.life));
        dummy.updateMatrix();

        meshRef.current.setMatrixAt(i, dummy.matrix);
        meshRef.current.setColorAt(i, colorObj);
      } else {
        dummy.position.set(0, 0, -1000);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      }
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PARTICLES]}>
      <circleGeometry args={[1, 8]} />
      <meshBasicMaterial transparent opacity={0.5} depthWrite={false} color="#ffffff" />
    </instancedMesh>
  );
}

// 3D Scene Controller
interface SceneProps {
  roomId: string;
  targetObject: TargetObjectType;
  setTargetObject: (obj: TargetObjectType) => void;
  paintSurface: PaintSurface;
  activeTool: 'spray' | 'brush' | null;
  setActiveTool: (tool: 'spray' | 'brush' | null) => void;
  activeColor: string;
  setActiveColor: (color: string) => void;
  toolSize: number;
  isPainting: boolean;
  setIsPainting: (painting: boolean) => void;
  cursorWorldPos: [number, number, number];
  setCursorWorldPos: (pos: [number, number, number]) => void;
  orbitControlsRef: React.RefObject<any>;
  autoRotate: boolean;
}

function Scene({
  roomId,
  targetObject,
  setTargetObject,
  paintSurface,
  activeTool,
  setActiveTool,
  activeColor,
  setActiveColor,
  toolSize,
  isPainting,
  setIsPainting,
  cursorWorldPos,
  setCursorWorldPos,
  orbitControlsRef,
  autoRotate,
}: SceneProps) {
  const [socket, setSocket] = useState<Socket | null>(null);

  const cursorPx = useRef<{ x: number; y: number }>({ x: 1024, y: 1024 });
  const lastCursorPx = useRef<{ x: number; y: number }>({ x: 1024, y: 1024 });
  const lastProjPx = useRef<{ x: number; y: number } | null>(null);
  const originRef = useRef<{ alpha: number | null; beta: number | null }>({ alpha: null, beta: null });

  const currentDims = OBJECT_SURFACE_DIMS[targetObject] || { width: 15.2, height: 11.2, zOffset: 0.05 };

  // Calculate 3D world position from pixel coordinates
  const updateCursorFromPx = useCallback(
    (px: number, py: number) => {
      cursorPx.current = { x: px, y: py };
      const worldX = (px / CANVAS_PIXEL_RES - 0.5) * currentDims.width;
      const worldY = -(py / CANVAS_PIXEL_RES - 0.5) * currentDims.height;
      setCursorWorldPos([worldX, worldY, currentDims.zOffset]);
    },
    [currentDims, setCursorWorldPos]
  );

  // Auto-recalibrate origin on object switch or mount
  useEffect(() => {
    originRef.current = { alpha: null, beta: null };
  }, [targetObject]);

  // WebSockets synchronization
  useEffect(() => {
    const newSocket = io();

    newSocket.on('connect', () => {
      newSocket.emit('join-room', { roomId, role: 'canvas' });
    });

    // 1. Gyro Motion Data with Anti-Stuck Soft Drift
    newSocket.on('motion', (data) => {
      const { alpha, beta } = data;
      if (alpha === null || beta === null) return;

      if (originRef.current.alpha === null || originRef.current.beta === null) {
        originRef.current.alpha = alpha;
        originRef.current.beta = beta;
      }

      let dAlpha = alpha - originRef.current.alpha;
      let dBeta = beta - originRef.current.beta;

      if (dAlpha > 180) dAlpha -= 360;
      if (dAlpha < -180) dAlpha += 360;

      // Smooth angular sensitivity mapping (1 degree = ~36 pixels on 2048x2048)
      const SENSITIVITY = 36;
      let rawPx = 1024 - dAlpha * SENSITIVITY;
      let rawPy = 1024 - dBeta * SENSITIVITY;

      // Soft clamp with auto-drift so user never stays permanently wedged in a corner
      const PADDING = 60;
      if (rawPx < PADDING) {
        originRef.current.alpha += 0.4;
        rawPx = PADDING;
      } else if (rawPx > CANVAS_PIXEL_RES - PADDING) {
        originRef.current.alpha -= 0.4;
        rawPx = CANVAS_PIXEL_RES - PADDING;
      }

      if (rawPy < PADDING) {
        originRef.current.beta += 0.4;
        rawPy = PADDING;
      } else if (rawPy > CANVAS_PIXEL_RES - PADDING) {
        originRef.current.beta -= 0.4;
        rawPy = CANVAS_PIXEL_RES - PADDING;
      }

      const px = Math.max(0, Math.min(CANVAS_PIXEL_RES, rawPx));
      const py = Math.max(0, Math.min(CANVAS_PIXEL_RES, rawPy));

      updateCursorFromPx(px, py);

      if (isPainting && activeTool === 'brush') {
        sounds.modulateBrush(Math.hypot(dAlpha, dBeta));
      }
    });

    // 2. Action (Spray / Brush hold from Motion mode)
    newSocket.on('action', (data) => {
      if (data.color) setActiveColor(data.color);
      if (data.action) setActiveTool(data.action);

      if (data.state === 'start') {
        setIsPainting(true);
        lastCursorPx.current = { ...cursorPx.current };

        if (data.action === 'spray') {
          sounds.startSpray(data.pressure || 1.0);
        } else if (data.action === 'brush') {
          sounds.startBrush();
        }
      } else if (data.state === 'stop') {
        setIsPainting(false);
        sounds.stopSpray();
        sounds.stopBrush();
      }
    });

    // 3. Direct Mobile Projection Drawing
    newSocket.on('projection-draw', (data: ProjectionDrawData) => {
      const px = data.x * CANVAS_PIXEL_RES;
      const py = data.y * CANVAS_PIXEL_RES;

      updateCursorFromPx(px, py);

      if (data.type === 'start') {
        lastProjPx.current = { x: px, y: py };
        if (data.tool === 'spray') {
          sounds.startSpray(1.0);
          paintSurface.spray(px, py, data.color, data.size || 1.0);
        } else {
          sounds.startBrush();
          paintSurface.brush(px, py, px + 0.1, py + 0.1, data.color, data.size || 1.0);
        }
      } else if (data.type === 'move') {
        if (data.tool === 'spray') {
          paintSurface.spray(px, py, data.color, data.size || 1.0);
        } else {
          const prev = lastProjPx.current || { x: px, y: py };
          paintSurface.brush(prev.x, prev.y, px, py, data.color, data.size || 1.0);
        }
        lastProjPx.current = { x: px, y: py };
      } else if (data.type === 'end') {
        lastProjPx.current = null;
        sounds.stopSpray();
        sounds.stopBrush();
      }
    });

    // 4. Object Change
    newSocket.on('change-object', (data) => {
      if (data.objectType) {
        setTargetObject(data.objectType);
        originRef.current = { alpha: null, beta: null };
        sounds.playClick(1.5);
      }
    });

    // 5. Settings, clear, shake, calibrate, AI stamp
    newSocket.on('settings', (data) => {
      if (data.color) setActiveColor(data.color);
      if (data.tool) setActiveTool(data.tool);
      if (data.targetObject) {
        setTargetObject(data.targetObject);
        originRef.current = { alpha: null, beta: null };
      }
    });

    newSocket.on('clear-canvas', () => {
      paintSurface.clear();
      sounds.playWhoosh();
    });

    newSocket.on('shake', () => {
      sounds.playCanRattle();
    });

    newSocket.on('calibrate', () => {
      originRef.current = { alpha: null, beta: null };
      sounds.playClick(1.5);
    });

    newSocket.on('ai-stamp', (data) => {
      if (data.stencilSymbol) {
        paintSurface.stampSymbol(data.stencilSymbol, 1024, 1024, data.color || '#FF3D00', data.text);
        sounds.playWhoosh();
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      sounds.stopSpray();
      sounds.stopBrush();
    };
  }, [
    roomId,
    isPainting,
    activeTool,
    setActiveTool,
    setActiveColor,
    setIsPainting,
    updateCursorFromPx,
    paintSurface,
    setTargetObject,
  ]);

  // Painting frame loop
  useFrame(() => {
    if (isPainting) {
      if (activeTool === 'spray') {
        paintSurface.spray(cursorPx.current.x, cursorPx.current.y, activeColor, toolSize);
      } else if (activeTool === 'brush') {
        paintSurface.brush(
          lastCursorPx.current.x,
          lastCursorPx.current.y,
          cursorPx.current.x,
          cursorPx.current.y,
          activeColor,
          toolSize
        );
      }
    }
    lastCursorPx.current = { ...cursorPx.current };
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 7.6]} fov={55} />

      {/* 3D Orbit & Rotation Controls */}
      <OrbitControls
        ref={orbitControlsRef}
        enableDamping
        dampingFactor={0.06}
        minDistance={3.5}
        maxDistance={25}
        autoRotate={autoRotate}
        autoRotateSpeed={1.5}
        maxPolarAngle={Math.PI / 2 + 0.15}
      />

      {/* Studio Lighting */}
      <ambientLight intensity={0.65} />
      <directionalLight position={[10, 15, 12]} intensity={1.8} castShadow />
      <directionalLight position={[-12, 8, 10]} intensity={0.8} color="#38bdf8" />
      <spotLight
        position={[0, 8, 14]}
        angle={0.7}
        penumbra={0.8}
        intensity={1.6}
        color="#fff9f2"
        target-position={[0, 0, 0]}
      />

      {/* 3D Target Object (Grand Scale) */}
      <DecorateObjects3D objectType={targetObject} canvasTexture={paintSurface.texture} />

      {/* 3D Floating Tool Models */}
      <Tools3D
        targetPosition={cursorWorldPos}
        activeTool={activeTool}
        isTriggerActive={isPainting}
        color={activeColor}
        toolSize={toolSize}
      />

      {/* Dynamic Aerosol Mist Particle System */}
      <SprayParticles
        activeTool={isPainting ? activeTool : null}
        cursorPosition={cursorWorldPos}
        color={activeColor}
      />

      {/* Floor Shadows */}
      <ContactShadows position={[0, -6.0, 0]} opacity={0.75} scale={35} blur={2.4} far={15} />
    </>
  );
}

const PRESET_COLORS = [
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
  { id: 'easel', label: 'Studio Easel', icon: '🎨' },
  { id: 'skateboard', label: 'Skate Deck', icon: '🛹' },
  { id: 'subway', label: 'Subway Train', icon: '🚇' },
  { id: 'boombox', label: 'Vintage Boombox', icon: '📻' },
  { id: 'wall', label: 'Brick Alley', icon: '🧱' },
];

const STYLE_TRANSFORM_PRESETS = [
  {
    id: 'cyberpunk',
    name: 'Cyberpunk 2099',
    icon: '⚡',
    desc: 'Neon cyan/magenta glow, cybernetic vector grids, and chromatic edge flares.',
    accent: '#06B6D4',
  },
  {
    id: 'wildstyle80s',
    name: 'Vintage 80s Subway',
    icon: '👑',
    desc: 'Heavy gravity paint drips, fat-cap highlights, and hot yellow-to-orange flares.',
    accent: '#FF3D00',
  },
  {
    id: 'banksy',
    name: 'Banksy Stencil Dystopia',
    icon: '👁',
    desc: 'Gritty monochrome street wash with a single dripping red heart accent.',
    accent: '#18181B',
  },
  {
    id: 'popart',
    name: 'Pop-Art Ben-Day',
    icon: '✦',
    desc: 'Comic book halftone dot screens with saturated primary bursts.',
    accent: '#F59E0B',
  },
  {
    id: 'cosmic',
    name: 'Cosmic Nebula Aurora',
    icon: '🚀',
    desc: 'Deep ultraviolet nebulas, stardust galaxy scatter, and celestial flares.',
    accent: '#8B5CF6',
  },
];

export default function CanvasView() {
  const { roomId } = useParams<{ roomId: string }>();

  const paintSurface = useMemo(() => new PaintSurface(CANVAS_PIXEL_RES), []);
  const [activeTool, setActiveTool] = useState<'spray' | 'brush' | null>('spray');
  const [activeColor, setActiveColor] = useState<string>('#FF3D00');
  const [toolSize, setToolSize] = useState<number>(1.0);
  const [isPainting, setIsPainting] = useState<boolean>(false);
  const [cursorWorldPos, setCursorWorldPos] = useState<[number, number, number]>([0, 0, 0.05]);

  const [targetObject, setTargetObject] = useState<TargetObjectType>('easel');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);

  const orbitControlsRef = useRef<any>(null);

  // AI Modal states & tabs
  const [aiModalOpen, setAiModalOpen] = useState<boolean>(false);
  const [aiTab, setAiTab] = useState<'transform' | 'generate' | 'critique'>('transform');
  const [selectedStylePreset, setSelectedStylePreset] = useState<string>('cyberpunk');
  const [aiPrompt, setAiPrompt] = useState<string>('NEON OVERDRIVE');
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [transformResult, setTransformResult] = useState<any>(null);
  const [aiResult, setAiResult] = useState<any>(null);
  const [critiqueResult, setCritiqueResult] = useState<any>(null);

  // Preset 3D Camera Angles
  const setCameraAngle = (azimuth: number, polar: number) => {
    if (!orbitControlsRef.current) return;
    sounds.playClick(1.2);
    orbitControlsRef.current.setAzimuthalAngle(azimuth);
    orbitControlsRef.current.setPolarAngle(polar);
    orbitControlsRef.current.minDistance = 3.5;
    orbitControlsRef.current.maxDistance = 25;
    orbitControlsRef.current.update();
  };

  // Toggle Fullscreen Immersion Mode
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f') {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const toggleMute = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
    if (!muted) sounds.playClick(1.3);
  };

  const handleClearCanvas = () => {
    paintSurface.clear();
    sounds.playWhoosh();
  };

  const handleDownloadSnapshot = () => {
    sounds.playClick(1.6);
    const link = document.createElement('a');
    link.download = `AeroCanvas-${targetObject}-${roomId || 'art'}-${Date.now()}.png`;
    link.href = paintSurface.canvas.toDataURL('image/png');
    link.click();
  };

  // AI Style Transformation
  const handleTransformArtwork = async () => {
    setAiLoading(true);
    sounds.playClick(1.4);
    try {
      const res = await fetch('/api/ai/transform-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset: selectedStylePreset,
          objectType: targetObject,
          customPrompt: aiPrompt,
        }),
      });
      const data = await res.json();
      setTransformResult(data);

      // Execute procedural stylistic shader transformation onto the 3D canvas texture
      if (selectedStylePreset === 'cyberpunk') {
        paintSurface.applyCyberpunkStyle(data.accentColor, data.secondaryColor, data.tagText);
      } else if (selectedStylePreset === 'wildstyle80s') {
        paintSurface.applyWildstyleDrips(data.accentColor, data.tagText);
      } else if (selectedStylePreset === 'banksy') {
        paintSurface.applyBanksyFilter(data.accentColor, data.tagText);
      } else if (selectedStylePreset === 'popart') {
        paintSurface.applyPopArtDots(data.accentColor, data.tagText);
      } else if (selectedStylePreset === 'cosmic') {
        paintSurface.applyCosmicNebula(data.accentColor, data.secondaryColor, data.tagText);
      }

      sounds.playWhoosh();
    } catch (e) {
      console.error('Style transform error:', e);
    } finally {
      setAiLoading(false);
    }
  };

  // AI Graffiti Generation
  const handleGenerateAiTag = async () => {
    setAiLoading(true);
    sounds.playClick(1.4);
    try {
      const res = await fetch('/api/ai/graffiti-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, style: 'wildstyle' }),
      });
      const data = await res.json();
      setAiResult(data);
    } catch (e) {
      console.error('AI tag generation error:', e);
    } finally {
      setAiLoading(false);
    }
  };

  // AI Gallery Critique & Valuation
  const handleGenerateAiCritique = async () => {
    setAiLoading(true);
    sounds.playClick(1.4);
    try {
      const res = await fetch('/api/ai/critique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectType: targetObject, dominantColor: activeColor }),
      });
      const data = await res.json();
      setCritiqueResult(data);
    } catch (e) {
      console.error('AI critique error:', e);
    } finally {
      setAiLoading(false);
    }
  };

  const handleStampAiConcept = () => {
    if (!aiResult) return;
    const symbol = aiResult.stencilSymbol || '⚡';
    const text = aiResult.graffitiText || aiPrompt;
    paintSurface.stampSymbol(symbol, 1024, 1024, activeColor, text);
    sounds.playWhoosh();
    setAiModalOpen(false);
  };

  if (!roomId) {
    return <div className="min-h-screen bg-[#080808] text-white flex items-center justify-center">Invalid Room</div>;
  }

  return (
    <div className="h-screen w-screen bg-[#080808] text-[#D1D1D1] flex flex-col font-sans overflow-hidden select-none relative">
      {/* ========================================================
          TOP NAVIGATION HEADER
          ======================================================== */}
      {!isFullscreen && (
        <nav className="h-16 px-6 md:px-8 flex items-center justify-between border-b border-[#1A1A1A] bg-[#0A0A0A] relative z-20 transition-all">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 bg-gradient-to-tr from-[#FF3D00] to-[#FFD600] rounded-lg shadow-[0_0_12px_rgba(255,61,0,0.3)]"></div>
            <div>
              <span className="text-xl font-bold tracking-tighter text-white">
                AERO•CANVAS <span className="text-[10px] font-mono text-[#555] ml-2 px-1.5 py-0.5 border border-[#222] rounded">3D STUDIO</span>
              </span>
            </div>
          </div>

          {/* 3D Target Object Switcher */}
          <div className="hidden lg:flex items-center space-x-1.5 bg-[#111] p-1 rounded-xl border border-[#222]">
            {TARGET_OBJECTS.map((obj) => (
              <button
                key={obj.id}
                onClick={() => {
                  setTargetObject(obj.id);
                  sounds.playClick(1.2);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                  targetObject === obj.id
                    ? 'bg-[#222] text-white shadow-sm border border-[#333]'
                    : 'text-[#666] hover:text-white'
                }`}
              >
                <span>{obj.icon}</span>
                <span>{obj.label}</span>
              </button>
            ))}
          </div>

          {/* Header Action Tools */}
          <div className="flex items-center space-x-2.5">
            {/* AI Copilot & Style Transformer Button */}
            <button
              onClick={() => {
                setAiModalOpen(true);
                sounds.playClick(1.2);
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-violet-900/40 to-fuchsia-900/40 hover:from-violet-800/50 hover:to-fuchsia-800/50 border border-violet-700/50 rounded-xl text-[10px] font-bold uppercase tracking-wider text-violet-200 transition-all shadow-[0_0_15px_rgba(139,92,246,0.2)]"
            >
              <Wand2 size={13} className="text-fuchsia-400" />
              <span>AI Copilot & Transform</span>
            </button>

            {/* Fullscreen Immersion Button */}
            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#141414] hover:bg-[#222] border border-[#222] text-[#AAA] hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors"
              title="Toggle Fullscreen Immersion Mode (F)"
            >
              <Maximize size={13} />
              <span className="hidden sm:inline">Fullscreen</span>
            </button>

            <button
              onClick={toggleMute}
              className="p-2 bg-[#141414] hover:bg-[#222] rounded-lg border border-[#222] text-[#AAA] transition-colors"
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} className="text-[#FF3D00]" />}
            </button>
          </div>
        </nav>
      )}

      {/* ========================================================
          FULL VIEWPORT 3D CANVAS STAGE (Expanded Proportions)
          ======================================================== */}
      <main className="flex-grow relative w-full h-full bg-[#080808] overflow-hidden">
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#444_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none"></div>

        {/* 3D Scene */}
        <Canvas shadows className="w-full h-full relative z-10 cursor-grab active:cursor-grabbing">
          <Scene
            roomId={roomId}
            targetObject={targetObject}
            setTargetObject={setTargetObject}
            paintSurface={paintSurface}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            activeColor={activeColor}
            setActiveColor={setActiveColor}
            toolSize={toolSize}
            isPainting={isPainting}
            setIsPainting={setIsPainting}
            cursorWorldPos={cursorWorldPos}
            setCursorWorldPos={setCursorWorldPos}
            orbitControlsRef={orbitControlsRef}
            autoRotate={autoRotate}
          />
        </Canvas>

        {/* 3D VIEW ANGLE CONTROLS */}
        <div className="absolute top-4 left-4 flex items-center space-x-1.5 bg-black/80 backdrop-blur-md p-1.5 rounded-2xl border border-[#222] z-30 pointer-events-auto shadow-2xl">
          <span className="text-[9px] font-mono font-bold text-[#666] px-2 flex items-center gap-1">
            <Rotate3d size={12} className="text-[#FF3D00]" />
            <span className="hidden sm:inline">3D VIEW</span>
          </span>
          <button
            onClick={() => setCameraAngle(0, Math.PI / 2)}
            className="px-2.5 py-1 rounded-lg bg-[#18181D] hover:bg-[#252530] text-[9px] font-bold uppercase text-[#DDD] transition-all border border-[#2A2A35]"
            title="Front View"
          >
            Front
          </button>
          <button
            onClick={() => setCameraAngle(0.6, Math.PI / 2.2)}
            className="px-2.5 py-1 rounded-lg bg-[#18181D] hover:bg-[#252530] text-[9px] font-bold uppercase text-[#DDD] transition-all border border-[#2A2A35]"
            title="3/4 Isometric Angle View"
          >
            35° Angle
          </button>
          <button
            onClick={() => setCameraAngle(1.35, Math.PI / 2)}
            className="px-2.5 py-1 rounded-lg bg-[#18181D] hover:bg-[#252530] text-[9px] font-bold uppercase text-[#DDD] transition-all border border-[#2A2A35]"
            title="Side Profile View"
          >
            Profile
          </button>
          <button
            onClick={() => setCameraAngle(0, 0.2)}
            className="px-2.5 py-1 rounded-lg bg-[#18181D] hover:bg-[#252530] text-[9px] font-bold uppercase text-[#DDD] transition-all border border-[#2A2A35]"
            title="Top Overhead View"
          >
            Top
          </button>
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all ${
              autoRotate
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                : 'bg-[#18181D] text-[#888] hover:text-white border border-[#2A2A35]'
            }`}
            title="Toggle 360° Auto Turntable Orbit"
          >
            <RefreshCw size={10} className={autoRotate ? 'animate-spin' : ''} />
            <span>360°</span>
          </button>
        </div>

        {/* Top-Right Floating Controls in Fullscreen */}
        {isFullscreen && (
          <div className="absolute top-4 right-4 flex items-center space-x-2 z-30 pointer-events-auto">
            <div className="flex items-center space-x-1 bg-black/80 backdrop-blur-md p-1 rounded-xl border border-[#222]">
              {TARGET_OBJECTS.map((obj) => (
                <button
                  key={obj.id}
                  onClick={() => {
                    setTargetObject(obj.id);
                    sounds.playClick(1.2);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all ${
                    targetObject === obj.id ? 'bg-[#FF3D00] text-white' : 'text-[#777] hover:text-white'
                  }`}
                  title={obj.label}
                >
                  <span>{obj.icon}</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => setAiModalOpen(true)}
              className="p-2 bg-black/80 backdrop-blur-md border border-violet-500/50 rounded-xl text-violet-300 hover:bg-violet-950/40"
              title="AI Copilot & Transform"
            >
              <Wand2 size={15} />
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-2 bg-black/80 backdrop-blur-md border border-[#333] rounded-xl text-[#AAA] hover:text-white"
              title="Exit Fullscreen (Esc / F)"
            >
              <Minimize size={15} />
            </button>
          </div>
        )}

        {/* Bottom Floating Studio Dock */}
        <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between pointer-events-none z-20">
          {/* Left: Tool Telemetry */}
          <div className="p-3 bg-black/85 backdrop-blur-md rounded-2xl border border-[#222] pointer-events-auto flex items-center gap-3 shadow-2xl">
            <div
              className="w-3.5 h-3.5 rounded-full shadow-[0_0_10px]"
              style={{
                backgroundColor: activeColor,
                boxShadow: `0 0 10px ${activeColor}`,
              }}
            />
            <div>
              <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-white">
                {activeTool === 'spray' ? 'Spray Can Active' : 'Fine Brush Active'} • {targetObject.toUpperCase()}
              </p>
              <p className="text-[9px] font-mono text-[#666]">
                FULL-SCALE 3D VIEWPORT • ROTATE SCENE & PAINT IN REAL-TIME
              </p>
            </div>

            {/* Quick Color Swatches */}
            <div className="hidden sm:flex items-center space-x-1 pl-2 border-l border-[#222]">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => {
                    setActiveColor(c.hex);
                    sounds.playClick(1.4);
                  }}
                  className={`w-4 h-4 rounded-full transition-transform ${
                    activeColor === c.hex
                      ? 'scale-125 ring-2 ring-white ring-offset-1 ring-offset-black'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          {/* Right: Studio Action Buttons */}
          <div className="flex items-center space-x-2 pointer-events-auto">
            <button
              onClick={() => sounds.playCanRattle()}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#111]/85 backdrop-blur border border-[#222] text-[#AAA] hover:text-[#FF3D00] hover:border-[#FF3D00]/50 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
              title="Rattle authentic metal spray can ball bearing"
            >
              <Sparkles size={14} />
              <span>Shake Can</span>
            </button>

            <button
              onClick={handleClearCanvas}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#111]/85 backdrop-blur border border-[#222] text-[#AAA] hover:text-red-400 hover:border-red-500/50 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
              title="Clear entire canvas"
            >
              <Trash2 size={14} />
              <span>Clear</span>
            </button>

            <button
              onClick={handleDownloadSnapshot}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#FF3D00] hover:bg-orange-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-orange-950/40 transition-all active:scale-95"
              title="Export high-res PNG artwork"
            >
              <Download size={14} />
              <span>Save PNG</span>
            </button>
          </div>
        </div>
      </main>

      {/* ========================================================
          AI STREET ART COPILOT & STYLE TRANSFORMATION STUDIO
          ======================================================== */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="w-full max-w-xl bg-[#0E0E12] border border-[#262630] rounded-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setAiModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-[#777] hover:text-white"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600 to-fuchsia-500 flex items-center justify-center text-white">
                <Wand2 size={18} />
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">AI Art Studio & Stylizer</h2>
                <p className="text-[10px] text-[#888] font-mono">GEMINI MULTI-STYLE ART ENGINE</p>
              </div>
            </div>

            {/* AI Modal Navigation Tabs */}
            <div className="flex bg-[#14141C] p-1 rounded-xl border border-[#262633] mb-5">
              <button
                onClick={() => setAiTab('transform')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                  aiTab === 'transform'
                    ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow'
                    : 'text-[#777] hover:text-white'
                }`}
              >
                <Palette size={12} />
                <span>Transform Style</span>
              </button>
              <button
                onClick={() => setAiTab('generate')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                  aiTab === 'generate'
                    ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow'
                    : 'text-[#777] hover:text-white'
                }`}
              >
                <Sparkle size={12} />
                <span>Concept Generator</span>
              </button>
              <button
                onClick={() => setAiTab('critique')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                  aiTab === 'critique'
                    ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow'
                    : 'text-[#777] hover:text-white'
                }`}
              >
                <Eye size={12} />
                <span>Valuation & Appraisal</span>
              </button>
            </div>

            {/* ========================================================
                TAB 1: TRANSFORM & STYLIZE ACTIVE ARTWORK
                ======================================================== */}
            {aiTab === 'transform' && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#AAA] mb-2 block">
                  Select Style Transformation Preset
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                  {STYLE_TRANSFORM_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setSelectedStylePreset(preset.id)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        selectedStylePreset === preset.id
                          ? 'bg-[#1C1A28] border-fuchsia-500/60 shadow-[0_0_15px_rgba(217,70,239,0.2)]'
                          : 'bg-[#121218] border-[#222] hover:border-[#333]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span>{preset.icon}</span>
                          <span>{preset.name}</span>
                        </span>
                        {selectedStylePreset === preset.id && (
                          <Check size={12} className="text-fuchsia-400" />
                        )}
                      </div>
                      <p className="text-[9px] text-[#888] leading-tight">{preset.desc}</p>
                    </button>
                  ))}
                </div>

                <div className="mb-4">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#AAA] mb-1.5 block">
                    Custom Theme Words / Tag Calligraphy (Optional)
                  </label>
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. CYBER CITY, TOKYO, OVERDRIVE..."
                    className="w-full px-3 py-2 bg-[#16161D] border border-[#2C2C38] rounded-xl text-xs text-white placeholder-[#555] focus:outline-none focus:border-violet-500"
                  />
                </div>

                <button
                  onClick={handleTransformArtwork}
                  disabled={aiLoading}
                  className="w-full py-3 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-orange-500 hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 shadow-xl shadow-fuchsia-950/40 mb-4"
                >
                  <Wand2 size={15} />
                  <span>{aiLoading ? 'AI Stylizing Artwork...' : `Apply ${selectedStylePreset.toUpperCase()} Style To 3D Canvas`}</span>
                </button>

                {transformResult && (
                  <div className="bg-[#14141C] border border-fuchsia-900/40 rounded-xl p-3.5 mb-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-fuchsia-400">
                        {transformResult.transformedTitle}
                      </span>
                      <span className="text-[9px] font-mono text-[#888]">{transformResult.tagLine}</span>
                    </div>
                    <p className="text-[10px] text-[#AAA] italic mt-1 leading-relaxed">
                      "{transformResult.curatorNotes}"
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={handleDownloadSnapshot}
                        className="flex-1 py-2 bg-[#FF3D00] hover:bg-orange-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow"
                      >
                        <Download size={13} />
                        <span>Save Stylized Artwork PNG</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ========================================================
                TAB 2: STREET CONCEPT GENERATOR
                ======================================================== */}
            {aiTab === 'generate' && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#AAA] mb-1.5 block">
                  Street Concept / Tag Inspiration
                </label>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. TOKYO CYBER, WILD STYLE, PHANTOM..."
                    className="flex-1 px-3 py-2 bg-[#16161D] border border-[#2C2C38] rounded-xl text-xs text-white placeholder-[#555] focus:outline-none focus:border-violet-500"
                  />
                  <button
                    onClick={handleGenerateAiTag}
                    disabled={aiLoading}
                    className="px-4 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-lg"
                  >
                    <Sparkles size={13} />
                    <span>{aiLoading ? 'Thinking...' : 'Generate'}</span>
                  </button>
                </div>

                {aiResult && (
                  <div className="bg-[#14141C] border border-[#262633] rounded-xl p-4 mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">
                        {aiResult.title}
                      </span>
                      <span className="text-[9px] font-mono text-[#888]">{aiResult.tagLine}</span>
                    </div>

                    <div className="flex items-center gap-4 my-3">
                      <div className="w-16 h-16 rounded-xl bg-black/60 border border-violet-500/40 flex items-center justify-center text-3xl shadow-[0_0_20px_rgba(139,92,246,0.3)]">
                        {aiResult.stencilSymbol}
                      </div>
                      <div>
                        <h3 className="text-lg font-black tracking-tighter text-white uppercase">
                          {aiResult.graffitiText}
                        </h3>
                        <p className="text-[10px] text-[#999] italic mt-0.5">{aiResult.styleNotes}</p>
                      </div>
                    </div>

                    <button
                      onClick={handleStampAiConcept}
                      className="w-full py-2.5 bg-[#FF3D00] hover:bg-orange-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-md flex items-center justify-center gap-1.5"
                    >
                      <Zap size={13} />
                      <span>Stamp Stencil On {targetObject.toUpperCase()}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ========================================================
                TAB 3: GALLERY VALUATION & CURATION
                ======================================================== */}
            {aiTab === 'critique' && (
              <div>
                <p className="text-[11px] text-[#AAA] mb-4">
                  Request an official high-end art curator appraisal and auction house valuation based on your active 3D {targetObject} artwork and aerosol stroke velocity.
                </p>
                <button
                  onClick={handleGenerateAiCritique}
                  disabled={aiLoading}
                  className="w-full py-3 bg-gradient-to-r from-violet-700 to-fuchsia-700 hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg mb-4"
                >
                  <Eye size={15} />
                  <span>{aiLoading ? 'Curating Gallery Appraisal...' : 'Evaluate & Appraise Artwork'}</span>
                </button>

                {critiqueResult && (
                  <div className="bg-[#121218] border border-fuchsia-900/40 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-fuchsia-400">
                        {critiqueResult.exhibitionTitle}
                      </span>
                      <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/50">
                        {critiqueResult.estimatedValue}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#AAA] leading-relaxed mt-2.5">
                      "{critiqueResult.curatorCritique}"
                    </p>
                    <div className="flex gap-1.5 mt-3 flex-wrap">
                      {critiqueResult.vibeTags?.map((tag: string, i: number) => (
                        <span key={i} className="text-[8px] font-mono bg-[#1E1E28] text-[#888] px-2 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
