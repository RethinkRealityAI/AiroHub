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
import { useLocation, useParams } from 'react-router-dom';
import { Canvas, useThree } from '@react-three/fiber';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import * as THREE from 'three';
import {
  Volume2, VolumeX, Download, Trash2, Sparkles, Maximize, Minimize, AlertTriangle,
  RefreshCw, Wand2, Palette, Eye, Check, Upload, Users, Layers,
  Copy, ExternalLink, MousePointer, Hand, SprayCan, Brush, Loader2,
  Wifi, WifiOff, Undo2, Redo2, History, Video, HelpCircle,
  Stamp as StampIcon, Clapperboard, Megaphone, X,
} from 'lucide-react';

import { PaintSurface, CANVAS_RES } from '../paint/PaintSurface';
import { StampBatcher, StampPacket, PaintStamp, packStamps, unpackStamps } from '../paint/stamps';
import {
  BUILTIN_STAMPS,
  StampAsset,
  StampLibrary,
  addUpload,
  createStampApplier,
  decodeStampImage,
  loadStampLibrary,
  markRecent,
  removeUpload,
  stampForSymbol,
  stampFromFile,
  stampPayload,
  stampRadiusPx,
} from '../paint/stampAssets';
import { StampTray } from '../ui/StampSheet';
import { pickSurfaceUV, pointerToNdc } from '../scene/stampPlacement';
import { StudioScene } from '../scene/StudioScene';
import { ShowcasePanel } from '../showcase/ShowcasePanel';
import type { ShowcaseHandles } from '../showcase/recorder';
import { Finish } from '../scene/PaintTarget';
import { ObjectTrigger, ObjectPickerSheet } from '../ui/ObjectPicker';
import { GlassPanel, GlassPill, GlassIconButton, Segmented, Sheet } from '../ui/Glass';
import { WelcomeGuide } from './WelcomeGuide';
import { ColorWell } from '../ui/ColorWell';
import { OBJECT_BY_ID } from '../paint/objectCatalog';
import { ensureCustomModels } from '../paint/customModels';
import { prefetchModels } from '../paint/modelRegistry';
import { AiroConnection, SLOT_COLORS, isRealtimeConfigured } from '../net/realtime';
import { sounds } from '../utils/audio';
import { parseUploaded3DModel } from '../utils/model3dLoader';
import { TargetObjectType, PlayerState, Uploaded3DModelInfo, ImageStampData } from '../types';
import { getFlags, useFlags } from '../config/flags';
import { track } from '../analytics/track';
import { FeedbackButton } from '../feedback/FeedbackButton';

/**
 * Turns a tap on the stage into a surface UV.
 *
 * It lives inside the R3F canvas purely to reach the default camera and the
 * scene graph; the ray maths and the "which meshes are paintable" question are
 * both answered by `scene/stampPlacement`. A drag is never a placement — the
 * same left button still orbits the camera in stamp mode, so only a press that
 * neither travels nor lingers counts as a tap.
 */
function StampPlacer({
  armedRef,
  onPlace,
  pickCentreRef,
}: {
  armedRef: React.MutableRefObject<boolean>;
  onPlace: (u: number, v: number) => void;
  /**
   * Filled in with a "where is the model right now" probe, so code outside the
   * canvas — the AI copilot — can place a stamp somewhere the viewer can
   * actually see rather than at a fixed UV.
   */
  pickCentreRef: React.MutableRefObject<(() => { u: number; v: number } | null) | null>;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  // The UV under the middle of the frame. A generated model's atlas scatters
  // its charts, so a hard-coded UV lands wherever that chart happens to be —
  // often on a face nobody is looking at. Rays from the centre outwards find a
  // spot that is genuinely on screen.
  useEffect(() => {
    pickCentreRef.current = () => {
      const offsets: [number, number][] = [
        [0, 0],
        [0, 0.18],
        [0, -0.18],
        [0.22, 0],
        [-0.22, 0],
        [0.26, 0.2],
        [-0.26, -0.2],
      ];
      for (const [x, y] of offsets) {
        const hit = pickSurfaceUV(scene, cameraRef.current, x, y);
        if (hit) return { u: hit.u, v: hit.v };
      }
      return null;
    };
    return () => {
      pickCentreRef.current = null;
    };
  }, [scene, pickCentreRef]);

  useEffect(() => {
    const canvas = gl.domElement;
    const press = { x: 0, y: 0, at: 0, id: -1, live: false };

    const onDown = (event: PointerEvent) => {
      press.live = armedRef.current && event.button === 0;
      if (!press.live) return;
      press.x = event.clientX;
      press.y = event.clientY;
      press.at = performance.now();
      press.id = event.pointerId;
    };

    const onUp = (event: PointerEvent) => {
      if (!press.live || event.pointerId !== press.id) return;
      press.live = false;
      if (!armedRef.current) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) return;
      if (performance.now() - press.at > 700) return;
      const ndc = pointerToNdc(canvas, event.clientX, event.clientY);
      const hit = pickSurfaceUV(scene, cameraRef.current, ndc.x, ndc.y);
      if (hit) onPlaceRef.current(hit.u, hit.v);
    };

    const onCancel = () => {
      press.live = false;
    };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [gl, scene, armedRef]);

  return null;
}

/**
 * The style presets, as art.
 *
 * Each one ships a reference plate (`/ui/presets/*.webp`) showing what the
 * transform actually lays down, so the picker is a row of small paintings
 * rather than a row of labels. `id` is the wire value the AI endpoint expects
 * and never changes; the plate filename is deliberately decoupled from it.
 */
const STYLE_PRESETS = [
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    art: '/ui/presets/preset-cyberpunk.webp',
    desc: 'Neon grids and chromatic flare.',
    accent: '#22D3EE',
  },
  {
    id: 'wildstyle80s',
    name: 'Wildstyle 84',
    art: '/ui/presets/preset-wildstyle.webp',
    desc: 'Fat caps and gravity drips.',
    accent: '#FF4D1C',
  },
  {
    id: 'banksy',
    name: 'Stencil',
    art: '/ui/presets/preset-stencil.webp',
    desc: 'Monochrome wash, one red accent.',
    accent: '#E4E4E7',
  },
  {
    id: 'popart',
    name: 'Pop Art',
    art: '/ui/presets/preset-popart.webp',
    desc: 'Ben-Day dots, primary bursts.',
    accent: '#FFB020',
  },
  {
    id: 'cosmic',
    name: 'Cosmic',
    art: '/ui/presets/preset-cosmic.webp',
    desc: 'Nebula haze and stardust.',
    accent: '#A78BFA',
  },
];

/** Where an AI-suggested stencil lands: centred, a little above the equator. */
const AI_STAMP_UV = { u: 0.5, v: 0.35 };

/** House ink for the copilot's paint-stroke buttons. */
const AI_PAINT = 'linear-gradient(120deg, #7C3AED 0%, #A855F7 55%, #E879F9 100%)';

/** Hex colours an AI answer offered, cleaned up for use as swatches. */
function paletteOf(...values: unknown[]): string[] {
  const flat = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
  const seen = new Set<string>();
  return flat.filter(
    (value): value is string =>
      typeof value === 'string' &&
      /^#[0-9a-f]{6}$/i.test(value.trim()) &&
      !seen.has(value.toUpperCase()) &&
      Boolean(seen.add(value.toUpperCase()))
  );
}

/* ------------------------------------------------------------------
   AI copilot presentation
   ------------------------------------------------------------------ */

