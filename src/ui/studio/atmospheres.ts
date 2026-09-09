/**
 * Studio atmospheres — the sky behind the stage, and the accent the studio's
 * own furniture takes from it.
 *
 * Each gradient preset is a small palette: three light masses (`a` top-left,
 * `b` top-right, `c` low centre), three sky stops and an accent trio the glass,
 * the dials and the buttons pick up. Solid presets are exactly that — one flat
 * colour, no light, no grain — for when the piece should be the only thing on
 * screen. Everything reaches CSS as custom properties on the studio root, so a
 * change of atmosphere is one style attribute, not a re-render of the rails.
 */

export interface AccentTrio {
  /** The studio's primary accent (dials, selected rows, tiles). */
  accent: string;
  /** Darker end of the accent gradient. */
  deep: string;
  /** Hot, lighter end of the accent gradient. */
  hot: string;
  /** Type colour on a solid accent fill. */
  onAccent: string;
}

export interface GradientAtmosphere extends AccentTrio {
  kind: 'gradient';
  id: string;
  name: string;
  /** One word for a swatch label; `name` is for the trigger and the header. */
  short: string;
  /** Light masses. */
  a: string;
  b: string;
  c: string;
  /** Sky gradient, top to bottom. */
  sky: [string, string, string];
  /** The darkest ink; card bodies and the page fallback. */
  ink: string;
}

export interface SolidAtmosphere extends AccentTrio {
  kind: 'solid';
  id: string;
  name: string;
  color: string;
}

export type Atmosphere = GradientAtmosphere | SolidAtmosphere;

const VIOLET: AccentTrio = { accent: '#a855f7', deep: '#7c3aed', hot: '#ec4899', onAccent: '#ffffff' };

export const GRADIENT_ATMOSPHERES: GradientAtmosphere[] = [
  {
    kind: 'gradient',
    id: 'dusk',
    name: 'Violet Dusk',
    short: 'Dusk',
    a: '#7c3aed',
    b: '#e0409a',
    c: '#b060ff',
    sky: ['#1a0b2c', '#26113f', '#170a26'],
    ink: '#12071f',
    ...VIOLET,
  },
  {
    kind: 'gradient',
    id: 'ember',
    name: 'Ember Alley',
    short: 'Ember',
    a: '#ff4d1c',
    b: '#ffb020',
    c: '#ff6a3d',
    sky: ['#1c0a08', '#2c110a', '#130605'],
    ink: '#120607',
    accent: '#ff6a3d',
    deep: '#d93a12',
    hot: '#ffb020',
    onAccent: '#ffffff',
  },
  {
    kind: 'gradient',
    id: 'neon',
    name: 'Neon Yard',
    short: 'Neon',
    a: '#22d3ee',
    b: '#a78bfa',
    c: '#0ea5e9',
    sky: ['#041421', '#07233b', '#030d19'],
    ink: '#04101c',
    accent: '#22d3ee',
    deep: '#0891b2',
    hot: '#a78bfa',
    onAccent: '#06131a',
  },
  {
    kind: 'gradient',
    id: 'chrome',
    name: 'Chrome Sunset',
    short: 'Chrome',
    a: '#f97316',
    b: '#ec4899',
    c: '#f43f5e',
    sky: ['#1a0812', '#2b0c1e', '#120510'],
    ink: '#14060e',
    accent: '#f472b6',
    deep: '#db2777',
    hot: '#fb923c',
    onAccent: '#ffffff',
  },
  {
    kind: 'gradient',
    id: 'acid',
    name: 'Acid Rain',
    short: 'Acid',
    a: '#d9f32b',
    b: '#34d399',
    c: '#84cc16',
    sky: ['#0b1207', '#15210b', '#070c04'],
    ink: '#0a1006',
    accent: '#a3e635',
    deep: '#4d7c0f',
    hot: '#34d399',
    onAccent: '#0b1206',
  },
  {
    kind: 'gradient',
    id: 'graphite',
    name: 'Graphite',
    short: 'Graphite',
    a: '#64748b',
    b: '#94a3b8',
    c: '#475569',
    sky: ['#0b0d12', '#151923', '#07080c'],
    ink: '#0a0c10',
    accent: '#94a3b8',
    deep: '#475569',
    hot: '#e2e8f0',
    onAccent: '#0b0d12',
  },
];

