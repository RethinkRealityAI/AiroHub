/**
 * The public "how it works" guide.
 *
 * A long-scroll walkthrough of the studio, the phone controller and the ideas
 * underneath. Everything visual here is either a real screenshot of the app or
 * a live three.js stage — no mockups — so the page can never drift from what
 * the product actually does.
 *
 * The heavy 3D playground is split out and lazily loaded: this page is the
 * first thing a cold visitor may land on, and the guide reads fine while the
 * stage is still streaming in.
 */
import React, { Suspense, lazy, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, Plus, X } from 'lucide-react';

const GuideStage = lazy(() =>
  import('../scene/GuideStage').then((m) => ({ default: m.GuideStage ?? m.default }))
);

const IMG = '/ui/guide';

/* ------------------------------------------------------------------
   Hotspots over the studio screenshot
   ------------------------------------------------------------------ */

interface Hotspot {
  key: string;
  /** Position as a percentage of the image box, origin top-left. */
  x: number;
  y: number;
  /** Which way the callout opens, so it never falls off the image. */
  side: 'top' | 'bottom' | 'left' | 'right';
  accent: string;
  title: string;
  body: string;
}

/**
 * Measured against the real studio screenshot rather than eyeballed, so the
 * dots keep sitting on their controls if the shot is ever retaken at another
 * size (percentages scale, pixels would not).
 */
const HOTSPOTS: Hotspot[] = [
  {
    key: 'room-badge',
    x: 4.9, y: 3.2, side: 'bottom', accent: '#FF4D1C',
    title: 'The room code',
    body: 'Every studio gets a six-character code. Phones join by scanning the QR or typing it — no install, no account.',
  },
  {
    key: 'object-picker',
    x: 44.4, y: 3.2, side: 'bottom', accent: '#FFB020',
    title: 'The subject',
    body: 'Swap the paintable object mid-session. Everyone in the room switches with you, and the artwork follows.',
  },
  {
    key: 'roster',
    x: 82.9, y: 3.2, side: 'bottom', accent: '#34D399',
    title: 'Who is holding a can',
    body: 'Live presence. Each painter is given a slot colour that follows them across the scene, the roster and their phone.',
  },
  {
    key: 'camera-rail',
    x: 3.4, y: 41.0, side: 'right', accent: '#22D3EE',
    title: 'Camera presets',
    body: 'Snap the view to front, three-quarter, side or top. Drag anywhere on the stage to orbit freely.',
  },
  {
    key: 'stage-mode',
    x: 3.4, y: 60.0, side: 'right', accent: '#A78BFA',
    title: 'What a drag does',
    body: 'Set whether dragging on the big screen paints, places a stamp, or spins the object.',
  },
  {
    key: 'player-tag',
    x: 58.5, y: 45.6, side: 'right', accent: '#22D3EE',
    title: 'Their aim, live',
    body: 'Each phone gets a floating can drawn where it is pointing — rendered about 90 ms in the past through a jitter buffer, so a lumpy network still reads as one smooth line.',
  },
  {
    key: 'subject',
    x: 54.0, y: 50.0, side: 'left', accent: '#FF4D1C',
    title: 'One shared texture',
    body: 'Paint is composited into the model’s own texture rather than floating in front of it, so it survives camera moves, object spins and a page reload.',
  },
  {
    key: 'tool-toggle',
    x: 21.3, y: 95.7, side: 'top', accent: '#FF4D1C',
    title: 'Spray, brush, stamp',
    body: 'Soft atomised spray for fades, a hard brush for lines, and stamps for stencils and uploaded images.',
  },
  {
    key: 'finish-toggle',
    x: 54.5, y: 95.7, side: 'top', accent: '#22D3EE',
    title: 'Textured or primer',
    body: 'Paint over the model’s own material, or strip it back to a bare primer coat and start from white.',
  },
  {
    key: 'history',
    x: 64.4, y: 95.7, side: 'top', accent: '#A78BFA',
    title: 'Undo for the whole room',
    body: 'Every stroke is logged, so undo, redo and a full replay of the piece work across all the painters at once.',
  },
  {
    key: 'showcase-button',
    x: 80.0, y: 95.7, side: 'top', accent: '#FFB020',
    title: 'Take it with you',
    body: 'Save a PNG, or record a cinematic turntable of the finished object straight off the canvas as a video.',
  },
];