/** One style preset, presented as a small painting with its own accent edge. */
const PresetCard: React.FC<{
  preset: (typeof STYLE_PRESETS)[number];
  selected: boolean;
  onSelect: () => void;
}> = ({ preset, selected, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={selected}
    className={`tap group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-colors ${
      selected ? 'border-white/40 bg-white/[0.12]' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
    }`}
  >
    <div className="relative h-[86px] shrink-0 overflow-hidden">
      <img
        src={preset.art}
        alt=""
        draggable={false}
        className={`h-full w-full scale-[1.08] object-cover transition-transform duration-300 group-hover:scale-[1.14] ${
          selected ? '' : 'opacity-80 saturate-[0.85]'
        }`}
      />
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, rgba(6,6,12,0) 38%, rgba(6,6,12,0.82) 100%)' }}
      />
      {selected && (
        <span
          className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full"
          style={{ background: preset.accent, boxShadow: `0 4px 14px -2px ${preset.accent}` }}
        >
          <Check size={11} className="text-black/80" />
        </span>
      )}
    </div>
    {/* The accent edge: a painted rule the width of the card. */}
    <span
      aria-hidden
      className="block h-[2.5px] w-full transition-opacity"
      style={{ background: preset.accent, opacity: selected ? 1 : 0.42 }}
    />
    <div className="px-2.5 pb-2.5 pt-2">
      <div className="truncate text-[11.5px] font-bold tracking-tight text-white">{preset.name}</div>
      <p className="mt-0.5 text-[9.5px] leading-snug text-white/45">{preset.desc}</p>
    </div>
  </button>
);

/** Colours an answer proposed, as a row of paint swatches. */
const PaletteRow: React.FC<{
  colors: string[];
  active?: string;
  onPick?: (hex: string) => void;
}> = ({ colors, active, onPick }) =>
  colors.length === 0 ? null : (
    <div className="flex items-center gap-1.5">
      {colors.map((hex) => {
        const selected = active?.toUpperCase() === hex.toUpperCase();
        return onPick ? (
          <button
            key={hex}
            type="button"
            onClick={() => onPick(hex)}
            title={hex}
            aria-label={`Use ${hex}`}
            aria-pressed={selected}
            className={`tap h-6 w-6 rounded-full border transition-transform ${
              selected ? 'border-white/80 scale-110' : 'border-white/20 hover:border-white/50'
            }`}
            style={{ background: hex, boxShadow: selected ? `0 4px 14px -3px ${hex}` : undefined }}
          />
        ) : (
          <span
            key={hex}
            title={hex}
            className="h-5 w-5 rounded-full border border-white/20"
            style={{ background: hex }}
          />
        );
      })}
    </div>
  );

/** The copilot's failure state — one quiet line, never a red wall. */
const ResultNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mt-3.5 flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-3.5 py-3 text-[11px] text-amber-200/90">
    <AlertTriangle size={13} className="mt-px shrink-0" />
    <span>{children}</span>
  </div>
);

