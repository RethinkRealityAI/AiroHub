/**
 * The dashboard's chart marks — inline SVG and CSS, no charting library.
 *
 * A charting dependency would be the single largest thing on this route and it
 * would still need every rule below written by hand, so the marks are drawn
 * directly: one line chart, one bar list, one meter, plus the number
 * formatting they share.
 *
 * **The palette is computed, not chosen.** AiroHub's brand hues are tuned for
 * chrome floating over a live 3D stage, which puts most of them above the
 * lightness band a data mark wants on a near-black plate. Each mark colour
 * here is the brand hue held at its own hue angle and stepped down into the
 * band (OKLCH L 0.48–0.67), then validated against the chart surface
 * (`#0e0e16`, the glass plate over the void):
 *
 *   visitors / bars  #00A0BA  aqua, stepped     ┐ worst-case colour-vision
 *   rooms            #CD8100  ember, stepped    ┘ ΔE 19.1, normal-vision 24.9
 *   emphasis         #FF4D1C  brand flame, already in band (L 0.668)
 *                             vs the bar aqua: ΔE 20.9 / 33.6
 *
 * All three clear 3:1 against the plate. **Flame and the stepped ember are
 * indistinguishable to a deuteranope (ΔE 0.9), so they never share a chart** —
 * ember is only ever the second line, flame only ever the emphasis on a bar
 * list whose other bars are aqua. Meter tracks are a dark step of their own
 * fill's hue (aqua `#00526b`, ember `#7D3600`, flame `#960000`), each still
 * clearing 2:1 on the plate so the empty part of a meter is visible as a
 * quantity rather than as nothing.
 *
 * Identity is never colour alone: two series get a legend carrying their
 * current value, bar values are printed beside every bar, and the day-by-day
 * numbers are one disclosure away from the line chart.
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ tokens */

export const VIZ = {
  /** The glass plate these marks are drawn on; every check above used it. */
  surface: '#0e0e16',
  series1: '#00A0BA',
  series2: '#CD8100',
  emphasis: '#FF4D1C',
  grid: 'rgba(255,255,255,0.08)',
  axisText: 'rgba(255,255,255,0.38)',
  track: 'rgba(255,255,255,0.06)',
} as const;

/* -------------------------------------------------------------- formatting */

/** 1,284 · 12.9K · 4.2M — compact above four digits, exact below. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${(n / 1000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return n.toLocaleString('en-GB');
}

/** "3 h ago" / "just now" — relative, because an admin reads recency, not clocks. */
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** `2026-08-31` → `31 Aug`, in UTC because the rows are bucketed in UTC. */
export function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Round a maximum up to something an axis tick can be honest about. */
function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (value <= candidate) return candidate;
  }
  return 10 * magnitude;
}

/* ----------------------------------------------------------------- sizing */

/**
 * The rendered width of an element.
 *
 * The charts draw at 1:1 rather than scaling a fixed viewBox, so a 10px axis
 * label is 10px here exactly as it is everywhere else in the app — a scaled
 * viewBox would render the same label at whatever size the container happened
 * to imply.
 */
