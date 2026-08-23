import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, ContactShadows } from '@react-three/drei';
import { QRCodeSVG } from 'qrcode.react';
import * as THREE from 'three';
import { DecorateObjects3D, OBJECT_SURFACE_DIMS } from './DecorateObjects3D';
import { Tools3D } from './Tools3D';
import { sounds } from '../utils/audio';
import { parseUploaded3DModel, Parsed3DModelResult } from '../utils/model3dLoader';
import {
  TargetObjectType,
  ProjectionDrawData,
  PlayerState,
  Uploaded3DModelInfo,
} from '../types';
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
  Palette,
  Eye,
  Check,
  Upload,
  Users,
  QrCode,
  Box,
  Layers,
  Info,
  Copy,
  ExternalLink,
  MousePointer,
  Hand,
  SprayCan,
  PenTool,
} from 'lucide-react';
import { RadialColorPicker } from './RadialColorPicker';

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
    this.ctx.fillStyle = '#f6f3eb';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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

  applyCyberpunkStyle(accentColor = '#06B6D4', secondaryColor = '#EC4899', tagText = 'CYBERPUNK') {
    this.ctx.save();
    const gradient = this.ctx.createRadialGradient(1024, 1024, 400, 1024, 1024, 1400);
    gradient.addColorStop(0, 'rgba(10, 10, 20, 0)');
    gradient.addColorStop(1, 'rgba(2, 6, 23, 0.65)');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, 2048, 2048);

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
    this.ctx.fillStyle = 'rgba(24, 24, 27, 0.45)';
    this.ctx.fillRect(0, 0, 2048, 2048);

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
    this.ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
    const spacing = 32;
    for (let x = 0; x < 2048; x += spacing) {
      for (let y = 0; y < 2048; y += spacing) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, 4, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

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
    const nebGrad = this.ctx.createRadialGradient(1024, 1024, 100, 1024, 1024, 1200);
    nebGrad.addColorStop(0, 'rgba(139, 92, 246, 0.25)');
    nebGrad.addColorStop(0.6, 'rgba(6, 182, 212, 0.15)');
    nebGrad.addColorStop(1, 'rgba(10, 5, 25, 0.55)');
    this.ctx.fillStyle = nebGrad;
    this.ctx.fillRect(0, 0, 2048, 2048);

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
const MAX_PARTICLES_PER_PLAYER = 600;

function MultiPlayerSprayParticles({
  players,
}: {
  players: PlayerState[];
}) {
  const activeSprayingPlayers = players.filter((p) => p.isPainting && p.tool === 'spray');
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  const totalParticles = 4 * MAX_PARTICLES_PER_PLAYER;
  const particleData = useRef(
    Array.from({ length: totalParticles }, () => ({
      life: 0,
      playerIndex: 0,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      scale: 1,
    }))
  );

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    activeSprayingPlayers.forEach((player, pIdx) => {
      const startIdx = pIdx * MAX_PARTICLES_PER_PLAYER;
      const spawnCount = 24;
      let spawned = 0;

      const surfPt = player.surfacePoint
        ? new THREE.Vector3(player.surfacePoint[0], player.surfacePoint[1], player.surfacePoint[2])
        : new THREE.Vector3(0, 0, 0);

      const toolPos = new THREE.Vector3(player.worldPos[0], player.worldPos[1], player.worldPos[2]);
      const dir = surfPt.clone().sub(toolPos).normalize();
      if (dir.lengthSq() < 0.001) dir.set(0, 0, -1);

      // Create orthogonal basis for cone spread
      const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
      if (right.lengthSq() < 0.001) right.set(1, 0, 0);
      const up = dir.clone().cross(right).normalize();

      for (let i = startIdx; i < startIdx + MAX_PARTICLES_PER_PLAYER; i++) {
        if (spawned >= spawnCount) break;
        if (particleData.current[i].life <= 0) {
          particleData.current[i].life = 0.5 + Math.random() * 0.35;
          particleData.current[i].playerIndex = pIdx;

          particleData.current[i].position.set(
            toolPos.x + dir.x * 0.06 + (Math.random() - 0.5) * 0.06,
            toolPos.y + dir.y * 0.06 + (Math.random() - 0.5) * 0.06,
            toolPos.z + dir.z * 0.06 + (Math.random() - 0.5) * 0.06
          );

          const angle = Math.random() * Math.PI * 2;
          const spreadRadius = Math.random() * 1.1;
          const spreadVec = right
            .clone()
            .multiplyScalar(Math.cos(angle) * spreadRadius)
            .add(up.clone().multiplyScalar(Math.sin(angle) * spreadRadius));

          const speed = 4.6;
          particleData.current[i].velocity.copy(dir).multiplyScalar(speed).add(spreadVec);
          particleData.current[i].scale = Math.random() * 0.14 + 0.06;
          spawned++;
        }
      }
    });

    for (let i = 0; i < totalParticles; i++) {
      const p = particleData.current[i];
      if (p.life > 0) {
        p.life -= delta * 2.2;
        p.position.addScaledVector(p.velocity, delta);

        const activePlayer = activeSprayingPlayers[p.playerIndex];
        const color = activePlayer?.color || '#FF3D00';
        colorObj.set(color);

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
    <instancedMesh ref={meshRef} args={[undefined, undefined, totalParticles]}>
      <circleGeometry args={[1, 8]} />
      <meshBasicMaterial transparent opacity={0.55} depthWrite={false} color="#ffffff" />
    </instancedMesh>
  );
}

// 3D Scene Controller
interface SceneProps {
  roomId: string;
  targetObject: TargetObjectType;
  setTargetObject: (obj: TargetObjectType) => void;
  paintSurface: PaintSurface;
  players: PlayerState[];
  setPlayers: React.Dispatch<React.SetStateAction<PlayerState[]>>;
  orbitControlsRef: React.RefObject<any>;
  autoRotate: boolean;
  custom3DGroup: THREE.Group | null;
  desktopPointerActive: boolean;
  hostTool: 'spray' | 'brush';
  hostColor: string;
}

function Scene({
  roomId,
  targetObject,
  setTargetObject,
  paintSurface,
  players,
  setPlayers,
  orbitControlsRef,
  autoRotate,
  custom3DGroup,
  desktopPointerActive,
  hostTool,
  hostColor,
}: SceneProps) {
  const currentDims = OBJECT_SURFACE_DIMS[targetObject] || { width: 15.2, height: 11.2, zOffset: 0.05 };
  const { camera, raycaster } = useThree();
  const objectGroupRef = useRef<THREE.Group>(null);

  const originsRef = useRef<Map<string, { alpha: number | null; beta: number | null }>>(new Map());
  const lastPlayerPxRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const lastProjPxRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Desktop Pointer Direct Spray / Paint Logic
  const isDesktopPainting = useRef<boolean>(false);
  const lastDesktopPxRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = (e: any) => {
    if (!desktopPointerActive || e.button !== 0) return;
    isDesktopPainting.current = true;
    const meshes: THREE.Object3D[] = [];
    if (objectGroupRef.current) {
      objectGroupRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child);
      });
    }
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      let hitNormal = new THREE.Vector3(0, 0, 1);
      if (hit.face) {
        hitNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      if (hit.uv) {
        const uvPx = hit.uv.x * CANVAS_PIXEL_RES;
        const uvPy = (1 - hit.uv.y) * CANVAS_PIXEL_RES;
        lastDesktopPxRef.current = { x: uvPx, y: uvPy };
        if (hostTool === 'spray') {
          sounds.startSpray(1.0);
          paintSurface.spray(uvPx, uvPy, hostColor, 1.0);
        } else {
          sounds.startBrush();
          paintSurface.brush(uvPx, uvPy, uvPx + 0.1, uvPy + 0.1, hostColor, 1.0);
        }
      }
      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === 'p1_local' || p.slot === 1) {
            const hoverDist = hostTool === 'spray' ? 0.45 : 0.2;
            const toolPos = hit.point.clone().addScaledVector(hitNormal, hoverDist);
            return {
              ...p,
              isPainting: true,
              tool: hostTool,
              color: hostColor,
              worldPos: [toolPos.x, toolPos.y, toolPos.z],
              surfacePoint: [hit.point.x, hit.point.y, hit.point.z],
              surfaceNormal: [hitNormal.x, hitNormal.y, hitNormal.z],
            };
          }
          return p;
        })
      );
    }
  };

  const handlePointerMove = (e: any) => {
    if (!desktopPointerActive) return;
    const meshes: THREE.Object3D[] = [];
    if (objectGroupRef.current) {
      objectGroupRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child);
      });
    }
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      let hitNormal = new THREE.Vector3(0, 0, 1);
      if (hit.face) {
        hitNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      if (isDesktopPainting.current && hit.uv) {
        const uvPx = hit.uv.x * CANVAS_PIXEL_RES;
        const uvPy = (1 - hit.uv.y) * CANVAS_PIXEL_RES;
        if (hostTool === 'spray') {
          paintSurface.spray(uvPx, uvPy, hostColor, 1.0);
        } else {
          const prev = lastDesktopPxRef.current || { x: uvPx, y: uvPy };
          paintSurface.brush(prev.x, prev.y, uvPx, uvPy, hostColor, 1.0);
        }
        lastDesktopPxRef.current = { x: uvPx, y: uvPy };
      }
      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === 'p1_local' || p.slot === 1) {
            const hoverDist = isDesktopPainting.current
              ? hostTool === 'spray'
                ? 0.45
                : 0.2
              : 0.8;
            const toolPos = hit.point.clone().addScaledVector(hitNormal, hoverDist);
            return {
              ...p,
              isPainting: isDesktopPainting.current,
              tool: hostTool,
              color: hostColor,
              worldPos: [toolPos.x, toolPos.y, toolPos.z],
              surfacePoint: [hit.point.x, hit.point.y, hit.point.z],
              surfaceNormal: [hitNormal.x, hitNormal.y, hitNormal.z],
            };
          }
          return p;
        })
      );
    }
  };

  const handlePointerUp = (e: any) => {
    if (!desktopPointerActive) return;
    if (isDesktopPainting.current) {
      isDesktopPainting.current = false;
      lastDesktopPxRef.current = null;
      sounds.stopSpray();
      sounds.stopBrush();
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === 'p1_local' || p.slot === 1 ? { ...p, isPainting: false } : p
        )
      );
    }
  };

  // WebSockets Multiplayer Synchronization
  useEffect(() => {
    const socket = io();

    socket.on('connect', () => {
      socket.emit('join-room', { roomId, role: 'canvas' });
    });

    // Receive updated player list
    socket.on('player-list-update', (playerList: any[]) => {
      setPlayers((prev) => {
        const next = playerList.map((p, idx) => {
          const existing = prev.find((x) => x.id === p.id);
          return (
            existing || {
              id: p.id,
              slot: p.slot || idx + 1,
              name: p.name || `Tagger ${idx + 1}`,
              color: p.color || '#FF3D00',
              tool: p.tool || 'spray',
              isPainting: false,
              cursorPx: { x: 1024, y: 1024 },
              worldPos: [0, 0, currentDims.zOffset] as [number, number, number],
              surfacePoint: [0, 0, 0] as [number, number, number],
              surfaceNormal: [0, 0, 1] as [number, number, number],
              pressure: 1.0,
              lastActive: Date.now(),
              mode: p.mode || 'motion',
            }
          );
        });
        return next;
      });
    });

    // 1. Gyro Motion Data per Player
    socket.on('motion', (data) => {
      const { playerId, alpha, beta } = data;
      if (!playerId || alpha === null || beta === null) return;

      if (!originsRef.current.has(playerId)) {
        originsRef.current.set(playerId, { alpha, beta });
      }

      const orig = originsRef.current.get(playerId)!;
      if (orig.alpha === null || orig.beta === null) {
        orig.alpha = alpha;
        orig.beta = beta;
      }

      let dAlpha = alpha - orig.alpha;
      let dBeta = beta - orig.beta;

      if (dAlpha > 180) dAlpha -= 360;
      if (dAlpha < -180) dAlpha += 360;

      const SENSITIVITY = 36;
      let rawPx = 1024 - dAlpha * SENSITIVITY;
      let rawPy = 1024 - dBeta * SENSITIVITY;

      // Soft clamp
      const PADDING = 40;
      if (rawPx < PADDING) {
        orig.alpha += 0.35;
        rawPx = PADDING;
      } else if (rawPx > CANVAS_PIXEL_RES - PADDING) {
        orig.alpha -= 0.35;
        rawPx = CANVAS_PIXEL_RES - PADDING;
      }

      if (rawPy < PADDING) {
        orig.beta += 0.35;
        rawPy = PADDING;
      } else if (rawPy > CANVAS_PIXEL_RES - PADDING) {
        orig.beta -= 0.35;
        rawPy = CANVAS_PIXEL_RES - PADDING;
      }

      const px = Math.max(0, Math.min(CANVAS_PIXEL_RES, rawPx));
      const py = Math.max(0, Math.min(CANVAS_PIXEL_RES, rawPy));

      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === playerId) {
            return {
              ...p,
              cursorPx: { x: px, y: py },
              lastActive: Date.now(),
            };
          }
          return p;
        })
      );
    });

    // 2. Action (Spray / Brush hold from Motion mode)
    socket.on('action', (data) => {
      const { playerId, action, state, color } = data;
      if (!playerId) return;

      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === playerId) {
            const isPainting = state === 'start';
            if (isPainting) {
              lastPlayerPxRef.current.set(playerId, { ...p.cursorPx });
              if (action === 'spray') sounds.startSpray(data.pressure || 1.0);
              else sounds.startBrush();
            } else {
              sounds.stopSpray();
              sounds.stopBrush();
            }

            return {
              ...p,
              tool: action || p.tool,
              color: color || p.color,
              isPainting,
              lastActive: Date.now(),
            };
          }
          return p;
        })
      );
    });

    // 3. Direct Mobile Projection Drawing per Player
    socket.on('projection-draw', (data: ProjectionDrawData) => {
      const { playerId, x, y, type, tool, color, size } = data;
      const pId = playerId || 'default';
      const px = x * CANVAS_PIXEL_RES;
      const py = y * CANVAS_PIXEL_RES;

      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === pId) {
            return {
              ...p,
              cursorPx: { x: px, y: py },
              tool: tool || p.tool,
              color: color || p.color,
              isPainting: type !== 'end',
              lastActive: Date.now(),
            };
          }
          return p;
        })
      );

      if (type === 'start') {
        lastProjPxRef.current.set(pId, { x: px, y: py });
        if (tool === 'spray') {
          sounds.startSpray(1.0);
          paintSurface.spray(px, py, color, size || 1.0);
        } else {
          sounds.startBrush();
          paintSurface.brush(px, py, px + 0.1, py + 0.1, color, size || 1.0);
        }
      } else if (type === 'move') {
        if (tool === 'spray') {
          paintSurface.spray(px, py, color, size || 1.0);
        } else {
          const prev = lastProjPxRef.current.get(pId) || { x: px, y: py };
          paintSurface.brush(prev.x, prev.y, px, py, color, size || 1.0);
        }
        lastProjPxRef.current.set(pId, { x: px, y: py });
      } else if (type === 'end') {
        lastProjPxRef.current.delete(pId);
        sounds.stopSpray();
        sounds.stopBrush();
      }
    });

    // 4. Object Change
    socket.on('change-object', (data) => {
      if (data.objectType) {
        setTargetObject(data.objectType);
        originsRef.current.clear();
        sounds.playClick(1.5);
      }
    });

    // 5. Settings, clear, calibrate
    socket.on('settings', (data) => {
      const { playerId, color, tool } = data;
      if (playerId) {
        setPlayers((prev) =>
          prev.map((p) =>
            p.id === playerId ? { ...p, color: color || p.color, tool: tool || p.tool } : p
          )
        );
      }
    });

    socket.on('clear-canvas', () => {
      paintSurface.clear();
      sounds.playWhoosh();
    });

    socket.on('shake', () => {
      sounds.playCanRattle();
    });

    socket.on('calibrate', (data) => {
      if (data.playerId) {
        originsRef.current.delete(data.playerId);
      } else {
        originsRef.current.clear();
      }
      sounds.playClick(1.5);
    });

    socket.on('ai-stamp', (data) => {
      if (data.stencilSymbol) {
        paintSurface.stampSymbol(data.stencilSymbol, 1024, 1024, data.color || '#FF3D00', data.text);
        sounds.playWhoosh();
      }
    });

    return () => {
      socket.disconnect();
      sounds.stopSpray();
      sounds.stopBrush();
    };
  }, [roomId, currentDims, paintSurface, setPlayers, setTargetObject]);

  // Frame loop: High-precision camera raycasting, 3D tool positioning & surface UV painting
  useFrame(() => {
    const meshes: THREE.Object3D[] = [];
    if (objectGroupRef.current) {
      objectGroupRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          meshes.push(child);
        }
      });
    }

    const ndc = new THREE.Vector2();
    const toCam = new THREE.Vector3();
    const planeHit = new THREE.Vector3();

    players.forEach((p) => {
      ndc.x = (p.cursorPx.x / CANVAS_PIXEL_RES - 0.5) * 2;
      ndc.y = -(p.cursorPx.y / CANVAS_PIXEL_RES - 0.5) * 2;

      raycaster.setFromCamera(ndc, camera);

      const intersects = meshes.length > 0 ? raycaster.intersectObjects(meshes, true) : [];

      if (intersects.length > 0) {
        const hit = intersects[0];
        const hitPoint = hit.point;
        let hitNormal = new THREE.Vector3(0, 0, 1);
        if (hit.face) {
          hitNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        }
        toCam.subVectors(camera.position, hitPoint).normalize();
        if (hitNormal.dot(toCam) < 0) hitNormal.negate();

        const hoverDist = p.isPainting ? (p.tool === 'spray' ? 0.45 : 0.2) : 0.8;
        const toolPos = hitPoint.clone().addScaledVector(hitNormal, hoverDist);

        p.worldPos = [toolPos.x, toolPos.y, toolPos.z];
        p.surfacePoint = [hitPoint.x, hitPoint.y, hitPoint.z];
        p.surfaceNormal = [hitNormal.x, hitNormal.y, hitNormal.z];

        if (p.isPainting && p.mode === 'motion') {
          if (hit.uv) {
            const uvPx = hit.uv.x * CANVAS_PIXEL_RES;
            const uvPy = (1 - hit.uv.y) * CANVAS_PIXEL_RES;
            if (p.tool === 'spray') {
              paintSurface.spray(uvPx, uvPy, p.color, 1.0);
            } else if (p.tool === 'brush') {
              const last = lastPlayerPxRef.current.get(p.id) || { x: uvPx, y: uvPy };
              paintSurface.brush(last.x, last.y, uvPx, uvPy, p.color, 1.0);
              lastPlayerPxRef.current.set(p.id, { x: uvPx, y: uvPy });
            }
          } else {
            if (p.tool === 'spray') {
              paintSurface.spray(p.cursorPx.x, p.cursorPx.y, p.color, 1.0);
            } else if (p.tool === 'brush') {
              const last = lastPlayerPxRef.current.get(p.id) || p.cursorPx;
              paintSurface.brush(last.x, last.y, p.cursorPx.x, p.cursorPx.y, p.color, 1.0);
              lastPlayerPxRef.current.set(p.id, { ...p.cursorPx });
            }
          }
        }
      } else {
        // Off-mesh raycast: keep tool in front of the model facing the center
        const camDir = camera.position.clone().normalize();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(0, 0, 0));
        raycaster.ray.intersectPlane(plane, planeHit);
        const toolPos = planeHit.clone().addScaledVector(camDir, 0.85);

        p.worldPos = [toolPos.x, toolPos.y, toolPos.z];
        p.surfacePoint = [planeHit.x, planeHit.y, planeHit.z];
        p.surfaceNormal = [camDir.x, camDir.y, camDir.z];

        if (p.isPainting && p.mode === 'motion') {
          const last = lastPlayerPxRef.current.get(p.id) || p.cursorPx;
          if (p.tool === 'spray') {
            paintSurface.spray(p.cursorPx.x, p.cursorPx.y, p.color, 1.0);
          } else if (p.tool === 'brush') {
            paintSurface.brush(last.x, last.y, p.cursorPx.x, p.cursorPx.y, p.color, 1.0);
            lastPlayerPxRef.current.set(p.id, { ...p.cursorPx });
          }
        }
      }
    });
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 7.6]} fov={55} />

      <OrbitControls
        ref={orbitControlsRef}
        enableDamping
        dampingFactor={0.06}
        minDistance={3.5}
        maxDistance={25}
        autoRotate={autoRotate}
        autoRotateSpeed={1.5}
        maxPolarAngle={Math.PI / 2 + 0.15}
        mouseButtons={
          desktopPointerActive
            ? { LEFT: undefined, RIGHT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY }
            : { LEFT: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY }
        }
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

      {/* 3D Target Object or Custom Uploaded 3D Model with Ref for Precision Raycasting & Desktop Painting */}
      <group
        ref={objectGroupRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <DecorateObjects3D
          objectType={targetObject}
          canvasTexture={paintSurface.texture}
          custom3DGroup={custom3DGroup}
        />
      </group>

      {/* Multiple Floating 3D Tools (One for each connected Player) */}
      {players.map((player) => (
        <Tools3D
          key={player.id}
          targetPosition={player.worldPos}
          surfacePoint={player.surfacePoint}
          surfaceNormal={player.surfaceNormal}
          activeTool={player.tool}
          isTriggerActive={player.isPainting}
          color={player.color}
          playerName={player.name}
          playerSlot={player.slot}
        />
      ))}

      {/* Multiplayer Aerosol Mist Particle System */}
      <MultiPlayerSprayParticles players={players} />

      {/* Floor Shadows */}
      <ContactShadows position={[0, -6.0, 0]} opacity={0.75} scale={35} blur={2.4} far={15} />
    </>
  );
}

