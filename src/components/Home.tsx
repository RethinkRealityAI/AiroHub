/**
 * Landing screen — a graffiti-studio hero.
 *
 * The whole viewport is a live 3D scene (LandingHero): an oversized spray can
 * that follows your pointer, sprays, and permanently tags the backdrop behind
 * the copy. The UI floats over it as a thin liquid-glass layer with one job:
 *
 *   Launch Studio  →  /canvas/:roomId    (fresh generated room code)
 *
 * There is deliberately no code field here. Phones join from the QR the
 * studio shows the moment it opens (the room code is printed there too), so a
 * code on this page only asked visitors to read and remember something before
 * they had a reason to. The three steps under the button say how joining
 * works instead.
 *
 * Layout is deliberately two-mode rather than fluid. Below `lg` the page
 * stacks — headline at the top, glass card at the bottom, and the whole middle
 * band handed to the can. At `lg` and above it splits into a left copy column
 * and a right stage, and the hero's own layout switch (LandingHero picks its
 * zone from the viewport aspect) is tuned to match.
 *
 * `.paint-title`, `.paint-btn`, `.drip-edge` and `.splat-chip` are the paint
 * mask skin's hooks (see index.css, including the landing block appended at
 * the end of it); every element carrying one also has complete solid styling,
 * so the page still looks finished if those stencils fail to load.
 *
 * The Launch action navigates with `state: { justCreated: true }` — the studio
 * screen keys its first-run invite moment off that flag.
 */
import React, { Suspense, lazy } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  SprayCan, ArrowRight, QrCode, Monitor, Smartphone, Users, Boxes, Radio, MousePointer2, Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GlassPanel } from '../ui/Glass';
import { track } from '../analytics/track';
import { FeedbackButton } from '../feedback/FeedbackButton';

/**
 * The hero is a full three.js scene and by far the largest thing the landing
 * page can ask for. Imported statically it put the whole rendering bundle on
 * the critical path of `/`, so a visitor who only ever wanted to read the
 * headline paid for the renderer before a single word appeared. Code-split, it
 * arrives after the copy instead of ahead of it.
 */
const LandingHero = lazy(() => import('../scene/LandingHero'));

/**
 * A still frame of that very scene, baked from the running page by
 * `ONLY=hero-poster node scripts/preview/shoot-brand.mjs`. It holds the stage
 * until the hero mounts. Because it comes out of the real scene rather than
 * being drawn by hand, the handover reads as the picture coming alive rather
 * than as one image being swapped for another.
 */
const HERO_POSTER = '/ui/hero-poster.webp';

const spring = { type: 'spring', stiffness: 260, damping: 30 } as const;
/** Reveal easing for the headline wipe — fast out, long settle. */
const wipe = [0.16, 1, 0.3, 1] as const;

/** The house gradient. Used for the title ink and the drips hanging off it. */
const TITLE_INK = 'linear-gradient(100deg, #FF4D1C 0%, #FFB020 30%, #E879F9 62%, #22D3EE 100%)';
const CTA_PAINT = 'linear-gradient(120deg, #FF4D1C, #FF7A34 70%, #FFB020)';

const FEATURES: { icon: LucideIcon; label: string; accent: string }[] = [
  { icon: Users, label: 'Up to four painters', accent: 'var(--color-airo-flame)' },
  { icon: Boxes, label: '14 paintable objects', accent: 'var(--color-airo-aqua)' },
  { icon: Radio, label: 'Live in the same room', accent: 'var(--color-airo-violet)' },
];

/** How a session comes together, in the order people do it. */
const STEPS: { icon: LucideIcon; label: string; short: string; accent: string }[] = [
  { icon: Monitor, label: 'Open on a big screen', short: 'Big screen', accent: 'var(--color-airo-flame)' },
  { icon: QrCode, label: 'Friends scan the QR', short: 'Scan the QR', accent: 'var(--color-airo-aqua)' },
  { icon: Sparkles, label: 'Shake a phone & spray', short: 'Shake & spray', accent: 'var(--color-airo-violet)' },
];

/** Six-character room code: the studio prints it next to its QR. */
function newRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'X');
}

