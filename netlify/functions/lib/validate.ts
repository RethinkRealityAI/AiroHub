/**
 * Everything the browser sends, reduced to something safe to store.
 *
 * These functions run before any row reaches Postgres, and each rule here is a
 * specific thing going wrong otherwise:
 *
 *  - `visitorHash` is the only identity kept. It is a hash of a salt that
 *    rotates daily, so the analytics table cannot be turned back into a list of
 *    IP addresses once the salt is pruned. The salt goes FIRST in the input so
 *    the digest cannot be precomputed against a rainbow table of IPs.
 *  - `normalisePath` folds room codes to `:room`. Without it every throwaway
 *    session becomes its own row in "top pages", which both destroys the report
 *    and stores a shareable room URL in a table that is supposed to be
 *    anonymous.
 *  - `referrerHost` keeps a host and throws the rest away. A full referrer URL
 *    can carry a search query, a session token, or somebody's Reddit DM link.
 *  - `validateTrack` and `validateFeedback` bound every field. The `events`
 *    table has CHECK constraints on all of them, and a violated constraint is
 *    an exception in a function that is contractually not allowed to 5xx, so
 *    the bounds are enforced here where they can be enforced quietly.
 */
import { createHash } from 'node:crypto';
import {
  EVENT_NAMES,
  FEEDBACK_KINDS,
  FEEDBACK_EMAIL_MAX,
  FEEDBACK_MAX,
  FEEDBACK_MIN,
  TRACK_MAX_BATCH,
  TRACK_MAX_PROPS_BYTES,
  type EventName,
  type FeedbackKind,
} from '../../../src/api/contracts.js';

export const PATH_MAX = 200;
export const REFERRER_HOST_MAX = 120;
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const ROOM_ID_RE = /^[A-Za-z0-9]{1,16}$/;
/** Deliberately loose: this rejects typos, not addresses. */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const encoder = new TextEncoder();

const byteLength = (value: string): number => encoder.encode(value).length;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * sha256(salt | ip | user agent). Salt first, and `|` between the parts so
 * "1.2.3" + "4.5" cannot collide with "1.2" + "3.4.5".
 */
export function visitorHash(salt: string, ip: string, ua: string): string {
  return createHash('sha256').update(`${salt}|${ip}|${ua}`, 'utf8').digest('hex');
}

/** `/canvas/AB12CD?x=1#y` becomes `/canvas/:room`. */
export function normalisePath(raw: unknown): string {
  if (typeof raw !== 'string') return '/';

  // Control characters would be stored verbatim and rendered in the dashboard.
  let path = raw.replace(CONTROL_CHARS, '').trim();
  path = path.split('?')[0].split('#')[0];
  if (path.length === 0) return '/';
  if (!path.startsWith('/')) path = `/${path}`;

  path = path
    .replace(/^\/canvas\/[^/]+/i, '/canvas/:room')
    .replace(/^\/controller\/[^/]+/i, '/controller/:room');

  return path.slice(0, PATH_MAX);
}

/**
 * The host a visit came from, or `''` for "no useful referrer" — which covers
 * a direct visit, an internal navigation, and anything unparseable alike.
 * `selfHost` is passed in rather than read from an env var so a deploy preview
 * does not report every one of its own page views as a referral.
 */
export function referrerHost(raw: unknown, selfHost = ''): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (value.length === 0) return '';

  // Reddit's Android app sends `android-app://com.reddit.frontpage`, which is
  // the single most valuable referrer this launch has and is not a web URL.
  const app = /^android-app:\/\/([^/?#]+)/i.exec(value);
  if (app) return app[1].toLowerCase().slice(0, REFERRER_HOST_MAX);

  let host = '';
  try {
    host = new URL(value).hostname;
  } catch {
    return '';
  }

  host = host.toLowerCase().replace(/^www\./, '');
  if (host.length === 0) return '';

  const self = String(selfHost).toLowerCase().replace(/^www\./, '').split(':')[0];
  if (self.length > 0 && host === self) return '';

  return host.slice(0, REFERRER_HOST_MAX);
}

/** A room code, or `''`. Never a partially-cleaned one. */
export function normaliseRoomId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  return ROOM_ID_RE.test(value) ? value : '';
}

/* ------------------------------------------------------------------ track */

