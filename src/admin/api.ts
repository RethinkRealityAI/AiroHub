/**
 * The dashboard's half of the admin API.
 *
 * Everything under `/admin` reads and writes through this module, for one
 * reason: **the gate is the API, not the page.** The route is lazy-loaded and
 * public — anyone can download the chunk and render the shell — so the only
 * thing standing between a stranger and the data is the signed `airo_admin`
 * cookie the login endpoint sets. That makes a 401 a first-class event rather
 * than an error to log: whoever is looking at the page is no longer signed in,
 * and every panel on it is now showing stale numbers behind a login card that
 * is not there yet. `onUnauthorized` is how the gate hears about it without
 * the panels having to know a gate exists.
 *
 * A 401 both notifies and throws. Notifying alone would let a caller carry on
 * as if the empty response were data; throwing alone would leave the page
 * signed out with no way to say so.
 *
 * `credentials: 'same-origin'` everywhere. The cookie is HttpOnly, so this
 * code can neither read it nor forge it — the browser attaches it or the call
 * comes back 401.
 */
import type { AdminSessionResponse } from '../api/contracts';

const BASE = '/api/admin';

/** A failed admin call, carrying the HTTP status the UI needs to explain it. */
export class AdminApiError extends Error {
  /** 0 when the request never reached the server (offline, DNS, abort). */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

/**
 * The database sleeps when nothing has touched it; the first call after that
 * comes back 503 rather than slow. Panels use this to say so in a way that
 * does not read like an outage, because it is not one.
 */
export function isDatabaseAsleep(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 503;
}

/* --------------------------------------------------- unauthorized listeners */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to "the session just went away". Returns the unsubscribe. */
export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function fireUnauthorized(): void {
  // A listener that throws must not stop the others hearing about it.
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* a subscriber's problem, not ours */
    }
  }
}

/* ------------------------------------------------------------- the transport */

interface ErrorBody {
  error?: unknown;
  message?: unknown;
}

/** Human-facing text for a failed response, preferring the server's own. */
async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody;
    if (typeof body?.message === 'string' && body.message) return body.message;
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch {
    /* not JSON — the status is all we have */
  }
  return fallback;
}

async function request<T>(
  path: string,
  init: RequestInit & { fallbackMessage: string }
): Promise<T> {
  const { fallbackMessage, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...rest,
      headers: { accept: 'application/json', ...(rest.headers ?? {}) },
    });
  } catch {
    throw new AdminApiError('Could not reach the server. Check your connection.', 0);
  }

  if (response.status === 401) {
    fireUnauthorized();
    throw new AdminApiError(await readError(response, 'Signed out.'), 401);
  }
  if (!response.ok) {
    throw new AdminApiError(await readError(response, fallbackMessage), response.status);
  }

  // 204s and empty bodies are legal answers to a write.
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdminApiError('The server sent something that is not JSON.', response.status);
  }
}

/* ------------------------------------------------------------------- session */

/** Always answers — `{ authenticated: false }` is a 200, not a 401. */
export async function adminSession(): Promise<AdminSessionResponse> {
  return request<AdminSessionResponse>(`${BASE}/auth/session`, {
    method: 'GET',
    fallbackMessage: 'Could not check the session.',
  });
}

/**
 * Exchanges the shared password for the session cookie.
 *
 * Throws with something a person can act on: a wrong password, a server that
 * has no password configured yet, and a dead network are three different
 * problems and the login card says which.
 */
export async function adminLogin(password: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new AdminApiError('Could not reach the server. Check your connection.', 0);
  }

  if (response.ok) return;

  if (response.status === 401) {
    throw new AdminApiError('That password is not right.', 401);
  }
  if (response.status === 429) {
    throw new AdminApiError('Too many attempts. Wait a minute and try again.', 429);
  }
  if (response.status === 503) {
    throw new AdminApiError(
      'The admin password is not configured on the server yet.',
      503
    );
  }
  throw new AdminApiError(
    await readError(response, `Sign-in failed (HTTP ${response.status}).`),
    response.status
  );
}

/** Clears the cookie server-side. Never throws — signing out must always work. */
export async function adminLogout(): Promise<void> {
  try {
    await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
  } catch {
    /* the cookie expires on its own in 12 h either way */
  }
}

/* ---------------------------------------------------------------------- data */

export type AdminView = 'overview' | 'events' | 'errors' | 'feedback' | 'settings';

type Query = Record<string, string | number | undefined>;

function withQuery(view: AdminView, query?: Query): string {
  const url = `${BASE}/data/${view}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function adminGet<T>(view: AdminView, query?: Query): Promise<T> {
  return request<T>(withQuery(view, query), {
    method: 'GET',
    fallbackMessage: `Could not load ${view}.`,
  });
}

export async function adminPost<T>(view: AdminView, body: unknown): Promise<T> {
  return request<T>(withQuery(view), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    fallbackMessage: `Could not save ${view}.`,
  });
}

/**
 * The settings endpoint answers `{ flags: {...} }`; older fixtures and a
 * hand-written stub may hand back the bare object. Either way, the caller
 * gets the flags or `null`, never the envelope.
 */
export function flagsOf<T extends object>(payload: unknown): T | null {
  if (!payload || typeof payload !== 'object') return null;
  const wrapped = (payload as Record<string, unknown>).flags;
  if (wrapped && typeof wrapped === 'object') return wrapped as T;
  return payload as T;
}

/**
 * Pulls a row array out of whatever envelope the endpoint used.
 *
 * The list endpoints are written by another pair of hands in the same release;
 * `[…]`, `{ rows: […] }` and `{ items: […] }` are all reasonable answers to
 * "give me the feedback". Accepting the three of them costs six lines and
 * removes an entire class of launch-day breakage where the dashboard renders
 * an empty state over data that arrived perfectly well.
 */
export function rowsOf<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    for (const key of ['rows', 'items', 'data', 'feedback', 'events', 'errors']) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}
