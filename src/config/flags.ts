/**
 * Feature flags, as the browser sees them.
 *
 * The owner turns parts of the product on and off from the dashboard;
 * `GET /api/flags` is how that decision reaches a visitor. Two things about
 * this module are deliberate.
 *
 * **The defaults apply synchronously.** A flag that only lands after the first
 * network round trip is a flag that leaks: the AI button and the phone's Pad
 * mode would paint, then disappear a beat later, which is worse for a launch
 * than never showing them. So `current` is resolved while this module is
 * evaluated — from a fresh-enough localStorage cache, otherwise from
 * `DEFAULT_FLAGS` — and the fetch only ever refines it. Both starting points
 * hide AI and Pad, so the very first frame of every screen already matches the
 * launch posture, on a cold cache and on a dead network alike.
 *
 * **There is no React context.** Nothing else in this codebase uses one; the
 * house pattern for "one fetch, many readers" is the module singleton in
 * `src/paint/customModels.ts`. Flags are read by leaves scattered across three
 * route trees — a studio island, a header button on the phone, a floating
 * button on two static pages — so a provider would have to wrap the router and
 * re-render every route for a value that changes at most once per page load.
 * `useSyncExternalStore` gives the same subscription with none of that, and it
 * lets the one caller that must read flags outside React (the studio's
 * keyboard handler, which is bound once with `[]` deps) call `getFlags()`
 * directly instead of chasing a stale closure.
 *
 * Failure is always "keep what we have": a 500, a timeout, an offline tab and
 * a garbage payload all leave `current` exactly as it was.
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_FLAGS, NOTICE_MAX, type PublicFlags, type UiFlags } from '../api/contracts';

const CACHE_KEY = 'airo:flags:v1';
/** Past this, a cached answer is not evidence of anything. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** The whole point is to not block the first paint on a sleeping database. */
const FETCH_TIMEOUT_MS = 2500;

interface CacheEnvelope {
  v: 1;
  fetchedAt: number;
  flags: PublicFlags;
}

/** The public half of `DEFAULT_FLAGS`, copied so nobody can mutate the frozen source. */
function defaults(): PublicFlags {
  return { ui: { ...DEFAULT_FLAGS.ui }, notice: DEFAULT_FLAGS.notice };
}

/**
 * The client-side twin of the server's `mergeFlags`: every `ui.*` field must be
 * a real boolean or it keeps its default, and the notice is a string clamped to
 * the same length the dashboard enforces. Anything that is not an object with a
 * `ui` object on it is not a flags payload at all, and returns null so the
 * caller falls back rather than half-trusting it.
 */
function sanitise(raw: unknown): PublicFlags | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as { ui?: unknown; notice?: unknown };
  if (!source.ui || typeof source.ui !== 'object') return null;

  const incoming = source.ui as Record<string, unknown>;
  const ui = { ...DEFAULT_FLAGS.ui };
  for (const key of Object.keys(DEFAULT_FLAGS.ui) as (keyof UiFlags)[]) {
    const value = incoming[key];
    if (typeof value === 'boolean') ui[key] = value;
  }

  const notice = typeof source.notice === 'string' ? source.notice.slice(0, NOTICE_MAX) : '';
  return { ui, notice };
}

function sameFlags(a: PublicFlags, b: PublicFlags): boolean {
  if (a.notice !== b.notice) return false;
  return (Object.keys(a.ui) as (keyof UiFlags)[]).every((key) => a.ui[key] === b.ui[key]);
}

function readCache(): PublicFlags | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope>;
    if (parsed?.v !== 1 || typeof parsed.fetchedAt !== 'number') return null;
    if (!Number.isFinite(parsed.fetchedAt)) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_MAX_AGE_MS) return null;
    return sanitise(parsed.flags);
  } catch {
    // Private mode, disabled storage, or a payload from a future shape.
    return null;
  }
}

function writeCache(flags: PublicFlags) {
  try {
    const envelope: CacheEnvelope = { v: 1, fetchedAt: Date.now(), flags };
    localStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage full or blocked — the next load just starts from the defaults.
  }
}

let current: PublicFlags = readCache() ?? defaults();

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * The current flags. Identity is stable: the object is replaced only when the
 * server actually disagrees with what we are holding, which is what lets
 * `useSyncExternalStore` use this as both the client and the server snapshot.
 */
export function getFlags(): PublicFlags {
  return current;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let pending: Promise<PublicFlags> | null = null;

/**
 * Fetches the live flags once per page load and publishes them.
 *
 * Memoised on the promise, not on a boolean, so the two callers that race on
 * mount (the route tracker and any screen that wants flags early) share one
 * request. It never rejects — every failure resolves to whatever is already
 * current, because a screen that has already painted the defaults must not be
 * torn down by a network hiccup.
 */
export function ensureFlags(): Promise<PublicFlags> {
  if (pending) return pending;
  pending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch('/api/flags', {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return current;
      const next = sanitise(await res.json());
      if (!next) return current;
      writeCache(next);
      if (!sameFlags(current, next)) {
        current = next;
        emit();
      }
      return current;
    } catch {
      return current;
    } finally {
      clearTimeout(timer);
    }
  })();
  return pending;
}

/** Subscribes a component to the flags. Re-renders only on a real change. */
export function useFlags(): PublicFlags {
  return useSyncExternalStore(subscribe, getFlags, getFlags);
}
