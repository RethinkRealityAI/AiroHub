/**
 * Mounts a liquid-glass refraction filter over one element.
 *
 * The dangerous half of this feature is the application, not the maths. An
 * inline `backdrop-filter` whose `url(#…)` names a filter that is not there —
 * not built yet, failed to raster, torn down on unmount — is not *partially*
 * applied: Chromium throws the whole declaration away, blur and saturation with
 * it, and the panel collapses into a flat translucent box over the live 3D
 * stage. So the rule here is absolute. The <filter> enters the document
 * complete, with its map URL already in hand, and only then does the inline
 * style go on; every failure path returns having touched nothing at all, and
 * `.glass` in index.css keeps doing the job it has always done.
 *
 * The style is spliced in rather than restated. Whatever `.glass` or
 * `.glass-strong` resolved to stays exactly as it was, with the refraction
 * inserted in FRONT of it — the bend happens on a sharp backdrop and the blur
 * then softens the result, which is the order real glass works in. Restating a
 * blur here instead would quietly downgrade every `glass-strong` panel to the
 * lighter recipe.
 *
 * The filters live in a single 0×0 <svg> on <body>, refcounted across every
 * panel using the hook, and it must not be `display: none` — Chromium will not
 * resolve a filter reference into a display:none subtree, and the panels would
 * all go flat. It is hidden by being zero-sized with its overflow clipped.
 *
 * `window.__airoLiquidGlass` reports `{ rebuilds, instances }` for
 * scripts/preview/verify-liquid-glass.mjs.
 */
import { useEffect, useRef, type RefObject } from 'react';
import {
  DEFAULT_BEZEL_CAP,
  DEFAULT_RADIUS,
  DEFAULT_THICKNESS,
  getDisplacementMap,
  isLiquidGlassSupported,
} from './liquidGlass';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Long enough that dragging a window edge builds one map at the end of the
 * gesture rather than sixty along the way.
 */
const RESIZE_DEBOUNCE_MS = 120;

/**
 * Filter-region margin. The displacement pulls samples from outside the border
 * box, and without slack in the region those samples come back transparent.
 */
const REGION_PAD = 4;

/** Takes the single-pixel stair-stepping off the 8-bit map's diagonals. */
const EDGE_BLUR = 0.4;

/** Read by the verify harness; see the module comment. */
const counters = { rebuilds: 0, instances: 0 };

let host: SVGSVGElement | null = null;
let defs: SVGDefsElement | null = null;
let hostRefs = 0;
let nextId = 0;

/**
 * The shared <defs>, created on first use and refcounted.
 *
 * StrictMode mounts, unmounts and mounts again, which takes the count 1 → 0 → 1
 * and tears the host down in the middle. That is fine as long as the rebuild is
 * complete on the way back up: every filter is re-created by its own effect, and
 * the inline style is only written once its filter is back in the document.
 */
function acquireDefs(): SVGDefsElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!host || !defs) {
    host = document.createElementNS(SVG_NS, 'svg');
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('focusable', 'false');
    host.style.cssText =
      'position:absolute;top:0;left:0;width:0;height:0;overflow:hidden;pointer-events:none';
    defs = document.createElementNS(SVG_NS, 'defs');
    host.appendChild(defs);
    document.body.appendChild(host);
  }
  hostRefs++;
  return defs;
}

function releaseHost(): void {
  hostRefs = Math.max(0, hostRefs - 1);
  if (hostRefs === 0 && host) {
    host.remove();
    host = null;
    defs = null;
  }
}

