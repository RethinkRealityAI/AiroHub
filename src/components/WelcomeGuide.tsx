/**
 * First-join welcome guide.
 *
 * A one-shot "how to play" modal shown the first time someone lands in a
 * session. Two variants share one skeleton:
 *
 *   controller — the phone. Explains the three paint modes (Aim / Paint / Pad)
 *                that live in the top segmented switch, plus a row of quick
 *                tips for the smaller affordances.
 *   studio     — the big screen. Explains mouse painting, inviting phones via
 *                the QR sheet, and the host-only room controls.
 *
 * The mounting side owns first-run persistence; this component only renders
 * when told to and calls `onClose` when the player is ready.
 *
 * Illustration slots: each controller card can show /ui/guide-*.png. Those
 * images are produced by a separate workstream and may not exist yet, so a
 * failed load simply removes the slot rather than leaving a broken image.
 *
 * Styling hooks for the upcoming paint-mask pass: the primary button carries
 * `paint-btn` and the tip chips carry `splat-chip`. Both have complete solid
 * styling here so nothing depends on those classes existing in CSS yet.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Crosshair, Pencil, Square, Sparkles, Undo2, Redo2, Palette, ChevronDown,
  Droplets, MousePointer, QrCode, Video, SprayCan, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useFlags } from '../config/flags';

/* ------------------------------------------------------------------
   Content
   ------------------------------------------------------------------ */

interface GuideCard {
  /** Small accent-coloured caps label — the mode name / step number. */
  tag: string;
  headline: string;
  body: string;
  icon: LucideIcon;
  accent: string;
  /** Optional illustration; hidden gracefully if the asset is missing. */
  image?: string;
}

interface GuideTip {
  icons: LucideIcon[];
  label: string;
}

const CONTROLLER_CARDS: GuideCard[] = [
  {
    tag: 'Aim',
    headline: 'Point & spray',
    body:
      'Point your phone at the studio screen like a real can. Hold anywhere to spray; paint lands where you aim. Tap Recentre to zero your aim.',
    icon: Crosshair,
    accent: '#FF4D1C',
    image: '/ui/guide-aim.png',
  },
  {
    tag: 'Paint',
    headline: 'Touch the object itself',
    body: 'Paint the 3D object right on your phone. One finger paints — two fingers rotate & zoom.',
    icon: Pencil,
    accent: '#22D3EE',
    image: '/ui/guide-paint.png',
  },
  {
    tag: 'Pad',
    headline: 'Precision trackpad',
    body: "A flat pad mapped straight onto the object's skin. Great for precise fills.",
    icon: Square,
    accent: '#A78BFA',
    image: '/ui/guide-pad.png',
  },
];

const CONTROLLER_TIPS: GuideTip[] = [
  { icons: [Sparkles], label: 'Shake phone = re-centre your aim' },
  { icons: [Undo2, Redo2], label: 'Undo / Redo' },
  { icons: [Palette], label: 'Colour button is always on screen' },
  { icons: [ChevronDown], label: 'Collapse the dock for full immersion' },
  { icons: [Droplets], label: 'Spray & hold = drips' },
];

const STUDIO_CARDS: GuideCard[] = [
  {
    tag: '01',
    headline: 'Paint with your mouse',
    body: 'Left-drag paints, right-drag orbits. Press B to swap spray/brush.',
    icon: MousePointer,
    accent: '#FF4D1C',
  },
  {
    tag: '02',
    headline: 'Invite painters',
    body:
      'Open Invite and let phones scan the QR — they jump straight into this session as motion-tracked spray cans.',
    icon: QrCode,
    accent: '#22D3EE',
  },
  {
    tag: '03',
    headline: 'Direct the room',
    body:
      'Toggle CAM on a player to let their phone rotate your view. Undo/redo any stroke (Ctrl+Z / Ctrl+Shift+Z), replay the artwork painting itself, save snapshots.',
    icon: Video,
    accent: '#A78BFA',
  },
];

