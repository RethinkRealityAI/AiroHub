/**
 * Landing screen — a graffiti-studio hero.
 *
 * The whole viewport is a live 3D scene (LandingHero): the real spray can
 * follows your pointer and paints splats onto a backdrop. The UI floats over
 * it as a thin glass layer with exactly two jobs, unchanged from before:
 *
 *   Create a Studio  →  /canvas/:roomId    (fresh generated room code)
 *   Join with a code →  /controller/:code  (typed session code)
 *
 * `.paint-title`, `.paint-btn` and `.splat-chip` are the paint-mask skin's
 * hooks (see index.css); the button and chip also carry solid utility styling
 * so they still look finished if that skin is ever absent.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { SprayCan, ArrowRight, QrCode, Monitor, Smartphone } from 'lucide-react';
import { GlassPanel } from '../ui/Glass';
import LandingHero from '../scene/LandingHero';

/** Session codes: uppercase alphanumeric, 4-8 chars. */
const CODE_RE = /^[A-Z0-9]{4,8}$/;

const spring = { type: 'spring', stiffness: 260, damping: 30 } as const;

export default function Home() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');

  // One room code per mount; regenerating on re-render would invalidate a
  // code somebody has already read off the screen.
  const roomId = useMemo(
    () => Math.random().toString(36).slice(2, 8).toUpperCase(),
    []
  );

  const createStudio = () => navigate(`/canvas/${roomId}`);

  const joinValid = CODE_RE.test(joinCode);
  const joinStudio = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinValid) navigate(`/controller/${joinCode}`);
  };

  return (
    <div className="relative min-h-[100svh] overflow-hidden bg-[var(--color-airo-void)] stage-vignette text-white">
      {/* Live hero: spray can + paintable backdrop, behind everything. */}
      <div className="absolute inset-0" aria-hidden>
        <LandingHero />
      </div>

      {/* Legibility washes — text sits left on desktop, bottom on mobile. */}
      <div className="pointer-events-none absolute inset-0 hidden md:block bg-gradient-to-r from-black/65 via-black/25 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 md:hidden bg-gradient-to-t from-black/75 via-black/35 to-transparent" />

      {/* Overlay UI. pointer-events-none on the frame so the hero keeps
          tracking everywhere; re-enabled only on interactive pieces. */}
      <div className="pointer-events-none relative z-10 flex min-h-[100svh] flex-col">
        <header className="safe-top flex items-center px-5 pt-4 sm:px-8">
          <motion.span
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.05 }}
            className="splat-chip pointer-events-auto inline-flex items-center gap-2 glass glass-sheen rounded-full px-3.5 py-2 text-[11px] font-extrabold tracking-[0.22em]"
          >
            <SprayCan size={13} className="text-[var(--color-airo-flame)]" />
            AIROHUB
          </motion.span>
        </header>

        <main className="flex flex-1 flex-col px-5 sm:px-10 md:justify-center lg:px-16">
          {/* Title block: centred on mobile, left column on desktop so the
              can gets the right half of the stage to spray on. */}
          <div className="flex flex-1 flex-col items-center justify-center text-center md:flex-none md:items-start md:text-left">
            <motion.h1
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.12 }}
              className="paint-title text-6xl font-black leading-[0.95] tracking-tight sm:text-7xl lg:text-8xl"
            >
              AIROHUB
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.2 }}
              className="mt-4 max-w-md text-[14px] leading-relaxed text-white/65 sm:text-[15px]"
            >
              Turn your phone into a spray can. Paint real 3D objects together, live.
            </motion.p>
          </div>

          {/* Action card: near the bottom on mobile, in the column on desktop. */}
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.3 }}
            className="pointer-events-auto mx-auto mt-6 w-full max-w-md md:mx-0 md:mt-9"
          >
            <GlassPanel strong className="p-5 sm:p-6">
              <button
                onClick={createStudio}
                className="paint-btn tap flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#FF4D1C] to-[#FFB020] py-3.5 text-[13px] font-bold tracking-wide text-white shadow-[0_12px_30px_-8px_rgba(255,77,28,0.7)]"
              >
                <SprayCan size={16} />
                Create a Studio
                <ArrowRight size={15} />
              </button>
              <p className="mt-2 text-center font-mono text-[10px] tracking-[0.2em] text-white/30">
                NEW STUDIO CODE · {roomId}
              </p>

              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-white/12" />
                <span className="label-caps text-white/35">or join with a code</span>
                <span className="h-px flex-1 bg-white/12" />
              </div>

              <form onSubmit={joinStudio} className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={(e) =>
                    setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))
                  }
                  placeholder="CODE"
                  aria-label="Session code"
                  maxLength={8}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 font-mono text-sm uppercase tracking-[0.3em] text-white placeholder:tracking-[0.18em] placeholder:text-white/25 focus:border-[var(--color-airo-aqua)]/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!joinValid}
                  className="tap rounded-2xl border border-[var(--color-airo-aqua)]/40 bg-[var(--color-airo-aqua)]/15 px-5 text-[12px] font-bold text-[var(--color-airo-aqua)] disabled:opacity-40"
                >
                  Join
                </button>
              </form>

              <p className="mt-4 flex items-center justify-center gap-2 text-[11px] text-white/40 md:justify-start">
                <QrCode size={13} className="shrink-0 text-[var(--color-airo-aqua)]" />
                On a phone? Scan the studio's QR to jump straight in.
              </p>
            </GlassPanel>
          </motion.div>
        </main>

        <footer className="safe-bottom px-5 pb-4 pt-5 sm:px-8">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 0.5 }}
            className="flex items-center justify-center gap-2 text-[10px] text-white/35 md:justify-start"
          >
            <Monitor size={12} className="shrink-0" />
            Works best: studio on a big screen
            <span className="text-white/20">·</span>
            <Smartphone size={12} className="shrink-0" />
            phones as controllers
          </motion.p>
        </footer>
      </div>
    </div>
  );
}
