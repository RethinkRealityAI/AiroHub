/**
 * The atmosphere picker: a round trigger that wears the current sky, and a
 * popover of gradient tiles, solid dots and a custom colour. Pops relative to
 * its trigger like the colour well, so it works from the header on wide
 * displays and from the view island on compact ones.
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Pipette } from 'lucide-react';
import { sounds } from '../../utils/audio';
import {
  Atmosphere,
  CUSTOM_SOLID_ID,
  GRADIENT_ATMOSPHERES,
  SOLID_ATMOSPHERES,
  atmospherePreview,
  customSolid,
} from './atmospheres';

export const AtmospherePicker: React.FC<{
  value: Atmosphere;
  onChange: (atmo: Atmosphere) => void;
  /** Where the popover opens relative to the trigger. */
  placement?: 'down' | 'right';
  size?: number;
}> = ({ value, onChange, placement = 'down', size = 38 }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (atmo: Atmosphere) => {
    onChange(atmo);
    sounds.playClick(1.3);
  };

  const isCustom = value.kind === 'solid' && value.id === CUSTOM_SOLID_ID;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          sounds.playClick(1.1);
        }}
        aria-label="Studio atmosphere"
        aria-expanded={open}
        title={`Atmosphere: ${value.name}`}
        style={{ width: size, height: size }}
        className={`tap glass glass-sheen rounded-full grid place-items-center ${open ? 'border-white/40' : ''}`}
      >
        <span
          aria-hidden
          className="block rounded-full ring-1 ring-white/30"
          style={{
            width: size * 0.5,
            height: size * 0.5,
            background: atmospherePreview(value),
            boxShadow: `0 0 12px -2px ${value.accent}`,
          }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Choose an atmosphere"
            initial={{ opacity: 0, scale: 0.92, y: placement === 'down' ? -8 : 0, x: placement === 'right' ? -8 : 0 }}
            animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: placement === 'down' ? -8 : 0, x: placement === 'right' ? -8 : 0 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            style={
              placement === 'down'
                ? { top: size + 10, right: 0, transformOrigin: 'top right' }
                : { left: size + 12, bottom: 0, transformOrigin: 'bottom left' }
            }
            className="absolute z-50 glass-modal glass-sheen rounded-[22px] p-3 w-[268px]"
          >
            <div className="mb-2 flex items-center justify-between px-0.5">
              <span className="mono-caps text-[8.5px] text-white/45">Atmosphere</span>
              <span className="text-[10px] font-semibold text-white/70">{value.name}</span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {GRADIENT_ATMOSPHERES.map((atmo) => {
                const selected = value.id === atmo.id;
                return (
                  <button
                    key={atmo.id}
                    type="button"
                    onClick={() => pick(atmo)}
                    aria-pressed={selected}
                    title={atmo.name}
                    className={`tap group relative overflow-hidden rounded-[14px] border text-left ${
                      selected ? 'border-white/70' : 'border-white/10 hover:border-white/35'
                    }`}
                  >
                    <span aria-hidden className="block h-[44px] w-full" style={{ background: atmospherePreview(atmo) }} />
                    <span className="mono-caps block px-1.5 py-1 text-[7.5px] leading-tight text-white/75 truncate bg-black/25">
                      {atmo.short}
                    </span>
                    {selected && (
                      <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-white text-black">
                        <Check size={9} strokeWidth={3.5} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 mb-1.5 flex items-center justify-between px-0.5">
              <span className="mono-caps text-[8.5px] text-white/45">Solid</span>
              <button
                type="button"
                onClick={() => customRef.current?.click()}
                className={`tap rounded-lg px-2 py-1 text-[9px] font-semibold flex items-center gap-1 ${
                  isCustom ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20'
                }`}
              >
                <Pipette size={9} className="text-white/80" />
                Custom
              </button>
              <input
                ref={customRef}
                type="color"
                value={value.kind === 'solid' ? value.color : '#101018'}
                onChange={(e) => onChange(customSolid(e.target.value))}
                className="sr-only"
                aria-label="Custom solid colour"
              />
            </div>
            <div className="flex items-center gap-1.5">
              {SOLID_ATMOSPHERES.map((atmo) => {
                const selected = value.id === atmo.id;
                return (
                  <button
                    key={atmo.id}
                    type="button"
                    onClick={() => pick(atmo)}
                    aria-pressed={selected}
                    title={atmo.name}
                    className={`tap grid h-8 w-8 place-items-center rounded-full border ${
                      selected ? 'border-white ring-2 ring-white/40 ring-offset-2 ring-offset-black/50' : 'border-white/20 hover:border-white/50'
                    }`}
                    style={{ background: atmo.color }}
                  >
                    {selected && <Check size={11} strokeWidth={3.5} className="text-white/90" />}
                  </button>
                );
              })}
              {isCustom && (
                <span
                  className="grid h-8 w-8 place-items-center rounded-full border border-white ring-2 ring-white/40 ring-offset-2 ring-offset-black/50"
                  style={{ background: value.kind === 'solid' ? value.color : undefined }}
                  title="Custom"
                >
                  <Check size={11} strokeWidth={3.5} className="text-white/90" />
                </span>
              )}
            </div>
            <p className="mt-2.5 text-[9px] leading-snug text-white/40">
              Only your screen changes — phones keep their own view. Remembered on this device.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