export function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setWidth(node.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/* ------------------------------------------------------------- line chart */

export interface SeriesSpec {
  label: string;
  color: string;
}

export interface LinePoint {
  /** Axis label for this slot, e.g. `31 Aug`. */
  label: string;
  /** One value per series, in the same order as `series`. */
  values: number[];
}

const PAD = { top: 14, right: 14, bottom: 22, left: 38 };

/**
 * Two lines on one axis. Never two axes: a second y-scale would let the two
 * series be aligned any way at all, which invents a relationship the data has
 * not got. Visitors and rooms are both counts of things that happened in a
 * day, so one scale is also the honest one.
 */
export function LineChart({
  points,
  series,
  height = 190,
  ariaLabel,
}: {
  points: LinePoint[];
  series: SeriesSpec[];
  height?: number;
  ariaLabel: string;
}) {
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(1, ...points.flatMap((p) => p.values)));
  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;
  const x = (i: number) => PAD.left + (points.length > 1 ? i * stepX : plotW / 2);
  const y = (value: number) => PAD.top + plotH - (Math.max(0, value) / max) * plotH;

  const move = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      if (points.length === 0 || plotW <= 0) return;
      const box = event.currentTarget.getBoundingClientRect();
      const local = event.clientX - box.left;
      const index = points.length > 1 ? Math.round(local / (plotW / (points.length - 1))) : 0;
      setHover(Math.min(points.length - 1, Math.max(0, index)));
    },
    [points.length, plotW]
  );

  const step = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setHover((current) => {
        const next = (current ?? points.length - 1) + (event.key === 'ArrowRight' ? 1 : -1);
        return Math.min(points.length - 1, Math.max(0, next));
      });
    },
    [points.length]
  );

  const ticks = [0, max / 2, max];
  const labelIndexes =
    points.length <= 1
      ? points.map((_, i) => i)
      : [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <div className="relative">
      {/* Legend, carrying each series' latest value — the direct label that
          cannot collide with the other line's. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((spec, s) => (
          <span key={spec.label} className="inline-flex items-baseline gap-1.5 text-[11px]">
            <span
              aria-hidden
              className="inline-block h-[3px] w-3.5 shrink-0 self-center rounded-full"
              style={{ background: spec.color }}
            />
            <span className="text-white/55">{spec.label}</span>
            <span className="font-mono text-[11px] font-bold text-white/85">
              {formatCompact(points.length ? points[points.length - 1].values[s] : 0)}
            </span>
            <span className="text-white/30">today</span>
          </span>
        ))}
      </div>

      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={step}
        onBlur={() => setHover(null)}
        className="relative w-full outline-none focus-visible:ring-1 focus-visible:ring-white/25 rounded-xl"
      >
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel}>
            {/* Gridlines: solid hairlines one step off the surface. */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={VIZ.grid}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={PAD.left - 8}
                  y={y(tick) + 3}
                  textAnchor="end"
                  fontSize={9}
                  fontFamily="var(--font-mono)"
                  fill={VIZ.axisText}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatCompact(tick)}
                </text>
              </g>
            ))}

            {labelIndexes.map((index) => (
              <text
                key={index}
                x={x(index)}
                y={height - 6}
                textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
                fontSize={9}
                fontFamily="var(--font-mono)"
                fill={VIZ.axisText}
              >
                {points[index]?.label}
              </text>
            ))}

            {hover !== null && points.length > 0 && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            )}

            {series.map((spec, s) => {
              const d = points
                .map((point, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(point.values[s] ?? 0).toFixed(1)}`)
                .join(' ');
              const last = points.length - 1;
              return (
                <g key={spec.label}>
                  {points.length > 1 && (
                    <path
                      d={d}
                      fill="none"
                      stroke={spec.color}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {points.length > 0 && (
                    <circle
                      cx={x(last)}
                      cy={y(points[last].values[s] ?? 0)}
                      r={4}
                      fill={spec.color}
                      stroke={VIZ.surface}
                      strokeWidth={2}
                    />
                  )}
                  {hover !== null && points[hover] && (
                    <circle
                      cx={x(hover)}
                      cy={y(points[hover].values[s] ?? 0)}
                      r={4}
                      fill={spec.color}
                      stroke={VIZ.surface}
                      strokeWidth={2}
                    />
                  )}
                </g>
              );
            })}

            <rect
              x={PAD.left}
              y={PAD.top}
              width={Math.max(0, plotW)}
              height={plotH}
              fill="transparent"
              onPointerMove={move}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}

        {hover !== null && points[hover] && width > 0 && (
          <div
            className="glass pointer-events-none absolute top-0 z-10 rounded-xl px-2.5 py-1.5"
            style={{ left: Math.min(Math.max(0, x(hover) - 52), Math.max(0, width - 118)) }}
          >
            <div className="label-caps text-white/45">{points[hover].label}</div>
            {series.map((spec, s) => (
              <div key={spec.label} className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
                <span
                  aria-hidden
                  className="inline-block h-[3px] w-3 rounded-full"
                  style={{ background: spec.color }}
                />
                <span className="text-[10.5px] text-white/55">{spec.label}</span>
                <span className="ml-auto font-mono text-[10.5px] font-bold text-white/90">
                  {formatCompact(points[hover].values[s] ?? 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The table twin: nothing on this chart is reachable only by hovering. */}
      <details className="mt-2 group">
        <summary className="tap cursor-pointer list-none text-[10.5px] text-white/35 hover:text-white/70">
          Show the numbers
        </summary>
        <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-white/8">
          <table className="w-full font-mono text-[10.5px]">
            <thead className="sticky top-0 bg-white/[0.06] text-white/45">
              <tr>
                <th className="px-2.5 py-1.5 text-left font-semibold">Day</th>
                {series.map((spec) => (
                  <th key={spec.label} className="px-2.5 py-1.5 text-right font-semibold">
                    {spec.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.label} className="border-t border-white/6">
                  <td className="px-2.5 py-1 text-white/55">{point.label}</td>
                  {series.map((spec, s) => (
                    <td
                      key={spec.label}
                      className="px-2.5 py-1 text-right tabular-nums text-white/80"
                    >
                      {point.values[s] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/* -------------------------------------------------------------- bar list */

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Right-hand detail, e.g. `12 sessions`. */
  detail?: string;
  /** Overrides the default bar colour; used for the emphasis row. */
  color?: string;
  /** A short tag beside the label — the secondary channel for that emphasis. */
  badge?: string;
}

/**
 * Ranked horizontal bars.
 *
 * One hue for every bar, because these categories have no order: colouring
 * each bar by its own value would spend the identity channel re-encoding what
 * the bar length already says. The only second colour is emphasis — a row the
 * reader is looking for (Reddit, on launch day) — and it carries a text badge
 * as well, so the highlight survives a screenshot in greyscale.
 */
export function BarList({
  rows,
  empty = 'Nothing yet.',
}: {
  rows: BarDatum[];
  empty?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-[11.5px] text-white/35">{empty}</p>;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const color = row.color ?? VIZ.series1;
        return (
          <li key={row.key} title={row.detail ? `${row.label} — ${row.detail}` : row.label}>
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-white/75">
                {row.label}
              </span>
              {row.badge && (
                <span
                  className="shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold"
                  style={{ borderColor: `${color}66`, color, background: `${color}18` }}
                >
                  {row.badge}
                </span>
              )}
              <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-white/85">
                {formatCompact(row.value)}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 w-full overflow-hidden rounded-[3px]"
              style={{ background: VIZ.track }}
            >
              <div
                className="h-full rounded-r-[4px]"
                style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ meter */

/**
 * One quantity against a limit. The fill carries severity and the unfilled
 * track is a dark step of the fill's own hue, so the state reads across the
 * whole bar rather than only across the filled part.
 */
export function Meter({
  value,
  max,
  caption,
}: {
  value: number;
  max: number;
  caption?: string;
}) {
  // A cap of zero is "nothing allowed": any use at all fills the bar.
  const ratio = max > 0 ? Math.min(1, value / max) : value > 0 ? 1 : 0;
  const [fill, track] =
    ratio >= 0.9
      ? [VIZ.emphasis, '#960000']
      : ratio >= 0.7
        ? [VIZ.series2, '#7D3600']
        : [VIZ.series1, '#00526B'];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[15px] font-bold text-white/90">
          {formatCompact(value)}
          <span className="text-white/35"> / {formatCompact(max)}</span>
        </span>
        <span className="font-mono text-[11px] tabular-nums text-white/45">
          {Math.round(ratio * 100)}%
        </span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-[3px]"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        style={{ background: track }}
      >
        <div
          className="h-full rounded-r-[4px] transition-[width] duration-500"
          style={{ width: `${Math.max(ratio * 100, value > 0 ? 2 : 0)}%`, background: fill }}
        />
      </div>
      {caption && <p className="mt-1.5 text-[10.5px] leading-relaxed text-white/40">{caption}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- KPI tile */

/**
 * A headline number. Proportional figures on the value (tabular digits make a
 * three-digit number look loose at this size); the label sits above it in the
 * same caps as every other label on the page.
 */
export function KpiTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
      <div className="label-caps text-white/35">{label}</div>
      <div
        className="mt-1 text-[26px] font-black leading-none tracking-tight"
        style={{ color: accent ?? 'rgba(255,255,255,0.92)' }}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[10.5px] leading-snug text-white/35">{hint}</div>}
    </div>
  );
}

/** Shared panel chrome for a chart card: a title, then the marks. */
export function ChartCard({
  title,
  sub,
  children,
  right,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-bold text-white/85">{title}</h3>
          {sub && <p className="mt-0.5 text-[10.5px] leading-snug text-white/35">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}
