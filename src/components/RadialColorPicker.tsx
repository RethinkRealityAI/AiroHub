import React, { useState, useRef, useEffect } from 'react';
import { Palette, Pipette, Check, Sparkles } from 'lucide-react';
import { sounds } from '../utils/audio';

export const CURATED_PALETTE = [
  { name: 'Electric Orange', hex: '#FF3D00', group: 'warm' },
  { name: 'Bright Gold', hex: '#F59E0B', group: 'warm' },
  { name: 'Acid Yellow', hex: '#EAB308', group: 'warm' },
  { name: 'Hot Pink', hex: '#EC4899', group: 'warm' },
  { name: 'Hyper Magenta', hex: '#D946EF', group: 'warm' },
  { name: 'Crimson Red', hex: '#DC2626', group: 'warm' },
  { name: 'Cyber Cyan', hex: '#06B6D4', group: 'cool' },
  { name: 'Sky Azure', hex: '#38BDF8', group: 'cool' },
  { name: 'Acid Lime', hex: '#10B981', group: 'cool' },
  { name: 'Ultra Violet', hex: '#8B5CF6', group: 'cool' },
  { name: 'Indigo Pulse', hex: '#6366F1', group: 'cool' },
  { name: 'Pure White', hex: '#FFFFFF', group: 'mono' },
  { name: 'Chrome Silver', hex: '#94A3B8', group: 'mono' },
  { name: 'Matte Charcoal', hex: '#18181B', group: 'mono' },
];

interface RadialColorPickerProps {
  selectedColor: string;
  onSelectColor: (hex: string) => void;
  className?: string;
}

export const RadialColorPicker: React.FC<RadialColorPickerProps> = ({
  selectedColor,
  onSelectColor,
  className = 'bottom-5 right-5',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const customColorInputRef = useRef<HTMLInputElement>(null);

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !isOpen;
    setIsOpen(next);
    sounds.playClick(next ? 1.4 : 1.1);
    if (navigator.vibrate) navigator.vibrate(12);
  };

  const handlePick = (hex: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    onSelectColor(hex);
    sounds.playClick(1.6);
    if (navigator.vibrate) navigator.vibrate(15);
    setIsOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      className={`fixed ${className} z-50 flex flex-col items-end pointer-events-auto select-none`}
    >
      {/* ========================================================
          EXPANDED POP-OUT PALETTE CLUSTER
          ======================================================== */}
      {isOpen && (
        <div className="mb-3 p-3.5 bg-[#101016]/95 backdrop-blur-xl border border-[#2A2A3A] rounded-2xl shadow-[0_15px_50px_rgba(0,0,0,0.85)] flex flex-col gap-3 min-w-[240px] max-w-[300px] animate-in fade-in zoom-in-95 duration-150 origin-bottom-right">
          <div className="flex items-center justify-between border-b border-[#222230] pb-2">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#AAA] flex items-center gap-1.5">
              <Sparkles size={11} className="text-[#FF3D00]" />
              <span>STREET PALETTE</span>
            </span>

            {/* Custom Hex Color Dropper */}
            <button
              onClick={() => customColorInputRef.current?.click()}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#1C1C28] hover:bg-[#252536] border border-[#333346] text-[9px] font-mono text-[#DDD] transition-all"
              title="Custom Hex Color"
            >
              <Pipette size={10} className="text-cyan-400" />
              <span>CUSTOM</span>
            </button>
            <input
              ref={customColorInputRef}
              type="color"
              value={selectedColor}
              onChange={(e) => onSelectColor(e.target.value)}
              className="sr-only"
            />
          </div>

          {/* Color Swatches Grid */}
          <div className="grid grid-cols-5 gap-2 justify-items-center">
            {CURATED_PALETTE.map((c) => {
              const isSelected = selectedColor.toLowerCase() === c.hex.toLowerCase();
              return (
                <button
                  key={c.hex}
                  onClick={(e) => handlePick(c.hex, e)}
                  className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 transform ${
                    isSelected
                      ? 'scale-115 ring-2 ring-white ring-offset-2 ring-offset-[#101016] shadow-[0_0_12px_rgba(255,255,255,0.4)]'
                      : 'hover:scale-110 active:scale-95 opacity-90 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.name}
                >
                  {isSelected && (
                    <Check
                      size={13}
                      className={
                        c.hex === '#FFFFFF' || c.hex === '#EAB308' || c.hex === '#94A3B8'
                          ? 'text-black font-bold stroke-[3]'
                          : 'text-white font-bold stroke-[3]'
                      }
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Active Color Info Display */}
          <div className="flex items-center justify-between pt-1 border-t border-[#1F1F2C] text-[9px] font-mono text-[#777]">
            <div className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full border border-black/40"
                style={{ backgroundColor: selectedColor }}
              />
              <span className="text-[#DDD] font-bold">{selectedColor.toUpperCase()}</span>
            </div>
            <span>TOUCH COLOR TO SELECT</span>
          </div>
        </div>
      )}

      {/* ========================================================
          FLOATING ACTION TOGGLE BUTTON (COLORFUL RAINBOW RING)
          ======================================================== */}
      <button
        onClick={toggleOpen}
        className={`relative group w-13 h-13 rounded-full p-[2.5px] transition-all duration-200 transform ${
          isOpen
            ? 'scale-105 shadow-[0_0_25px_rgba(255,61,0,0.6)] rotate-12'
            : 'hover:scale-110 active:scale-95 shadow-[0_0_20px_rgba(0,0,0,0.7)]'
        }`}
        style={{
          background:
            'conic-gradient(from 0deg, #FF3D00, #F59E0B, #10B981, #06B6D4, #8B5CF6, #EC4899, #FF3D00)',
        }}
        title="Toggle Color Palette"
      >
        {/* Inner Button Disc with Current Selected Color */}
        <div
          className="w-full h-full rounded-full flex items-center justify-center border-2 border-black shadow-inner transition-colors duration-200"
          style={{ backgroundColor: selectedColor }}
        >
          <Palette
            size={18}
            className={`drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] transition-transform duration-200 ${
              isOpen ? 'scale-110 text-white' : 'text-white group-hover:rotate-12'
            }`}
          />
        </div>

        {/* Pulse ping animation when closed */}
        {!isOpen && (
          <span
            className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#101016] animate-pulse"
            style={{ backgroundColor: selectedColor }}
          />
        )}
      </button>
    </div>
  );
};
