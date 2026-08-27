/**
 * Object switcher.
 *
 * Replaces the old row of nine cramped icon buttons that were duplicated (and
 * truncated differently) on both screens. There is now one component with two
 * presentations:
 *
 *   - a compact trigger that shows what is currently loaded
 *   - a sheet of categorised cards, which scales to any number of objects and
 *     is comfortable to hit on a phone
 *
 * Every built-in object carries a render of its own model (`/ui/objects/*.webp`,
 * cutouts on transparency), so the picker shows the actual thing you are about
 * to paint rather than a stand-in glyph. Uploads — which have no render — get a
 * tinted `Boxes` chip instead.
 */
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, ChevronDown, Box, Boxes, Upload, Loader2 } from 'lucide-react';
import { TargetObjectType } from '../types';
import {
  OBJECT_BY_ID,
  OBJECT_CATEGORIES,
  objectsInCategory,
  PaintableObject,
} from '../paint/objectCatalog';
import { Sheet } from './Glass';

/**
 * A model render, or the upload fallback.
 *
 * The renders are lit for a dark stage and sit on transparency, so they need a
 * ground of their own to read as objects rather than floating cut-outs: a soft
 * radial pool behind them does that without boxing them in.
 */
export const ObjectThumb: React.FC<{
  thumb?: string;
  label: string;
  /** Edge length of the square the render is fitted into. */
  size?: number;
  /** Colour of the pool behind the render and of the fallback glyph. */
  accent?: string;
  className?: string;
}> = ({ thumb, label, size = 34, accent = 'var(--color-airo-aqua)', className = '' }) => (
  <span
    className={`relative grid shrink-0 place-items-center overflow-hidden ${className}`}
    style={{ width: size, height: size }}
  >
    <span
      aria-hidden
      className="absolute inset-0"
      style={{ background: `radial-gradient(circle at 50% 62%, ${accent}2e, transparent 68%)` }}
    />
    {thumb ? (
      <img
        src={thumb}
        alt={label}
        draggable={false}
        className="relative h-full w-full object-contain drop-shadow-[0_3px_8px_rgba(0,0,0,0.55)]"
      />
    ) : (
      <Boxes
        size={Math.round(size * 0.5)}
        className="relative"
        style={{ color: accent }}
        aria-label={label}
      />
    )}
  </span>
);

export const ObjectTrigger: React.FC<{
  objectId: TargetObjectType;
  customName?: string;
  onClick: () => void;
  compact?: boolean;
}> = ({ objectId, customName, onClick, compact }) => {
  const meta = OBJECT_BY_ID.get(objectId);
  const label = objectId === 'custom3d' ? customName || 'Custom Model' : meta?.label || 'Object';
  const thumb = objectId === 'custom3d' ? undefined : meta?.thumb;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap glass glass-sheen rounded-full flex items-center gap-2 ${
        compact ? 'pl-1.5 pr-2 py-1' : 'pl-2 pr-2.5 py-1.5'
      } text-white`}
    >
      <ObjectThumb
        thumb={thumb}
        label={label}
        size={compact ? 24 : 28}
        className="rounded-full bg-white/[0.06]"
      />
      <span className={`font-semibold tracking-tight ${compact ? 'text-[11px]' : 'text-[12px]'} truncate max-w-[130px]`}>
        {label}
      </span>
      <ChevronDown size={13} className="text-white/50" />
    </button>
  );
};

const ObjectCard: React.FC<{
  object: PaintableObject;
  selected: boolean;
  loading: boolean;
  onSelect: () => void;
}> = ({ object, selected, loading, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className={`tap group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-colors ${
      selected
        ? 'bg-white/[0.14] border-white/35'
        : 'bg-white/[0.045] border-white/10 hover:bg-white/[0.085] hover:border-white/20'
    }`}
  >
    {selected && (
      <motion.span
        layoutId="object-card-selected"
        transition={{ type: 'spring', stiffness: 460, damping: 36 }}
        className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-[var(--color-airo-flame)]"
      />
    )}

    <div className="relative grid h-[102px] shrink-0 place-items-center px-3 pt-3">
      <ObjectThumb thumb={object.thumb} label={object.label} size={86} accent="#FF7A34" />
      {loading && (
        <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-black/55">
          <Loader2 size={11} className="animate-spin text-white/80" />
        </span>
      )}
      {selected && !loading && (
        <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-[var(--color-airo-flame)]">
          <Check size={11} className="text-white" />
        </span>
      )}
    </div>

    <div className="relative px-3 pb-3 pt-1.5">
      <div className="truncate text-[12px] font-semibold text-white">{object.label}</div>
      <p className="mt-0.5 text-[10px] leading-snug text-white/45 line-clamp-2">{object.blurb}</p>
    </div>
  </button>
);

export const ObjectPickerSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  objectId: TargetObjectType;
  onSelect: (id: TargetObjectType) => void;
  loadingId?: string | null;
  /** Studio only — the phone controller cannot upload files. */
  onUpload?: () => void;
  customName?: string;
}> = ({ open, onClose, objectId, onSelect, loadingId, onUpload, customName }) => (
  <Sheet
    open={open}
    onClose={onClose}
    title="Choose a canvas"
    subtitle="Every object is a real 3D model you can paint from any angle"
  >
    {OBJECT_CATEGORIES.filter((category) => objectsInCategory(category).length > 0).map((category) => (
      <section key={category} className="mb-5 last:mb-0">
        <h3 className="label-caps text-white/40 mb-2 px-0.5">{category}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {objectsInCategory(category).map((object) => (
            <ObjectCard
              key={object.id}
              object={object}
              selected={object.id === objectId}
              loading={loadingId === object.id}
              onSelect={() => {
                onSelect(object.id);
                onClose();
              }}
            />
          ))}
        </div>
      </section>
    ))}

    {onUpload && (
      <section>
        <h3 className="label-caps text-white/40 mb-2 px-0.5">Your own</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {customName && (
            <ObjectCard
              object={{
                id: 'custom3d',
                label: customName,
                short: customName,
                category: 'Objects',
                blurb: 'Your uploaded model.',
                targetSize: 11,
              }}
              selected={objectId === 'custom3d'}
              loading={false}
              onSelect={() => {
                onSelect('custom3d');
                onClose();
              }}
            />
          )}
          <button
            type="button"
            onClick={() => {
              onUpload();
              onClose();
            }}
            className="tap flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] text-white/60 hover:border-white/40 hover:text-white"
          >
            <Upload size={18} />
            <span className="text-[10px] font-semibold">Upload GLB / OBJ</span>
          </button>
        </div>
      </section>
    )}

    <p className="mt-5 text-[10px] text-white/35 flex items-center gap-1.5">
      <Box size={11} />
      Models stream in on demand, so switching stays instant after the first load.
    </p>
  </Sheet>
);