function HotspotLayer({
  hotspots,
  onDiscover,
}: {
  hotspots: Hotspot[];
  onDiscover: (key: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const uid = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Tapping the picture anywhere but a dot closes the callout; so does Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      {hotspots.map((h) => {
        const isOpen = open === h.key;
        const panelId = `${uid}-${h.key}`;
        return (
          <div
            key={h.key}
            className="absolute"
            style={{ left: `${h.x}%`, top: `${h.y}%` }}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => {
                setOpen(isOpen ? null : h.key);
                onDiscover(h.key);
              }}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') {
                  setOpen(h.key);
                  onDiscover(h.key);
                }
              }}
              className="tap group absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center rounded-full"
              style={{ width: 30, height: 30 }}
            >
              <span
                className="absolute inset-0 rounded-full opacity-60 group-hover:opacity-100"
                style={{
                  background: `radial-gradient(circle, ${h.accent}66 0%, ${h.accent}00 70%)`,
                }}
              />
              {!isOpen && (
                <span
                  className="absolute rounded-full airo-ping"
                  style={{ inset: 6, border: `1.5px solid ${h.accent}`, opacity: 0.55 }}
                />
              )}
              <span
                className="relative grid place-items-center rounded-full text-[#07070C] transition-transform group-hover:scale-110"
                style={{ width: 18, height: 18, background: h.accent, boxShadow: `0 0 14px ${h.accent}99` }}
              >
                {isOpen ? <X size={11} strokeWidth={3} /> : <Plus size={11} strokeWidth={3} />}
              </span>
              <span className="sr-only">{h.title}</span>
            </button>

            {isOpen && (
              <motion.div
                id={panelId}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="glass glass-sheen absolute z-20 w-[min(17rem,60vw)] rounded-2xl p-3.5 text-left"
                style={{
                  borderColor: `${h.accent}55`,
                  ...calloutOffset(h.side),
                }}
              >
                <p
                  className="label-caps mb-1 text-[10px]"
                  style={{ color: h.accent }}
                >
                  {h.title}
                </p>
                <p className="text-[12.5px] leading-relaxed text-white/80">{h.body}</p>
              </motion.div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Where a callout sits relative to its dot. */
function calloutOffset(side: Hotspot['side']): React.CSSProperties {
  switch (side) {
    case 'top':
      return { left: '50%', bottom: 22, transform: 'translateX(-50%)' };
    case 'bottom':
      return { left: '50%', top: 22, transform: 'translateX(-50%)' };
    case 'left':
      return { right: 22, top: '50%', transform: 'translateY(-50%)' };
    default:
      return { left: 22, top: '50%', transform: 'translateY(-50%)' };
  }
}


/**
 * The studio screenshot, annotated. Keeping a tally of what has been opened
 * turns a wall of markers into something a visitor will actually finish.
 */
function StudioExplorer() {
  const [found, setFound] = useState<Set<string>>(() => new Set());
  const discover = useCallback((key: string) => {
    setFound((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  const done = found.size === HOTSPOTS.length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="label-caps flex items-center gap-2 text-[11px] text-[color:var(--color-airo-aqua)]">
          <span className="grid h-4 w-4 place-items-center rounded-full bg-[color:var(--color-airo-aqua)] text-[#07070C]">
            <Plus size={9} strokeWidth={3} />
          </span>
          Tap a marker to see what each part does
        </p>
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#FF4D1C] via-[#FFB020] to-[#22D3EE] transition-[width] duration-500"
              style={{ width: `${(found.size / HOTSPOTS.length) * 100}%` }}
            />
          </div>
          <span className="label-caps text-[11px] tabular-nums text-white/45">
            {done ? 'All found' : `${found.size} / ${HOTSPOTS.length}`}
          </span>
        </div>
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#0E0E18] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
        <img
          src={`${IMG}/studio-painted.webp`}
          alt="The AiroHub studio: a 3D object covered in multi-coloured spray paint, with player cans floating in the scene and the command bar below."
          className="block w-full"
        />
        <HotspotLayer hotspots={HOTSPOTS} onDiscover={discover} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------
   Page furniture
   ------------------------------------------------------------------ */

function Shot({
  src,
  alt,
  caption,
  children,
}: {
  src: string;
  alt: string;
  caption?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#0E0E18] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
        <img src={src} alt={alt} loading="lazy" decoding="async" className="block w-full" />
        {children}
      </div>
      {caption && <figcaption className="text-sm text-white/45">{caption}</figcaption>}
    </figure>
  );
}

function Divider() {
  return (
    <div
      aria-hidden="true"
      className="h-16 bg-cover bg-center opacity-55"
      style={{
        backgroundImage: `url(${IMG}/ill-strokes.webp)`,
        maskImage: 'linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)',
        WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)',
      }}
    />
  );
}

function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-b border-white/10 py-20 sm:py-24">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '0px 0px -8% 0px' }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
        className="mx-auto w-[min(100%-2.5rem,68rem)]"
      >
        <div className="mb-10 flex max-w-[62ch] flex-col gap-3">
          <p className="label-caps text-[11px] tracking-[0.34em] text-white/40">{eyebrow}</p>
          <h2 className="paint-title text-[clamp(2.2rem,6vw,3.6rem)] font-black uppercase leading-[0.95] tracking-tight">
            {title}
          </h2>
          {lede && <p className="text-lg leading-relaxed text-white/65">{lede}</p>}
        </div>
        {children}
      </motion.div>
    </section>
  );
}

/** The mechanism, drawn rather than described. */
function LoopDiagram() {
  const nodes = [
    { n: '01', tag: 'Phone', head: 'The can', body: 'Reads its gyroscope 40 times a second.', accent: '#FF4D1C' },
    { n: '02', tag: 'Studio', head: 'The wall', body: 'Raycasts that aim onto the model and stamps the texture.', accent: '#22D3EE' },
    { n: '03', tag: 'Everyone', head: 'In sync', body: 'Every screen rebuilds the identical artwork.', accent: '#A78BFA' },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {nodes.map((node, i) => (
        <div key={node.n} className="relative">
          <div
            className="glass glass-sheen h-full rounded-2xl p-5"
            style={{ borderColor: `${node.accent}44` }}
          >
            <p className="label-caps text-[10px]" style={{ color: node.accent }}>
              {node.n} / {node.tag}
            </p>
            <h3 className="mt-3 text-2xl font-black uppercase leading-none tracking-tight">
              {node.head}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{node.body}</p>
          </div>
          {i < nodes.length - 1 && (
            <ArrowRight
              size={18}
              aria-hidden="true"
              className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-white/25 sm:block"
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------
   The page
   ------------------------------------------------------------------ */

export default function HowItWorks() {
  const railRef = useRef<HTMLElement>(null);

  // A stripe of paint down the edge that fills as the guide is read.
  const onScroll = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const d = document.documentElement;
    const max = d.scrollHeight - d.clientHeight;
    el.style.transform = `scaleY(${max > 0 ? d.scrollTop / max : 0})`;
  }, []);
  useEffect(() => {
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [onScroll]);

  return (
    <div className="min-h-[100svh] bg-[#07070C] text-white">
      <div aria-hidden="true" className="fixed inset-y-0 left-0 z-40 w-1 bg-white/5">
        <i
          ref={railRef}
          className="block h-full origin-top scale-y-0 bg-gradient-to-b from-[#FF4D1C] via-[#A78BFA] to-[#34D399] shadow-[0_0_18px_rgba(255,77,28,0.5)]"
        />
      </div>

      {/* ------------------------------- hero ------------------------------- */}
      <header className="relative flex min-h-[min(92svh,54rem)] items-center overflow-hidden border-b border-white/10">
        <div className="absolute inset-0">
          <img
            src={`${IMG}/ill-hero.webp`}
            alt="Three phones aimed at a large screen, each spraying a cone of coloured paint onto a 3D sneaker."
            className="h-full w-full object-cover opacity-80"
            style={{ objectPosition: '62% 50%' }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(100deg,#07070C_6%,rgba(7,7,12,0.86)_38%,rgba(7,7,12,0.25)_66%,rgba(7,7,12,0.55))]" />
        </div>

        <div className="relative mx-auto w-[min(100%-2.5rem,68rem)] py-20">
          <p className="label-caps text-[11px] tracking-[0.34em] text-white/45">Field guide</p>
          <h1 className="paint-title paint-title-flow mt-3 text-[clamp(4rem,15vw,10rem)] font-black uppercase leading-[0.82] tracking-tighter">
            AiroHub
          </h1>
          <div className="mt-1 h-[7px] w-[min(34rem,86%)] rounded-full bg-gradient-to-r from-[#FF4D1C] via-[#E879F9] to-[#22D3EE]" />
          <p className="mt-7 max-w-[34ch] text-[clamp(1.05rem,2.4vw,1.35rem)] leading-relaxed text-white/75">
            Put a 3D object on the big screen. Everyone points their phone at it like a spray can.
            You paint it together, live.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/"
              className="tap inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FF4D1C] to-[#FF7A34] px-6 py-3 text-sm font-bold text-white shadow-[0_10px_30px_-8px_rgba(255,77,28,0.75)]"
            >
              Open the studio
              <ArrowRight size={15} />
            </Link>
            <a
              href="#loop"
              className="tap glass inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white/90"
            >
              How it works
            </a>
          </div>
          <p className="mt-5 text-sm text-white/40">No install. No account. One room code.</p>
        </div>
      </header>

      {/* ------------------------------- loop ------------------------------- */}
      <Section
        id="loop"
        eyebrow="The loop"
        title="Nobody streams pixels"
        lede="Your phone sends where it is aiming — nothing else. Every screen in the room rebuilds the same artwork from the same instructions."
      >
        <LoopDiagram />
        <div className="mt-12 grid items-start gap-10 md:grid-cols-2">
          <Shot
            src={`${IMG}/ill-phone.webp`}
            alt="A phone tilted in mid-air with a cone of orange paint erupting from its top edge like an aerosol nozzle."
            caption={
              <>
                <b className="font-semibold text-white/80">The phone is the nozzle.</b> Its gyroscope
                is read 40 times a second and integrated as rotation deltas, so tilting your wrist
                never bends a vertical stroke sideways.
              </>
            }
          />
          <div className="flex flex-col gap-4">
            <h3 className="text-2xl font-black uppercase leading-none tracking-tight">
              Why it feels like a mouse
            </h3>
            <p className="leading-relaxed text-white/70">
              Aim is accumulated from how the phone <em>turned</em>, not from where it thinks it is
              pointing. A movement estimate stiffens the filter when you hold still and gets out of
              the way the instant you flick, so you can hold a line pixel-steady and still snap
              across the model.
            </p>
            <p className="leading-relaxed text-white/70">
              Pulling the trigger briefly freezes that integrator, so a thumb tap can never kick your
              aim off target.
            </p>
            <p className="text-sm text-white/40">Shake the phone to re-centre your aim at any time.</p>
          </div>
        </div>
      </Section>

      {/* ------------------------------ try it ------------------------------ */}
      <Section
        eyebrow="Try it"
        title="Have a go, right here"
        lede="A real paintable object, the same paint pipeline the studio uses. Drag to spray, then spin it and look at what you did."
      >
        <div className="overflow-hidden rounded-3xl border border-white/12 bg-[#0B0B12]">
          <Suspense
            fallback={
              <div className="grid h-[min(60svh,30rem)] place-items-center">
                <span className="airo-breathe label-caps text-sm text-white/35">
                  Warming up the stage…
                </span>
              </div>
            }
          >
            <GuideStage objectId="hydrant" className="h-[min(62svh,32rem)] w-full" />
          </Suspense>
        </div>
        <p className="mt-3 text-sm text-white/40">
          This is the studio&rsquo;s renderer running on its own — no room, nobody else painting.
        </p>
      </Section>

      <Divider />

      {/* ------------------------------ start ------------------------------ */}
      <Section eyebrow="Start" title="Painting in 60 seconds">
        <div className="grid gap-10 sm:grid-cols-3">
          {[
            {
              n: '01',
              accent: '#FF4D1C',
              head: 'Open a studio',
              body: 'Hit Create a Studio on a laptop or TV. You get a six-character room code and a QR panel that fills the screen.',
              shot: 'landing',
              alt: 'The AiroHub landing page with a large 3D spray can following the pointer and fresh paint on the wall behind it.',
            },
            {
              n: '02',
              accent: '#FFB020',
              head: 'Everyone scans',
              body: 'Each phone scans the code and lands straight in the room as a painter with their own colour. Up to four cans at once.',
              shot: 'studio-invite-qr',
              alt: 'The invite modal: a large QR code and the room code for phones to join.',
            },
            {
              n: '03',
              accent: '#22D3EE',
              head: 'Point and spray',
              body: 'Hold the trigger and move the phone. Paint lands on the model on the big screen, in front of everyone, instantly.',
              shot: 'phone-aim',
              alt: 'The phone controller in Aim mode: the motion-tracked spray-can HUD with a trigger.',
            },
          ].map((s) => (
            <div key={s.n} className="flex flex-col gap-4">
              <div
                className="text-[3.4rem] font-black leading-[0.8] text-transparent"
                style={{ WebkitTextStroke: `1.5px ${s.accent}` }}
              >
                {s.n}
              </div>
              <h3 className="text-2xl font-black uppercase leading-none tracking-tight">{s.head}</h3>
              <p className="leading-relaxed text-white/65">{s.body}</p>
              <Shot src={`${IMG}/${s.shot}.webp`} alt={s.alt} />
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------ studio ------------------------------ */}
      <Section
        eyebrow="The big screen"
        title="The studio"
        lede="The shared canvas. It owns the object, the artwork and the camera — and it paints with a mouse just as happily as with phones."
      >
        <StudioExplorer />
        <p className="mt-3 text-sm text-white/45">
          <b className="font-semibold text-white/80">One object, four painters.</b> Every can floating
          in the scene is somebody&rsquo;s phone, drawn where they are aiming right now.
        </p>
      </Section>

      <Divider />

      {/* ------------------------------ remote ------------------------------ */}
      <Section
        eyebrow="The phone"
        title="Three ways to hold it"
        lede="Switch any time from the segmented control at the top of the controller. Each mode paints the same shared texture."
      >
        <div className="grid gap-7 sm:grid-cols-3">
          {[
            {
              chip: 'Aim',
              accent: '#FF4D1C',
              shot: 'phone-aim',
              head: 'The spray can',
              body: 'Point the phone at the screen and hold the trigger. Motion-tracked, roll-proof, and re-centred with a shake.',
              alt: 'The phone controller in Aim mode.',
            },
            {
              chip: 'Paint',
              accent: '#22D3EE',
              shot: 'phone-paint',
              head: 'On-device canvas',
              body: 'The object appears on your phone. Drag a finger to paint straight onto it. One-finger action toggles between paint, stamp and rotate.',
              alt: 'The phone controller in Paint mode with an on-device 3D preview.',
            },
            {
              chip: 'Pad',
              accent: '#A78BFA',
              shot: 'phone-pad',
              head: 'Trackpad',
              body: 'A flat pad mapped directly onto the texture. The precise one, for lettering and detail work.',
              alt: 'The phone controller in Pad mode: a flat trackpad mapped onto the texture.',
            },
          ].map((m) => (
            <div
              key={m.chip}
              className="glass glass-sheen flex flex-col gap-4 rounded-2xl p-5"
              style={{ borderColor: `${m.accent}44` }}
            >
              <span
                className="label-caps self-start rounded-full px-2.5 py-1 text-[10px]"
                style={{
                  color: m.accent,
                  background: `${m.accent}22`,
                  border: `1px solid ${m.accent}66`,
                }}
              >
                {m.chip}
              </span>
              <img
                src={`${IMG}/${m.shot}.webp`}
                alt={m.alt}
                loading="lazy"
                decoding="async"
                className="w-full rounded-xl border border-white/10"
              />
              <div>
                <h3 className="text-xl font-black uppercase leading-none tracking-tight">{m.head}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{m.body}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-white/45">
          Every mode carries the same kit: spray or brush, your colour, and a size dial.
        </p>
      </Section>

      {/* ------------------------------ camera ------------------------------ */}
      <Section eyebrow="Permissions" title={<>Hand over<br />the camera</>}>
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <p className="leading-relaxed text-white/70">
              The studio owns the view by default — otherwise ten people fight over it. To let
              someone spin the object for the room, tap <span className="rounded-md border border-white/15 bg-white/8 px-1.5 py-0.5 font-mono text-[0.85em]">CAM</span> beside
              their name in the player list.
            </p>
            <p className="leading-relaxed text-white/70">
              Their rotate gesture now drives the studio camera for everyone. Tap again to take it
              back.
            </p>
          </div>
          <Shot
            src={`${IMG}/studio-roster-cam.webp`}
            alt="The player list, showing each painter with a CAM button that grants them control of the studio camera."
            caption={<b className="font-semibold text-white/80">Per-player, revocable, off by default.</b>}
          />
        </div>
      </Section>

      {/* ------------------------------- more ------------------------------- */}
      <Section eyebrow="Beyond the can" title="The rest of the kit">
        <div className="grid gap-9 md:grid-cols-2">
          <Shot
            src={`${IMG}/studio-stamps.webp`}
            alt="The stamp tray, showing tintable graffiti stencils and uploaded images."
            caption={
              <>
                <b className="font-semibold text-white/80">Stamps.</b> Tintable graffiti stencils, or
                upload your own image and slap it anywhere on the model. Each stamp is one undoable
                stroke.
              </>
            }
          />
          <Shot
            src={`${IMG}/studio-ai.webp`}
            alt="The AI copilot sheet, offering palettes and stencil suggestions."
            caption={
              <>
                <b className="font-semibold text-white/80">AI copilot.</b> Ask for a direction and it
                returns palettes and stencils you can spray straight onto the piece.
              </>
            }
          />
          <Shot
            src={`${IMG}/studio-objects.webp`}
            alt="The object picker, showing rendered thumbnails of the paintable 3D models."
            caption={
              <>
                <b className="font-semibold text-white/80">Objects.</b> A library of real 3D models,
                streamed on demand and rendered as live thumbnails.
              </>
            }
          />
          <Shot
            src={`${IMG}/studio-showcase.webp`}
            alt="The showcase panel, which records a turntable video of the finished piece."
            caption={
              <>
                <b className="font-semibold text-white/80">Showcase.</b> Records a cinematic 360°
                turntable of the finished piece straight off the canvas as a video.
              </>
            }
          />
        </div>
      </Section>

      <Divider />

      {/* ------------------------------ builders ---------------------------- */}
      <Section
        eyebrow="For the builders"
        title="Under the hood"
        lede="Built in public. The interesting problems were not the rendering ones."
      >
        <dl className="overflow-hidden rounded-2xl border border-white/12">
          {[
            ['Rendering', 'three.js and React Three Fiber. Paint composites over each model’s own PBR albedo inside the material, so strokes survive camera moves, object swaps and reloads.'],
            ['Painting', 'Strokes resolve to a 2048² texture via BVH-accelerated raycasts with per-hit texel density, so a dab stays the same size in texture space no matter how far the camera is.'],
            ['Tracking', 'Device orientation integrated as player-space rotation deltas — roll-invariant, seam-free, edge-ratcheting — behind a movement-gated filter and trigger suppression.'],
            ['Networking', 'Peers exchange resolved stamp batches, never pixels. Remote cursors render through a jitter buffer about 90 ms in the past rather than chasing the newest packet.'],
            ['Transport', 'Supabase Realtime broadcast and presence — no dedicated socket server. Rejoins with backoff, and the roster self-heals if presence is slow.'],
            ['WebGPU', 'Evaluated and declined for now: this scene submits few draw calls and has no compute work, while its one hot path — a large canvas-to-texture upload — currently benchmarks behind WebGL, worst on Safari.'],
          ].map(([term, def]) => (
            <div
              key={term}
              className="grid gap-2 border-b border-white/10 p-4 last:border-b-0 sm:grid-cols-[minmax(9rem,12rem)_1fr] sm:gap-5 sm:px-5"
            >
              <dt className="label-caps text-[11px] text-white/40">{term}</dt>
              <dd className="text-[0.97rem] leading-relaxed text-white/70">{def}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* ------------------------------ closing ----------------------------- */}
      <div className="relative border-b border-white/10">
        <img
          src={`${IMG}/ill-room.webp`}
          alt="Four people pointing phones at one big screen, four coloured paint beams landing on a 3D object."
          loading="lazy"
          decoding="async"
          className="h-[clamp(16rem,42svh,29rem)] w-full object-cover opacity-90"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,7,12,0.65),rgba(7,7,12,0.1)_45%,#07070C)]" />
      </div>

      <footer className="mx-auto flex w-[min(100%-2.5rem,68rem)] flex-col items-center gap-5 py-20 text-center">
        <p className="label-caps text-[11px] tracking-[0.34em] text-white/40">Grab a can</p>
        <h2 className="paint-title text-[clamp(2rem,5vw,3rem)] font-black uppercase leading-none tracking-tight">
          The wall is empty
        </h2>
        <Link
          to="/"
          className="tap inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FF4D1C] to-[#FF7A34] px-7 py-3.5 text-sm font-bold text-white shadow-[0_10px_30px_-8px_rgba(255,77,28,0.75)]"
        >
          Open the studio
          <ArrowRight size={15} />
        </Link>
        <p className="text-sm text-white/35">Works in any modern mobile browser.</p>
      </footer>
    </div>
  );
}
