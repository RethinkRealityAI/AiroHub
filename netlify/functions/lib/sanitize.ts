/**
 * A guard on everything the AI model returns.
 *
 * Gemini answers with JSON that matches a schema, and the studio then renders
 * those values directly: `accentColor` becomes a CSS colour, `stencilSymbol` is
 * drawn onto the canvas, `dripIntensity` and `glowRadius` are fed to the paint
 * shader. A schema is a request, not a guarantee — a model can and does return
 * `"accentColor": "javascript:alert(1)"`, a 4,000-word `curatorNotes`, a
 * `glowRadius` of 900, or an emoji sequence where a single glyph was asked for.
 * Each of those is a real failure downstream: a style value the browser refuses
 * to parse, a panel that scrolls off the screen, a shader that stalls the frame
 * on a phone, a stencil that renders as three overlapping glyphs.
 *
 * The rule this module enforces is that EVERY field is either valid or the
 * curated fallback's value for that field. Never `undefined`, never a partial
 * object: the client destructures these results, and a missing key there is a
 * blank card with no way to tell whether the model failed or the request did.
 * Sanitising per field rather than rejecting the whole answer keeps the good
 * three-quarters of a mostly-fine response.
 */

export interface GraffitiConcept {
  title: string;
  tagLine: string;
  recommendedPalette: string[];
  stencilSymbol: string;
  graffitiText: string;
  styleNotes: string;
}

export interface StyleTransformation {
  transformedTitle: string;
  vibe: string;
  tagLine: string;
  accentColor: string;
  secondaryColor: string;
  stencilSymbol: string;
  tagText: string;
  dripIntensity: number;
  glowRadius: number;
  curatorNotes: string;
}

export interface Critique {
  exhibitionTitle: string;
  curatorCritique: string;
  estimatedValue: string;
  auctionHouse: string;
  vibeTags: string[];
}

/** Field caps, in one place so the client and the panel layout can be read against them. */
export const TITLE_MAX = 60;
export const TAG_LINE_MAX = 60;
export const TAG_TEXT_MAX = 24;
export const NOTES_MAX = 400;
export const VALUE_MAX = 32;
export const VIBE_TAG_MAX = 32;
export const VIBE_TAGS_MAX = 5;
export const PALETTE_MAX = 6;
export const DRIP_MIN = 0.2;
export const DRIP_MAX = 1.2;
export const GLOW_MIN = 8;
export const GLOW_MAX = 40;

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A CSS colour or the fallback. Anything that is not `#rgb`/`#rrggbb` is not a colour. */
export function hex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return HEX_RE.test(trimmed) ? trimmed : fallback;
}

/** Non-empty text, trimmed and capped. Empty strings are a failure, not a value. */
export function str(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.slice(0, max);
}

/**
 * Exactly one grapheme. `Intl.Segmenter` is what makes this correct for emoji
 * built from several code points (a flag, a ZWJ sequence): counting code points
 * would reject a valid single symbol, and counting `.length` would accept two.
 */
export function glyph(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;

  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const graphemes = [...segmenter.segment(trimmed)];
    return graphemes.length === 1 ? trimmed : fallback;
  } catch {
    // No Intl.Segmenter: fall back to code points, which is right for every
    // symbol in the curated set and only over-strict for exotic sequences.
    return [...trimmed].length === 1 ? trimmed : fallback;
  }
}

/**
 * A finite number clamped into range. Out-of-range values are clamped rather
 * than rejected — a model that says `glowRadius: 900` meant "as much as
 * possible", and 40 is that; only a non-number is a real failure.
 */
export function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** A palette of hex colours, capped. Falls back whole if nothing in it parsed. */
export function hexes(value: unknown, max: number, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const colours = value
    .filter((entry): entry is string => typeof entry === 'string' && HEX_RE.test(entry.trim()))
    .map((entry) => entry.trim())
    .slice(0, max);
  return colours.length > 0 ? colours : [...fallback];
}

function tags(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const cleaned = value
    .map((entry) => (typeof entry === 'string' ? entry.replace(/\s+/g, ' ').trim() : ''))
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.slice(0, VIBE_TAG_MAX))
    .slice(0, VIBE_TAGS_MAX);
  return cleaned.length > 0 ? cleaned : [...fallback];
}

export function sanitizeConcept(raw: unknown, fallback: GraffitiConcept): GraffitiConcept {
  const value = record(raw);
  return {
    title: str(value.title, TITLE_MAX, fallback.title),
    tagLine: str(value.tagLine, TAG_LINE_MAX, fallback.tagLine),
    recommendedPalette: hexes(value.recommendedPalette, PALETTE_MAX, fallback.recommendedPalette),
    stencilSymbol: glyph(value.stencilSymbol, fallback.stencilSymbol),
    graffitiText: str(value.graffitiText, TAG_TEXT_MAX, fallback.graffitiText),
    styleNotes: str(value.styleNotes, NOTES_MAX, fallback.styleNotes),
  };
}

export function sanitizeStyle(raw: unknown, fallback: StyleTransformation): StyleTransformation {
  const value = record(raw);
  return {
    transformedTitle: str(value.transformedTitle, TITLE_MAX, fallback.transformedTitle),
    vibe: str(value.vibe, TAG_LINE_MAX, fallback.vibe),
    tagLine: str(value.tagLine, TAG_LINE_MAX, fallback.tagLine),
    accentColor: hex(value.accentColor, fallback.accentColor),
    secondaryColor: hex(value.secondaryColor, fallback.secondaryColor),
    stencilSymbol: glyph(value.stencilSymbol, fallback.stencilSymbol),
    tagText: str(value.tagText, TAG_TEXT_MAX, fallback.tagText),
    dripIntensity: num(value.dripIntensity, DRIP_MIN, DRIP_MAX, fallback.dripIntensity),
    glowRadius: num(value.glowRadius, GLOW_MIN, GLOW_MAX, fallback.glowRadius),
    curatorNotes: str(value.curatorNotes, NOTES_MAX, fallback.curatorNotes),
  };
}

export function sanitizeCritique(raw: unknown, fallback: Critique): Critique {
  const value = record(raw);
  return {
    exhibitionTitle: str(value.exhibitionTitle, TITLE_MAX, fallback.exhibitionTitle),
    curatorCritique: str(value.curatorCritique, NOTES_MAX, fallback.curatorCritique),
    estimatedValue: str(value.estimatedValue, VALUE_MAX, fallback.estimatedValue),
    auctionHouse: str(value.auctionHouse, TITLE_MAX, fallback.auctionHouse),
    vibeTags: tags(value.vibeTags, fallback.vibeTags),
  };
}
