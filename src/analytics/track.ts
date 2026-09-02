/**
 * First-party, cookieless analytics.
 *
 * Enough to answer the only questions a launch actually raises — did anyone
 * arrive, did they get as far as painting, and is anything on fire — without a
 * third-party script, a cookie banner, or a single byte of personal data. The
 * server never sees an identifier that outlives the tab: the session id lives
 * in `sessionStorage`, and the per-day visitor hash is computed server-side
 * from a salt that is thrown away at midnight.
 *
 * **Everything here fails silently, on purpose.** This module is instrumenting
 * a paint tool, not running it. A blocked request, a full storage quota, a
 * browser without `sendBeacon` — none of it may reach a console, a rejected
 * promise, or the person painting. That also keeps the five Playwright
 * harnesses honest: they treat any console error as a failure, so a noisy
 * analytics call would redden checks that have nothing to do with it.
 *
 * **Why batching.** Events cluster (a page view and a room entry land in the
 * same tick), and a tab that is closing gets exactly one chance to send. So
 * events queue, drain every four seconds or whenever the batch is full, and
 * both `pagehide` and the hidden half of `visibilitychange` force a beacon
 * flush — the two events that survive a backgrounded or discarded tab, unlike
 * `unload`, which mobile Safari never fires.
 *
 * A dropped batch is a dropped batch. There is no retry queue: re-sending
 * yesterday's events on tomorrow's page load would corrupt the daily series
 * this feeds, and an analytics gap is a cheaper failure than a wrong chart.
 */
import {
  TRACK_MAX_BATCH,
  TRACK_MAX_PROPS_BYTES,
  type EventName,
  type TrackEvent,
  type TrackRequest,
} from '../api/contracts';

const ENDPOINT = '/api/track';
const SESSION_KEY = 'airo:sid';
/** Long enough to coalesce a burst, short enough that a bounce still reports. */
const FLUSH_INTERVAL_MS = 4000;
/** The server stores a truncated message anyway; this keeps the batch small. */
const ERROR_MESSAGE_MAX = 200;
/** One broken dependency can throw hundreds of times a minute. */
const ERROR_BUDGET = 5;
const REFERRER_MAX = 500;

/* ------------------------------------------------------------------ session */

function mintSessionId(): string {
  try {
    // Hex only — the id is a database column with a length check, not a URL.
    return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  } catch {
    let out = '';
    while (out.length < 24) out += Math.random().toString(16).slice(2);
    return out.slice(0, 24);
  }
}

let sessionId: string | null = null;

/**
 * Per-tab, never persisted beyond it. `sessionStorage` rather than
 * `localStorage` is the whole privacy posture in one line: close the tab and
 * the only thing tying two page views together is gone.
 */
function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored && stored.length >= 8 && stored.length <= 64) {
      sessionId = stored;
      return sessionId;
    }
  } catch {
    /* private mode — fall through to a memory-only id */
  }
  sessionId = mintSessionId();
  try {
    sessionStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    /* the id still holds for this page; a reload simply mints another */
  }
  return sessionId;
}

/* -------------------------------------------------------------------- queue */

const queue: TrackEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** The referrer is only interesting once, and only as a host. */
let referrerSent = false;
let listenersInstalled = false;

function currentPath(): string {
  try {
    return location.pathname || '/';
  } catch {
    return '/';
  }
}

/** Props that cannot be serialised, or that are absurdly large, are dropped —
 *  never the event they were attached to. */
function safeProps(props?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!props) return undefined;
  try {
    const encoded = JSON.stringify(props);
    if (!encoded || encoded === '{}') return undefined;
    if (encoded.length > TRACK_MAX_PROPS_BYTES) return undefined;
    return props;
  } catch {
    return undefined;
  }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush(false);
  }, FLUSH_INTERVAL_MS);
}

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  try {
    // Both, not either: `pagehide` covers navigation and bfcache, the hidden
    // branch of `visibilitychange` covers a tab being backgrounded on mobile
    // and then killed without ever firing another event.
    addEventListener('pagehide', () => flush(true));
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true);
    });
  } catch {
    /* no window — nothing to hook */
  }
}

/**
 * Queues one event. Never throws, never awaits.
 *
 * `name` is the shared allowlist from `src/api/contracts.ts`, so a typo is a
 * type error here and a dropped row on the server rather than a phantom event
 * in the dashboard.
 */
export function track(name: EventName, props?: Record<string, unknown>, roomId?: string) {
  try {
    installListeners();
    const event: TrackEvent = { name, path: currentPath() };
    if (roomId) event.roomId = roomId;
    const clean = safeProps(props);
    if (clean) event.props = clean;
    queue.push(event);
    if (queue.length >= TRACK_MAX_BATCH) flush(false);
    else schedule();
  } catch {
    /* instrumentation must never break the thing it instruments */
  }
}

/**
 * Sends whatever is queued.
 *
 * `useBeacon` is for the closing-tab path: `sendBeacon` hands the request to
 * the browser to deliver after the document is gone, which a normal fetch
 * cannot promise even with `keepalive`. It needs a `Blob` with an explicit JSON
 * type — the default would send `text/plain` and the function would reject it.
 */
export function flush(useBeacon = false) {
  try {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!queue.length) return;

    const events = queue.splice(0, TRACK_MAX_BATCH);
    const payload: TrackRequest = { sessionId: getSessionId(), events };
    if (!referrerSent) {
      referrerSent = true;
      const referrer = (document.referrer || '').slice(0, REFERRER_MAX);
      if (referrer) payload.referrer = referrer;
    }
    const body = JSON.stringify(payload);

    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) {
        if (queue.length) schedule();
        return;
      }
      // Beacon refused (queue full) — fall through to the fetch below, which
      // still has a chance on a same-document visibility change.
    }

    void fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {
      /* offline, blocked, or 500 — the batch is gone and that is fine */
    });

    if (queue.length) schedule();
  } catch {
    /* see the module note: nothing here is worth an exception */
  }
}

/* ------------------------------------------------------------- error capture */

let errorCaptureInstalled = false;
let errorBudget = ERROR_BUDGET;
const seenErrors = new Set<string>();

function reportError(message: unknown, source: 'error' | 'unhandledrejection') {
  try {
    if (errorBudget <= 0) return;
    const text = String(
      message instanceof Error ? message.message || message.name : (message ?? 'unknown')
    )
      .trim()
      .slice(0, ERROR_MESSAGE_MAX);
    if (!text) return;
    // One line per distinct failure. A render loop that throws every frame
    // would otherwise spend the whole budget on one bug.
    const key = `${source}:${text}`;
    if (seenErrors.has(key)) return;
    seenErrors.add(key);
    errorBudget -= 1;
    track('client.error', { message: text, source });
  } catch {
    /* an error reporter that throws is worse than no error reporter */
  }
}

/**
 * Sends the first few distinct uncaught errors of a session.
 *
 * Idempotent, and passive: the handlers never call `preventDefault`, so the
 * browser still logs everything it would have logged and nothing downstream
 * changes behaviour because telemetry is installed.
 */
export function installErrorCapture() {
  if (errorCaptureInstalled) return;
  errorCaptureInstalled = true;
  try {
    addEventListener('error', (event) => {
      reportError((event as ErrorEvent).message || (event as ErrorEvent).error, 'error');
    });
    addEventListener('unhandledrejection', (event) => {
      reportError((event as PromiseRejectionEvent).reason, 'unhandledrejection');
    });
  } catch {
    /* no window — nothing to hook */
  }
}
