/**
 * The stamp shelf.
 *
 * One component family serves both screens so the studio and the phone show
 * the same library, tinted the same way:
 *
 *   `StampTray`  — the studio's anchored glass panel, docked above the bottom
 *                  bar. Deliberately *not* a modal sheet: picking a stamp and
 *                  placing it are the same gesture loop, and a backdrop would
 *                  swallow every tap meant for the model.
 *   `StampStrip` — the controller's one-row version, sized for thumbs.
 *
 * Built-in stencils are white-on-alpha, so their previews are rendered as a
 * CSS mask filled with the painter's current colour — what you see in the tray
 * is literally what lands on the model.
 */
import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { RotateCcw, RotateCw, Shuffle, Upload, Trash2, X, Stamp as StampIcon } from 'lucide-react';

import { StampAsset, StampLibrary, allStamps, recentStamps, BUILTIN_STAMPS } from '../paint/stampAssets';

/* ------------------------------------------------------------------
   Swatch
   ------------------------------------------------------------------ */

export const StampSwatch: React.FC<{
  asset: StampAsset;
  color: string;
  selected: boolean;
  onSelect: (asset: StampAsset) => void;
  onRemove?: (asset: StampAsset) => void;
  size?: number;
}> = ({ asset, color, selected, onSelect, onRemove, size = 54 }) => (
  <div className="relative shrink-0 group" style={{ width: size, height: size }}>
    <button
      type="button"
      onClick={() => onSelect(asset)}
      title={asset.label}
      aria-label={asset.label}
      aria-pressed={selected}
      className={`tap w-full h-full rounded-2xl grid place-items-center border overflow-hidden ${
        selected
          ? 'border-white/60 bg-white/[0.16]'
          : 'border-white/12 bg-white/[0.05] hover:bg-white/[0.11]'
      }`}
      style={selected ? { boxShadow: `0 6px 20px -6px ${color}, inset 0 1px 0 rgba(255,255,255,0.25)` } : undefined}
    >
      {asset.tintable ? (
        <span
          aria-hidden
          className="block w-[68%] h-[68%]"
          style={{
            background: color,
            WebkitMaskImage: `url(${asset.src})`,
            maskImage: `url(${asset.src})`,
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.55))',
          }}
        />
      ) : (
        <img
          src={asset.src}
          alt={asset.label}
          draggable={false}
          className="w-[76%] h-[76%] object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
        />
      )}
    </button>

    {onRemove && (
      <button
        type="button"
        onClick={() => onRemove(asset)}
        title={`Remove ${asset.label}`}
        aria-label={`Remove ${asset.label}`}
        className="tap absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full glass grid place-items-center text-white/70 hover:text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
      >
        <Trash2 size={10} />
      </button>
    )}
  </div>
);

/* ------------------------------------------------------------------
   Rotation stepper
   ------------------------------------------------------------------ */

const STEP_DEG = 15;

export const RotationStepper: React.FC<{
  rotationDeg: number;
  randomise: boolean;
  onRotate: (deg: number) => void;
  onToggleRandom: () => void;
}> = ({ rotationDeg, randomise, onRotate, onToggleRandom }) => {
  // Nudging the angle is a statement of intent: it drops the random tilt so
  // the readout you just set is the angle you actually get.
  const step = (deg: number) => {
    if (randomise) onToggleRandom();
    onRotate(deg);
  };

  return (
  <div className="flex items-center gap-1 rounded-full bg-black/40 border border-white/12 p-0.5 shrink-0">
    <button
      type="button"
      onClick={() => step(rotationDeg - STEP_DEG)}
      title="Rotate anticlockwise"
      aria-label="Rotate anticlockwise"
      className="tap w-7 h-7 rounded-full grid place-items-center text-white/70 hover:text-white hover:bg-white/12"
    >
      <RotateCcw size={12} />
    </button>
    <span className="text-[10px] font-mono text-white/65 w-9 text-center tabular-nums">
      {randomise ? 'RND' : `${Math.round(rotationDeg)}°`}
    </span>
    <button
      type="button"
      onClick={() => step(rotationDeg + STEP_DEG)}
      title="Rotate clockwise"
      aria-label="Rotate clockwise"
      className="tap w-7 h-7 rounded-full grid place-items-center text-white/70 hover:text-white hover:bg-white/12"
    >
      <RotateCw size={12} />
    </button>
    <button
      type="button"
      onClick={onToggleRandom}
      title="Give each stamp a slight random tilt"
      aria-label="Random tilt"
      aria-pressed={randomise}
      className={`tap w-7 h-7 rounded-full grid place-items-center ${
        randomise
          ? 'bg-[var(--color-airo-violet)]/30 text-[var(--color-airo-violet)]'
          : 'text-white/60 hover:text-white hover:bg-white/12'
      }`}
    >
      <Shuffle size={12} />
    </button>
  </div>
  );
};