export default function Home() {
  const navigate = useNavigate();

  // `justCreated` tells the studio this is a brand-new room, so it can open
  // its invite moment (QR and code front and centre) instead of dropping the
  // host straight onto an empty wall.
  const launchStudio = () => {
    const roomId = newRoomId();
    track('studio.create', undefined, roomId);
    navigate(`/canvas/${roomId}`, { state: { justCreated: true } });
  };

  return (
    <div className="relative min-h-[100svh] overflow-hidden bg-[var(--color-airo-void)] stage-vignette text-white">
      {/* Live hero: spray can + paintable backdrop, behind everything.
          The container already reserves the full viewport, so swapping the
          poster for the canvas shifts nothing — the lazy hero costs no layout
          stability. The poster is left in place underneath rather than torn
          down on mount: the canvas is `alpha: true` and its backdrop plane is
          overscanned past every edge, so it is never visible again, and
          keeping it spares the page a second of void if the first WebGL frame
          is slow. `data-hero-stage` is the hook shoot-brand.mjs isolates when
          it re-bakes the poster. */}
      <div
        data-hero-stage
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${HERO_POSTER})` }}
        aria-hidden
      >
        <Suspense fallback={null}>
          <LandingHero />
        </Suspense>
      </div>

      {/* Legibility washes. Split layout gets a left-hand column of ink; the
          stacked layout gets a top and a bottom band instead. Both stop well
          short of the stage so the can never sits in a grey box. */}
      <div
        className="pointer-events-none absolute inset-0 hidden lg:block"
        style={{
          background:
            'linear-gradient(90deg, rgba(3,3,8,0.92) 0%, rgba(3,3,8,0.72) 24%, rgba(3,3,8,0.26) 46%, rgba(3,3,8,0) 66%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 lg:hidden"
        style={{ background: 'linear-gradient(180deg, rgba(3,3,8,0.9), rgba(3,3,8,0.45) 55%, rgba(3,3,8,0))' }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] lg:hidden"
        style={{ background: 'linear-gradient(0deg, rgba(3,3,8,0.92), rgba(3,3,8,0.55) 45%, rgba(3,3,8,0))' }}
      />

      {/* Overlay UI. pointer-events-none on the frame so the hero keeps
          tracking everywhere; re-enabled only on interactive pieces. */}
      <div className="pointer-events-none relative z-10 flex min-h-[100svh] flex-col">
        <header className="safe-top flex items-center justify-between gap-4 px-5 pt-4 sm:px-8 lg:px-14">
          <motion.span
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.05 }}
            className="splat-chip pointer-events-auto inline-flex items-center gap-2 glass glass-sheen rounded-full px-3.5 py-2 text-[11px] font-extrabold tracking-[0.22em]"
          >
            <SprayCan size={13} className="text-[var(--color-airo-flame)]" />
            AIROHUB
          </motion.span>

          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="hidden items-center gap-2 text-[10px] font-bold tracking-[0.24em] text-white/40 sm:inline-flex"
          >
            <span className="airo-breathe h-1.5 w-1.5 rounded-full bg-[var(--color-airo-aqua)] shadow-[0_0_10px_var(--color-airo-aqua)]" />
            REAL-TIME STUDIO
          </motion.span>
        </header>

        <main className="flex flex-1 flex-col px-5 pb-1 sm:px-8 lg:justify-center lg:px-14 lg:pb-0">
          {/* Copy block. Centred while stacked, left column at lg. */}
          <div className="shrink-0 pt-3 text-center sm:pt-5 lg:pt-0 lg:text-left">
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.08 }}
              className="mb-5 flex items-center justify-center gap-3 text-[10px] font-bold tracking-[0.3em] text-white/45 lg:justify-start"
            >
              <span
                aria-hidden
                className="h-px w-7 lg:w-12"
                style={{ background: 'linear-gradient(90deg, transparent, var(--color-airo-flame))' }}
              />
              COLLABORATIVE SPRAY STUDIO
            </motion.div>

            {/* The drips hang off the wrapper, not the h1 — the h1 itself is
                clipped by the reveal wipe and would cut them off. */}
            <div
              className="drip-edge drip-edge-soft inline-block"
              style={{ '--paint': TITLE_INK } as React.CSSProperties}
            >
              <motion.h1
                initial={{ clipPath: 'inset(0 100% 0 0)', opacity: 0 }}
                animate={{ clipPath: 'inset(0 0% 0 0)', opacity: 1 }}
                transition={{ duration: 1, ease: wipe, delay: 0.14 }}
                className="paint-title paint-title-flow text-[clamp(3.1rem,8.4vw,8.25rem)] font-black leading-[0.86] tracking-[-0.035em]"
              >
                AIROHUB
              </motion.h1>
            </div>

            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.34 }}
              className="mx-auto mt-9 max-w-[30rem] text-[15px] leading-relaxed text-white/70 sm:text-[16px] lg:mx-0"
            >
              Turn any phone into a spray can. Paint real 3D objects together, live.
            </motion.p>

            <motion.ul
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.42 }}
              className="mt-6 hidden flex-wrap items-center justify-center gap-2 sm:flex lg:justify-start"
            >
              {FEATURES.map(({ icon: Icon, label, accent }) => (
                <li
                  key={label}
                  className="glass glass-sheen inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-semibold text-white/75"
                >
                  <Icon size={12} style={{ color: accent }} className="shrink-0" />
                  {label}
                </li>
              ))}
            </motion.ul>
          </div>

          {/* Stacked layouts hand this gap to the can. */}
          <div className="min-h-[4.5rem] flex-1 lg:hidden" />

          {/* Action card. */}
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.5 }}
            className="pointer-events-auto mx-auto w-full max-w-[27rem] lg:mx-0 lg:mt-11"
          >
            <GlassPanel
              strong
              // The one panel on the site with a live 3D scene running behind
              // it, so the rim refraction has something worth bending.
              liquid
              className="splatter-accent splatter-accent-bl p-5 sm:p-6"
              style={{
                // A darker glass than the default tint: the can can pass right
                // behind this card, and the CTA has to stay readable when it
                // does. Same recipe as `glass-modal`, one step lighter.
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.028)), rgba(8,8,14,0.62)',
                '--paint': 'var(--color-airo-violet)',
              } as React.CSSProperties}
            >
              <button
                onClick={launchStudio}
                className="paint-btn paint-cta tap flex w-full items-center justify-center gap-2.5 px-10 py-4 text-[16px] font-bold tracking-wide text-white sm:py-5"
                style={{ '--paint': CTA_PAINT } as React.CSSProperties}
              >
                <SprayCan size={18} />
                Launch Studio
                <ArrowRight size={17} />
              </button>

              <p className="mt-2.5 text-center text-[12px] text-white/50 sm:mt-3">
                Free, no sign-up. Friends join by QR.
              </p>

              {/* Stacked phones get a flat row (icon beside label) so the card
                  leaves the can room; wider screens get the tiled version. */}
              <ol className="mt-3.5 grid grid-cols-3 gap-1.5 sm:mt-5 sm:gap-2" aria-label="How it works">
                {STEPS.map(({ icon: Icon, label, short, accent }, i) => (
                  <li
                    key={label}
                    className="flex items-center gap-1.5 rounded-2xl border border-white/8 bg-white/[0.035] px-2 py-2 text-left sm:flex-col sm:gap-2 sm:py-3 sm:text-center"
                  >
                    <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06] sm:h-8 sm:w-8">
                      <Icon size={13} style={{ color: accent }} />
                      <span
                        aria-hidden
                        className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-black/70 font-mono text-[9px] font-bold text-white/70 sm:inline-flex"
                      >
                        {i + 1}
                      </span>
                    </span>
                    <span className="text-[10.5px] font-semibold leading-tight text-white/70 sm:leading-snug">
                      <span className="sm:hidden">{short}</span>
                      <span className="hidden sm:inline">{label}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </GlassPanel>
          </motion.div>
        </main>

        <footer className="safe-bottom flex items-end justify-between gap-6 px-5 pb-4 pt-5 sm:px-8 lg:px-14">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.5 }}
            className="flex flex-1 flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[9.5px] text-white/35 sm:gap-x-3 sm:text-[10px] lg:flex-none lg:justify-start"
          >
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Monitor size={11} className="shrink-0" />
              Studio on the big screen
            </span>
            <span aria-hidden className="text-white/15">
              /
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Smartphone size={11} className="shrink-0" />
              Phones as spray cans
            </span>
            <span aria-hidden className="text-white/15">
              /
            </span>
            <Link
              to="/how-it-works"
              className="pointer-events-auto whitespace-nowrap text-white/35 transition-colors hover:text-white/70"
            >
              How it works
            </Link>
          </motion.div>

          {/* Reads as a caption, works as onboarding: nothing else on the page
              tells you the can is yours to move. Split layouts only — stacked
              ones have no room to spare under the card. */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.7 }}
            className="hidden items-center gap-2 text-[10px] tracking-wide text-white/30 lg:flex"
          >
            <MousePointer2 size={11} className="shrink-0 text-white/40" />
            Move your pointer — the can follows, and the wall keeps the paint
          </motion.p>
        </footer>
      </div>

      {/* Outside the pointer-events-none overlay frame on purpose: that frame
          exists so the hero keeps tracking the pointer, and a button inside it
          would inherit the same click-through. */}
      <FeedbackButton variant="floating" />
    </div>
  );
}