/** The stencil an answer suggested, drawn as the stamp it will actually place. */
const StencilPreview: React.FC<{ asset: StampAsset; tint: string; size?: number }> = ({
  asset,
  tint,
  size = 60,
}) => (
  <span
    className="glass relative grid shrink-0 place-items-center rounded-2xl"
    style={{ width: size, height: size }}
  >
    <span
      aria-hidden
      className="block h-[64%] w-[64%]"
      style={{
        background: tint,
        WebkitMaskImage: `url(${asset.src})`,
        maskImage: `url(${asset.src})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        filter: `drop-shadow(0 3px 10px ${tint}80)`,
      }}
    />
  </span>
);

const HOST_ID = 'host-local';

/**
 * Ceiling on players minted from traffic alone. Presence caps the real room at
 * MAX_PLAYERS; this only stops a peer that spams fresh ids from growing the
 * roster without bound, so it sits above the roster size rather than at it.
 */
const MAX_REMOTE_PLAYERS = 8;
/**
 * How long a player minted from traffic outlives a roster that has not caught
 * up with them. Long enough to cover a presence re-track after a drop, short
 * enough that someone who genuinely left gives their slot colour back.
 */
const PROVISIONAL_GRACE_MS = 15000;

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

  /**
   * What the owner has switched on. The defaults resolve synchronously (see
   * src/config/flags.ts), so the AI button and the stamp tool are absent on the
   * first frame rather than appearing and then being taken away.
   */
  const flags = useFlags();

  // Guarded on the room it last reported rather than a "first run" flag:
  // StrictMode mounts effects twice in development, and one arrival is one
  // arrival.
  const enteredRoom = useRef<string | null>(null);
  useEffect(() => {
    if (enteredRoom.current === (roomId ?? null)) return;
    enteredRoom.current = roomId ?? null;
    track('room.enter', { role: 'studio' }, roomId);
  }, [roomId]);

  const paintSurface = useMemo(() => new PaintSurface(CANVAS_RES), []);
  const orbitRef = useRef<any>(null);

  const [objectId, setObjectId] = useState<TargetObjectType>('skateboard');
  const objectIdRef = useRef(objectId);
  useEffect(() => {
    objectIdRef.current = objectId;
  }, [objectId]);
  /**
   * Guards state responses: a peer that just (re)connected and still sits on
   * defaults must not answer a state request and downgrade the room. It earns
   * the right to answer by learning the room (applied state, changed object,
   * painted) — or by incumbency, 8s connected with nobody contradicting it.
   */
  const roomStateKnown = useRef(false);
  const connectedAt = useRef(Date.now());
  const canAnswerState = () =>
    roomStateKnown.current || Date.now() - connectedAt.current > 8000;
  const [finish, setFinish] = useState<Finish>('original');
  const [objectLoading, setObjectLoading] = useState(true);

  const [hostTool, setHostTool] = useState<'spray' | 'brush'>('spray');
  const [hostColor, setHostColor] = useState('#FF4D1C');
  const [hostSize, setHostSize] = useState(1);
  const [stageMode, setStageMode] = useState<'paint' | 'stamp' | 'orbit'>('paint');

  /* ------------------------------ stamps ------------------------------ */

  const [stampLibrary, setStampLibrary] = useState<StampLibrary>(() => loadStampLibrary());
  // Mirrored so the mutating helpers (which also write localStorage) run once
  // per action rather than once per React updater invocation.
  const libraryRef = useRef(stampLibrary);
  const updateLibrary = useCallback((next: (library: StampLibrary) => StampLibrary) => {
    libraryRef.current = next(libraryRef.current);
    setStampLibrary(libraryRef.current);
  }, []);

  const [selectedStamp, setSelectedStamp] = useState<StampAsset | null>(BUILTIN_STAMPS[0]);
  const [stampRotationDeg, setStampRotationDeg] = useState(0);
  const [stampRandomise, setStampRandomise] = useState(true);
  const [stampBusy, setStampBusy] = useState(false);
  const [stampError, setStampError] = useState<string | null>(null);
  const stampSeq = useRef(0);
  /** Set by `StampPlacer`: the UV under the middle of the live frame. */
  const pickCentreRef = useRef<(() => { u: number; v: number } | null) | null>(null);
  /** Read by the in-canvas tap listener, which is bound once. */
  const stampArmed = useRef(false);
  stampArmed.current = stageMode === 'stamp' && Boolean(selectedStamp);

  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [connection, setConnection] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'offline'
  >('connecting');

  const [objectSheet, setObjectSheet] = useState(false);
  /** Players whose gestures are allowed to rotate the studio camera. */
  const [cameraSyncIds, setCameraSyncIds] = useState<Set<string>>(new Set());
  const cameraSyncRef = useRef(cameraSyncIds);
  useEffect(() => {
    cameraSyncRef.current = cameraSyncIds;
  }, [cameraSyncIds]);
  const [inviteSheet, setInviteSheet] = useState(false);
  // Fresh studio from the landing page: put the invite QR front and centre so
  // the creator can hand phones in immediately. If the first-run guide is up,
  // the invite follows it once the guide closes.
  const location = useLocation();
  const pendingInvite = useRef<boolean>((location.state as any)?.justCreated === true);
  // First-run guide: shown once per browser, reopenable from the help button.
  const [guideOpen, setGuideOpen] = useState(() => {
    try {
      return localStorage.getItem('airo:guide:studio') !== '1';
    } catch {
      return true;
    }
  });
  const closeGuide = () => {
    setGuideOpen(false);
    try {
      localStorage.setItem('airo:guide:studio', '1');
    } catch {
      /* private mode */
    }
  };
  useEffect(() => {
    if (pendingInvite.current && !guideOpen) {
      pendingInvite.current = false;
      setInviteSheet(true);
      // Consume the navigation state so a refresh doesn't re-open the modal.
      window.history.replaceState({}, '');
    }
  }, [guideOpen]);
  /**
   * The owner's banner, dismissed per tab and keyed by its own text: changing
   * the notice makes it a new notice, so an announcement that matters is not
   * silenced by someone having waved away the last one.
   */
  const [noticeSeen, setNoticeSeen] = useState(() => {
    try {
      return sessionStorage.getItem('airo:notice:seen') ?? '';
    } catch {
      return '';
    }
  });
  const dismissNotice = () => {
    setNoticeSeen(flags.notice);
    try {
      sessionStorage.setItem('airo:notice:seen', flags.notice);
    } catch {
      /* private mode — it will be back on the next load */
    }
  };

  const [aiSheet, setAiSheet] = useState(false);
  const [uploadSheet, setUploadSheet] = useState(false);
  const [copied, setCopied] = useState(false);
  // Showcase: cinematic turntable video export of the painted piece.
  const [showcaseOpen, setShowcaseOpen] = useState(false);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Player roster. A ref mirrors it because the render loop mutates player
  // transforms every frame and must not trigger React re-renders.
  const [players, setPlayers] = useState<PlayerState[]>([makeHost('#FF4D1C')]);
  const playersRef = useRef<PlayerState[]>(players);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  /**
   * Resolves the sender of a packet, minting them if presence has not placed
   * them on the roster yet.
   *
   * Presence and broadcast are separate guarantees: a controller whose
   * `track` is still retrying — or whose sync simply has not landed here yet —
   * broadcasts motion, stamps and actions perfectly well. Dropping that
   * traffic is what produced "I can see them spraying but their remote never
   * shows up on my screen". The entry is provisional: the presence roster
   * overwrites the guessed name, colour and slot the moment it arrives.
   */
  const ensurePlayer = useCallback(
    (
      playerId: unknown,
      hints?: {
        name?: unknown;
        tool?: 'spray' | 'brush';
        color?: unknown;
        mode?: 'motion' | 'projection';
      }
    ): PlayerState | null => {
      if (typeof playerId !== 'string' || !playerId || playerId === HOST_ID) return null;
      const known = playersRef.current.find((p) => p.id === playerId);
      if (known) return known;
      const remotes = playersRef.current.filter((p) => !p.isHost);
      if (remotes.length >= MAX_REMOTE_PLAYERS) return null;
      const taken = new Set(remotes.map((p) => p.color));
      const player: PlayerState = {
        id: playerId,
        slot: remotes.length + 1,
        name: typeof hints?.name === 'string' && hints.name ? hints.name : `Player ${remotes.length + 1}`,
        color:
          (typeof hints?.color === 'string' && hints.color) ||
          SLOT_COLORS.find((c) => !taken.has(c)) ||
          SLOT_COLORS[remotes.length % SLOT_COLORS.length],
        tool: hints?.tool ?? 'spray',
        isPainting: false,
        cursorPx: { x: CANVAS_RES / 2, y: CANVAS_RES / 2 },
        worldPos: [0, 0, 6],
        pressure: 1,
        sizeMultiplier: 1,
        lastActive: Date.now(),
        mode: hints?.mode ?? 'motion',
      };
      // Written into the ref synchronously, not just queued through setState:
      // the packet that revealed this player is applied to the returned object
      // in this same tick, and a motion sample dropped here is a lost frame.
      playersRef.current = [...playersRef.current, player];
      setPlayers(playersRef.current);
      return player;
    },
    []
  );

  const [customGroup, setCustomGroup] = useState<THREE.Group | null>(null);
  const [customInfo, setCustomInfo] = useState<Uploaded3DModelInfo | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [aiTab, setAiTab] = useState<'style' | 'concept' | 'critique'>('style');
  const [stylePreset, setStylePreset] = useState('cyberpunk');
  const [aiPrompt, setAiPrompt] = useState('NEON OVERDRIVE');
  const [aiBusy, setAiBusy] = useState(false);
  /**
   * Colour an AI stencil is stamped in. Seeded from whatever palette the last
   * answer proposed and overridable by tapping a swatch; null means "whatever
   * the painter is holding".
   */
  const [aiTint, setAiTint] = useState<string | null>(null);
  const [styleResult, setStyleResult] = useState<any>(null);
  const [conceptResult, setConceptResult] = useState<any>(null);
  const [critiqueResult, setCritiqueResult] = useState<any>(null);

  const connectionRef = useRef<AiroConnection | null>(null);
  const controllerUrl = `${window.location.origin}/controller/${roomId}`;

  // Fold admin-uploaded models into the picker once the registry answers.
  const [, setCatalogTick] = useState(0);
  useEffect(() => {
    ensureCustomModels().then((count) => count > 0 && setCatalogTick((t) => t + 1));
  }, []);

  /**
   * Rebroadcasts stamps the studio painted (host pointer strokes and the paint
   * it derives for motion-aiming phones) so controllers' local textures track
   * the studio's. One batcher per painter identity, keyed with the tool+colour
   * the batch was painted with.
   */
  const stampBatchers = useRef(
    new Map<string, { batcher: StampBatcher; tool: 'spray' | 'brush'; color: string; strokeId: string }>()
  );
  /** One per mount: the first paint this studio put on the model. */
  const paintedOnce = useRef(false);
  const broadcastStamps = useCallback(
    (playerId: string, tool: 'spray' | 'brush', color: string, stamps: PaintStamp[], strokeId: string) => {
      roomStateKnown.current = true;
      if (!paintedOnce.current && stamps.length) {
        paintedOnce.current = true;
        track('paint.first', { role: 'studio' }, roomId);
      }
      let entry = stampBatchers.current.get(playerId);
      if (!entry || entry.tool !== tool || entry.color !== color || entry.strokeId !== strokeId) {
        entry?.batcher.dispose();
        const batcher = new StampBatcher((batch, state) => {
          connectionRef.current?.emit('paint-stamps', {
            playerId,
            tool,
            color,
            state,
            strokeId,
            stamps: packStamps(batch),
          } satisfies StampPacket as unknown as Record<string, unknown>);
        });
        entry = { batcher, tool, color, strokeId };
        stampBatchers.current.set(playerId, entry);
        entry.batcher.begin();
      }
      entry.batcher.push(stamps);
    },
    [roomId]
  );
  useEffect(
    () => () => {
      for (const { batcher } of stampBatchers.current.values()) batcher.dispose();
    },
    []
  );

  /** Applies `image-stamp` broadcasts, decode-serialised so order holds. */
  const applyImageStamp = useMemo(() => createStampApplier(paintSurface), [paintSurface]);

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

    conn.on('connection', ({ status }) => {
      setConnection(
        status === 'connected'
          ? 'connected'
          : status === 'reconnecting'
            ? 'reconnecting'
            : status === 'error'
              ? 'offline'
              : 'connecting'
      );
      if (status === 'connected') {
        connectedAt.current = Date.now();
        conn.emit('request-state', { playerId: HOST_ID });
      }
    });

    // A peer answered our state request: adopt the room's object and bake
    // their artwork in as our baseline.
    conn.on('canvas-state', ({ target, dataUrl, objectType }) => {
      if (target !== HOST_ID) return;
      roomStateKnown.current = true;
      if (objectType && objectType !== objectIdRef.current) {
        ensureCustomModels().finally(() => setObjectId(objectType));
      }
      if (typeof dataUrl === 'string' && dataUrl.length > 100) {
        const image = new Image();
        image.onload = () => {
          paintSurface.setBaseline(image);
          paintSurface.commit();
        };
        image.src = dataUrl;
      }
    });

    conn.on('player-list-update', (roster: any[]) => {
      setPlayers((prev) => {
        const host = prev.find((p) => p.isHost) ?? makeHost(hostColor);
        const next: PlayerState[] = [host];
        for (const entry of roster) {
          const existing = prev.find((p) => p.id === entry.id);
          next.push(
            existing
              ? {
                  ...existing,
                  slot: entry.slot,
                  name: entry.name,
                  color: entry.color,
                  mode: entry.mode,
                  tool: entry.tool ?? existing.tool,
                }
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
        // Players minted from traffic survive a roster that has not listed
        // them yet — evicting someone mid-stroke because their presence record
        // is a beat behind is the ghost bug all over again. They keep their own
        // slot number so a badge cannot be claimed twice, and age out through
        // the roster once they go quiet.
        const now = Date.now();
        for (const p of prev) {
          if (p.isHost || next.some((n) => n.id === p.id)) continue;
          if (now - p.lastActive < PROVISIONAL_GRACE_MS) next.push({ ...p, slot: next.length });
        }
        return next;
      });
    });

    // Motion arrives at ~30 Hz. Mutating the ref (rather than setState) keeps
    // it off the React render path; the scene reads it every frame anyway.
    conn.on('motion', ({ playerId, x, y }) => {
      if (typeof x !== 'number') return;
      const player = playersRef.current.find((p) => p.id === playerId) ?? ensurePlayer(playerId);
      if (!player) return;
      player.cursorPx.x = x * CANVAS_RES;
      player.cursorPx.y = y * CANVAS_RES;
      // Arrival-stamped for the scene's jitter-buffer interpolation — the
      // stamp must be taken here, at delivery, not when the frame loop reads.
      (player.cursorSamples ??= []).push({ x, y, at: performance.now() });
      if (player.cursorSamples.length > 60) {
        player.cursorSamples.splice(0, player.cursorSamples.length - 60);
      }
      player.lastActive = Date.now();
    });

    conn.on('action', ({ playerId, action, state, color, size }) => {
      const player =
        playersRef.current.find((p) => p.id === playerId) ??
        ensurePlayer(playerId, { tool: action, color });
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
      const player =
        playersRef.current.find((p) => p.id === playerId) ??
        ensurePlayer(playerId, { name: packet.playerName, tool, color, mode: 'projection' });
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
        paintSurface.applyStamps(unpackStamps(stamps), tool, color, packet.strokeId);
        paintSurface.commit();
      }
    });

    // A stamp placed anywhere in the room. UV-anchored, so it lands on the
    // same spot of the model here as it did on the peer that placed it.
    conn.on('image-stamp', (payload: ImageStampData) => {
      applyImageStamp(payload);
      sounds.playClick(1.35);
    });

    conn.on('redo-stroke', ({ strokeId }) => {
      if (strokeId && paintSurface.redoStroke(strokeId)) paintSurface.commit();
    });
    conn.on('undo-stroke', ({ strokeId }) => {
      if (strokeId && paintSurface.undoStroke(strokeId)) {
        paintSurface.commit();
        sounds.playWhoosh();
      }
    });

    // A phone's orbit gesture steers the studio camera — but only for players
    // the host has toggled on, so ten people can't fight over the view.
    conn.on('camera-sync', ({ playerId, azimuth, polar, distanceRatio }) => {
      if (!playerId || !cameraSyncRef.current.has(playerId)) return;
      const controls = orbitRef.current;
      if (!controls) return;
      controls.setAzimuthalAngle(azimuth);
      controls.setPolarAngle(polar);
      if (typeof distanceRatio === 'number') {
        const min = controls.minDistance || 1;
        const max = controls.maxDistance || min + 1;
        const dist = min + (max - min) * Math.min(Math.max(distanceRatio, 0), 1);
        const cam = controls.object as THREE.PerspectiveCamera;
        const dir = cam.position.clone().sub(controls.target).normalize().multiplyScalar(dist);
        cam.position.copy(controls.target).add(dir);
      }
      controls.update();
    });

    // Late joiners ask for the artwork as it stands; answer with a downscaled
    // snapshot they bake in as a baseline. Throttled per requester.
    const lastStateSend = new Map<string, number>();
    conn.on('request-state', ({ playerId }) => {
      if (!playerId) return;
      const now = Date.now();
      if (now - (lastStateSend.get(playerId) ?? 0) < 4000) return;
      lastStateSend.set(playerId, now);
      if (!canAnswerState()) return;
      const dataUrl = paintSurface.toSyncDataURL(1024);
      // The object choice always syncs; the artwork rides along when it is
      // non-trivial and within the broadcast size budget.
      const withArt = dataUrl.length >= 2000 && dataUrl.length <= 900000;
      conn.emit('canvas-state', {
        target: playerId,
        objectType: objectIdRef.current,
        ...(withArt ? { dataUrl } : {}),
      });
    });

    conn.on('change-object', ({ objectType }) => {
      roomStateKnown.current = true;
      if (objectType) ensureCustomModels().finally(() => setObjectId(objectType));
    });

    conn.on('settings', ({ playerId, color, tool, size, playerName }) => {
      ensurePlayer(playerId, { name: playerName, tool, color });
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
    // Legacy AI stencil broadcast. Peers on an older build still send a symbol
    // character; it is resolved to a real stencil and applied through the
    // image-stamp pipeline, so it lands as a proper undoable stamp rather than
    // as typeset text in the middle of the texture.
    conn.on('ai-stamp', ({ stencilSymbol, color, stampId }) => {
      const asset = stampForSymbol(stencilSymbol);
      stampPayload(asset)
        .then((img) =>
          applyImageStamp({
            img,
            u: AI_STAMP_UV.u,
            v: AI_STAMP_UV.v,
            radiusPx: stampRadiusPx(1.5),
            rotation: 0,
            tint: typeof color === 'string' ? color : '#FF4D1C',
            stampId: stampId || `ai#${Math.random().toString(36).slice(2, 9)}`,
          })
        )
        .catch((err) => console.error('[ai-stamp] could not prepare stencil', err));
      sounds.playWhoosh();
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
      // The roster as the render loop sees it, so verification can assert that
      // a peer who is sending traffic actually has a cursor here.
      (window as any).__airoPlayers = () =>
        playersRef.current.map((p) => ({
          id: p.id,
          isHost: !!p.isHost,
          isPainting: p.isPainting,
          x: p.cursorPx.x,
          y: p.cursorPx.y,
        }));
      // Samples the paint layer itself — no camera, no model, no shader — so
      // stamp/undo assertions can be made on what actually landed.
      (window as any).__airoPaintProbe = (u: number, v: number) =>
        paintSurface.samplePaint(u, v);
    }

    return () => {
      conn.disconnect();
      connectionRef.current = null;
      delete (window as any).__airoSim;
      delete (window as any).__airoPlayers;
      delete (window as any).__airoPaintProbe;
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

  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if (key === 'f') toggleFullscreen();
      if (key === 'b') setHostTool((t) => (t === 'spray' ? 'brush' : 'spray'));
      if (key === 'o') setStageMode((m) => (m === 'orbit' ? 'paint' : 'orbit'));
      // `getFlags()`, not the hook's value: this listener is bound once with
      // empty deps, so a captured flags object would be the one from mount.
      if (key === 's' && getFlags().ui.stamps) setStageMode((m) => (m === 'stamp' ? 'paint' : 'stamp'));
      if (key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
      }
      if (key === 'y' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        redoRef.current();
      }
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
      roomStateKnown.current = true;
      track('object.change', { objectId: next }, roomId);
      connectionRef.current?.emit('change-object', { objectType: next });
    },
    [roomId]
  );

  const handleHostColor = (hex: string) => {
    setHostColor(hex);
    setPlayers((prev) => prev.map((p) => (p.isHost ? { ...p, color: hex } : p)));
  };

  const clearCanvas = () => {
    paintSurface.clear();
    paintSurface.commit();
    sounds.playWhoosh();
    connectionRef.current?.emit('clear-canvas', {});
  };

  const undoLast = useCallback(() => {
    const strokeId = paintSurface.lastStrokeId();
    if (!strokeId) return;
    paintSurface.undoStroke(strokeId);
    paintSurface.commit();
    sounds.playClick(1.1);
    connectionRef.current?.emit('undo-stroke', { strokeId });
  }, [paintSurface]);
  undoRef.current = undoLast;

  const redoLast = useCallback(() => {
    const strokeId = paintSurface.redoStroke();
    if (!strokeId) return;
    paintSurface.commit();
    sounds.playClick(1.25);
    connectionRef.current?.emit('redo-stroke', { strokeId });
  }, [paintSurface]);
  redoRef.current = redoLast;

  /* ---------------------------- stamp actions ---------------------------- */

  /**
   * Places any stamp at a surface UV: applied here first so the studio never
   * waits on the network, then broadcast for every peer. The stamp id doubles
   * as its stroke id, which is what makes one placement one undoable unit
   * everywhere in the room.
   *
   * Everything that puts a stamp on the model goes through here — the tray, a
   * tap on the stage, and the AI copilot's suggestions — so all three converge
   * identically and undo the same way.
   */
  const placeStampAsset = async (
    asset: StampAsset,
    u: number,
    v: number,
    options: { tint?: string; sizeMultiplier?: number; rotation?: number } = {}
  ): Promise<boolean> => {
    const rotation =
      options.rotation ??
      (stampRandomise ? (Math.random() - 0.5) * 0.36 : (stampRotationDeg * Math.PI) / 180);
    const tint = asset.tintable ? options.tint || hostColor : null;
    const radiusPx = stampRadiusPx(options.sizeMultiplier ?? hostSize);
    const stampId = `${HOST_ID}#stamp${++stampSeq.current}`;

    try {
      const img = await stampPayload(asset);
      const image = await decodeStampImage(img);
      paintSurface.stampImage(image, u, v, radiusPx, rotation, tint, stampId);
      paintSurface.commit();
      sounds.playWhoosh();
      roomStateKnown.current = true;
      track('stamp.place', { builtin: asset.origin === 'builtin' }, roomId);
      updateLibrary((library) => markRecent(library, asset.id));
      connectionRef.current?.emit('image-stamp', {
        playerId: HOST_ID,
        stampId,
        img,
        u,
        v,
        radiusPx,
        rotation,
        ...(tint ? { tint } : {}),
      });
      return true;
    } catch (err) {
      console.error('[stamp] placement failed', err);
      setStampError('That stamp could not be prepared. Try another one.');
      return false;
    }
  };

  /** A tap on the stage places whatever the tray has selected. */
  const placeStamp = (u: number, v: number) => {
    if (selectedStamp) void placeStampAsset(selectedStamp, u, v);
  };

  const handleStampUpload = async (file: File) => {
    setStampBusy(true);
    setStampError(null);
    try {
      const asset = await stampFromFile(file);
      updateLibrary((library) => addUpload(library, asset));
      setSelectedStamp(asset);
      sounds.playClick(1.4);
    } catch (err: any) {
      setStampError(err?.message || 'Could not use that image as a stamp.');
    } finally {
      setStampBusy(false);
    }
  };

  const [replaying, setReplaying] = useState(false);
  const replayArtwork = async () => {
    if (paintSurface.isReplaying) return;
    setReplaying(true);
    sounds.playWhoosh();
    await paintSurface.replayTimelapse(4200);
    setReplaying(false);
  };

  const saveSnapshot = () => {
    sounds.playClick(1.6);
    track('snapshot.save', { objectId }, roomId);
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
    track('invite.copy', undefined, roomId);
    sounds.playClick(1.5);
    setTimeout(() => setCopied(false), 2000);
  };

  /* -------------------------------- AI -------------------------------- */

  const callAi = async (path: string, body: unknown) => {
    track('ai.run', { route: path }, roomId);
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
      setAiTint(paletteOf(data.accentColor, data.secondaryColor)[0] ?? null);
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
    sounds.playClick(1.3);
    try {
      const data = await callAi('graffiti-tag', { prompt: aiPrompt, style: 'wildstyle' });
      setConceptResult(data);
      setAiTint(paletteOf(data.recommendedPalette)[0] ?? null);
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

  /**
   * Puts an AI suggestion on the model.
   *
   * The old version typed the suggested character into the middle of the
   * texture at 260px and called it a stencil. It now resolves to one of the
   * shipped stencils and goes out as a normal `image-stamp`, so the studio,
   * every phone and the undo stack all agree about what just happened — and it
   * lands on the face of the model you are currently looking at.
   */
  const stampSuggestion = async (symbol: string | undefined, tint: string) => {
    const spot = pickCentreRef.current?.() ?? AI_STAMP_UV;
    const placed = await placeStampAsset(stampForSymbol(symbol), spot.u, spot.v, {
      tint,
      // Same size a hand-placed stamp gets: the tray's radius is already tuned
      // to sit inside a single UV chart on these atlased models.
      sizeMultiplier: hostSize,
      // A hand-placed stencil is never perfectly square to the object.
      rotation: (Math.random() - 0.5) * 0.28,
    });
    if (placed) setAiSheet(false);
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
  /** What an AI stencil would be stamped in right now. */
  const activeAiTint = aiTint || hostColor;

  const showcaseHandles: ShowcaseHandles = useMemo(
    () => ({
      getCanvas: () => glCanvasRef.current,
      getOrbit: () => orbitRef.current,
      roomId: roomId ?? 'studio',
    }),
    [roomId]
  );

  return (
    <div className="h-screen w-screen overflow-hidden stage-vignette text-white relative select-none">
      {/* ---------------------------- 3D stage ---------------------------- */}
      <Canvas
        dpr={[1, 2]}
        // No consumer reads this framebuffer back: Save exports the 2D paint
        // canvas and the showcase records via captureStream(), so neither
        // preserveDrawingBuffer nor shadow-map machinery earns its cost here.
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          glCanvasRef.current = gl.domElement;
        }}
        className={`absolute inset-0 ${
          stageMode === 'paint'
            ? 'cursor-crosshair'
            : stageMode === 'stamp'
              ? 'cursor-copy'
              : 'cursor-grab active:cursor-grabbing'
        }`}
      >
        <StampPlacer armedRef={stampArmed} onPlace={placeStamp} pickCentreRef={pickCentreRef} />
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

            <div className="flex-1 flex justify-center min-w-0 overflow-hidden px-1">
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
                onClick={() => {
                  setInviteSheet(true);
                  track('invite.open', undefined, roomId);
                }}
                className="tap glass glass-sheen splat-btn-2 rounded-full pl-2 pr-3 py-1.5 flex items-center gap-2"
                style={{ '--paint': 'rgba(34,211,238,0.34)' } as React.CSSProperties}
                title="Invite players"
              >
                <Users size={14} className="text-[var(--color-airo-aqua)]" />
                <div className="flex -space-x-1.5">
                  {[1, 2, 3, 4].map((slot) => {
                    const player = remotePlayers.find((p) => p.slot === slot);
                    const syncOn = player ? cameraSyncIds.has(player.id) : false;
                    return (
                      <span
                        key={slot}
                        className={`w-4 h-4 rounded-full border-2 ${
                          syncOn ? 'border-[var(--color-airo-aqua)]' : 'border-black/50'
                        } ${player?.isPainting ? 'airo-breathe' : ''}`}
                        style={{ background: player ? player.color : 'rgba(255,255,255,0.14)' }}
                      />
                    );
                  })}
                </div>
              </button>

              <GlassIconButton
                onClick={() => {
                  setGuideOpen(true);
                  track('guide.open', { role: 'studio' }, roomId);
                }}
                title="How it works"
                size={38}
              >
                <HelpCircle size={15} className="text-[var(--color-airo-aqua)]" />
              </GlassIconButton>
              <span className="hidden md:contents">
              {flags.ui.aiPanel && (
                <GlassIconButton
                  onClick={() => {
                    setAiSheet(true);
                    track('ai.open', undefined, roomId);
                  }}
                  title="AI copilot"
                  size={38}
                >
                  <Wand2 size={15} className="text-[var(--color-airo-violet)]" />
                </GlassIconButton>
              )}
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
              </span>
              <span className="hidden sm:contents">
              <GlassIconButton onClick={toggleFullscreen} title="Fullscreen (F)" size={38}>
                <Maximize size={15} />
              </GlassIconButton>
              </span>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* --------------------------- owner's notice --------------------------- */}
      {/* One line, under the top bar, over nothing that matters: the frame is
          click-through so an announcement can never cost somebody a brush
          stroke, and only the pill itself takes the pointer. */}
      <AnimatePresence>
        {!fullscreen && Boolean(flags.notice) && noticeSeen !== flags.notice && (
          <motion.div
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="absolute top-16 inset-x-0 z-30 flex justify-center pointer-events-none"
          >
            <GlassPill className="pointer-events-auto max-w-[min(92vw,640px)] pl-3 pr-1.5 py-1.5">
              <Megaphone size={12} className="shrink-0 text-[var(--color-airo-ember)]" />
              <span className="min-w-0 truncate text-[11px] font-medium text-white/80">
                {flags.notice}
              </span>
              <button
                type="button"
                onClick={dismissNotice}
                aria-label="Dismiss notice"
                className="tap grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
              >
                <X size={12} />
              </button>
            </GlassPill>
          </motion.div>
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
                  autoRotate ? 'splat-chip text-black' : 'text-white/70 hover:bg-white/12'
                }`}
                style={autoRotate ? ({ '--paint': '#22D3EE' } as React.CSSProperties) : undefined}
                title="Auto-rotate"
                aria-pressed={autoRotate}
              >
                <RefreshCw size={14} className={autoRotate ? 'animate-spin' : ''} />
              </button>
            </GlassPanel>

            {/* The stage-mode island. The active mode wears a spray splat
                rather than a solid chip, so the one piece of state on the left
                rail matches the dock's paint-stroke toggles. */}
            <GlassPanel radius="rounded-[22px]" className="p-1.5 flex flex-col gap-1">
              {(
                [
                  {
                    mode: 'paint',
                    icon: <MousePointer size={14} />,
                    title: 'Paint with pointer',
                    paint: '#FF4D1C',
                    ink: 'text-white',
                  },
                  {
                    mode: 'stamp',
                    icon: <StampIcon size={14} />,
                    title: 'Place stamps (S)',
                    paint: '#FFB020',
                    ink: 'text-black',
                  },
                  {
                    mode: 'orbit',
                    icon: <Hand size={14} />,
                    title: 'Orbit camera (O)',
                    paint: '#A78BFA',
                    ink: 'text-white',
                  },
                ] as const
              )
                .filter((entry) => entry.mode !== 'stamp' || flags.ui.stamps)
                .map((entry) => {
                  const active = stageMode === entry.mode;
                  return (
                    <button
                      key={entry.mode}
                      onClick={() => {
                        setStageMode(entry.mode);
                        sounds.playClick(1.2);
                      }}
                      className={`tap w-[52px] py-2 rounded-[15px] grid place-items-center ${
                        active ? `splat-chip ${entry.ink}` : 'text-white/70 hover:bg-white/12'
                      }`}
                      style={active ? ({ '--paint': entry.paint } as React.CSSProperties) : undefined}
                      title={entry.title}
                      aria-pressed={active}
                    >
                      {entry.icon}
                    </button>
                  );
                })}
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --------------------------- right feedback rail --------------------------- */}
      {/* The left island's mirror image. Feedback belongs on the studio screen
          — it is where a session actually goes wrong — but a fixed corner
          button would sit under the bottom dock, so it rides the free middle
          of the right edge and leaves with the rest of the furniture in
          fullscreen. */}
      <AnimatePresence>
        {!fullscreen && (
          <motion.div
            initial={{ x: 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 80, opacity: 0 }}
            className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 z-30"
          >
            <FeedbackButton variant="inline" roomId={roomId} />
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
            className="absolute bottom-0 inset-x-0 z-30 p-3 md:p-4 flex flex-col items-center gap-2 safe-bottom pointer-events-none"
          >
            {/* The stamp shelf docks directly above the bar so it can never
                cover it, and stays non-modal so the next tap reaches the
                model rather than a backdrop. */}
            <AnimatePresence>
              {stageMode === 'stamp' && (
                <StampTray
                  key="stamp-tray"
                  library={stampLibrary}
                  selectedId={selectedStamp?.id ?? null}
                  color={hostColor}
                  rotationDeg={stampRotationDeg}
                  randomise={stampRandomise}
                  busy={stampBusy}
                  error={stampError}
                  onSelect={(asset) => {
                    setSelectedStamp(asset);
                    setStampError(null);
                    sounds.playClick(1.3);
                  }}
                  onUpload={handleStampUpload}
                  onRemoveUpload={(asset) => {
                    updateLibrary((library) => removeUpload(library, asset.id));
                    if (selectedStamp?.id === asset.id) setSelectedStamp(BUILTIN_STAMPS[0]);
                    sounds.playClick(0.9);
                  }}
                  onRotate={(deg) => setStampRotationDeg(((deg % 360) + 360) % 360)}
                  onToggleRandom={() => setStampRandomise((v) => !v)}
                  onClose={() => setStageMode('paint')}
                />
              )}
            </AnimatePresence>

            {/* Wide enough that the third tool segment does not push the save
                button onto a second row on a laptop display. */}
            <GlassPanel className="px-3 py-2.5 flex items-center gap-2 md:gap-3 flex-wrap justify-center w-full md:w-auto max-w-[min(100%,1120px)] pointer-events-auto">
              {/* Row 1 on phones: tool + colour. */}
              <div className="flex items-center gap-2 w-full md:w-auto md:contents">
                <Segmented<'spray' | 'brush' | 'stamp'>
                  layoutId="host-tool"
                  paint
                  className="flex-1 md:flex-none"
                  value={stageMode === 'stamp' ? 'stamp' : hostTool}
                  onChange={(value) => {
                    sounds.playClick(1.2);
                    if (value === 'stamp') {
                      setStageMode('stamp');
                      return;
                    }
                    setHostTool(value);
                    if (stageMode !== 'paint') setStageMode('paint');
                  }}
                  options={[
                    { value: 'spray' as const, label: 'Spray', icon: <SprayCan size={13} />, accent: '#FF4D1C' },
                    { value: 'brush' as const, label: 'Brush', icon: <Brush size={13} />, accent: '#22D3EE' },
                    { value: 'stamp' as const, label: 'Stamp', icon: <StampIcon size={13} />, accent: '#FFB020' },
                  ].filter((option) => option.value !== 'stamp' || flags.ui.stamps)}
                />
                <ColorWell color={hostColor} onChange={handleHostColor} />
              </div>

              {/* Row 2 on phones: size + finish. */}
              <div className="flex items-center gap-2 w-full md:w-auto md:contents">
                <div className="flex items-center gap-2 px-1 md:px-2 flex-1 md:flex-none md:min-w-[130px]">
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
                  paint
                  value={finish}
                  onChange={(value) => {
                    setFinish(value);
                    sounds.playClick(1.1);
                  }}
                  options={[
                    { value: 'original', label: 'Textured', accent: '#22D3EE' },
                    { value: 'primer', label: 'Primer', accent: '#A78BFA' },
                  ]}
                />
              </div>

              <div className="w-px h-7 bg-white/12 hidden md:block" />

              <div className="flex items-center justify-center gap-2 w-full md:w-auto md:contents">
              <GlassIconButton onClick={undoLast} title="Undo last stroke (Ctrl+Z)" size={38}>
                <Undo2 size={15} />
              </GlassIconButton>
              <GlassIconButton onClick={redoLast} title="Redo undone stroke (Ctrl+Shift+Z)" size={38}>
                <Redo2 size={15} />
              </GlassIconButton>
              <GlassIconButton
                onClick={replayArtwork}
                title="Replay the artwork painting itself"
                size={38}
                disabled={replaying}
              >
                <History size={15} className={replaying ? 'animate-spin text-[var(--color-airo-aqua)]' : ''} />
              </GlassIconButton>
              <GlassIconButton onClick={() => sounds.playCanRattle()} title="Shake can" size={38}>
                <Sparkles size={15} className="text-[var(--color-airo-ember)]" />
              </GlassIconButton>
              <GlassIconButton onClick={clearCanvas} title="Clear paint" size={38}>
                <Trash2 size={15} />
              </GlassIconButton>
              {flags.ui.showcase && (
                <GlassIconButton
                  onClick={() => setShowcaseOpen(true)}
                  title="Showcase — record a turntable video of your piece"
                  size={38}
                >
                  <Clapperboard size={15} className="text-[var(--color-airo-aqua)]" />
                </GlassIconButton>
              )}
              <button
                onClick={saveSnapshot}
                className="tap rounded-full px-4 py-2 bg-gradient-to-r from-[#FF4D1C] to-[#FF7A34] text-white text-[11px] font-bold tracking-wide flex items-center gap-1.5 shadow-[0_8px_24px_-6px_rgba(255,77,28,0.75)]"
              >
                <Download size={14} />
                <span>Save</span>
              </button>
              </div>
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --------------------------- status readouts --------------------------- */}
      {/* On phones the stamp shelf occupies the space these pills sit in, so
          they stand down until it closes. */}
      <div
        className={`absolute right-3 md:right-4 bottom-48 md:bottom-28 z-20 flex-col items-end gap-2 pointer-events-none ${
          stageMode === 'stamp' ? 'hidden md:flex' : 'flex'
        }`}
      >
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
          ) : connection === 'reconnecting' ? (
            <>
              <RefreshCw size={12} className="animate-spin text-amber-400" />
              <span className="text-amber-300">Reconnecting…</span>
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

      <WelcomeGuide open={guideOpen} onClose={closeGuide} role="studio" />

      <ObjectPickerSheet
        open={objectSheet}
        onClose={() => setObjectSheet(false)}
        objectId={objectId}
        onSelect={changeObject}
        onUpload={flags.ui.uploads ? () => setUploadSheet(true) : undefined}
        customName={customInfo?.name}
      />

      <ShowcasePanel
        open={showcaseOpen && flags.ui.showcase}
        onClose={() => setShowcaseOpen(false)}
        handles={showcaseHandles}
      />

      <Sheet
        open={inviteSheet}
        onClose={() => setInviteSheet(false)}
        centered
        title="Invite players"
        subtitle="Up to four phones can join this studio"
      >
        <div className="relative mx-auto mb-3 w-fit">
          <div
            className="absolute -inset-4 splatter-accent opacity-70 pointer-events-none"
            style={{ '--paint': '#22D3EE' } as React.CSSProperties}
          />
          <div className="relative bg-white rounded-[26px] p-5 grid place-items-center shadow-[0_28px_90px_-28px_rgba(34,211,238,0.5)]">
            <QRCodeSVG
              value={controllerUrl}
              size={Math.min(258, Math.floor(window.innerWidth * 0.56))}
            />
          </div>
        </div>

        <p className="text-[11.5px] text-white/60 text-center mb-1.5">
          Scan with a phone camera to turn it into a spray can.
        </p>
        <div className="text-center mb-4">
          <span className="label-caps text-white/40">Room code</span>
          <div
            className="paint-title text-3xl font-black tracking-[0.34em] mt-0.5 pl-[0.34em]"
            aria-label={`Room code ${roomId}`}
          >
            {roomId}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {[1, 2, 3, 4].map((slot) => {
            const player = remotePlayers.find((p) => p.slot === slot);
            const syncOn = player ? cameraSyncIds.has(player.id) : false;
            return (
              <div
                key={slot}
                className={`rounded-2xl px-3 py-2.5 border flex items-center gap-2 text-[11px] ${
                  player ? 'bg-white/[0.1] border-white/25' : 'bg-white/[0.03] border-dashed border-white/15 text-white/40'
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${player ? 'airo-breathe' : ''}`}
                  style={{ background: player ? player.color : 'rgba(255,255,255,0.2)' }}
                />
                <span className="font-semibold truncate flex-1">
                  {player ? player.name : `Slot ${slot} open`}
                </span>
                {player && (
                  <button
                    onClick={() => {
                      setCameraSyncIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(player.id)) next.delete(player.id);
                        else next.add(player.id);
                        return next;
                      });
                      sounds.playClick(1.1);
                    }}
                    title={
                      syncOn
                        ? 'This player is steering the studio camera — click to stop'
                        : "Let this player's gestures rotate the studio camera"
                    }
                    className={`tap shrink-0 rounded-lg px-1.5 py-1 border text-[9px] font-bold flex items-center gap-1 ${
                      syncOn
                        ? 'bg-[var(--color-airo-aqua)]/25 border-[var(--color-airo-aqua)]/50 text-[var(--color-airo-aqua)]'
                        : 'bg-white/[0.06] border-white/15 text-white/50'
                    }`}
                  >
                    <Video size={10} />
                    CAM
                  </button>
                )}
              </div>
            );
          })}
        </div>

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
        open={uploadSheet && flags.ui.uploads}
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
        open={aiSheet && flags.ui.aiPanel}
        onClose={() => setAiSheet(false)}
        centered
        wide
        title="AI copilot"
        subtitle="Restyle the piece, sketch a concept, or have it appraised"
      >
        <div className="mb-4">
          <Segmented<'style' | 'concept' | 'critique'>
            layoutId="ai-tabs"
            paint
            value={aiTab}
            onChange={(next) => {
              setAiTab(next);
              sounds.playClick(1.15);
            }}
            options={[
              { value: 'style', label: 'Style', icon: <Palette size={12} />, accent: '#A78BFA' },
              { value: 'concept', label: 'Concept', icon: <Sparkles size={12} />, accent: '#E879F9' },
              { value: 'critique', label: 'Appraise', icon: <Eye size={12} />, accent: '#22D3EE' },
            ]}
          />
        </div>

        {aiTab === 'style' && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3.5">
              {STYLE_PRESETS.map((preset) => (
                <PresetCard
                  key={preset.id}
                  preset={preset}
                  selected={stylePreset === preset.id}
                  onSelect={() => {
                    setStylePreset(preset.id);
                    sounds.playClick(1.15);
                  }}
                />
              ))}
            </div>

            <label className="label-caps mb-1.5 block text-white/35" htmlFor="ai-style-theme">
              Theme words
            </label>
            <input
              id="ai-style-theme"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. TOKYO OVERDRIVE"
              className="mb-3.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[12px] placeholder-white/25 focus:border-[var(--color-airo-violet)] focus:outline-none"
            />

            <button
              onClick={applyStyle}
              disabled={aiBusy}
              className="paint-btn paint-cta tap flex w-full items-center justify-center gap-2 px-6 py-3.5 text-[12.5px] font-bold tracking-wide text-white disabled:opacity-50"
              style={{ '--paint': AI_PAINT } as React.CSSProperties}
            >
              {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {aiBusy ? 'Styling…' : 'Apply style'}
            </button>

            {styleResult &&
              (styleResult.error ? (
                <ResultNote>{styleResult.error}</ResultNote>
              ) : (
                <div className="mt-3.5 rounded-2xl border border-white/12 bg-white/[0.05] p-4">
                  <div className="label-caps text-white/35">{styleResult.vibe || 'Applied'}</div>
                  <h3 className="mt-0.5 truncate text-[15px] font-black tracking-tight">
                    {styleResult.transformedTitle}
                  </h3>
                  <p className="mt-1.5 text-[11px] italic leading-relaxed text-white/55">
                    “{styleResult.curatorNotes}”
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                    <div className="flex items-center gap-2.5">
                      <StencilPreview
                        asset={stampForSymbol(styleResult.stencilSymbol)}
                        tint={activeAiTint}
                        size={40}
                      />
                      <div>
                        <div className="label-caps mb-1.5 text-white/30">Palette</div>
                        <PaletteRow
                          colors={paletteOf(styleResult.accentColor, styleResult.secondaryColor)}
                          active={activeAiTint}
                          onPick={setAiTint}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => stampSuggestion(styleResult.stencilSymbol, activeAiTint)}
                      className="tap glass glass-sheen flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] font-bold text-white/85 hover:text-white"
                    >
                      <StampIcon size={12} style={{ color: activeAiTint }} />
                      Stamp its mark
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}

        {aiTab === 'concept' && (
          <div>
            <div className="mb-3.5 flex gap-2">
              <input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="A word to build a piece around, e.g. PHANTOM"
                className="min-w-0 flex-1 rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[12px] placeholder-white/25 focus:border-[var(--color-airo-violet)] focus:outline-none"
              />
              <button
                onClick={generateConcept}
                disabled={aiBusy}
                className="paint-btn paint-btn-2 paint-cta tap flex shrink-0 items-center gap-1.5 px-5 text-[11px] font-bold text-white disabled:opacity-50"
                style={{ '--paint': AI_PAINT } as React.CSSProperties}
              >
                {aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Generate
              </button>
            </div>

            {conceptResult &&
              (conceptResult.error ? (
                <ResultNote>{conceptResult.error}</ResultNote>
              ) : (
                <div
                  className="splatter-accent relative overflow-hidden rounded-2xl border border-white/12 bg-white/[0.05] p-4"
                  style={{ '--paint': activeAiTint } as React.CSSProperties}
                >
                  <div className="relative z-10 flex items-start gap-3">
                    <StencilPreview
                      asset={stampForSymbol(conceptResult.stencilSymbol)}
                      tint={activeAiTint}
                      size={64}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="label-caps truncate text-white/35">
                        {conceptResult.tagLine || conceptResult.title}
                      </div>
                      <h3 className="truncate text-[19px] font-black uppercase leading-tight tracking-tight">
                        {conceptResult.graffitiText}
                      </h3>
                      <p className="mt-1 text-[10.5px] italic leading-snug text-white/50">
                        {conceptResult.styleNotes}
                      </p>
                    </div>
                  </div>

                  <div className="relative z-10 mt-3.5 border-t border-white/10 pt-3">
                    <div className="label-caps mb-2 text-white/30">Suggested palette</div>
                    <PaletteRow
                      colors={paletteOf(conceptResult.recommendedPalette)}
                      active={activeAiTint}
                      onPick={setAiTint}
                    />
                  </div>

                  <button
                    onClick={() => stampSuggestion(conceptResult.stencilSymbol, activeAiTint)}
                    className="paint-btn paint-cta tap relative z-10 mt-4 flex w-full items-center justify-center gap-2 px-5 py-3 text-[12px] font-bold text-white"
                    style={
                      {
                        '--paint': `linear-gradient(120deg, ${activeAiTint}, ${activeAiTint}c0)`,
                      } as React.CSSProperties
                    }
                  >
                    <StampIcon size={14} />
                    Stamp it on the {activeObject?.label ?? 'object'}
                  </button>
                  <p className="relative z-10 mt-2 text-center text-[9.5px] text-white/35">
                    Placed as a real stencil, shared with every phone, undoable with Ctrl+Z.
                  </p>
                </div>
              ))}
          </div>
        )}

        {aiTab === 'critique' && (
          <div>
            <p className="mb-3.5 text-[11.5px] leading-relaxed text-white/55">
              A gallery-style appraisal of the piece currently on the{' '}
              {activeObject?.label ?? 'object'}.
            </p>
            <button
              onClick={generateCritique}
              disabled={aiBusy}
              className="paint-btn paint-cta tap flex w-full items-center justify-center gap-2 px-6 py-3.5 text-[12.5px] font-bold tracking-wide text-white disabled:opacity-50"
              style={{ '--paint': AI_PAINT } as React.CSSProperties}
            >
              {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              {aiBusy ? 'Appraising…' : 'Appraise artwork'}
            </button>

            {critiqueResult &&
              (critiqueResult.error ? (
                <ResultNote>{critiqueResult.error}</ResultNote>
              ) : (
                <div className="mt-3.5 rounded-2xl border border-white/12 bg-white/[0.05] p-4">
                  <div className="label-caps text-white/35">
                    {critiqueResult.auctionHouse || 'Curator'}
                  </div>
                  <h3 className="mt-0.5 text-[16px] font-black leading-tight tracking-tight">
                    {critiqueResult.exhibitionTitle}
                  </h3>
                  <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/65">
                    “{critiqueResult.curatorCritique}”
                  </p>
                  <div className="mt-3.5 flex items-center justify-between border-t border-white/10 pt-3">
                    <span className="label-caps text-white/35">Estimate</span>
                    <span className="font-mono text-[14px] font-bold text-emerald-300">
                      {critiqueResult.estimatedValue}
                    </span>
                  </div>
                  {Array.isArray(critiqueResult.vibeTags) && critiqueResult.vibeTags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {critiqueResult.vibeTags.map((tag: string) => (
                        <span
                          key={tag}
                          className="glass rounded-full px-2.5 py-1 text-[9.5px] font-semibold text-white/60"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
