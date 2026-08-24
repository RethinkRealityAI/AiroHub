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
  /** Accent applied to the sliding pill when this option is selected. */
  accent?: string;
}

/**
 * iOS-style segmented control. The selection indicator is a single shared
 * element animated between slots with a layout transition, which is what gives
 * it the fluid "the pill moved" feel rather than a cross-fade.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  layoutId,
  className = '',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md' | 'lg';
  /** Must be unique per control instance on screen. */
  layoutId: string;
  className?: string;
}) {
  const pad =
    size === 'lg' ? 'px-5 py-2.5 text-[12px]' : size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3.5 py-1.5 text-[11px]';

  return (
    <div className={`segmented ${className}`} role="tablist">
      {options.map((option) => {
        const selected = option.value === value;
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
          >
            {selected && (
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
            )}
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
}> = ({ open, onClose, title, subtitle, children, centered }) => (
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
            centered ? 'max-w-lg m-4' : 'max-w-2xl'
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
              <h2 className="text-[15px] font-semibold text-white tracking-tight">{title}</h2>
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