/* ------------------------------------------------------------------
   Upload control
   ------------------------------------------------------------------ */

const UploadButton: React.FC<{
  onPick: (file: File) => void;
  label?: string;
  compact?: boolean;
  /** Drops to icon-only on narrow screens, where the header row is tight. */
  responsiveLabel?: boolean;
}> = ({ onPick, label = 'Upload', compact, responsiveLabel }) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={`tap glass glass-sheen splat-btn-2 rounded-full flex items-center gap-1.5 font-bold text-white/85 shrink-0 ${
          compact ? 'px-2.5 py-1.5 text-[9px]' : 'px-3 py-1.5 text-[10px]'
        }`}
        style={{ '--paint': 'rgba(34,211,238,0.34)' } as React.CSSProperties}
      >
        <Upload size={compact ? 11 : 12} className="text-[var(--color-airo-aqua)]" />
        <span className={responsiveLabel ? 'hidden sm:inline' : undefined}>{label}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Upload a stamp image"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
    </>
  );
};

/* ------------------------------------------------------------------
   Shared props
   ------------------------------------------------------------------ */

export interface StampShelfProps {
  library: StampLibrary;
  selectedId: string | null;
  color: string;
  rotationDeg: number;
  randomise: boolean;
  onSelect: (asset: StampAsset) => void;
  onUpload: (file: File) => void;
  onRemoveUpload: (asset: StampAsset) => void;
  onRotate: (deg: number) => void;
  onToggleRandom: () => void;
  busy?: boolean;
  error?: string | null;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="label-caps text-white/35 mb-1.5">{title}</div>
    {children}
  </div>
);

/**
 * Contrast backing for a shelf that floats over the 3D stage.
 *
 * Plain glass is tuned for the near-black studio backdrop; parked over a lit
 * brick wall it lets the subject read straight through the labels. This sits
 * under the content but over the panel's own tint, keeping the liquid-glass
 * edge and sheen while the type stays crisp.
 */
const Scrim: React.FC<{ radius: string }> = ({ radius }) => (
  <span
    aria-hidden
    className={`absolute inset-0 ${radius} pointer-events-none bg-[rgba(8,8,14,0.62)]`}
  />
);

/** One thumb-scrollable row of swatches. */
const StampRow: React.FC<{
  assets: StampAsset[];
  color: string;
  selectedId: string | null;
  onSelect: (asset: StampAsset) => void;
  size?: number;
}> = ({ assets, color, selectedId, onSelect, size = 46 }) => (
  <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
    {assets.map((asset) => (
      <StampSwatch
        key={asset.id}
        asset={asset}
        color={color}
        selected={asset.id === selectedId}
        onSelect={onSelect}
        size={size}
      />
    ))}
  </div>
);

