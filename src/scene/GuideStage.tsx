/**
 * GuideStage — the "try it right here" playground for the marketing guide.
 *
 * One real catalog object, the studio's real paint pipeline, and nothing else:
 * no room, no peers, no Supabase, no audio. A visitor drags on the object and
 * aerosol lands on the actual surface, because this drives the same
 * `SurfacePainter` -> `PaintSurface` -> `PaintTarget` chain the studio does
 * (`StudioScene` is the reference implementation — the host branch of its
 * frame loop is what this component is a single-player distillation of).
 *
 * Three things this widget must do that the studio does not, because it lives
 * inside a long scrolling page rather than owning the viewport:
 *
 *  - **Never scroll-jack.** A bare wheel over the stage belongs to the page,
 *    so it is stopped before OrbitControls' own canvas listener sees it and
 *    zoom needs an explicit ctrl/meta. On touch the canvas is held at
 *    `touch-action: pan-y` (OrbitControls forces `none` whenever it connects,
 *    so that gets re-asserted) — a vertical swipe always scrolls the page.
 *  - **Not burn a GPU it cannot be seen on.** The frame loop is parked while
 *    the widget is off screen.
 *  - **Invite the first drag.** Until someone touches it the object turns
 *    slowly on its own, and a one-line hint sits under it; the first
 *    interaction stops the attract loop for good.
 *
 * Safe to `React.lazy(() => import('../scene/GuideStage'))` — everything it
 * needs is imported here and there is no module-level side effect.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Eraser, Orbit, SprayCan } from 'lucide-react';
import { PaintSurface } from '../paint/PaintSurface';
import { SurfacePainter } from './SurfacePainter';
import { PaintTarget } from './PaintTarget';
import { StudioEnvironment } from './StudioEnvironment';
import { useFitCamera } from './useFitCamera';
import { OBJECT_BY_ID } from '../paint/objectCatalog';
import { TargetObjectType } from '../types';

/**
 * The four player-slot colours (mirrors `SLOT_COLORS` in `net/realtime`, which
 * is not imported here so the guide chunk never pulls in the Supabase client)
 * plus the ember accent, because five swatches balance the bar better than
 * four and ember is the palette's warm mid.
 */
const PALETTE = ['#FF4D1C', '#22D3EE', '#A78BFA', '#34D399', '#FFB020'] as const;

const MODE_ACCENT = { spray: '#FF4D1C', rotate: '#22D3EE' } as const;

/**
 * The one stroke setting the widget exposes no control for. A shade wider than
 * the studio's default: a visitor gets one drag to be impressed, and a hairline
 * does not read as spray paint from across a marketing page.
 */
const GUIDE_STROKE = { tool: 'spray', size: 1.25 } as const;

type StageMode = 'spray' | 'rotate';

export interface GuideStageProps {
  /**
   * Which catalog object to load — any id in `PAINTABLE_OBJECTS`. Defaults to
   * the skate deck ('skateboard'; the catalog's short label for it is "Deck").
   * The upload ids ('custom3d', `up-…`) have no asset of their own and render
   * an empty stage here.
   */
  objectId?: TargetObjectType;
  /**
   * Sizes the widget — the stage fills it. Pass a height; without one the
   * component falls back to a 28rem-tall full-width box.
   */
  className?: string;
}

/* ------------------------------------------------------------------
   Hooks
   ------------------------------------------------------------------ */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------
   The 3D half
   ------------------------------------------------------------------ */

interface GuideSceneProps {
  objectId: TargetObjectType;
  paintSurface: PaintSurface;
  /** True in Spray mode: a one-finger / left-button drag paints. */
  painting: boolean;
  color: string;
  autoRotate: boolean;
  orbitRef: React.RefObject<any>;
  onInteract: () => void;
  onFirstPaint: () => void;
  onLoadingChange: (loading: boolean) => void;
}

