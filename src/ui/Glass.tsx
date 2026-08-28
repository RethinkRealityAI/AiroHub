/**
 * Liquid-glass UI primitives.
 *
 * Every floating surface in AiroHub is one of these, so blur strength, edge
 * treatment and the specular sheen stay identical between the studio and the
 * phone controller.
 */
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

type Div = React.HTMLAttributes<HTMLDivElement>;

export const GlassPanel: React.FC<
  Div & { strong?: boolean; sheen?: boolean; radius?: string }
> = ({ strong, sheen = true, radius = 'rounded-[26px]', className = '', children, ...rest }) => (
  <div
    className={`${strong ? 'glass-strong' : 'glass'} ${sheen ? 'glass-sheen' : ''} ${radius} ${className}`}
    {...rest}
  >
    {children}
  </div>
);

/** Small pill used for status readouts and player badges. */
export const GlassPill: React.FC<Div & { tone?: 'neutral' | 'live' }> = ({
  tone = 'neutral',
  className = '',
  children,
  ...rest
}) => (
  <div
    className={`glass glass-sheen rounded-full px-3 py-1.5 flex items-center gap-2 ${
      tone === 'live' ? 'border-white/25' : ''
    } ${className}`}
    {...rest}
  >
    {children}
  </div>
);

/** Circular glass button — the standard icon affordance. */
export const GlassIconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: number }
> = ({ active, size = 42, className = '', children, ...rest }) => (
  <button
    type="button"
    style={{ width: size, height: size }}
    className={`tap glass glass-sheen rounded-full grid place-items-center shrink-0 ${
      active ? 'bg-white/20 border-white/35 text-white' : 'text-white/70 hover:text-white'
    } ${className}`}
    {...rest}
  >
    {children}
  </button>
);

/* ------------------------------------------------------------------
   Segmented control
   ------------------------------------------------------------------ */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Accent applied to the sliding indicator when this option is selected. */
  accent?: string;
}

/** Colour a paint-stroke indicator falls back to when an option has no accent. */
const STROKE_FALLBACK = '#FF4D1C';

/**
 * sRGB relative luminance of a `#rrggbb` accent.
 *
 * The palette runs from deep flame red to near-white primer grey, and a label
 * has to stay readable on all of it — white type on the aqua, ember or pastel
 * violet strokes sits under 3:1. Anything above the threshold below gets ink
 * instead; only the deep flame and equally dark accents keep white type, which
 * is also how the brand's own buttons are set.
 */