/* ------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------ */

const cardSpring = { type: 'spring', stiffness: 420, damping: 34 } as const;

/** Accent-tinted square icon chip with a soft glow — the card's identity. */
const AccentChip: React.FC<{ icon: LucideIcon; accent: string; size?: number }> = ({
  icon: Icon,
  accent,
  size = 38,
}) => (
  <div
    aria-hidden
    className="rounded-xl grid place-items-center shrink-0"
    style={{
      width: size,
      height: size,
      background: `linear-gradient(140deg, ${accent}30, ${accent}12)`,
      border: `1px solid ${accent}55`,
      boxShadow: `0 0 20px -4px ${accent}80, inset 0 1px 0 rgba(255,255,255,0.14)`,
    }}
  >
    <Icon size={Math.round(size * 0.44)} style={{ color: accent }} />
  </div>
);

const ModeCard: React.FC<{
  card: GuideCard;
  index: number;
  stacked: boolean;
  imageHidden: boolean;
  onImageError: (src: string) => void;
}> = ({ card, index, stacked, imageHidden, onImageError }) => (
  <motion.div
    initial={{ opacity: 0, y: 18, scale: 0.97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ ...cardSpring, delay: 0.12 + index * 0.07 }}
    className="relative rounded-2xl bg-white/[0.05] border border-white/10 p-4 overflow-hidden"
  >
    {/* Accent edge */}
    <span
      aria-hidden
      className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
      style={{ background: card.accent, boxShadow: `0 0 12px ${card.accent}aa` }}
    />

    <div className={stacked ? 'flex flex-col gap-2.5' : 'flex items-start gap-3'}>
      <AccentChip icon={card.icon} accent={card.accent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="label-caps" style={{ color: card.accent }}>
            {card.tag}
          </span>
          <span className="text-[15px] font-semibold text-white tracking-tight whitespace-nowrap">
            {card.headline}
          </span>
        </div>
        <div>
          {card.image && !imageHidden && (
            <img
              src={card.image}
              alt=""
              loading="lazy"
              draggable={false}
              onError={() => onImageError(card.image!)}
              className="float-right w-20 h-20 object-contain ml-2.5 -mt-1 select-none"
            />
          )}
          <p className="text-[13px] leading-relaxed text-white/65">{card.body}</p>
        </div>
      </div>
    </div>
  </motion.div>
);

/* ------------------------------------------------------------------
   WelcomeGuide
   ------------------------------------------------------------------ */

export const WelcomeGuide: React.FC<{
  open: boolean;
  onClose: () => void;
  role: 'studio' | 'controller';
}> = ({ open, onClose, role }) => {
  const isStudio = role === 'studio';
  const flags = useFlags();
  // Filtered at render, not at the source: the Pad card is written and ready,
  // and the day the owner switches Pad back on it must reappear in the guide
  // without a deploy.
  const cards = (isStudio ? STUDIO_CARDS : CONTROLLER_CARDS).filter(
    (card) => card.tag !== 'Pad' || flags.ui.padMode
  );

  // Illustration assets ship from another workstream and may not exist yet;
  // a failed load hides that slot for the rest of the session.
  const [hiddenImages, setHiddenImages] = useState<Record<string, boolean>>({});
  const hideImage = useCallback(
    (src: string) => setHiddenImages((prev) => (prev[src] ? prev : { ...prev, [src]: true })),
    []
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const title = isStudio ? 'Welcome to the studio' : 'You are the spray can';
  const subtitle = isStudio
    ? "Your screen is the wall — here's how to run the room."
    : 'Three ways to paint. Switch any time with the top selector.';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6"
          initial="hidden"
          animate="shown"
          exit="hidden"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* Backdrop */}
          <motion.div
            variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
          />

          {/* Panel — glass-strong with a near-opaque ink wash so the guide reads
              as a moment of focus rather than another translucent island. */}
          <motion.div
            variants={{
              hidden: { opacity: 0, scale: 0.92, y: 18 },
              shown: { opacity: 1, scale: 1, y: 0 },
            }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className={`relative w-full ${
              isStudio ? 'max-w-3xl' : 'max-w-md'
            } glass-strong glass-sheen rounded-3xl overflow-hidden flex flex-col max-h-[88vh]`}
            style={{
              background: 'linear-gradient(180deg, rgba(17,17,28,0.93), rgba(8,8,14,0.95))',
            }}
          >
            {/* Ambient accent glows along the top edge */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-28 pointer-events-none"
              style={{
                background:
                  'radial-gradient(ellipse 55% 100% at 18% 0%, rgba(255,77,28,0.16), transparent 70%),' +
                  'radial-gradient(ellipse 45% 90% at 62% 0%, rgba(34,211,238,0.1), transparent 70%),' +
                  'radial-gradient(ellipse 45% 90% at 95% 0%, rgba(167,139,250,0.12), transparent 70%)',
              }}
            />

            {/* ------------------------------ header ------------------------------ */}
            <header className="relative shrink-0 px-5 sm:px-6 pt-5 pb-4 flex items-start gap-3.5">
              <motion.div
                initial={{ scale: 0.6, rotate: -14, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 20, delay: 0.05 }}
                className="w-11 h-11 rounded-[15px] bg-gradient-to-tr from-[#FF4D1C] to-[#FFB020] grid place-items-center shadow-[0_0_28px_rgba(255,77,28,0.5)] shrink-0"
              >
                <SprayCan size={21} className="text-white drop-shadow" />
              </motion.div>

              <div className="flex-1 min-w-0 pt-0.5">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white leading-tight">
                  {title}
                </h2>
                <p className="text-[12.5px] text-white/55 mt-1 leading-snug">{subtitle}</p>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close guide"
                className="tap glass rounded-full w-8 h-8 grid place-items-center text-white/70 hover:text-white shrink-0"
              >
                <X size={15} />
              </button>
            </header>

            {/* ------------------------------ body ------------------------------ */}
            <div className="relative flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 pb-5">
              <div className={isStudio ? 'grid gap-3 sm:grid-cols-3' : 'flex flex-col gap-3'}>
                {cards.map((card, index) => (
                  <ModeCard
                    key={card.tag}
                    card={card}
                    index={index}
                    stacked={isStudio}
                    imageHidden={!card.image || !!hiddenImages[card.image]}
                    onImageError={hideImage}
                  />
                ))}
              </div>

              {!isStudio && (
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...cardSpring, delay: 0.12 + CONTROLLER_CARDS.length * 0.07 }}
                  className="mt-4"
                >
                  <div className="label-caps text-white/35 mb-2">Quick tips</div>
                  <div className="flex flex-wrap gap-1.5">
                    {CONTROLLER_TIPS.map((tip) => (
                      <span
                        key={tip.label}
                        className="splat-chip glass rounded-full pl-2.5 pr-3 py-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-white/80"
                      >
                        {tip.icons.map((Icon, iconIndex) => (
                          <Icon
                            key={iconIndex}
                            size={12}
                            className="text-[var(--color-airo-ember)] shrink-0"
                          />
                        ))}
                        {tip.label}
                      </span>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

            {/* ------------------------------ footer ------------------------------ */}
            <footer className="relative shrink-0 px-5 sm:px-6 pt-3 pb-5 safe-bottom border-t border-white/[0.07]">
              <motion.button
                type="button"
                onClick={onClose}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...cardSpring, delay: 0.24 }}
                className="paint-btn tap w-full py-4 px-10 text-white text-[14px] font-bold tracking-wide flex items-center justify-center gap-2"
                style={{ '--paint': 'linear-gradient(120deg, #FF4D1C, #FF7A34 70%, #FFB020)' } as React.CSSProperties}
              >
                <SprayCan size={16} />
                Let's paint
              </motion.button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default WelcomeGuide;