const GuideScene: React.FC<GuideSceneProps> = ({
  objectId,
  paintSurface,
  painting,
  color,
  autoRotate,
  orbitRef,
  onInteract,
  onFirstPaint,
  onLoadingChange,
}) => {
  const { camera, gl, size } = useThree();
  const meshRegistry = useRef<THREE.Object3D[]>([]);
  const [subjectRadius, setSubjectRadius] = useState<number | null>(null);
  // Tighter than the studio's default margin: `useFitCamera` frames the
  // subject's bounding *sphere*, and in a short wide widget box the vertical
  // field of view is what binds — extra margin on top of that just pushes a
  // flat object like the deck into the middle distance.
  useFitCamera(subjectRadius, orbitRef, 1.06);

  // The painter outlives every render, so it must dereference the CURRENT
  // default camera through a ref. Capturing `camera` in its construction
  // closure pins it to r3f's initial default camera and every raycast lands
  // offset toward the screen centre — the paint-offset bug documented in
  // StudioScene.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const painter = useMemo(
    () =>
      new SurfacePainter(
        () => meshRegistry.current,
        () => cameraRef.current,
        () => sizeRef.current.height
      ),
    []
  );

  // Texel-density caches are keyed per mesh; they go stale when the object swaps.
  useEffect(() => {
    painter.invalidate();
  }, [painter, objectId]);

  /* --------------------------- stroke state --------------------------- */

  // Everything the frame loop touches is preallocated here and mutated in
  // place; the loop itself allocates nothing of its own.
  const pointerNdc = useRef(new THREE.Vector2(0, 0));
  const dragging = useRef(false);
  const activePointers = useRef(new Set<number>());
  const gestureLock = useRef(false);
  const strokeSeq = useRef(0);
  const strokeId = useRef('guide#0');
  const hasPainted = useRef(false);

  const paintingRef = useRef(painting);
  paintingRef.current = painting;
  const colorRef = useRef(color);
  colorRef.current = color;
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const onFirstPaintRef = useRef(onFirstPaint);
  onFirstPaintRef.current = onFirstPaint;

  /* ---------------------------- pointer ---------------------------- */

  useEffect(() => {
    const canvas = gl.domElement;

    const toNdc = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerNdc.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
    };

    const endStroke = () => {
      if (!dragging.current) return;
      dragging.current = false;
      painter.end();
    };

    const onDown = (event: PointerEvent) => {
      onInteractRef.current();
      activePointers.current.add(event.pointerId);
      // A second finger means "gesture": abort the stroke and let the orbit
      // controls' two-finger rotate/pinch take over. No stroke restarts until
      // every finger lifts.
      if (activePointers.current.size > 1) {
        endStroke();
        gestureLock.current = true;
        return;
      }
      if (!paintingRef.current || gestureLock.current || event.button !== 0) return;
      toNdc(event);
      dragging.current = true;
      // Mint the id here, where the stroke begins, so each drag is its own
      // undoable entry in the paint log rather than all of them sharing one.
      strokeId.current = `guide#${++strokeSeq.current}`;
      painter.begin(GUIDE_STROKE);
    };

    const onMove = (event: PointerEvent) => {
      toNdc(event);
    };

    const onUp = (event: PointerEvent) => {
      activePointers.current.delete(event.pointerId);
      if (activePointers.current.size === 0) gestureLock.current = false;
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
      painter.end();
    };
  }, [gl, painter]);

  // OrbitControls sets `touch-action: none` on the canvas every time it
  // connects — and it reconnects whenever its camera identity changes — which
  // would trap a page scroll that begins on the widget. Hold it at `pan-y`:
  // a vertical swipe scrolls the page, while a drag that starts sideways is
  // claimed by the stage and can then travel in any direction.
  useEffect(() => {
    const canvas = gl.domElement;
    const assert = () => {
      if (canvas.style.touchAction !== 'pan-y') canvas.style.touchAction = 'pan-y';
    };
    assert();
    const observer = new MutationObserver(assert);
    observer.observe(canvas, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, [gl]);

  /* ----------------------------- frame ----------------------------- */

  useFrame((_, delta) => {
    const paintingNow = paintingRef.current && dragging.current;

    if (paintingNow && !painter.isActive) painter.begin(GUIDE_STROKE);
    else if (!paintingNow && painter.isActive) painter.end();

    // Only step the painter while a stroke is live. Idle, `frame()` would fire
    // a raycast per frame purely to place a tool cursor this widget does not
    // draw, and drips are cleared by `end()` anyway.
    if (paintingNow) {
      const result = painter.frame(pointerNdc.current.x, pointerNdc.current.y, true, delta);
      if (result.stamps.length > 0) {
        paintSurface.applyStamps(result.stamps, 'spray', colorRef.current, strokeId.current);
        if (!hasPainted.current) {
          hasPainted.current = true;
          onFirstPaintRef.current();
        }
      }
    }

    // At most one texture upload per frame, never one per dab.
    paintSurface.commit();
  });

  return (
    <>
      <OrbitControls
        ref={orbitRef}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        autoRotate={autoRotate}
        autoRotateSpeed={0.85}
        maxPolarAngle={Math.PI / 2 + 0.24}
        target={[0, 0, 0]}
        // While spraying, left-drag paints and right-drag orbits.
        mouseButtons={
          painting
            ? { LEFT: undefined as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
            : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
        }
        // One finger paints in Spray mode; two fingers always rotate and
        // pinch, in either mode, with no toggle to find first.
        touches={
          painting
            ? { ONE: undefined as any, TWO: THREE.TOUCH.DOLLY_ROTATE }
            : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }
        }
      />

      <StudioEnvironment intensity={0.62} />
      <ambientLight intensity={0.38} />
      {/* Pure illuminators — nothing here casts a shadow map. */}
      <directionalLight position={[9, 14, 10]} intensity={2.0} />
      <directionalLight position={[-11, 5, -6]} intensity={0.7} color="#7dd3fc" />
      <spotLight position={[0, 10, 13]} angle={0.7} penumbra={0.85} intensity={1.2} color="#fff6ec" />

      <PaintTarget
        objectId={objectId}
        paintTexture={paintSurface.texture}
        // Primer washes the model's own texture to a flat off-white, so the
        // first stroke a visitor lays reads unmistakably as *their* paint.
        finish="primer"
        meshRegistry={meshRegistry}
        onLoadedChange={onLoadingChange}
        onRadiusChange={setSubjectRadius}
      />
    </>
  );
};

/* ------------------------------------------------------------------
   The widget
   ------------------------------------------------------------------ */

export function GuideStage({
  objectId = 'skateboard',
  className,
}: GuideStageProps): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<any>(null);

  const [mode, setMode] = useState<StageMode>('spray');
  const [color, setColor] = useState<string>(PALETTE[0]);
  const [loading, setLoading] = useState(true);
  const [interacted, setInteracted] = useState(false);
  const [painted, setPainted] = useState(false);
  const [onScreen, setOnScreen] = useState(true);

  const reducedMotion = usePrefersReducedMotion();

  // One surface per mounted widget. The studio's own surface is a separate
  // instance; nothing is shared but the model cache.
  const paintSurface = useMemo(() => new PaintSurface(), []);
  useEffect(
    () => () => {
      paintSurface.clear();
      paintSurface.texture.dispose();
    },
    [paintSurface]
  );

  // `PaintTarget` re-runs its load effect when these change identity, so they
  // have to be stable for the lifetime of the widget.
  const handleLoading = useCallback((value: boolean) => setLoading(value), []);
  const markInteracted = useCallback(() => setInteracted(true), []);
  const markPainted = useCallback(() => setPainted(true), []);

  /* A bare wheel belongs to the page. Stop it in the capture phase on the
     wrapper — above the canvas OrbitControls listens on — so the widget never
     eats a scroll; ctrl/meta+wheel still falls through and dollies. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.stopPropagation();
    };
    el.addEventListener('wheel', onWheel, { capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  /* Park the render loop while the widget is scrolled away. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '200px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* Debug hooks, same shape as the studio's, so `verify-guide-stage.mjs` can
     assert what actually landed on the paint layer without a camera or a
     shader in the way. */
  useEffect(() => {
    const w = window as any;
    w.__airoPaintProbe = (u: number, v: number) => paintSurface.samplePaint(u, v);
    w.__airoGuideStage = () => ({
      strokeId: paintSurface.lastStrokeId(),
      /** Orbit azimuth, so a test can tell attract-rotation from a still stage. */
      azimuth: orbitRef.current?.getAzimuthalAngle?.() ?? null,
    });
    return () => {
      delete w.__airoPaintProbe;
      delete w.__airoGuideStage;
    };
  }, [paintSurface]);

  const object = OBJECT_BY_ID.get(objectId);
  const spraying = mode === 'spray';
  const attract = !interacted && !reducedMotion;

  // No `commit()` here: the frame loop is the only place that uploads, and it
  // will pick the wipe up on its very next tick.
  const clear = useCallback(() => {
    markInteracted();
    paintSurface.clear();
  }, [markInteracted, paintSurface]);

  return (
    <div
      ref={wrapRef}
      className={`relative isolate select-none overflow-hidden ${className ?? 'h-[28rem] w-full'}`}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 45, position: [0, 1.5, 17], near: 0.1, far: 200 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        frameloop={onScreen ? 'always' : 'never'}
        className={`absolute inset-0 ${
          spraying ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        }`}
      >
        <Suspense fallback={null}>
          <GuideScene
            objectId={objectId}
            paintSurface={paintSurface}
            painting={spraying}
            color={color}
            autoRotate={attract}
            orbitRef={orbitRef}
            onInteract={markInteracted}
            onFirstPaint={markPainted}
            onLoadingChange={handleLoading}
          />
        </Suspense>
      </Canvas>

      {/* ------------------------------ overlay ------------------------------ */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-4">
        {/* Top row: what you are looking at, and how a drag behaves. */}
        <div className="flex items-start justify-between gap-3">
          <div className="glass glass-sheen pointer-events-none flex items-center gap-2 rounded-full px-3 py-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: color, boxShadow: `0 0 10px ${color}` }}
            />
            <span className="label-caps text-white/70">{object?.label ?? 'Object'}</span>
          </div>

          <div className="segmented pointer-events-auto" role="group" aria-label="Drag behaviour">
            {(['spray', 'rotate'] as const).map((value) => {
              const active = mode === value;
              const accent = MODE_ACCENT[value];
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    markInteracted();
                    setMode(value);
                  }}
                  aria-pressed={active}
                  className={`tap label-caps flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
                    active ? 'text-white' : 'text-white/45 hover:text-white/75'
                  }`}
                  style={
                    active
                      ? {
                          background: `${accent}2e`,
                          boxShadow: `inset 0 0 0 1px ${accent}80, 0 0 18px -6px ${accent}`,
                        }
                      : undefined
                  }
                >
                  {value === 'spray' ? <SprayCan size={13} /> : <Orbit size={13} />}
                  {value === 'spray' ? 'Spray' : 'Rotate'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom: the hint, then the paint bar. */}
        <div className="flex flex-col items-center gap-2.5">
          <span
            aria-hidden={painted}
            className={`glass pointer-events-none rounded-full px-3 py-1 text-[12.5px] text-white/60 transition-opacity duration-500 ${
              painted || loading ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {spraying ? 'Drag to spray' : 'Drag to spin it around'}
          </span>

          <div className="glass glass-sheen pointer-events-auto flex items-center gap-2.5 rounded-full px-3 py-2">
            <div className="flex items-center gap-1.5" role="group" aria-label="Paint colour">
              {PALETTE.map((swatch) => {
                const active = color === swatch;
                return (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => {
                      markInteracted();
                      setColor(swatch);
                      if (mode !== 'spray') setMode('spray');
                    }}
                    aria-pressed={active}
                    aria-label={`Paint in ${swatch}`}
                    className="tap h-7 w-7 rounded-full border"
                    style={{
                      background: swatch,
                      borderColor: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.22)',
                      transform: active ? 'scale(1.1)' : undefined,
                      boxShadow: active ? `0 0 16px -2px ${swatch}` : 'none',
                    }}
                  />
                );
              })}
            </div>

            <span className="h-6 w-px bg-white/15" />

            <button
              type="button"
              onClick={clear}
              className="tap label-caps flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-white/60 hover:text-white"
            >
              <Eraser size={13} />
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Streaming the model in. */}
      {loading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="airo-breathe label-caps text-white/40">Loading the object…</span>
        </div>
      )}
    </div>
  );
}

export default GuideStage;
