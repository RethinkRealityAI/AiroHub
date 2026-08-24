/**
 * The studio screen.
 *
 * Full-bleed 3D stage with floating glass control islands over it. The old
 * layout put a solid navigation bar above the canvas and scattered controls
 * into four corners; everything now sits in three deliberate zones — a top
 * command bar, a left view island, and a bottom dock — so the object itself
 * stays the focus.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Canvas } from '@react-three/fiber';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import * as THREE from 'three';
import {
  Volume2, VolumeX, Download, Trash2, Sparkles, Maximize, Minimize, X, Zap,
  RefreshCw, Wand2, Palette, Eye, Check, Upload, Users, QrCode, Layers,
  Copy, ExternalLink, MousePointer, Hand, SprayCan, Brush, Loader2, Camera,
  Wifi, WifiOff, Boxes,
} from 'lucide-react';

import { PaintSurface, CANVAS_RES } from '../paint/PaintSurface';
import { StampBatcher, StampPacket, PaintStamp, packStamps, unpackStamps } from '../paint/stamps';
import { StudioScene } from '../scene/StudioScene';
import { Finish } from '../scene/PaintTarget';
import { ObjectTrigger, ObjectPickerSheet } from '../ui/ObjectPicker';
import { GlassPanel, GlassIconButton, Segmented, Sheet } from '../ui/Glass';
import { ColorWell } from '../ui/ColorWell';
import { OBJECT_BY_ID, PAINTABLE_OBJECTS } from '../paint/objectCatalog';
import { prefetchModels } from '../paint/modelRegistry';
import { AiroConnection, SLOT_COLORS, isRealtimeConfigured } from '../net/realtime';
import { sounds } from '../utils/audio';
import { parseUploaded3DModel } from '../utils/model3dLoader';
import { TargetObjectType, PlayerState, Uploaded3DModelInfo } from '../types';

const STYLE_PRESETS = [
  { id: 'cyberpunk', name: 'Cyberpunk', icon: '⚡', desc: 'Neon grids and chromatic flare.', accent: '#22D3EE' },
  { id: 'wildstyle80s', name: 'Wildstyle 84', icon: '👑', desc: 'Fat caps and gravity drips.', accent: '#FF4D1C' },
  { id: 'banksy', name: 'Stencil', icon: '👁', desc: 'Monochrome wash, one red accent.', accent: '#E4E4E7' },
  { id: 'popart', name: 'Pop Art', icon: '✦', desc: 'Ben-Day dots, primary bursts.', accent: '#FFB020' },
  { id: 'cosmic', name: 'Cosmic', icon: '🚀', desc: 'Nebula haze and stardust.', accent: '#A78BFA' },
];

const HOST_ID = 'host-local';

function makeHost(color: string): PlayerState {
  return {
    id: HOST_ID,
    slot: 0,
    name: 'Studio',
    color,
    tool: 'spray',
    isPainting: false,
    cursorPx: { x: CANVAS_RES / 2, y: CANVAS_RES / 2 },
    worldPos: [0, 0, 6],
    pressure: 1,
    sizeMultiplier: 1,
    lastActive: Date.now(),
    mode: 'motion',
    isHost: true,
  };
}

export default function CanvasView() {
  const { roomId } = useParams<{ roomId: string }>();

  const paintSurface = useMemo(() => new PaintSurface(CANVAS_RES), []);
  const orbitRef = useRef<any>(null);

  const [objectId, setObjectId] = useState<TargetObjectType>('skateboard');
  const [finish, setFinish] = useState<Finish>('original');
  const [objectLoading, setObjectLoading] = useState(true);

  const [hostTool, setHostTool] = useState<'spray' | 'brush'>('spray');
  const [hostColor, setHostColor] = useState('#FF4D1C');
  const [hostSize, setHostSize] = useState(1);
  const [stageMode, setStageMode] = useState<'paint' | 'orbit'>('paint');

  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>('connecting');

  const [objectSheet, setObjectSheet] = useState(false);
  const [inviteSheet, setInviteSheet] = useState(false);
  const [aiSheet, setAiSheet] = useState(false);
  const [uploadSheet, setUploadSheet] = useState(false);
  const [copied, setCopied] = useState(false);

  // Player roster. A ref mirrors it because the render loop mutates player
  // transforms every frame and must not trigger React re-renders.
  const [players, setPlayers] = useState<PlayerState[]>([makeHost('#FF4D1C')]);
  const playersRef = useRef<PlayerState[]>(players);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  const [customGroup, setCustomGroup] = useState<THREE.Group | null>(null);
  const [customInfo, setCustomInfo] = useState<Uploaded3DModelInfo | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [aiTab, setAiTab] = useState<'style' | 'concept' | 'critique'>('style');
  const [stylePreset, setStylePreset] = useState('cyberpunk');
  const [aiPrompt, setAiPrompt] = useState('NEON OVERDRIVE');
  const [aiBusy, setAiBusy] = useState(false);
  const [styleResult, setStyleResult] = useState<any>(null);
  const [conceptResult, setConceptResult] = useState<any>(null);
  const [critiqueResult, setCritiqueResult] = useState<any>(null);

  const connectionRef = useRef<AiroConnection | null>(null);
  const controllerUrl = `${window.location.origin}/controller/${roomId}`;

  /**
   * Rebroadcasts stamps the studio painted (host pointer strokes and the paint
   * it derives for motion-aiming phones) so controllers' local textures track
   * the studio's. One batcher per painter identity, keyed with the tool+colour
   * the batch was painted with.
   */
  const stampBatchers = useRef(
    new Map<string, { batcher: StampBatcher; tool: 'spray' | 'brush'; color: string }>()
  );
  const broadcastStamps = useCallback(
    (playerId: string, tool: 'spray' | 'brush', color: string, stamps: PaintStamp[]) => {
      let entry = stampBatchers.current.get(playerId);
      if (!entry || entry.tool !== tool || entry.color !== color) {
        entry?.batcher.dispose();
        const batcher = new StampBatcher((batch, state) => {
          connectionRef.current?.emit('paint-stamps', {
            playerId,
            tool,
            color,
            state,
            stamps: packStamps(batch),
          } satisfies StampPacket as unknown as Record<string, unknown>);
        });
        entry = { batcher, tool, color };
        stampBatchers.current.set(playerId, entry);
        entry.batcher.begin();
      }
      entry.batcher.push(stamps);
    },
    []
  );
  useEffect(
    () => () => {
      for (const { batcher } of stampBatchers.current.values()) batcher.dispose();
    },
    []
  );

  /* --------------------------- networking --------------------------- */

  useEffect(() => {
    if (!roomId) return;
    if (!isRealtimeConfigured()) {
      setConnection('offline');
      return;
    }

    const conn = new AiroConnection(roomId, {
      id: HOST_ID,
      role: 'canvas',
      name: 'Studio',
      tool: 'spray',
      mode: 'motion',
    }).connect();
    connectionRef.current = conn;

    conn.on('connection', ({ status }) =>
      setConnection(status === 'connected' ? 'connected' : status === 'error' ? 'offline' : 'connecting')
    );

    conn.on('player-list-update', (roster: any[]) => {
      setPlayers((prev) => {
        const host = prev.find((p) => p.isHost) ?? makeHost(hostColor);
        const next: PlayerState[] = [host];
        for (const entry of roster) {
          const existing = prev.find((p) => p.id === entry.id);
          next.push(
            existing
              ? { ...existing, slot: entry.slot, name: entry.name, color: entry.color, mode: entry.mode }
              : {
                  id: entry.id,
                  slot: entry.slot,
                  name: entry.name,
                  color: entry.color,
                  tool: entry.tool ?? 'spray',
                  isPainting: false,
                  cursorPx: { x: CANVAS_RES / 2, y: CANVAS_RES / 2 },
                  worldPos: [0, 0, 6],
                  pressure: 1,
                  sizeMultiplier: 1,
                  lastActive: Date.now(),
                  mode: entry.mode ?? 'motion',
                }
          );
        }
        return next;
      });
    });

    // Motion arrives at ~30 Hz. Mutating the ref (rather than setState) keeps
    // it off the React render path; the scene reads it every frame anyway.
    conn.on('motion', ({ playerId, x, y }) => {
      const player = playersRef.current.find((p) => p.id === playerId);
      if (!player || typeof x !== 'number') return;
      player.cursorPx.x = x * CANVAS_RES;
      player.cursorPx.y = y * CANVAS_RES;
      player.lastActive = Date.now();
    });

    conn.on('action', ({ playerId, action, state, color, size }) => {
      const player = playersRef.current.find((p) => p.id === playerId);
      if (!player) return;
      const painting = state === 'start';
      player.tool = action || player.tool;
      if (color) player.color = color;
      if (typeof size === 'number') player.sizeMultiplier = size;
      player.isPainting = painting;
      player.mode = 'motion';
      if (painting) {
        if (player.tool === 'spray') sounds.startSpray(1);
        else sounds.startBrush();
      } else {
        sounds.stopSpray();
        sounds.stopBrush();
      }
      // Mirror into state so the roster badges reflect who is painting.
      setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, isPainting: painting } : p)));
    });

    // Phones painting by touch resolve their own surface raycasts and send the
    // resulting stamps; the studio applies them verbatim so every peer's
    // texture is identical.
    conn.on('paint-stamps', (packet: StampPacket) => {
      const { playerId, tool, color, state, stamps, cursor, point, normal } = packet;
      const player = playersRef.current.find((p) => p.id === playerId);
      if (player) {
        player.tool = tool || player.tool;
        if (color) player.color = color;
        player.mode = 'projection';
        player.isPainting = state !== 'end';
        if (cursor) {
          player.cursorPx.x = cursor[0] * CANVAS_RES;
          player.cursorPx.y = cursor[1] * CANVAS_RES;
        }
        // Touch-painting phones know their true surface contact; use it to
        // place their floating tool instead of guessing from a screen ray.
        if (point) {
          player.worldPos = point;
          player.surfacePoint = point;
          player.surfaceNormal = normal ?? [0, 0, 1];
        }
        player.lastActive = Date.now();
      }
      if (state === 'start') {
        if (tool === 'spray') sounds.startSpray(1);
        else sounds.startBrush();
      } else if (state === 'end') {
        sounds.stopSpray();
        sounds.stopBrush();
      }
      if (stamps?.length) {
        paintSurface.applyStamps(unpackStamps(stamps), tool, color);
        paintSurface.commit();
      }
    });

    conn.on('change-object', ({ objectType }) => {
      if (objectType) setObjectId(objectType);
    });

    conn.on('settings', ({ playerId, color, tool, size, playerName }) => {
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === playerId
            ? {
                ...p,
                color: color ?? p.color,
                tool: tool ?? p.tool,
                sizeMultiplier: size ?? p.sizeMultiplier,
                name: playerName ?? p.name,
              }
            : p
        )
      );
    });

    conn.on('clear-canvas', () => {
      paintSurface.clear();
      sounds.playWhoosh();
    });
    conn.on('shake', () => sounds.playCanRattle());
    conn.on('ai-stamp', ({ stencilSymbol, color, text }) => {
      if (stencilSymbol) {
        paintSurface.stampSymbol(stencilSymbol, CANVAS_RES / 2, CANVAS_RES / 2, color || '#FF4D1C', text);
        sounds.playWhoosh();
      }
    });

    // Test hook (only with ?debug in the URL): lets automated verification
    // drive the remote-player path without a live network.
    if (new URLSearchParams(window.location.search).has('debug')) {
      (window as any).__airoSim = (event: string, payload: unknown) =>
        conn.simulateIncoming(event as any, payload);
      (window as any).__airoProbe = () =>
        playersRef.current.map((p) => ({
          id: p.id,
          cursor: { ...p.cursorPx },
          painting: p.isPainting,
          mode: p.mode,
          world: [...p.worldPos],
        }));
    }

    return () => {
      conn.disconnect();
      connectionRef.current = null;
      delete (window as any).__airoSim;
      sounds.stopSpray();
      sounds.stopBrush();
    };
    // hostColor is only read for the initial host record; re-subscribing on
    // every colour change would tear down the channel mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, paintSurface]);

  /* ------------------------------ effects ------------------------------ */

  useEffect(() => {
    // Warm the two most likely next objects so switching feels instant.
    prefetchModels(['tool-spraycan', 'tool-brush'], null);
  }, []);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if (key === 'f') toggleFullscreen();
      if (key === 'b') setHostTool((t) => (t === 'spray' ? 'brush' : 'spray'));
      if (key === 'o') setStageMode((m) => (m === 'paint' ? 'orbit' : 'paint'));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  const setCameraAngle = (azimuth: number, polar: number) => {
    const controls = orbitRef.current;
    if (!controls) return;
    sounds.playClick(1.2);
    controls.setAzimuthalAngle(azimuth);
    controls.setPolarAngle(polar);
    controls.update();
  };

  const changeObject = useCallback(
    (next: TargetObjectType) => {
      setObjectId(next);
      sounds.playClick(1.3);
      connectionRef.current?.emit('change-object', { objectType: next });
    },
    []
  );

  const handleHostColor = (hex: string) => {
    setHostColor(hex);
    setPlayers((prev) => prev.map((p) => (p.isHost ? { ...p, color: hex } : p)));
  };

  const clearCanvas = () => {
    paintSurface.clear();
    sounds.playWhoosh();
    connectionRef.current?.emit('clear-canvas', {});
  };

  const saveSnapshot = () => {
    sounds.playClick(1.6);
    const link = document.createElement('a');
    const label = OBJECT_BY_ID.get(objectId)?.label.replace(/\s+/g, '-') ?? objectId;
    link.download = `AiroHub-${label}-${roomId || 'art'}.png`;
    link.href = paintSurface.toExportDataURL();
    link.click();
  };

  const handleUpload = async (file: File) => {
    setUploadBusy(true);
    setUploadError(null);
    try {
      const result = await parseUploaded3DModel(file, paintSurface.texture);
      setCustomGroup(result.group);
      setCustomInfo(result.info);
      setObjectId('custom3d');
      sounds.playWhoosh();
      setUploadSheet(false);
    } catch (err: any) {
      setUploadError(err?.message || 'Could not read that model. Try a GLB, GLTF, OBJ or STL file.');
    } finally {
      setUploadBusy(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(controllerUrl);
    setCopied(true);
    sounds.playClick(1.5);
    setTimeout(() => setCopied(false), 2000);
  };

  /* -------------------------------- AI -------------------------------- */

  const callAi = async (path: string, body: unknown) => {
    const res = await fetch(`/api/ai/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`AI request failed (${res.status})`);
    return res.json();
  };

  const applyStyle = async () => {
    setAiBusy(true);
    sounds.playClick(1.4);
    try {
      const data = await callAi('transform-style', {
        preset: stylePreset,
        objectType: objectId,
        customPrompt: aiPrompt,
      });
      setStyleResult(data);
      const apply: Record<string, () => void> = {
        cyberpunk: () => paintSurface.applyCyberpunkStyle(data.accentColor, data.secondaryColor, data.tagText),
        wildstyle80s: () => paintSurface.applyWildstyleDrips(data.accentColor, data.tagText),
        banksy: () => paintSurface.applyBanksyFilter(data.accentColor, data.tagText),
        popart: () => paintSurface.applyPopArtDots(data.accentColor, data.tagText),
        cosmic: () => paintSurface.applyCosmicNebula(data.accentColor, data.secondaryColor, data.tagText),
      };
      apply[stylePreset]?.();
      paintSurface.commit();
      sounds.playWhoosh();
    } catch (err) {
      console.error(err);
      setStyleResult({ error: 'The style engine is unavailable right now.' });
    } finally {
      setAiBusy(false);
    }
  };

  const generateConcept = async () => {
    setAiBusy(true);
    try {
      setConceptResult(await callAi('graffiti-tag', { prompt: aiPrompt, style: 'wildstyle' }));
    } catch {
      setConceptResult({ error: 'The concept generator is unavailable right now.' });
    } finally {
      setAiBusy(false);
    }
  };

  const generateCritique = async () => {
    setAiBusy(true);
    try {
      setCritiqueResult(await callAi('critique', { objectType: objectId, dominantColor: hostColor }));
    } catch {
      setCritiqueResult({ error: 'The appraisal service is unavailable right now.' });
    } finally {
      setAiBusy(false);
    }
  };

  const stampConcept = () => {
    if (!conceptResult) return;
    paintSurface.stampSymbol(
      conceptResult.stencilSymbol || '⚡',
      CANVAS_RES / 2,
      CANVAS_RES / 2,
      hostColor,
      conceptResult.graffitiText || aiPrompt
    );
    paintSurface.commit();
    connectionRef.current?.emit('ai-stamp', {
      stencilSymbol: conceptResult.stencilSymbol,
      text: conceptResult.graffitiText,
      color: hostColor,
    });
    sounds.playWhoosh();
    setAiSheet(false);
  };

  if (!roomId) {
    return (
      <div className="min-h-screen grid place-items-center stage-vignette text-white">
        <GlassPanel className="p-8 text-center">
          <p className="text-sm">That studio link is missing a room code.</p>
        </GlassPanel>
      </div>
    );
  }

  const remotePlayers = players.filter((p) => !p.isHost);
  const activeObject = OBJECT_BY_ID.get(objectId);

  return (
    <div className="h-screen w-screen overflow-hidden stage-vignette text-white relative select-none">
      {/* ---------------------------- 3D stage ---------------------------- */}
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        className={`absolute inset-0 ${stageMode === 'paint' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      >
        <Suspense fallback={null}>
        <StudioScene
          objectId={objectId}
          finish={finish}
          paintSurface={paintSurface}
          players={players}
          playersRef={playersRef}
          orbitRef={orbitRef}
          autoRotate={autoRotate}
          customGroup={customGroup}
          hostPainting={stageMode === 'paint'}
          hostTool={hostTool}
          hostColor={hostColor}
          hostSize={hostSize}
          onObjectLoadingChange={setObjectLoading}
          onStampsPainted={broadcastStamps}
        />
        </Suspense>
      </Canvas>

      {/* --------------------------- top command bar --------------------------- */}
      <AnimatePresence>
        {!fullscreen && (
          <motion.header
            initial={{ y: -70, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -70, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="absolute top-0 inset-x-0 z-30 p-3 md:p-4 flex items-center gap-2 md:gap-3 safe-top"
          >
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-9 h-9 rounded-[13px] bg-gradient-to-tr from-[#FF4D1C] to-[#FFB020] shadow-[0_0_22px_rgba(255,77,28,0.45)] grid place-items-center">
                <SprayCan size={17} className="text-white drop-shadow" />
              </div>
              <div className="hidden sm:block leading-none">
                <div className="text-[15px] font-bold tracking-tight">AiroHub</div>
                <div className="text-[9px] font-mono text-white/40 mt-0.5">ROOM {roomId}</div>
              </div>
            </div>

            <div className="flex-1 flex justify-center min-w-0">
              <ObjectTrigger
                objectId={objectId}
                customName={customInfo?.name}
                onClick={() => {
                  setObjectSheet(true);
                  sounds.playClick(1.2);
                }}
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setInviteSheet(true)}
                className="tap glass glass-sheen rounded-full pl-2 pr-3 py-1.5 flex items-center gap-2"
                title="Invite players"
              >
                <Users size={14} className="text-[var(--color-airo-aqua)]" />
                <div className="flex -space-x-1.5">
                  {[1, 2, 3, 4].map((slot) => {
                    const player = remotePlayers.find((p) => p.slot === slot);
                    return (
                      <span
                        key={slot}
                        className={`w-4 h-4 rounded-full border-2 border-black/50 ${player?.isPainting ? 'airo-breathe' : ''}`}
                        style={{ background: player ? player.color : 'rgba(255,255,255,0.14)' }}
                      />
                    );
                  })}
                </div>
              </button>

              <GlassIconButton onClick={() => setAiSheet(true)} title="AI copilot" size={38}>
                <Wand2 size={15} className="text-[var(--color-airo-violet)]" />
              </GlassIconButton>
              <GlassIconButton
                onClick={() => {
                  const next = sounds.toggleMute();
                  setMuted(next);
                }}
                title={muted ? 'Unmute' : 'Mute'}
                size={38}
              >
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} className="text-[var(--color-airo-flame)]" />}
              </GlassIconButton>
              <GlassIconButton onClick={toggleFullscreen} title="Fullscreen (F)" size={38}>
                <Maximize size={15} />
              </GlassIconButton>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {fullscreen && (
        <GlassIconButton
          onClick={toggleFullscreen}
          className="absolute top-4 right-4 z-30"
          title="Exit fullscreen"
        >
          <Minimize size={15} />
        </GlassIconButton>
      )}

      {/* --------------------------- left view island --------------------------- */}
      <AnimatePresence>
        {!fullscreen && (
          <motion.div
            initial={{ x: -80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32, delay: 0.05 }}
            className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2"
          >
            <GlassPanel radius="rounded-[22px]" className="p-1.5 flex flex-col gap-1">
              {[
                { label: 'Front', az: 0, pol: Math.PI / 2 },
                { label: '3/4', az: 0.7, pol: Math.PI / 2.25 },
                { label: 'Side', az: Math.PI / 2, pol: Math.PI / 2 },
                { label: 'Top', az: 0, pol: 0.32 },
              ].map((view) => (
                <button
                  key={view.label}
                  onClick={() => setCameraAngle(view.az, view.pol)}
                  className="tap w-[52px] py-1.5 rounded-[15px] text-[10px] font-semibold text-white/75 hover:text-white hover:bg-white/12"
                >
                  {view.label}
                </button>
              ))}
              <div className="h-px bg-white/12 mx-2 my-0.5" />
              <button
                onClick={() => setAutoRotate((v) => !v)}
                className={`tap w-[52px] py-1.5 rounded-[15px] grid place-items-center ${
                  autoRotate ? 'bg-[var(--color-airo-aqua)]/25 text-[var(--color-airo-aqua)]' : 'text-white/70 hover:bg-white/12'
                }`}
                title="Auto-rotate"
              >
                <RefreshCw size={14} className={autoRotate ? 'animate-spin' : ''} />
              </button>
            </GlassPanel>

            <GlassPanel radius="rounded-[22px]" className="p-1.5 flex flex-col gap-1">
              <button
                onClick={() => setStageMode('paint')}
                className={`tap w-[52px] py-2 rounded-[15px] grid place-items-center ${
                  stageMode === 'paint' ? 'bg-[var(--color-airo-flame)] text-white' : 'text-white/70 hover:bg-white/12'
                }`}
                title="Paint with pointer (O)"
              >
                <MousePointer size={14} />
              </button>
              <button
                onClick={() => setStageMode('orbit')}
                className={`tap w-[52px] py-2 rounded-[15px] grid place-items-center ${
                  stageMode === 'orbit' ? 'bg-white/22 text-white' : 'text-white/70 hover:bg-white/12'
                }`}
                title="Orbit camera (O)"
              >
                <Hand size={14} />
              </button>
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------ bottom dock ------------------------------ */}
      <AnimatePresence>
        {!fullscreen && (
          <motion.div
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32, delay: 0.08 }}
            className="absolute bottom-0 inset-x-0 z-30 p-3 md:p-4 flex justify-center safe-bottom"
          >
            <GlassPanel className="px-3 py-2.5 flex items-center gap-2 md:gap-3 flex-wrap justify-center max-w-[min(100%,980px)]">
              <Segmented
                layoutId="host-tool"
                value={hostTool}
                onChange={(value) => {
                  setHostTool(value);
                  sounds.playClick(1.2);
                }}
                options={[
                  { value: 'spray', label: 'Spray', icon: <SprayCan size={13} />, accent: '#FF4D1C' },
                  { value: 'brush', label: 'Brush', icon: <Brush size={13} />, accent: '#22D3EE' },
                ]}
              />

              <ColorWell color={hostColor} onChange={handleHostColor} />

              <div className="flex items-center gap-2 px-2 min-w-[130px]">
                <span className="label-caps text-white/40 shrink-0">Size</span>
                <input
                  type="range"
                  min={0.4}
                  max={2}
                  step={0.05}
                  value={hostSize}
                  onChange={(e) => setHostSize(Number(e.target.value))}
                  className="airo-slider flex-1"
                  aria-label="Tool size"
                />
              </div>

              <div className="w-px h-7 bg-white/12 hidden md:block" />

              <Segmented
                layoutId="host-finish"
                size="sm"
                value={finish}
                onChange={(value) => {
                  setFinish(value);
                  sounds.playClick(1.1);
                }}
                options={[
                  { value: 'original', label: 'Textured' },
                  { value: 'primer', label: 'Primer' },
                ]}
              />

              <div className="w-px h-7 bg-white/12 hidden md:block" />

              <GlassIconButton onClick={() => sounds.playCanRattle()} title="Shake can" size={38}>
                <Sparkles size={15} className="text-[var(--color-airo-ember)]" />
              </GlassIconButton>
              <GlassIconButton onClick={clearCanvas} title="Clear paint" size={38}>
                <Trash2 size={15} />
              </GlassIconButton>
              <button
                onClick={saveSnapshot}
                className="tap rounded-full px-4 py-2 bg-gradient-to-r from-[#FF4D1C] to-[#FF7A34] text-white text-[11px] font-bold tracking-wide flex items-center gap-1.5 shadow-[0_8px_24px_-6px_rgba(255,77,28,0.75)]"
              >
                <Download size={14} />
                <span>Save</span>
              </button>
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --------------------------- status readouts --------------------------- */}
      <div className="absolute right-3 md:right-4 bottom-24 md:bottom-28 z-20 flex flex-col items-end gap-2 pointer-events-none">
        <AnimatePresence>
          {objectLoading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="glass glass-sheen rounded-full px-3 py-1.5 flex items-center gap-2 text-[10px] font-semibold"
            >
              <Loader2 size={12} className="animate-spin" />
              <span>Loading {activeObject?.label ?? 'model'}…</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="glass glass-sheen rounded-full px-3 py-1.5 flex items-center gap-2 text-[10px] font-medium text-white/70">
          {connection === 'connected' ? (
            <>
              <Wifi size={12} className="text-emerald-400" />
              <span>{remotePlayers.length} phone{remotePlayers.length === 1 ? '' : 's'} connected</span>
            </>
          ) : connection === 'connecting' ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              <span>Connecting…</span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-amber-400" />
              <span>Solo mode</span>
            </>
          )}
        </div>
      </div>

      {/* -------------------------------- sheets -------------------------------- */}

      <ObjectPickerSheet
        open={objectSheet}
        onClose={() => setObjectSheet(false)}
        objectId={objectId}
        onSelect={changeObject}
        onUpload={() => setUploadSheet(true)}
        customName={customInfo?.name}
      />

      <Sheet
        open={inviteSheet}
        onClose={() => setInviteSheet(false)}
        centered
        title="Invite players"
        subtitle="Up to four phones can join this studio"
      >
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[1, 2, 3, 4].map((slot) => {
            const player = remotePlayers.find((p) => p.slot === slot);
            return (
              <div
                key={slot}
                className={`rounded-2xl px-3 py-2.5 border flex items-center gap-2 text-[11px] ${
                  player ? 'bg-white/[0.1] border-white/25' : 'bg-white/[0.03] border-dashed border-white/15 text-white/40'
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${player ? 'airo-breathe' : ''}`}
                  style={{ background: player ? player.color : 'rgba(255,255,255,0.2)' }}
                />
                <span className="font-semibold truncate">{player ? player.name : `Slot ${slot} open`}</span>
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-2xl p-4 grid place-items-center mb-4">
          <QRCodeSVG value={controllerUrl} size={182} />
        </div>

        <p className="text-[11px] text-white/55 text-center mb-3">
          Scan with a phone camera to turn it into a spray can.
        </p>

        <div className="flex gap-2">
          <input
            readOnly
            value={controllerUrl}
            className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-black/40 border border-white/12 text-[11px] font-mono text-white/60 truncate"
          />
          <button onClick={copyLink} className="tap px-4 rounded-xl bg-white/15 hover:bg-white/25 text-[11px] font-bold flex items-center gap-1.5">
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <button
          onClick={() => window.open(controllerUrl, '_blank')}
          className="tap w-full mt-2 py-2.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/12 text-[11px] font-semibold flex items-center justify-center gap-2"
        >
          <ExternalLink size={13} />
          Open controller in a new tab
        </button>
      </Sheet>

      <Sheet
        open={uploadSheet}
        onClose={() => setUploadSheet(false)}
        centered
        title="Upload a 3D model"
        subtitle="GLB, GLTF, OBJ or STL"
      >
        <label className="block rounded-2xl border-2 border-dashed border-white/20 hover:border-[var(--color-airo-aqua)]/60 bg-white/[0.03] p-8 text-center cursor-pointer transition-colors">
          <input
            type="file"
            accept=".glb,.gltf,.obj,.stl"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
          />
          <Upload size={26} className="mx-auto mb-2 text-[var(--color-airo-aqua)]" />
          <p className="text-[13px] font-semibold">Drop a model here or click to browse</p>
          <p className="text-[10px] text-white/45 mt-1">
            We normalise the scale, generate UVs when missing, and wire it to the shared paint layer.
          </p>
        </label>

        {uploadBusy && (
          <div className="mt-3 rounded-xl bg-white/[0.07] border border-white/12 px-3 py-2.5 text-[11px] flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" />
            Reading geometry and attaching paint shaders…
          </div>
        )}
        {uploadError && (
          <div className="mt-3 rounded-xl bg-red-950/50 border border-red-500/30 px-3 py-2.5 text-[11px] text-red-200">
            {uploadError}
          </div>
        )}
        {customInfo && (
          <div className="mt-3 rounded-xl bg-white/[0.06] border border-white/12 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-semibold truncate">{customInfo.name}</span>
              <span className="text-[9px] font-mono text-white/50">
                {customInfo.meshCount} meshes · {customInfo.vertexCount.toLocaleString()} verts
              </span>
            </div>
            <p className="text-[10px] text-white/45 flex items-center gap-1.5">
              <Layers size={10} /> {customInfo.materials.length} materials mapped for painting
            </p>
          </div>
        )}
      </Sheet>

      <Sheet
        open={aiSheet}
        onClose={() => setAiSheet(false)}
        centered
        title="AI copilot"
        subtitle="Restyle the piece, generate a concept, or get it appraised"
      >
        <div className="mb-4">
          <Segmented<'style' | 'concept' | 'critique'>
            layoutId="ai-tabs"
            value={aiTab}
            onChange={setAiTab}
            options={[
              { value: 'style', label: 'Style', icon: <Palette size={12} />, accent: '#A78BFA' },
              { value: 'concept', label: 'Concept', icon: <Sparkles size={12} />, accent: '#A78BFA' },
              { value: 'critique', label: 'Appraise', icon: <Eye size={12} />, accent: '#A78BFA' },
            ]}
          />
        </div>

        {aiTab === 'style' && (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setStylePreset(preset.id)}
                  className={`tap text-left rounded-2xl p-3 border transition-colors ${
                    stylePreset === preset.id
                      ? 'bg-white/[0.14] border-white/35'
                      : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[15px]">{preset.icon}</span>
                    <span className="text-[12px] font-semibold flex-1">{preset.name}</span>
                    {stylePreset === preset.id && <Check size={12} style={{ color: preset.accent }} />}
                  </div>
                  <p className="text-[10px] text-white/45">{preset.desc}</p>
                </button>
              ))}
            </div>
            <input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Theme words, e.g. TOKYO OVERDRIVE"
              className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-white/12 text-[12px] placeholder-white/30 focus:outline-none focus:border-[var(--color-airo-violet)] mb-3"
            />
            <button
              onClick={applyStyle}
              disabled={aiBusy}
              className="tap w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 disabled:opacity-50 text-[12px] font-bold flex items-center justify-center gap-2"
            >
              {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {aiBusy ? 'Styling…' : 'Apply style'}
            </button>
            {styleResult && (
              <div className="mt-3 rounded-xl bg-white/[0.06] border border-white/12 p-3 text-[11px]">
                {styleResult.error ? (
                  <span className="text-amber-300">{styleResult.error}</span>
                ) : (
                  <>
                    <div className="font-semibold text-fuchsia-300">{styleResult.transformedTitle}</div>
                    <p className="text-white/55 italic mt-1 text-[10px]">"{styleResult.curatorNotes}"</p>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {aiTab === 'concept' && (
          <div>
            <div className="flex gap-2 mb-3">
              <input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. PHANTOM, WILDSTYLE"
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-black/40 border border-white/12 text-[12px] placeholder-white/30 focus:outline-none focus:border-[var(--color-airo-violet)]"
              />
              <button
                onClick={generateConcept}
                disabled={aiBusy}
                className="tap px-4 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 disabled:opacity-50 text-[11px] font-bold flex items-center gap-1.5"
              >
                {aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Generate
              </button>
            </div>
            {conceptResult &&
              (conceptResult.error ? (
                <p className="text-[11px] text-amber-300">{conceptResult.error}</p>
              ) : (
                <div className="rounded-xl bg-white/[0.06] border border-white/12 p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-14 h-14 rounded-xl bg-black/50 border border-violet-500/40 grid place-items-center text-2xl">
                      {conceptResult.stencilSymbol}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-black tracking-tight uppercase truncate">{conceptResult.graffitiText}</h3>
                      <p className="text-[10px] text-white/50 italic">{conceptResult.styleNotes}</p>
                    </div>
                  </div>
                  <button
                    onClick={stampConcept}
                    className="tap w-full py-2.5 rounded-xl bg-[var(--color-airo-flame)] text-[11px] font-bold flex items-center justify-center gap-1.5"
                  >
                    <Zap size={13} /> Stamp on {activeObject?.label ?? 'object'}
                  </button>
                </div>
              ))}
          </div>
        )}

        {aiTab === 'critique' && (
          <div>
            <p className="text-[11px] text-white/55 mb-3">
              Get a gallery-style appraisal of the piece currently on the {activeObject?.label ?? 'object'}.
            </p>
            <button
              onClick={generateCritique}
              disabled={aiBusy}
              className="tap w-full py-3 rounded-xl bg-gradient-to-r from-violet-700 to-fuchsia-700 disabled:opacity-50 text-[12px] font-bold flex items-center justify-center gap-2 mb-3"
            >
              {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              {aiBusy ? 'Appraising…' : 'Appraise artwork'}
            </button>
            {critiqueResult &&
              (critiqueResult.error ? (
                <p className="text-[11px] text-amber-300">{critiqueResult.error}</p>
              ) : (
                <div className="rounded-xl bg-white/[0.06] border border-white/12 p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-[12px] font-semibold text-fuchsia-300 truncate">
                      {critiqueResult.exhibitionTitle}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-emerald-300 shrink-0">
                      {critiqueResult.estimatedValue}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/60 leading-relaxed">"{critiqueResult.curatorCritique}"</p>
                </div>
              ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
