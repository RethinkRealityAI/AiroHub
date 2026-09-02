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
import { GlassPanel } from '../ui/Glass';
import { FeedbackButton } from '../feedback/FeedbackButton';

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
    x: 5.0, y: 3.2, side: 'bottom', accent: '#FF4D1C',
    title: 'The room code',
    body: 'Every studio gets a six-character code. Phones join by scanning the QR or typing it — no install, no account.',
  },
  {
    key: 'object-picker',
    x: 44.4, y: 3.2, side: 'bottom', accent: '#FFB020',
    title: 'The object',
    body: 'Swap the object mid-session. Everyone in the room switches with you, and the artwork follows.',
  },
  {
    key: 'roster',
    x: 83.0, y: 3.2, side: 'bottom', accent: '#34D399',
    title: 'Who is holding a can',
    body: 'Everyone painting right now. Each person gets a colour that follows them on the screen and on their phone.',
  },
  {
    key: 'camera-rail',
    x: 3.4, y: 43.3, side: 'right', accent: '#22D3EE',
    title: 'Camera presets',
    body: 'Snap the view to the front, the side or the top. Drag anywhere on the stage to spin it yourself.',
  },
  {
    key: 'stage-mode',
    x: 3.4, y: 60.1, side: 'right', accent: '#A78BFA',
    title: 'What a drag does',
    body: 'Set whether dragging on the big screen paints, places a stamp, or spins the object.',
  },
  {
    key: 'player-tag',
    x: 67.0, y: 36.1, side: 'right', accent: '#22D3EE',
    title: 'Their aim, live',
    body: 'A floating can shows where each phone is pointing, so you see a stroke coming before it lands.',
  },
  {
    key: 'subject',
    x: 53.4, y: 52.3, side: 'left', accent: '#FF4D1C',
    title: 'The paint sticks',
    body: 'Paint goes onto the object itself, not a layer in front. Spin it, move the camera, reload the page — it stays.',
  },
  {
    key: 'tool-toggle',
    x: 21.5, y: 95.8, side: 'top', accent: '#FF4D1C',
    title: 'Spray, brush, stamp',
    body: 'A soft spray for fades, a hard brush for lines, and stamps for stencils and your own images.',
  },
  {
    key: 'finish-toggle',
    x: 54.6, y: 95.8, side: 'top', accent: '#22D3EE',
    title: 'Textured or bare',
    body: 'Paint over the object as it comes, or strip it back to plain white and start from there.',
  },
  {
    key: 'history',
    x: 66.1, y: 95.8, side: 'top', accent: '#A78BFA',
    title: 'Undo for the whole room',
    body: 'Undo and redo cover everybody’s strokes, not just yours. You can replay the whole piece from the first spray.',
  },
  {
    key: 'showcase-button',
    x: 80.0, y: 95.8, side: 'top', accent: '#FFB020',
    title: 'Take it with you',
    body: 'Save a PNG, or record a slow spin of the finished object straight off the canvas as a video.',
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
    { n: '01', tag: 'Phone', head: 'You aim', body: 'You point your phone at the screen, like a can of spray paint.', accent: '#FF4D1C' },
    { n: '02', tag: 'Studio', head: 'Paint lands', body: 'Paint lands on the object exactly where you pointed.', accent: '#22D3EE' },
    { n: '03', tag: 'Everyone', head: 'Same picture', body: 'Every screen in the room shows the same picture.', accent: '#A78BFA' },
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

/**
 * The questions the guide answers in passing, gathered where somebody scanning
 * for one of them will actually find it.
 *
 * Every answer is drawn from copy that already appears elsewhere on this page —
 * nothing here is a new claim. The same six pairs are duplicated verbatim as
 * FAQPage structured data in how-it-works/index.html, because a static SPA has
 * no way to emit JSON-LD at request time. That duplication is only honest while
 * the two agree exactly, so scripts/preview/verify-seo.mjs reads the questions
 * and answers out of the JSON-LD and asserts each one appears in this page's
 * rendered text. Edit one side and the check fails; edit both and it passes.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: 'Do I need to install anything?',
    a: 'No install, no account, one room code. Every studio gets a six-character code, and phones join by scanning the QR or typing it.',
  },
  {
    q: 'How many people can paint at once?',
    a: 'Up to four cans at once. Each phone scans the code and lands straight in the room as a painter with their own colour.',
  },
  {
    q: 'Can I paint without a phone?',
    a: 'Yes. The big screen paints with a mouse just as happily as with phones, so you can open a studio and spray on your own.',
  },
  {
    q: 'What can I paint on?',
    a: 'Fourteen ready-made 3D objects — a fire hydrant, a skate deck, a subway car, a helmet and more. Swap the object mid-session and everyone in the room switches with you.',
  },
  {
    q: 'Can I keep what we painted?',
    a: 'Save a PNG, or record a cinematic turntable of the finished object straight off the canvas as a video.',
  },
  {
    q: 'Who controls the camera?',
    a: 'The studio owns the view by default — otherwise ten people fight over it. To let someone spin the object for the room, tap CAM beside their name in the player list. Per-player, revocable, off by default.',
  },
];

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
        title="What actually happens"
        lede="Your phone sends where it is pointing — nothing else. Every screen in the room draws the same picture from the same instructions."
      >
        <LoopDiagram />
        <div className="mt-12 grid items-start gap-10 md:grid-cols-2">
          <Shot
            src={`${IMG}/ill-phone.webp`}
            alt="A phone tilted in mid-air with a cone of orange paint erupting from its top edge like an aerosol nozzle."
            caption={
              <>
                <b className="font-semibold text-white/80">The phone is the nozzle.</b> Hold the
                trigger, move your hand, and the paint follows.
              </>
            }
          />
          <div className="flex flex-col gap-4">
            <h3 className="text-2xl font-black uppercase leading-none tracking-tight">
              It feels like a mouse
            </h3>
            <p className="leading-relaxed text-white/70">
              Hold your hand still and the line stays put, flick your wrist and the paint jumps
              across the object — and a shake of the phone re-centres your aim whenever it drifts.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------ try it ------------------------------ */}
      <Section
        eyebrow="Try it"
        title="Have a go, right here"
        lede="A real object, painted the way the studio paints. Drag to spray, then spin it and look at what you did."
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
          This is the studio running on its own — no room, nobody else painting.
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
              body: 'Hit Create a Studio on a laptop or TV. You get a six-character room code and a big QR code on screen.',
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
              body: 'Hold the trigger and move the phone. Paint lands on the object on the big screen, in front of everyone, straight away.',
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
        eyebrow="The studio"
        title="The big screen"
        lede="The shared canvas. It holds the object, the artwork and the camera — and it paints with a mouse just as happily as with phones."
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
        title="Two ways to hold your phone"
        lede="Switch between them any time, from the buttons at the top of the controller. Both paint the same object."
      >
        <div className="grid gap-7 sm:grid-cols-2">
          {[
            {
              chip: 'Aim',
              accent: '#FF4D1C',
              shot: 'phone-aim',
              head: 'The spray can',
              body: 'Point the phone at the screen and hold the trigger. Move your hand, and the paint follows.',
              alt: 'The phone controller in Aim mode.',
            },
            {
              chip: 'Paint',
              accent: '#22D3EE',
              shot: 'phone-paint',
              head: 'On the phone itself',
              body: 'The object appears on your phone. Drag a finger to paint straight onto it, or switch to stamping and spinning.',
              alt: 'The phone controller in Paint mode with an on-device 3D preview.',
            },
          ].map((m) => (
            <GlassPanel
              key={m.chip}
              liquid
              radius="rounded-2xl"
              className="flex flex-col gap-4 p-5"
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
            </GlassPanel>
          ))}
        </div>
        <p className="mt-6 text-sm text-white/45">
          Both modes carry the same kit: spray or brush, your colour, and a size dial.
        </p>
      </Section>

      {/* ------------------------------ camera ------------------------------ */}
      <Section eyebrow="Permissions" title="Who moves the camera">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <p className="leading-relaxed text-white/70">
              The big screen owns the view by default — otherwise ten people fight over it. To let
              someone spin the object for the room, tap <span className="rounded-md border border-white/15 bg-white/8 px-1.5 py-0.5 font-mono text-[0.85em]">CAM</span> beside
              their name in the player list. Tap it again to take the camera back.
            </p>
          </div>
          <Shot
            src={`${IMG}/studio-roster-cam.webp`}
            alt="The player list, showing each painter with a CAM button that grants them control of the studio camera."
            caption={<b className="font-semibold text-white/80">One person at a time. Off unless you turn it on.</b>}
          />
        </div>
      </Section>

      {/* ------------------------------- more ------------------------------- */}
      <Section eyebrow="Beyond the can" title="What else is in there">
        <div className="grid gap-9 md:grid-cols-2">
          <Shot
            src={`${IMG}/studio-stamps.webp`}
            alt="The stamp tray, showing tintable graffiti stencils and uploaded images."
            caption={
              <>
                <b className="font-semibold text-white/80">Stamps.</b> Graffiti stencils you can tint
                any colour, or upload your own image and slap it on the object. One tap, one undo.
              </>
            }
          />
          <Shot
            src={`${IMG}/studio-objects.webp`}
            alt="The object picker, showing rendered thumbnails of the paintable 3D models."
            caption={
              <>
                <b className="font-semibold text-white/80">Objects.</b> Fourteen of them — a fire
                hydrant, a skate deck, a subway car, a helmet and more.
              </>
            }
          />
          <Shot
            src={`${IMG}/studio-showcase.webp`}
            alt="The showcase panel, which records a turntable video of the finished piece."
            caption={
              <>
                <b className="font-semibold text-white/80">Showcase.</b> Records a slow 360° spin of
                the finished piece as a video you can post.
              </>
            }
          />
        </div>
      </Section>

      <Divider />

      {/* ------------------------------ builders ---------------------------- */}
      <Section eyebrow="For the builders" title="Built in public">
        <div className="flex max-w-[62ch] flex-col gap-5">
          <p className="leading-relaxed text-white/70">
            AiroHub is open source: the big screen, the phone controller and everything that puts
            paint on an object live in one public repository.
          </p>
          <p className="leading-relaxed text-white/70">
            Read it, borrow from it, or open an issue if something here does not match what you see.
          </p>
          <a
            href="https://github.com/RethinkRealityAI/AiroHub"
            target="_blank"
            rel="noreferrer"
            className="tap glass inline-flex items-center gap-2 self-start rounded-full px-6 py-3 text-sm font-bold text-white/90"
          >
            The code on GitHub
            <ArrowRight size={15} />
          </a>
        </div>
      </Section>

      {/* ---------------------------- questions ----------------------------- */}
      <Section
        id="questions"
        eyebrow="Straight answers"
        title="Common questions"
        lede="The things people ask before they open a room."
      >
        <dl className="overflow-hidden rounded-2xl border border-white/12">
          {FAQ.map(({ q, a }) => (
            <div
              key={q}
              className="grid gap-2 border-b border-white/10 p-4 last:border-b-0 sm:grid-cols-[minmax(14rem,20rem)_1fr] sm:gap-5 sm:px-5"
            >
              <dt className="text-[0.97rem] font-semibold leading-snug text-white/85">{q}</dt>
              <dd className="text-[0.97rem] leading-relaxed text-white/70">{a}</dd>
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

      <FeedbackButton variant="floating" />
    </div>
  );
}