/** One event, in exactly the column shape `jsonb_to_recordset` expands. */
export interface CleanEvent {
  name: EventName;
  path: string;
  room_id: string;
  props: Record<string, unknown>;
}

export interface TrackValidation {
  sessionId: string;
  /** Derived here so the endpoint never has to look at the raw referrer. */
  referrerHost: string;
  events: CleanEvent[];
  dropped: number;
}

/**
 * `null` means the body was not a track request at all. Anything else returns
 * the events worth storing plus a count of what was thrown away, because
 * "accepted 18 of 20" is a diagnosable answer and a silent truncation is not.
 *
 * An event whose `props` is not a plain object is dropped rather than blanked:
 * it is the same field failing in the same way as an oversized `props`, and a
 * client sending `props: "..."` has a bug worth seeing in the dropped count.
 */
export function validateTrack(body: unknown, selfHost = ''): TrackValidation | null {
  if (!isPlainObject(body)) return null;

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!SESSION_ID_RE.test(sessionId)) return null;

  const list = Array.isArray(body.events) ? body.events : null;
  if (!list) return null;

  const events: CleanEvent[] = [];
  for (const raw of list) {
    // Everything past the batch cap is dropped; no need to inspect it.
    if (events.length >= TRACK_MAX_BATCH) break;
    if (!isPlainObject(raw)) continue;

    const name = raw.name;
    if (typeof name !== 'string' || !(EVENT_NAMES as readonly string[]).includes(name)) continue;

    let props: Record<string, unknown> = {};
    if (raw.props !== undefined && raw.props !== null) {
      if (!isPlainObject(raw.props)) continue;
      let encoded = '';
      try {
        encoded = JSON.stringify(raw.props) ?? '{}';
      } catch {
        // Circular or non-serialisable props: not storable, not worth a 500.
        continue;
      }
      if (byteLength(encoded) > TRACK_MAX_PROPS_BYTES) continue;
      props = raw.props;
    }

    events.push({
      name: name as EventName,
      path: normalisePath(raw.path),
      room_id: normaliseRoomId(raw.roomId),
      props,
    });
  }

  return {
    sessionId,
    referrerHost: referrerHost(body.referrer, selfHost),
    events,
    dropped: list.length - events.length,
  };
}

/* --------------------------------------------------------------- feedback */

/** The row the feedback endpoint inserts, already inside every CHECK bound. */
export interface FeedbackDraft {
  kind: FeedbackKind;
  message: string;
  email: string;
  path: string;
  roomId: string;
}

export type FeedbackValidation = { honeypot: true } | { error: string } | { row: FeedbackDraft };

/**
 * The honeypot is checked first and answers with the same 200 a real
 * submission gets: a bot that learns its fill was rejected simply stops filling
 * it, and then the field is worth nothing.
 */
export function validateFeedback(body: unknown): FeedbackValidation {
  if (!isPlainObject(body)) return { error: 'Send a JSON object.' };

  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return { honeypot: true };
  }

  const kind = body.kind;
  if (typeof kind !== 'string' || !(FEEDBACK_KINDS as readonly string[]).includes(kind)) {
    return { error: `kind must be one of ${FEEDBACK_KINDS.join(', ')}.` };
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  // The column's check counts characters; `.length` counts UTF-16 units, so
  // two emoji would pass here and fail there. Count code points for the floor.
  // The ceiling is safe as is: units >= characters, so it only ever errs strict.
  if ([...message].length < FEEDBACK_MIN) {
    return { error: `message must be at least ${FEEDBACK_MIN} characters.` };
  }
  if (message.length > FEEDBACK_MAX) {
    return { error: `message must be at most ${FEEDBACK_MAX} characters.` };
  }

  let email = '';
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    if (typeof body.email !== 'string') return { error: 'email must be text.' };
    email = body.email.trim();
    if (email.length > 0) {
      if (email.length > FEEDBACK_EMAIL_MAX) {
        return { error: `email must be at most ${FEEDBACK_EMAIL_MAX} characters.` };
      }
      if (!EMAIL_RE.test(email)) return { error: 'email does not look like an address.' };
    }
  }

  return {
    row: {
      kind: kind as FeedbackKind,
      message,
      email,
      path: normalisePath(body.path),
      roomId: normaliseRoomId(body.roomId),
    },
  };
}