/** One length off a computed style, in px, or the fallback if it is not one. */
function cssPx(style: CSSStyleDeclaration, property: string, fallback: number): number {
  const value = parseFloat(style.getPropertyValue(property));
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Attach a refraction filter to the returned element while `enabled`.
 *
 * Purely additive: where the browser will not render it, or anything at all goes
 * wrong, the element is left exactly as its classes styled it.
 */
export function useLiquidGlass<T extends HTMLElement = HTMLDivElement>(
  enabled: boolean
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    // Asked before anything is allocated, so a browser that will not draw this
    // ends up with no host, no filter and no observer — the fallback is not
    // just visually the shipped design, it is also the shipped amount of work.
    if (!isLiquidGlassSupported()) return;

    const parent = acquireDefs();
    if (!parent) return;

    const id = `airo-lg-${++nextId}`;
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', id);
    // The region is set in CSS px of the element's own box below. The default,
    // objectBoundingBox, would read those numbers as fractions of the panel and
    // put the filter region somewhere else entirely.
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    // sRGB is not a preference. The default is linearRGB, which gamma-maps every
    // byte on its way into the chain and turns a ±0.5 offset encoding into
    // something that is no longer an offset at all — the effect survives, at
    // roughly half strength and skewed toward the rim.
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    parent.appendChild(filter);

    counters.instances++;
    (window as unknown as Record<string, unknown>).__airoLiquidGlass = counters;

    let timer = 0;
    let builtKey = '';

    const build = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;

      const style = getComputedStyle(el);
      // The real painted corner, not an assumed one: a band drawn against the
      // wrong radius bends the backdrop somewhere the panel's edge is not.
      const radius = cssPx(style, 'border-top-left-radius', DEFAULT_RADIUS);
      const thickness = cssPx(style, '--glass-refract-thickness', DEFAULT_THICKNESS);
      const bezelCap = cssPx(style, '--glass-refract-bezel', DEFAULT_BEZEL_CAP);
      const bezel = Math.min(radius * 1.2, bezelCap);

      const map = getDisplacementMap({
        width: rect.width,
        height: rect.height,
        radius,
        bezel,
        thickness,
      });
      // Unsupported browser, or the raster failed. Touch nothing.
      if (!map) return;

      const width = Math.round(rect.width * 100) / 100;
      const height = Math.round(rect.height * 100) / 100;
      const key = `${map.key}@${width}x${height}`;
      if (key === builtKey) return;
      builtKey = key;

      filter.setAttribute('x', String(-REGION_PAD));
      filter.setAttribute('y', String(-REGION_PAD));
      filter.setAttribute('width', String(width + REGION_PAD * 2));
      filter.setAttribute('height', String(height + REGION_PAD * 2));

      const image = document.createElementNS(SVG_NS, 'feImage');
      image.setAttribute('href', map.url);
      image.setAttributeNS(XLINK_NS, 'xlink:href', map.url);
      image.setAttribute('x', '0');
      image.setAttribute('y', '0');
      image.setAttribute('width', String(width));
      image.setAttribute('height', String(height));
      // The raster is bucketed to 2px so a drag reuses maps; stretching those
      // last two pixels back onto the real border box costs nothing and keeps
      // the bezel band pinned to the edge it is there to bend.
      image.setAttribute('preserveAspectRatio', 'none');
      image.setAttribute('result', 'lgMap');

      const displace = document.createElementNS(SVG_NS, 'feDisplacementMap');
      displace.setAttribute('in', 'SourceGraphic');
      displace.setAttribute('in2', 'lgMap');
      displace.setAttribute('scale', String(map.scale));
      displace.setAttribute('xChannelSelector', 'R');
      displace.setAttribute('yChannelSelector', 'G');
      displace.setAttribute('result', 'lgBent');

      const soften = document.createElementNS(SVG_NS, 'feGaussianBlur');
      soften.setAttribute('in', 'lgBent');
      soften.setAttribute('stdDeviation', String(EDGE_BLUR));

      // No specular pass. `glass-sheen` in index.css already draws the highlight
      // on every one of these panels; adding a second one here would double the
      // light on the top edge and read as a rendering bug, not as glass.
      filter.replaceChildren(image, displace, soften);

      // Additive: drop our own declaration first so the computed value is the
      // one the classes asked for, then splice the refraction in front of it.
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('-webkit-backdrop-filter');
      const base = getComputedStyle(el).backdropFilter;
      const chain = `url(#${id}) ${
        base && base !== 'none' ? base : 'blur(var(--glass-blur)) saturate(180%)'
      }`;
      el.style.setProperty('backdrop-filter', chain);
      el.style.setProperty('-webkit-backdrop-filter', chain);
      el.dataset.airoLiquid = id;
      counters.rebuilds++;
    };

    // Every build goes through the debounce, the first one included: the
    // observer delivers an initial measurement on observe(), so this is also
    // what puts the filter up. `builtKey` keeps a same-size notification from
    // counting as a rebuild.
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(build, RESIZE_DEBOUNCE_MS);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(el);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      filter.remove();
      // Ordering matters on the way out too: the filter is gone, so the
      // reference has to go with it in the same task or the panel paints one
      // frame with a dangling url() and no blur.
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('-webkit-backdrop-filter');
      delete el.dataset.airoLiquid;
      counters.instances = Math.max(0, counters.instances - 1);
      releaseHost();
    };
  }, [enabled]);

  return ref;
}
