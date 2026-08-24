/**
 * Colour picker.
 *
 * Replaces the old radial picker, which opened a fixed-position panel anchored
 * to the viewport corner — that worked on the studio screen but collided with
 * the controller's own bottom dock. This one pops relative to its trigger and
 * is sized for thumbs.
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Pipette } from 'lucide-react';
import { sounds } from '../utils/audio';

export const PALETTE = [
  { name: 'Flame', hex: '#FF4D1C' },
  { name: 'Ember', hex: '#FFB020' },
  { name: 'Acid', hex: '#D9F32B' },
  { name: 'Lime', hex: '#34D399' },
  { name: 'Aqua', hex: '#22D3EE' },
  { name: 'Azure', hex: '#3B82F6' },
  { name: 'Violet', hex: '#A78BFA' },
  { name: 'Magenta', hex: '#E879F9' },
  { name: 'Rose', hex: '#FB7185' },
  { name: 'Crimson', hex: '#DC2626' },
  { name: 'Bone', hex: '#F5F5F4' },
  { name: 'Chrome', hex: '#94A3B8' },
  { name: 'Ink', hex: '#18181B' },
  { name: 'Gold', hex: '#EAB308' },
];

export const ColorWell: React.FC<{
  color: string;
  onChange: (hex: string) => void;
  /** Opens upward (studio dock) or downward (controller header). */
  placement?: 'up' | 'down';
  size?: number;
}> = ({ color, onChange, placement = 'up', size = 38 }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [open]);

  const pick = (hex: string) => {
    onChange(hex);
    sounds.playClick(1.5);
    if (navigator.vibrate) navigator.vibrate(12);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          sounds.playClick(1.2);
        }}
        style={{ width: size, height: size }}
        aria-label="Choose colour"
        className="tap rounded-full p-[2.5px] grid place-items-center"
      >
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'conic-gradient(from 0deg,#FF4D1C,#FFB020,#D9F32B,#34D399,#22D3EE,#A78BFA,#E879F9,#FF4D1C)',
            opacity: open ? 1 : 0.85,
          }}
        />
        <span
          className="relative w-full h-full rounded-full border-2 border-black/60 shadow-inner"
          style={{ background: color }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: placement === 'up' ? 8 : -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: placement === 'up' ? 8 : -8 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            style={{ [placement === 'up' ? 'bottom' : 'top']: size + 10 } as React.CSSProperties}
            className="absolute right-0 z-50 glass-strong glass-sheen rounded-[22px] p-3 w-[236px] origin-bottom-right"
          >
            <div className="flex items-center justify-between mb-2.5">
              <span className="label-caps text-white/45">Palette</span>
              <button
                type="button"
                onClick={() => customRef.current?.click()}
                className="tap rounded-lg px-2 py-1 bg-white/10 hover:bg-white/20 text-[9px] font-semibold flex items-center gap-1"
              >
                <Pipette size={9} className="text-[var(--color-airo-aqua)]" />
                Custom
              </button>
              <input
                ref={customRef}
                type="color"
                value={color}
                onChange={(e) => onChange(e.target.value)}
                className="sr-only"
                aria-label="Custom colour"
              />
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {PALETTE.map((swatch) => {
                const selected = swatch.hex.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    onClick={() => pick(swatch.hex)}
                    title={swatch.name}
                    className={`tap w-7 h-7 rounded-full grid place-items-center ${
                      selected ? 'ring-2 ring-white ring-offset-2 ring-offset-black/60' : 'hover:scale-110'
                    }`}
                    style={{ background: swatch.hex }}
                  >
                    {selected && (
                      <Check
                        size={12}
                        strokeWidth={3.5}
                        className={['#F5F5F4', '#D9F32B', '#EAB308', '#94A3B8'].includes(swatch.hex) ? 'text-black' : 'text-white'}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              <span className="text-[10px] font-mono text-white/60">{color.toUpperCase()}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
