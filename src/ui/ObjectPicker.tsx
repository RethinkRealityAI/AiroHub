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
 */
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, ChevronDown, Box, Upload, Loader2 } from 'lucide-react';
import { TargetObjectType } from '../types';
import {
  OBJECT_BY_ID,
  OBJECT_CATEGORIES,
  objectsInCategory,
  PaintableObject,
} from '../paint/objectCatalog';
import { Sheet } from './Glass';

export const ObjectTrigger: React.FC<{
  objectId: TargetObjectType;
  customName?: string;
  onClick: () => void;
  compact?: boolean;
}> = ({ objectId, customName, onClick, compact }) => {
  const meta = OBJECT_BY_ID.get(objectId);
  const label = objectId === 'custom3d' ? customName || 'Custom Model' : meta?.label || 'Object';
  const icon = objectId === 'custom3d' ? '📦' : meta?.icon || '🎨';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap glass glass-sheen rounded-full flex items-center gap-2 ${
        compact ? 'pl-2.5 pr-2 py-1.5' : 'pl-3 pr-2.5 py-2'
      } text-white`}
    >
      <span className={compact ? 'text-[15px]' : 'text-[17px]'} aria-hidden>
        {icon}
      </span>
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
    className={`tap relative text-left rounded-2xl p-3 border transition-colors ${
      selected
        ? 'bg-white/[0.16] border-white/40'
        : 'bg-white/[0.05] border-white/10 hover:bg-white/[0.09] hover:border-white/20'
    }`}
  >
    {selected && (
      <motion.span
        layoutId="object-card-selected"
        transition={{ type: 'spring', stiffness: 460, damping: 36 }}
        className="absolute inset-0 rounded-2xl ring-2 ring-[var(--color-airo-flame)] pointer-events-none"
      />
    )}
    <div className="flex items-center gap-2.5 mb-1.5">
      <span className="text-[22px] leading-none" aria-hidden>
        {object.icon}
      </span>
      <span className="text-[12px] font-semibold text-white truncate flex-1">{object.label}</span>
      {loading ? (
        <Loader2 size={13} className="text-white/60 animate-spin" />
      ) : (
        selected && <Check size={13} className="text-[var(--color-airo-flame)]" />
      )}
    </div>
    <p className="text-[10px] leading-snug text-white/45">{object.blurb}</p>
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
    {OBJECT_CATEGORIES.map((category) => (
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
                icon: '📦',
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
            className="tap rounded-2xl p-3 border border-dashed border-white/20 hover:border-white/40 bg-white/[0.03] flex flex-col items-center justify-center gap-1.5 min-h-[86px] text-white/60 hover:text-white"
          >
            <Upload size={17} />
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