const TARGET_OBJECTS: { id: TargetObjectType; label: string; icon: string; category: string }[] = [
  { id: 'easel', label: 'Studio Easel', icon: '🎨', category: 'Standard' },
  { id: 'skateboard', label: 'Skate Deck', icon: '🛹', category: 'Standard' },
  { id: 'subway', label: 'Subway Train', icon: '🚇', category: 'Standard' },
  { id: 'boombox', label: 'Boombox 80s', icon: '📻', category: 'Standard' },
  { id: 'wall', label: 'Brick Alley', icon: '🧱', category: 'Standard' },
  { id: 'helmet', label: 'Cyber Helmet', icon: '🪖', category: '3D Objects' },
  { id: 'sneaker', label: 'Street Sneaker', icon: '👟', category: '3D Objects' },
  { id: 'vinyltoy', label: 'Vinyl Bear Toy', icon: '🧸', category: '3D Objects' },
  { id: 'sculpture', label: 'Roman Bust', icon: '🗿', category: '3D Objects' },
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
  const [targetObject, setTargetObject] = useState<TargetObjectType>('easel');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);

  // Multiplayer State (Up to 4+ players)
  const [players, setPlayers] = useState<PlayerState[]>([
    {
      id: 'p1_local',
      slot: 1,
      name: 'Host Tagger',
      color: '#FF3D00',
      tool: 'spray',
      isPainting: false,
      cursorPx: { x: 1024, y: 1024 },
      worldPos: [0, 0, 0.05],
      pressure: 1.0,
      lastActive: Date.now(),
      mode: 'motion',
    },
  ]);

  // Uploaded 3D Model State
  const [custom3DGroup, setCustom3DGroup] = useState<THREE.Group | null>(null);
  const [uploadedModelInfo, setUploadedModelInfo] = useState<Uploaded3DModelInfo | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);
  const [isUploadingModel, setIsUploadingModel] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Desktop Pointer / Mouse Spray Mode
  const [desktopPointerActive, setDesktopPointerActive] = useState<boolean>(true);
  const [hostTool, setHostTool] = useState<'spray' | 'brush'>('spray');
  const [hostColor, setHostColor] = useState<string>('#FF3D00');

  const handleHostColorChange = (hex: string) => {
    setHostColor(hex);
    setPlayers((prev) =>
      prev.map((p) => (p.id === 'p1_local' || p.slot === 1 ? { ...p, color: hex } : p))
    );
  };

  // Invite / QR Modal State
  const [inviteModalOpen, setInviteModalOpen] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

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

  const controllerUrl = `${window.location.origin}/controller/${roomId}`;

  const setCameraAngle = (azimuth: number, polar: number) => {
    if (!orbitControlsRef.current) return;
    sounds.playClick(1.2);
    orbitControlsRef.current.setAzimuthalAngle(azimuth);
    orbitControlsRef.current.setPolarAngle(polar);
    orbitControlsRef.current.minDistance = 3.5;
    orbitControlsRef.current.maxDistance = 25;
    orbitControlsRef.current.update();
  };

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

  // 3D Model File Upload Handler
  const handleFileUpload = async (file: File) => {
    setIsUploadingModel(true);
    setUploadError(null);
    sounds.playClick(1.4);

    try {
      const result: Parsed3DModelResult = await parseUploaded3DModel(file, paintSurface.texture);
      setCustom3DGroup(result.group);
      setUploadedModelInfo(result.info);
      setTargetObject('custom3d');
      sounds.playWhoosh();
      setUploadModalOpen(false);
    } catch (err: any) {
      console.error('3D model load error:', err);
      setUploadError(err?.message || 'Failed to parse 3D model. Please try another GLB/GLTF/OBJ/STL file.');
    } finally {
      setIsUploadingModel(false);
    }
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

  const handleGenerateAiCritique = async () => {
    setAiLoading(true);
    sounds.playClick(1.4);
    try {
      const res = await fetch('/api/ai/critique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectType: targetObject, dominantColor: '#FF3D00' }),
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
    paintSurface.stampSymbol(symbol, 1024, 1024, '#FF3D00', text);
    sounds.playWhoosh();
    setAiModalOpen(false);
  };

  const copyControllerLink = () => {
    navigator.clipboard.writeText(controllerUrl);
    setCopiedLink(true);
    sounds.playClick(1.5);
    setTimeout(() => setCopiedLink(false), 2000);
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
        <nav className="h-16 px-4 md:px-8 flex items-center justify-between border-b border-[#1A1A1A] bg-[#0A0A0A] relative z-20 transition-all">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-tr from-[#FF3D00] to-[#FFD600] rounded-lg shadow-[0_0_12px_rgba(255,61,0,0.3)]"></div>
            <div>
              <span className="text-lg font-bold tracking-tighter text-white">
                AERO•CANVAS <span className="text-[10px] font-mono text-[#555] ml-1.5 px-1.5 py-0.5 border border-[#222] rounded">3D MULTIPLAYER</span>
              </span>
            </div>
          </div>

          {/* 3D Object Switcher */}
          <div className="hidden xl:flex items-center space-x-1 bg-[#111] p-1 rounded-xl border border-[#222]">
            {TARGET_OBJECTS.map((obj) => (
              <button
                key={obj.id}
                onClick={() => {
                  setTargetObject(obj.id);
                  sounds.playClick(1.2);
                }}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                  targetObject === obj.id
                    ? 'bg-[#222] text-white shadow-sm border border-[#333]'
                    : 'text-[#666] hover:text-white'
                }`}
              >
                <span>{obj.icon}</span>
                <span>{obj.label}</span>
              </button>
            ))}

            {/* Custom 3D Model Option */}
            {uploadedModelInfo && (
              <button
                onClick={() => {
                  setTargetObject('custom3d');
                  sounds.playClick(1.2);
                }}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                  targetObject === 'custom3d'
                    ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/50'
                    : 'text-[#666] hover:text-white'
                }`}
              >
                <Box size={12} className="text-emerald-400" />
                <span>{uploadedModelInfo.name.slice(0, 10)}</span>
              </button>
            )}
          </div>

          {/* Header Action Tools */}
          <div className="flex items-center space-x-2">
            {/* Upload Custom 3D Model Button */}
            <button
              onClick={() => {
                setUploadModalOpen(true);
                sounds.playClick(1.2);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#141414] hover:bg-[#222] border border-[#2A2A35] text-emerald-400 hover:text-emerald-300 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              <Upload size={13} />
              <span className="hidden sm:inline">Upload 3D Model</span>
            </button>

            {/* Multiplayer Connect / QR Code Button */}
            <button
              onClick={() => {
                setInviteModalOpen(true);
                sounds.playClick(1.2);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-cyan-900/40 to-blue-900/40 hover:from-cyan-800/50 hover:to-blue-800/50 border border-cyan-700/50 rounded-xl text-[10px] font-bold uppercase tracking-wider text-cyan-200 transition-all shadow-[0_0_12px_rgba(6,182,212,0.2)]"
            >
              <Users size={13} className="text-cyan-400" />
              <span>
                Invite Players ({players.length}/4)
              </span>
            </button>

            {/* AI Copilot & Style Transformer Button */}
            <button
              onClick={() => {
                setAiModalOpen(true);
                sounds.playClick(1.2);
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-violet-900/40 to-fuchsia-900/40 hover:from-violet-800/50 hover:to-fuchsia-800/50 border border-violet-700/50 rounded-xl text-[10px] font-bold uppercase tracking-wider text-violet-200 transition-all shadow-[0_0_15px_rgba(139,92,246,0.2)]"
            >
              <Wand2 size={13} className="text-fuchsia-400" />
              <span className="hidden md:inline">AI Copilot & Stylize</span>
            </button>

            {/* Fullscreen Immersion Button */}
            <button
              onClick={toggleFullscreen}
              className="p-2 bg-[#141414] hover:bg-[#222] border border-[#222] text-[#AAA] hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors"
              title="Toggle Fullscreen Immersion Mode (F)"
            >
              <Maximize size={15} />
            </button>

            <button
              onClick={toggleMute}
              className="p-2 bg-[#141414] hover:bg-[#222] rounded-xl border border-[#222] text-[#AAA] transition-colors"
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
            >
              {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} className="text-[#FF3D00]" />}
            </button>
          </div>
        </nav>
      )}

      {/* ========================================================
          FULL VIEWPORT 3D CANVAS STAGE
          ======================================================== */}
      <main className="flex-grow relative w-full h-full bg-[#080808] overflow-hidden">
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#444_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none"></div>

        {/* 3D Scene */}
        <Canvas shadows className={`w-full h-full relative z-10 ${desktopPointerActive ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}>
          <Scene
            roomId={roomId}
            targetObject={targetObject}
            setTargetObject={setTargetObject}
            paintSurface={paintSurface}
            players={players}
            setPlayers={setPlayers}
            orbitControlsRef={orbitControlsRef}
            autoRotate={autoRotate}
            custom3DGroup={custom3DGroup}
            desktopPointerActive={desktopPointerActive}
            hostTool={hostTool}
            hostColor={hostColor}
          />
        </Canvas>

        {/* 3D VIEW ANGLE & DESKTOP POINTER CONTROLS */}
        <div className="absolute top-4 left-4 flex flex-wrap items-center gap-1.5 bg-black/85 backdrop-blur-md p-1.5 rounded-2xl border border-[#222] z-30 pointer-events-auto shadow-2xl">
          <span className="text-[9px] font-mono font-bold text-[#666] px-2 flex items-center gap-1">
            <Rotate3d size={12} className="text-[#FF3D00]" />
            <span className="hidden sm:inline">3D VIEW</span>
          </span>
          <button
            onClick={() => setCameraAngle(0, Math.PI / 2)}
            className="px-2.5 py-1 rounded-lg bg-[#18181D] hover:bg-[#252530] text-[9px] font-bold uppercase text-[#DDD] transition-all border border-[#2A2A35]"
          >
            Front
          </button>
          <button
            onClick={() => setCameraAngle(0.6, Math.PI / 2.2)}
            className="px-2.5 py-1 rounded-lg bg-[#18181D] hover:bg-[#252530] text-[9px] font-bold uppercase text-[#DDD] transition-all border border-[#2A2A35]"
          >
            35°
          </button>
          <button
            onClick={() => setCameraAngle(1.35, Math.PI / 2)}
            className="px-2.5 py-1 rounded-lg bg-[#18181D] hover:bg-[#252530] text-[9px] font-bold uppercase text-[#DDD] transition-all border border-[#2A2A35]"
          >
            Side
          </button>
          <button
            onClick={() => setCameraAngle(0, 0.2)}
            className="px-2.5 py-1 rounded-lg bg-[#18181D] hover:bg-[#252530] text-[9px] font-bold uppercase text-[#DDD] transition-all border border-[#2A2A35]"
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
          >
            <RefreshCw size={10} className={autoRotate ? 'animate-spin' : ''} />
            <span>360°</span>
          </button>

          <div className="w-[1px] h-4 bg-[#262630] mx-0.5" />

          {/* Desktop Pointer Spray / Orbit Toggle */}
          <button
            onClick={() => {
              setDesktopPointerActive(!desktopPointerActive);
              sounds.playClick(1.2);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all ${
              desktopPointerActive
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40 shadow-[0_0_10px_rgba(255,61,0,0.25)]'
                : 'bg-[#18181D] text-[#888] hover:text-white border border-[#2A2A35]'
            }`}
            title={desktopPointerActive ? 'Pointer Spray is active (Left click paints, Right click orbits)' : 'Camera Orbit mode active'}
          >
            <MousePointer size={11} className={desktopPointerActive ? 'text-[#FF3D00]' : ''} />
            <span>{desktopPointerActive ? 'Pointer Spray ON' : 'Orbit Only'}</span>
          </button>

          {/* Host Tool Switcher (Spray vs Brush) */}
          {desktopPointerActive && (
            <div className="flex bg-[#111] p-0.5 rounded-lg border border-[#262630]">
              <button
                onClick={() => {
                  setHostTool('spray');
                  sounds.playClick(1.2);
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${
                  hostTool === 'spray' ? 'bg-[#FF3D00] text-white shadow' : 'text-[#777] hover:text-white'
                }`}
              >
                <SprayCan size={10} />
                <span>Spray</span>
              </button>
              <button
                onClick={() => {
                  setHostTool('brush');
                  sounds.playClick(1.2);
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-bold uppercase transition-all ${
                  hostTool === 'brush' ? 'bg-[#06B6D4] text-white shadow' : 'text-[#777] hover:text-white'
                }`}
              >
                <PenTool size={10} />
                <span>Brush</span>
              </button>
            </div>
          )}

          {/* Quick Persistent QR / Invite Button */}
          <button
            onClick={() => {
              setInviteModalOpen(true);
              sounds.playClick(1.2);
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-950/50 hover:bg-cyan-900/70 text-[9px] font-bold uppercase text-cyan-300 border border-cyan-700/50 shadow-[0_0_10px_rgba(6,182,212,0.25)] transition-all"
            title="Invite Players / Show QR Code"
          >
            <QrCode size={11} className="text-cyan-400" />
            <span>Invite (QR)</span>
          </button>
        </div>

        {/* MULTIPLAYER ROSTER BADGES (TOP RIGHT) */}
        <div className="absolute top-4 right-4 flex items-center space-x-2 z-30 pointer-events-auto">
          <div
            onClick={() => {
              setInviteModalOpen(true);
              sounds.playClick(1.2);
            }}
            className="flex items-center space-x-1.5 bg-black/80 backdrop-blur-md p-1.5 rounded-2xl border border-[#222] hover:border-cyan-500/50 cursor-pointer shadow-2xl transition-all group"
            title="Click to view QR Code or invite players"
          >
            <Users size={13} className="text-cyan-400 ml-1 mr-0.5 group-hover:scale-110 transition-transform" />
            {[1, 2, 3, 4].map((slot) => {
              const player = players.find((p) => p.slot === slot);
              return (
                <div
                  key={slot}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-bold flex items-center gap-1.5 transition-all border ${
                    player
                      ? 'bg-[#181822] text-white border-[#333]'
                      : 'bg-[#101014] text-[#555] border-dashed border-[#222] group-hover:text-cyan-300 group-hover:border-cyan-500/40'
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full ${
                      player
                        ? player.isPainting
                          ? 'animate-ping'
                          : 'animate-pulse'
                        : 'bg-[#333]'
                    }`}
                    style={{ backgroundColor: player ? player.color : '#333' }}
                  />
                  <span>
                    {player ? `P${slot}: ${player.name.slice(0, 8)}` : `+ P${slot}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Radial Color Picker Floating in Host Stage */}
        <RadialColorPicker
          selectedColor={hostColor}
          onSelectColor={handleHostColorChange}
          className="bottom-20 right-6 md:bottom-20 md:right-6"
        />

        {/* Bottom Floating Studio Dock */}
        <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between pointer-events-none z-20">
          {/* Left: Telemetry & Model Info */}
          <div className="p-3 bg-black/85 backdrop-blur-md rounded-2xl border border-[#222] pointer-events-auto flex items-center gap-3 shadow-2xl">
            <div className="flex -space-x-1.5">
              {players.map((p) => (
                <div
                  key={p.id}
                  className="w-4 h-4 rounded-full border border-black shadow"
                  style={{ backgroundColor: p.color }}
                  title={`${p.name} (P${p.slot})`}
                />
              ))}
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-white">
                {targetObject === 'custom3d' && uploadedModelInfo
                  ? `Custom 3D: ${uploadedModelInfo.name}`
                  : `3D Target: ${targetObject.toUpperCase()}`}
              </p>
              <p className="text-[9px] font-mono text-[#666]">
                {players.length} CONNECTED TAGGER{players.length > 1 ? 'S' : ''} • MULTI-SPRAY PHYSICS ACTIVE
              </p>
            </div>
          </div>

          {/* Right: Studio Action Buttons */}
          <div className="flex items-center space-x-2 pointer-events-auto">
            <button
              onClick={() => sounds.playCanRattle()}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#111]/85 backdrop-blur border border-[#222] text-[#AAA] hover:text-[#FF3D00] hover:border-[#FF3D00]/50 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              <Sparkles size={14} />
              <span>Shake Can</span>
            </button>

            <button
              onClick={handleClearCanvas}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#111]/85 backdrop-blur border border-[#222] text-[#AAA] hover:text-red-400 hover:border-red-500/50 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              <Trash2 size={14} />
              <span>Clear</span>
            </button>

            <button
              onClick={handleDownloadSnapshot}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#FF3D00] hover:bg-orange-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-orange-950/40 transition-all active:scale-95"
            >
              <Download size={14} />
              <span>Save PNG</span>
            </button>
          </div>
        </div>
      </main>

      {/* ========================================================
          MODAL 1: MULTIPLAYER INVITE & QR CODE GENERATOR
          ======================================================== */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="w-full max-w-md bg-[#0E0E12] border border-[#262630] rounded-2xl p-6 shadow-2xl relative">
            <button
              onClick={() => setInviteModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-[#777] hover:text-white"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white">
                <Users size={20} />
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">Multiplayer Studio Join</h2>
                <p className="text-[10px] text-[#888] font-mono">CONNECT UP TO 4 MOBILE CONTROLLERS</p>
              </div>
            </div>

            {/* Live Player Slots */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {[1, 2, 3, 4].map((slot) => {
                const player = players.find((p) => p.slot === slot);
                return (
                  <div
                    key={slot}
                    className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs font-mono transition-all ${
                      player
                        ? 'bg-[#151520] border-[#333] text-white'
                        : 'bg-[#101014] border-dashed border-[#222] text-[#555]'
                    }`}
                  >
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        player ? 'animate-pulse' : 'bg-[#333]'
                      }`}
                      style={{ backgroundColor: player ? player.color : '#333' }}
                    />
                    <div className="truncate">
                      <span className="font-bold">P{slot}: </span>
                      <span>{player ? player.name : 'Open'}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-white p-4 rounded-xl flex items-center justify-center my-3 shadow-inner">
              <QRCodeSVG value={controllerUrl} size={170} />
            </div>

            <p className="text-xs text-center text-[#AAA] mb-3">
              Scan this QR code with your phone or open the controller link in another tab to join as a new tagger.
            </p>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                readOnly
                value={controllerUrl}
                className="flex-1 px-3 py-2 bg-[#16161D] border border-[#2C2C38] rounded-xl text-xs text-[#AAA] font-mono truncate"
              />
              <button
                onClick={copyControllerLink}
                className="px-4 py-2 bg-[#222] hover:bg-[#333] text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
              >
                {copiedLink ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                <span>{copiedLink ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <button
              onClick={() => window.open(controllerUrl, '_blank')}
              className="w-full py-2.5 bg-gradient-to-r from-cyan-900/50 to-blue-900/50 hover:from-cyan-800/60 hover:to-blue-800/60 text-cyan-200 border border-cyan-700/50 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md"
            >
              <ExternalLink size={14} className="text-cyan-400" />
              <span>Open Controller in New Window</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 2: 3D MODEL UPLOAD & MATERIAL BREAKDOWN
          ======================================================== */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="w-full max-w-xl bg-[#0E0E12] border border-[#262630] rounded-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setUploadModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-[#777] hover:text-white"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-600 flex items-center justify-center text-white">
                <Box size={20} />
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">Upload & Paint 3D Model</h2>
                <p className="text-[10px] text-[#888] font-mono">SUPPORTS .GLB, .GLTF, .OBJ, .STL</p>
              </div>
            </div>

            {/* Drag and Drop / File Input Box */}
            <label className="border-2 border-dashed border-[#333] hover:border-emerald-500/60 bg-[#121218] rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all mb-4">
              <input
                type="file"
                accept=".glb,.gltf,.obj,.stl"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />
              <Upload size={32} className="text-emerald-400 mb-2" />
              <p className="text-sm font-bold text-white">Click or drag & drop a 3D model file here</p>
              <p className="text-[10px] text-[#777] mt-1">
                Upload any 3D asset (.glb, .gltf, .obj, .stl). We will decompose its materials, normalize the geometry, and project the shared paint texture map!
              </p>
            </label>

            {isUploadingModel && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/40 rounded-xl text-xs text-emerald-300 flex items-center gap-2 mb-4">
                <RefreshCw size={14} className="animate-spin" />
                <span>Deconstructing 3D hierarchy, calculating UV coordinates, and attaching paint shaders...</span>
              </div>
            )}

            {uploadError && (
              <div className="p-3 bg-red-950/40 border border-red-800/40 rounded-xl text-xs text-red-300 mb-4">
                {uploadError}
              </div>
            )}

            {/* Discovered Model Info & Material Breakdown */}
            {uploadedModelInfo && (
              <div className="bg-[#14141C] border border-[#262633] rounded-xl p-4 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-white uppercase">{uploadedModelInfo.name}</span>
                  <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
                    {uploadedModelInfo.meshCount} Meshes • {uploadedModelInfo.vertexCount.toLocaleString()} Vertices
                  </span>
                </div>

                <div className="text-[10px] font-bold uppercase text-[#888] mb-1.5 flex items-center gap-1">
                  <Layers size={11} />
                  <span>Discovered Materials ({uploadedModelInfo.materials.length})</span>
                </div>

                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {uploadedModelInfo.materials.map((mat, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-[#191924] p-2 rounded-lg text-[10px]"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full border border-white/20"
                          style={{ backgroundColor: mat.color }}
                        />
                        <span className="font-mono text-white">{mat.name}</span>
                      </div>
                      <span className="text-[9px] font-mono text-[#888]">
                        {mat.type} • Paint Mapped
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 3: AI COPILOT & STYLE TRANSFORMATION STUDIO
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

            {/* TAB 1: TRANSFORM & STYLIZE ACTIVE ARTWORK */}
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

            {/* TAB 2: STREET CONCEPT GENERATOR */}
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

            {/* TAB 3: GALLERY VALUATION */}
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
