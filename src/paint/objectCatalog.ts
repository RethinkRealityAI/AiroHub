/**
 * The paintable object catalog.
 *
 * Mirrors `scripts/model-catalog.mjs` (which drives Meshy generation) and adds
 * the presentation metadata the UI needs. Kept as plain data so the object
 * picker, the controller sheet and the loader all agree on one source of truth.
 */
import { TargetObjectType } from '../types';

export type ObjectCategory = 'Canvas' | 'Street' | 'Objects' | 'Uploads';

export interface PaintableObject {
  id: TargetObjectType;
  label: string;
  /** Short label for the phone controller, where space is tight. */
  short: string;
  /**
   * Rendered thumbnail of the actual model (`/ui/objects/<id>.webp`, a cutout
   * on transparency). Absent for uploads, which fall back to a glyph chip.
   */
  thumb?: string;
  category: ObjectCategory;
  blurb: string;
  /** Longest dimension in world units after normalisation. */
  targetSize: number;
  /** Extra Y rotation so each model faces the camera at its best angle. */
  yaw?: number;
}

export const PAINTABLE_OBJECTS: PaintableObject[] = [
  {
    id: 'easel',
    label: 'Studio Easel',
    short: 'Easel',
    thumb: '/ui/objects/easel.webp',
    category: 'Canvas',
    blurb: 'Blank stretched canvas on an oak easel.',
    targetSize: 12,
  },
  {
    id: 'wall',
    label: 'Alley Wall',
    short: 'Wall',
    thumb: '/ui/objects/wall.webp',
    category: 'Canvas',
    blurb: 'Weathered brick with a concrete ledge.',
    targetSize: 14,
  },
  {
    id: 'skateboard',
    label: 'Skate Deck',
    short: 'Deck',
    thumb: '/ui/objects/skateboard.webp',
    category: 'Street',
    blurb: 'Full complete with trucks and wheels.',
    targetSize: 12,
  },
  {
    id: 'subway',
    label: 'Subway Car',
    short: 'Subway',
    thumb: '/ui/objects/subway.webp',
    category: 'Street',
    blurb: 'Stainless steel panel, straight from the yard.',
    targetSize: 15,
  },
  {
    id: 'hydrant',
    label: 'Fire Hydrant',
    short: 'Hydrant',
    thumb: '/ui/objects/hydrant.webp',
    category: 'Street',
    blurb: 'Cast iron, primed and waiting.',
    targetSize: 9,
  },
  {
    id: 'van',
    label: 'Delivery Van',
    short: 'Van',
    thumb: '/ui/objects/van.webp',
    category: 'Street',
    blurb: 'Big blank cargo panel to run a piece across.',
    targetSize: 14,
  },
  {
    id: 'boombox',
    label: 'Boombox',
    short: 'Boombox',
    thumb: '/ui/objects/boombox.webp',
    category: 'Street',
    blurb: 'Eighties twin-deck ghetto blaster.',
    targetSize: 12,
  },
  {
    id: 'helmet',
    label: 'Moto Helmet',
    short: 'Helmet',
    thumb: '/ui/objects/helmet.webp',
    category: 'Objects',
    blurb: 'Full-face shell, custom paint ready.',
    targetSize: 9,
  },
  {
    id: 'sneaker',
    label: 'High-Top',
    short: 'Sneaker',
    thumb: '/ui/objects/sneaker.webp',
    category: 'Objects',
    blurb: 'Blank canvas upper, cream sole.',
    targetSize: 11,
  },
  {
    id: 'vinyltoy',
    label: 'Vinyl Toy',
    short: 'Toy',
    thumb: '/ui/objects/vinyltoy.webp',
    category: 'Objects',
    blurb: 'Blank designer art toy.',
    targetSize: 10,
  },
  {
    id: 'sculpture',
    label: 'Marble Bust',
    short: 'Bust',
    thumb: '/ui/objects/sculpture.webp',
    category: 'Objects',
    blurb: 'Classical portrait bust on a plinth.',
    targetSize: 11,
  },
  {
    id: 'hoodie',
    label: 'Hoodie',
    short: 'Hoodie',
    thumb: '/ui/objects/hoodie.webp',
    category: 'Objects',
    blurb: 'Heavyweight fleece, blank front.',
    targetSize: 11,
  },
  {
    id: 'guitar',
    label: 'Electric Guitar',
    short: 'Guitar',
    thumb: '/ui/objects/guitar.webp',
    category: 'Objects',
    blurb: 'Solid body begging for a finish.',
    targetSize: 13,
  },
  {
    id: 'cap',
    label: 'Snapback',
    short: 'Cap',
    thumb: '/ui/objects/cap.webp',
    category: 'Objects',
    blurb: 'Flat brim, six blank panels.',
    targetSize: 8,
  },
];

export const OBJECT_BY_ID = new Map<TargetObjectType, PaintableObject>(
  PAINTABLE_OBJECTS.map((o) => [o.id, o])
);

export const OBJECT_CATEGORIES: ObjectCategory[] = ['Canvas', 'Street', 'Objects', 'Uploads'];

export function objectsInCategory(category: ObjectCategory): PaintableObject[] {
  return PAINTABLE_OBJECTS.filter((o) => o.category === category);
}