/** Recently used first, then everything else, each stamp listed once. */
function shelfOrder(library: StampLibrary): StampAsset[] {
  const seen = new Set<string>();
  return [...recentStamps(library), ...allStamps(library)].filter((asset) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}

/* ------------------------------------------------------------------
   Studio tray
   ------------------------------------------------------------------ */

export const StampTray: React.FC<StampShelfProps & { onClose: () => void }> = ({
  library,
  selectedId,
  color,
  rotationDeg,
  randomise,
  onSelect,
  onUpload,
  onRemoveUpload,
  onRotate,
  onToggleRandom,
  busy,
  error,
  onClose,
}) => {
  const uploads = [...library.uploads].reverse();
  const recents = recentStamps(library);

  // On phones the shelf hugs the right edge so it clears the left view island,
  // and collapses to one scrollable row so it never buries the model.
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className="glass-strong glass-sheen splatter-accent rounded-[26px] p-3 w-full ml-auto max-w-[calc(100%-62px)] md:mx-auto md:max-w-[620px] pointer-events-auto overflow-hidden"
      style={{ '--paint': color } as React.CSSProperties}
    >
      <Scrim radius="rounded-[26px]" />
      <div className="relative z-10 flex items-center gap-2 mb-2.5">
        <StampIcon size={13} className="text-[var(--color-airo-ember)] shrink-0" />
        <span className="label-caps text-white/70 hidden sm:inline">Stamps</span>
        <div className="flex-1" />
        <RotationStepper
          rotationDeg={rotationDeg}
          randomise={randomise}
          onRotate={onRotate}
          onToggleRandom={onToggleRandom}
        />
        <UploadButton onPick={onUpload} responsiveLabel />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close stamp tray"
          className="tap glass rounded-full w-7 h-7 grid place-items-center text-white/65 hover:text-white shrink-0"
        >
          <X size={13} />
        </button>
      </div>

      <div className="relative z-10 md:hidden">
        <StampRow
          assets={shelfOrder(library)}
          color={color}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>

      <div className="relative z-10 max-h-[38vh] overflow-y-auto no-scrollbar hidden md:flex md:flex-col gap-3 pr-0.5">
        <Section title="Stencils">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5">
            {BUILTIN_STAMPS.map((asset) => (
              <StampSwatch
                key={asset.id}
                asset={asset}
                color={color}
                selected={asset.id === selectedId}
                onSelect={onSelect}
                size={52}
              />
            ))}
          </div>
        </Section>

        {uploads.length > 0 && (
          <Section title="Your uploads">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5">
              {uploads.map((asset) => (
                <StampSwatch
                  key={asset.id}
                  asset={asset}
                  color={color}
                  selected={asset.id === selectedId}
                  onSelect={onSelect}
                  onRemove={onRemoveUpload}
                  size={52}
                />
              ))}
            </div>
          </Section>
        )}

        {recents.length > 0 && (
          <Section title="Recently used">
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {recents.map((asset) => (
                <StampSwatch
                  key={`recent-${asset.id}`}
                  asset={asset}
                  color={color}
                  selected={asset.id === selectedId}
                  onSelect={onSelect}
                  size={44}
                />
              ))}
            </div>
          </Section>
        )}
      </div>

      <p className="relative z-10 mt-2 text-[10px] text-white/45 leading-snug">
        {error ? (
          <span className="text-amber-300">{error}</span>
        ) : busy ? (
          'Preparing that image…'
        ) : (
          <>
            Tap the model to place.
            <span className="hidden md:inline">
              {' '}Stencils take your colour; uploads keep theirs. Size follows the dock slider.
            </span>
          </>
        )}
      </p>
    </motion.div>
  );
};

/* ------------------------------------------------------------------
   Controller strip
   ------------------------------------------------------------------ */

export const StampStrip: React.FC<StampShelfProps> = ({
  library,
  selectedId,
  color,
  rotationDeg,
  randomise,
  onSelect,
  onUpload,
  onRotate,
  onToggleRandom,
  busy,
  error,
}) => {
  // Recently used first — a thumb should not have to scroll to reach the
  // stamp it just placed.
  const ordered = shelfOrder(library);

  return (
    <div
      className="glass-strong glass-sheen rounded-[22px] p-2 pointer-events-auto overflow-hidden"
      style={{ '--paint': color } as React.CSSProperties}
    >
      <Scrim radius="rounded-[22px]" />
      <div className="relative z-10 flex items-center gap-2 mb-1.5 px-0.5">
        <StampIcon size={11} className="text-[var(--color-airo-ember)] shrink-0" />
        <span className="label-caps text-white/60 text-[9px]">Stamps</span>
        <div className="flex-1" />
        <RotationStepper
          rotationDeg={rotationDeg}
          randomise={randomise}
          onRotate={onRotate}
          onToggleRandom={onToggleRandom}
        />
        <UploadButton onPick={onUpload} label="Add" compact />
      </div>

      <div className="relative z-10">
        <StampRow assets={ordered} color={color} selectedId={selectedId} onSelect={onSelect} />
      </div>

      <p className="relative z-10 mt-1.5 px-0.5 text-[9px] text-white/45 leading-snug">
        {error ? (
          <span className="text-amber-300">{error}</span>
        ) : busy ? (
          'Preparing that image…'
        ) : (
          'Tap the object to place · drag to rotate the view'
        )}
      </p>
    </div>
  );
};