export const SOLID_ATMOSPHERES: SolidAtmosphere[] = [
  { kind: 'solid', id: 'void', name: 'Void', color: '#05050a', ...VIOLET },
  { kind: 'solid', id: 'ink', name: 'Ink', color: '#0f0f16', ...VIOLET },
  { kind: 'solid', id: 'plum', name: 'Plum', color: '#1b1026', ...VIOLET },
  { kind: 'solid', id: 'navy', name: 'Navy', color: '#0b1424', accent: '#38bdf8', deep: '#0369a1', hot: '#a5f3fc', onAccent: '#06131a' },
  { kind: 'solid', id: 'moss', name: 'Moss', color: '#0f1a14', accent: '#4ade80', deep: '#15803d', hot: '#d9f99d', onAccent: '#06130b' },
  { kind: 'solid', id: 'concrete', name: 'Concrete', color: '#2a2a31', accent: '#cbd5e1', deep: '#64748b', hot: '#f8fafc', onAccent: '#0b0d12' },
];

export const CUSTOM_SOLID_ID = 'custom';

export const DEFAULT_ATMOSPHERE = GRADIENT_ATMOSPHERES[0];

/** A solid of the user's own colour; the accent stays the house violet. */
export function customSolid(color: string): SolidAtmosphere {
  return { kind: 'solid', id: CUSTOM_SOLID_ID, name: 'Custom', color, ...VIOLET };
}

/** Inline preview of an atmosphere, for swatches and the picker's trigger. */
export function atmospherePreview(atmo: Atmosphere): string {
  if (atmo.kind === 'solid') return atmo.color;
  return `radial-gradient(circle at 30% 25%, ${atmo.a}cc, transparent 55%), radial-gradient(circle at 78% 30%, ${atmo.b}99, transparent 55%), radial-gradient(circle at 50% 105%, ${atmo.c}dd, transparent 60%), linear-gradient(180deg, ${atmo.sky[0]}, ${atmo.sky[1]} 50%, ${atmo.sky[2]})`;
}

/** The custom properties the studio root carries for an atmosphere. */
export function atmosphereVars(atmo: Atmosphere): Record<string, string> {
  const shared = {
    '--studio-accent': atmo.accent,
    '--studio-accent-deep': atmo.deep,
    '--studio-accent-hot': atmo.hot,
    '--studio-on-accent': atmo.onAccent,
  };
  if (atmo.kind === 'solid') {
    return {
      ...shared,
      '--studio-ink': atmo.color,
      '--atmo-a': atmo.color,
      '--atmo-b': atmo.color,
      '--atmo-c': atmo.color,
      '--atmo-sky-1': atmo.color,
      '--atmo-sky-2': atmo.color,
      '--atmo-sky-3': atmo.color,
    };
  }
  return {
    ...shared,
    '--studio-ink': atmo.ink,
    '--atmo-a': atmo.a,
    '--atmo-b': atmo.b,
    '--atmo-c': atmo.c,
    '--atmo-sky-1': atmo.sky[0],
    '--atmo-sky-2': atmo.sky[1],
    '--atmo-sky-3': atmo.sky[2],
  };
}

const STORAGE_KEY = 'airo:studio:atmosphere';

export function loadAtmosphere(): Atmosphere {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ATMOSPHERE;
    const saved = JSON.parse(raw) as { id?: string; color?: string };
    if (saved.id === CUSTOM_SOLID_ID && typeof saved.color === 'string' && /^#[0-9a-f]{6}$/i.test(saved.color)) {
      return customSolid(saved.color);
    }
    return (
      GRADIENT_ATMOSPHERES.find((a) => a.id === saved.id) ??
      SOLID_ATMOSPHERES.find((a) => a.id === saved.id) ??
      DEFAULT_ATMOSPHERE
    );
  } catch {
    return DEFAULT_ATMOSPHERE;
  }
}

export function saveAtmosphere(atmo: Atmosphere): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(atmo.kind === 'solid' && atmo.id === CUSTOM_SOLID_ID ? { id: atmo.id, color: atmo.color } : { id: atmo.id })
    );
  } catch {
    /* private mode */
  }
}