function luminance(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return 0;
  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((raw) => {
    const c = raw / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Above this, a stroke is light enough that its label must switch to ink. */
const INK_ON_PAINT = 0.3;

/**
 * The selection indicator, as an aerosol stroke instead of a plain pill.
 *
 * `mask-stroke-2` is the sprayed streak from the paint skin: dense across the
 * middle 40% of its own height and feathering out top and bottom, which is
 * exactly the profile a label needs — the type sits on the opaque core while
 * the ragged overspray breaks out of the track. The layer is stretched past
 * the segment vertically (where nothing else is drawn) and barely at all
 * horizontally, so the paint stays attached to the active segment and never
 * washes over the neighbouring label.
 */
const StrokeIndicator: React.FC<{ accent: string }> = ({ accent }) => (
  <span
    aria-hidden
    className="absolute pointer-events-none"
    style={{
      inset: '-46% -6%',
      background: `linear-gradient(105deg, ${accent} 0%, ${accent} 58%, ${accent}d9 100%)`,
      WebkitMaskImage: 'url(/ui/mask-stroke-2.webp)',
      maskImage: 'url(/ui/mask-stroke-2.webp)',
      WebkitMaskSize: '100% 100%',
      maskSize: '100% 100%',
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
      filter: `saturate(1.1) drop-shadow(0 5px 14px ${accent}80)`,
    }}
  />
);

/**
 * iOS-style segmented control. The selection indicator is a single shared
 * element animated between slots with a layout transition, which is what gives
 * it the fluid "the pill moved" feel rather than a cross-fade.
 *
 * `paint` swaps that indicator for a real spray-stroke stencil. Every segment
 * is `flex-1`, so all slots are the same width and the shared element only ever
 * translates — the stroke never stretches mid-flight.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  layoutId,
  className = '',
  paint = false,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md' | 'lg';
  /** Must be unique per control instance on screen. */
  layoutId: string;
  className?: string;
  /** Wear a paint stroke instead of the plain white pill. */
  paint?: boolean;
}) {
  const pad =
    size === 'lg' ? 'px-5 py-2.5 text-[12px]' : size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3.5 py-1.5 text-[11px]';

  return (
    <div className={`segmented ${className}`} role="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        const accent = option.accent || STROKE_FALLBACK;
        const onPaint = selected && paint;
        const inkLabel = onPaint && luminance(accent) > INK_ON_PAINT;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={`tap relative z-10 flex-1 flex items-center justify-center gap-1.5 rounded-full font-semibold tracking-wide whitespace-nowrap ${pad} ${
              selected ? 'text-white' : 'text-white/55 hover:text-white/85'
            }`}
            style={
              onPaint
                ? inkLabel
                  ? { color: '#0B0B12', textShadow: '0 1px 1px rgba(255,255,255,0.35)' }
                  : { textShadow: '0 1px 3px rgba(0,0,0,0.6), 0 0 10px rgba(0,0,0,0.35)' }
                : undefined
            }
          >
            {selected &&
              (paint ? (
                <motion.span
                  layoutId={layoutId}
                  transition={{ type: 'spring', stiffness: 480, damping: 38, mass: 0.7 }}
                  className="absolute inset-0 -z-10"
                >
                  <StrokeIndicator accent={accent} />
                </motion.span>
              ) : (
                <motion.span
                  layoutId={layoutId}
                  transition={{ type: 'spring', stiffness: 480, damping: 38, mass: 0.7 }}
                  className="absolute inset-0 rounded-full -z-10"
                  style={{
                    background: option.accent
                      ? `linear-gradient(140deg, ${option.accent}, ${option.accent}cc)`
                      : 'rgba(255,255,255,0.22)',
                    boxShadow: option.accent
                      ? `0 6px 18px -4px ${option.accent}90, inset 0 1px 0 rgba(255,255,255,0.35)`
                      : 'inset 0 1px 0 rgba(255,255,255,0.3)',
                  }}
                />
              ))}
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------
   Bottom sheet
   ------------------------------------------------------------------ */

/**
 * Modal bottom sheet. Used on the controller wherever a list would otherwise
 * have to be crammed into a horizontal strip — object picking above all.
 */
export const Sheet: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Centres the panel instead of docking it, for desktop dialogs. */
  centered?: boolean;
  /** Roomier centred dialog, for panels that show artwork rather than a list. */
  wide?: boolean;
}> = ({ open, onClose, title, subtitle, children, centered, wide }) => (
  <AnimatePresence>
    {open && (
      <motion.div
        className="fixed inset-0 z-[60] flex justify-center"
        style={{ alignItems: centered ? 'center' : 'flex-end' }}
        initial="hidden"
        animate="shown"
        exit="hidden"
      >
        <motion.div
          variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/75 backdrop-blur-md"
        />
        <motion.div
          variants={{
            hidden: centered ? { opacity: 0, scale: 0.94 } : { y: '100%' },
            shown: centered ? { opacity: 1, scale: 1 } : { y: 0 },
          }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          className={`relative w-full ${
            centered ? `${wide ? 'max-w-2xl' : 'max-w-lg'} m-4` : 'max-w-2xl'
          } glass-modal glass-sheen ${
            centered ? 'rounded-[28px]' : 'rounded-t-[30px] sm:rounded-[30px] sm:mb-4'
          } overflow-hidden max-h-[86vh] flex flex-col`}
        >
          {!centered && (
            <div className="pt-3 pb-1 flex justify-center shrink-0">
              <div className="w-10 h-1 rounded-full bg-white/30" />
            </div>
          )}
          <header className="px-5 pt-3 pb-3 flex items-start justify-between gap-4 shrink-0">
            <div className="min-w-0">
              <h2 className="paint-title text-[15px] font-bold tracking-tight">{title}</h2>
              {subtitle && (
                <p className="text-[11px] text-white/50 mt-0.5 leading-snug">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="tap glass rounded-full w-8 h-8 grid place-items-center text-white/70 hover:text-white shrink-0"
            >
              <X size={15} />
            </button>
          </header>
          <div className="px-5 pb-6 overflow-y-auto safe-bottom">{children}</div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
