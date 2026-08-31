/**
 * Segmented control specimen — the leaf subject a visual harness renders.
 *
 * `Segmented` (src/ui/Glass.tsx) is a *controlled* component: it derives the
 * whole indicator — position, accent, and which of the two label treatments the
 * active segment gets — from the `value` prop alone. Mounting it directly with
 * a literal `value` and a throwaway `onChange` therefore produces a control
 * that can never move, and quietly renders a state the app can't actually
 * reach. That is the bug this wrapper exists to prevent: `SegmentedFixture`
 * owns the state, so the specimen behaves like the real toolbar in a browser
 * and still renders deterministically from a cold mount.
 *
 * The option sets are not decorative. They pin the three things a picture of
 * this control has to prove:
 *
 *  - the paint-stroke indicator (`paint`) actually stencils, rather than
 *    falling back to the plain pill;
 *  - per-option `accent` reaches both the stroke gradient and its drop shadow;
 *  - the luminance switch in `Glass.tsx` flips the active label from white to
 *    ink above 0.3 relative luminance. Spray (#FF4D1C, L 0.27) is the only
 *    accent in the brand palette that keeps white type; Brush (#22D3EE, 0.53),
 *    Stamp (#FFB020, 0.52) and Violet (#A78BFA, 0.34) all cross over. Violet is
 *    kept in the third row precisely because it is the closest call — a
 *    threshold regression shows up there first.
 *
 * Nothing here imports the visual harness. This is a plain React module, so
 * `npm run lint` (`tsc --noEmit` over the whole tree) typechecks it for free,
 * it can be dropped into a route or a Storybook-alike unchanged, and replacing
 * the harness later costs nothing. See docs/AGENT-VISUAL-QA.md.
 *
 * Layout is written in inline styles on purpose. Tailwind v4 generates
 * utilities from the sources it scans, and a harness that compiles
 * `src/index.css` on its own may not scan `scripts/`; keeping the fixture's own
 * chrome out of Tailwind means the only utilities in the render are the ones
 * `Glass.tsx` itself asks for, which is exactly what the shot is meant to test.
 */
import React from 'react';
import { Brush, Layers, SprayCan, Stamp as StampIcon } from 'lucide-react';
import { Segmented, type SegmentOption } from '../../src/ui/Glass';

/** Mirrors the studio toolbar's tool picker (src/components/CanvasView.tsx). */
type Tool = 'spray' | 'brush' | 'stamp';

/** The accent ladder, ordered by relative luminance across the threshold. */
type Accent = 'flame' | 'violet' | 'aqua' | 'plain';

const TOOL_OPTIONS: SegmentOption<Tool>[] = [
  { value: 'spray', label: 'Spray', icon: <SprayCan size={13} />, accent: '#FF4D1C' },
  { value: 'brush', label: 'Brush', icon: <Brush size={13} />, accent: '#22D3EE' },
  { value: 'stamp', label: 'Stamp', icon: <StampIcon size={13} />, accent: '#FFB020' },
];

const ACCENT_OPTIONS: SegmentOption<Accent>[] = [
  { value: 'flame', label: 'Flame', accent: '#FF4D1C' },
  { value: 'violet', label: 'Violet', accent: '#A78BFA' },
  { value: 'aqua', label: 'Aqua', accent: '#22D3EE' },
  // No accent at all: proves the STROKE_FALLBACK path still paints a stroke
  // rather than dropping to the white pill mid-row.
  { value: 'plain', label: 'Default', icon: <Layers size={13} /> },
];

export interface SegmentedFixtureProps {
  /** Starting selection for the tool rows. */
  tool?: Tool;
  /** Starting selection for the accent ladder. */
  accent?: Accent;
  /** Size passed to every control, so one shot can compare the three scales. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Draw the studio backdrop behind the controls. The track is translucent and
   * blurs whatever is behind it, so a shot taken on white is a shot of a
   * different component; leave this on unless that is the point.
   */
  backdrop?: boolean;
}

/** One captioned row, with a stable id for the harness to target. */
const Specimen: React.FC<{ id: string; caption: string; children: React.ReactNode }> = ({
  id,
  caption,
  children,
}) => (
  <div
    data-sceneproof-id={id}
    style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}
  >
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.4)',
      }}
    >
      {caption}
    </span>
    {children}
  </div>
);

/**
 * Three controls, one mount: the paint stroke, the plain pill it replaced, and
 * the accent ladder that straddles the ink/white threshold.
 */
export function SegmentedFixture({
  tool = 'spray',
  accent = 'violet',
  size = 'md',
  backdrop = true,
}: SegmentedFixtureProps = {}) {
  const [paintTool, setPaintTool] = React.useState<Tool>(tool);
  const [pillTool, setPillTool] = React.useState<Tool>(tool);
  const [ladder, setLadder] = React.useState<Accent>(accent);

  return (
    <div
      data-sceneproof-id="segmented-sheet"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 26,
        alignItems: 'flex-start',
        padding: 34,
        width: 'fit-content',
        color: '#f4f4f7',
        fontFamily:
          '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif',
        // Stands in for the 3D stage the control normally floats over: dark,
        // with enough tonal range under the track that the blur has something
        // to do.
        background: backdrop
          ? 'radial-gradient(120% 100% at 22% 8%, #1d1730 0%, #0a0a12 46%, #05050a 100%)'
          : 'transparent',
      }}
    >
      <Specimen id="segmented-paint" caption="paint stroke">
        <Segmented<Tool>
          layoutId="fixture-tool-paint"
          paint
          size={size}
          value={paintTool}
          onChange={setPaintTool}
          options={TOOL_OPTIONS}
        />
      </Specimen>

      <Specimen id="segmented-pill" caption="plain pill">
        <Segmented<Tool>
          layoutId="fixture-tool-pill"
          size={size}
          value={pillTool}
          onChange={setPillTool}
          options={TOOL_OPTIONS}
        />
      </Specimen>

      <Specimen id="segmented-accents" caption="accent ladder">
        <Segmented<Accent>
          layoutId="fixture-accents"
          paint
          size={size}
          value={ladder}
          onChange={setLadder}
          options={ACCENT_OPTIONS}
        />
      </Specimen>
    </div>
  );
}

export default SegmentedFixture;
