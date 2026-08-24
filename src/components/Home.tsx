/**
 * Landing screen.
 *
 * Two jobs: start a studio, and get phones into it. Everything else is
 * supporting detail, so the layout is a single glass card with the two actions
 * given equal weight and the QR code visible without a click.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { motion } from 'motion/react';
import { Smartphone, Monitor, Users, Boxes, Wand2, Copy, Check, SprayCan, ArrowRight } from 'lucide-react';
import { GlassPanel } from '../ui/Glass';
import { PAINTABLE_OBJECTS } from '../paint/objectCatalog';

const FEATURES = [
  { icon: Users, label: '4-player multiplayer', tone: 'text-[var(--color-airo-aqua)]' },
  { icon: Boxes, label: `${PAINTABLE_OBJECTS.length} paintable 3D objects`, tone: 'text-[var(--color-airo-flame)]' },
  { icon: Smartphone, label: 'Phone motion aiming', tone: 'text-emerald-400' },
  { icon: Wand2, label: 'AI stylist & appraiser', tone: 'text-[var(--color-airo-violet)]' },
];

export default function Home() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  // One room code per mount; regenerating on re-render would invalidate any QR
  // code somebody is mid-scan on.
  const roomId = useMemo(
    () => Math.random().toString(36).slice(2, 8).toUpperCase(),
    []
  );

  const controllerUrl = `${window.location.origin}/controller/${roomId}`;

  const copyLink = () => {
    navigator.clipboard.writeText(controllerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen stage-vignette text-white flex items-center justify-center p-4 sm:p-6 safe-top safe-bottom">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        className="w-full max-w-4xl"
      >
        <GlassPanel strong className="p-6 sm:p-9">
          <header className="flex flex-col items-center text-center mb-7">
            <div className="w-14 h-14 rounded-[20px] bg-gradient-to-tr from-[#FF4D1C] to-[#FFB020] grid place-items-center shadow-[0_0_38px_rgba(255,77,28,0.5)] mb-4">
              <SprayCan size={26} className="text-white" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">AiroHub</h1>
            <p className="text-[13px] text-white/55 mt-2 max-w-md leading-relaxed">
              A collaborative 3D spray-paint studio. Put a real object on the stage, then paint it from
              any angle with up to four phones as spray cans.
            </p>
          </header>

          <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
            {FEATURES.map(({ icon: Icon, label, tone }) => (
              <span
                key={label}
                className="glass rounded-full px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-white/70"
              >
                <Icon size={11} className={tone} />
                {label}
              </span>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Studio */}
            <div className="rounded-[22px] bg-white/[0.05] border border-white/12 p-5 flex flex-col">
              <div className="w-11 h-11 rounded-2xl bg-[var(--color-airo-flame)]/15 border border-[var(--color-airo-flame)]/30 grid place-items-center text-[var(--color-airo-flame)] mb-3">
                <Monitor size={20} strokeWidth={1.8} />
              </div>
              <h2 className="text-[15px] font-semibold mb-1">Open the studio</h2>
              <p className="text-[11px] text-white/50 leading-relaxed flex-1 mb-4">
                The big screen. Full 3D stage, 360° orbit, model upload and the AI copilot. Paint with your
                mouse straight away, no phone required.
              </p>
              <button
                onClick={() => navigate(`/canvas/${roomId}`)}
                className="tap w-full py-3 rounded-2xl bg-gradient-to-r from-[#FF4D1C] to-[#FF7A34] text-[12px] font-bold tracking-wide flex items-center justify-center gap-2 shadow-[0_10px_26px_-8px_rgba(255,77,28,0.8)]"
              >
                Launch studio
                <ArrowRight size={15} />
              </button>
            </div>

            {/* Controller */}
            <div className="rounded-[22px] bg-white/[0.05] border border-white/12 p-5 flex flex-col">
              <div className="w-11 h-11 rounded-2xl bg-[var(--color-airo-aqua)]/15 border border-[var(--color-airo-aqua)]/30 grid place-items-center text-[var(--color-airo-aqua)] mb-3">
                <Smartphone size={20} strokeWidth={1.8} />
              </div>
              <h2 className="text-[15px] font-semibold mb-1">Add a phone</h2>
              <p className="text-[11px] text-white/50 leading-relaxed mb-4">
                Scan to turn any phone into a spray can. Aim it at the screen, or paint directly on the
                object in your hand.
              </p>

              <div className="flex items-center gap-4">
                <div className="bg-white p-2 rounded-2xl shrink-0">
                  <QRCodeSVG value={controllerUrl} size={104} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="label-caps text-white/40 mb-1">Room</div>
                  <div className="text-2xl font-bold font-mono tracking-widest mb-2.5">{roomId}</div>
                  <button
                    onClick={copyLink}
                    className="tap w-full py-2 rounded-xl bg-white/10 hover:bg-white/18 border border-white/12 text-[10px] font-bold flex items-center justify-center gap-1.5"
                  >
                    {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    {copied ? 'Link copied' : 'Copy join link'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-[10px] text-white/30">
            Models generated with Meshy · Painting composites over each object's own PBR texture
          </p>
        </GlassPanel>
      </motion.div>
    </div>
  );
}
