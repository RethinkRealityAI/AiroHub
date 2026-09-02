/**
 * `POST /api/track` — first-party, cookieless analytics.
 *
 * THIS ENDPOINT MUST NEVER RETURN A 5xx. It is called by `sendBeacon` and by
 * `fetch(..., { keepalive: true })` on page hide, from every page, including
 * while the studio is mid-session. A 5xx here is a red line in the console of
 * every visitor and a failed request in the network panel of anyone who opens
 * devtools during a launch; worse, it is a failure the client cannot act on,
 * because the person has already navigated away. So every failure path — no
 * database, a sleeping database, an unusable body, a salt lookup that threw —
 * ends at `200 { accepted, dropped }`, with `accepted: 0` telling the truth
 * about what was stored.
 *
 * WHAT IS STORED, AND WHY IT IS NOT PERSONAL DATA
 *
 * The IP address and user agent are used and thrown away in the same request.
 * They go into `visitorHash` together with a salt that is generated once per
 * UTC day and deleted by the prune job days later; what lands in the table is a
 * 64-character digest and a one-word device class. Once the salt is gone the
 * digest cannot be linked back to an address, which is what makes
 * "unique visitors" answerable without keeping anything about the visitor.
 *
 * The salt is memoised per warm instance and keyed by UTC date, so a busy
 * instance does one salt round trip per day rather than one per request, and
 * rolls over on its own at midnight without a restart.
 *
 * Everything the client sends is re-derived here rather than trusted: the
 * referrer becomes a bare host, the path has room codes folded to `:room`, and
 * the device comes from the request's own user-agent header.
 */
import type { Config, Context } from '@netlify/functions';
import { randomBytes } from 'node:crypto';
import { TRACK_MAX_BODY_BYTES, type TrackResponse } from '../../src/api/contracts.js';
import { getDb, isDbConfigured, json, safeQuery } from './_db.js';
import { deviceFromUa } from './_ua.js';
import { validateTrack, visitorHash, type CleanEvent } from './_validate.js';

const encoder = new TextEncoder();

/** 48 hex characters, comfortably inside the table's 32..96 CHECK. */
const newSalt = (): string => randomBytes(24).toString('hex');

const utcDay = (now = new Date()): string => now.toISOString().slice(0, 10);

let cachedSalt: { day: string; salt: string } | null = null;

/**
 * Today's salt, created by whichever instance asks first.
 *
 * The CTE is the race-safe part: the insert claims the day, `on conflict do
 * nothing` makes a loser of every other instance, and the `union all` then
 * reads whatever actually landed. Two instances starting in the same second
 * therefore agree on one salt, which they must — a second salt would split one
 * visitor into two.
 */
async function dailySalt(): Promise<string | null> {
  const day = utcDay();
  if (cachedSalt && cachedSalt.day === day) return cachedSalt.salt;

  const candidate = newSalt();
  const rows = await safeQuery<{ salt: string }[]>(
    async () =>
      await getDb().sql<{ salt: string }>`
        with claimed as (
          insert into visitor_salts (day, salt)
          values ((now() at time zone 'utc')::date, ${candidate})
          on conflict (day) do nothing
          returning salt
        )
        select salt from claimed
        union all
        select salt from visitor_salts where day = (now() at time zone 'utc')::date
        limit 1
      `,
    [],
    'track.salt'
  );

  const salt = rows[0]?.salt;
  if (!salt) return null;

  cachedSalt = { day, salt };
  return salt;
}

async function insertEvents(
  events: CleanEvent[],
  sessionId: string,
  hash: string,
  referrer: string,
  device: string,
  country: string
): Promise<number> {
  // One statement for the whole batch. `jsonb_to_recordset` expands the batch
  // server-side, so twenty events cost one round trip instead of twenty — which
  // is the difference between a beacon that lands during page unload and one
  // that does not.
  return safeQuery<number>(
    async () => {
      await getDb().sql`
        insert into events
          (name, session_id, visitor_hash, path, room_id, referrer_host, device, country, props)
        select e.name, ${sessionId}::text, ${hash}::text, e.path, e.room_id,
               ${referrer}::text, ${device}::text, ${country}::text, e.props
        from jsonb_to_recordset(${JSON.stringify(events)}::jsonb)
          as e(name text, path text, room_id text, props jsonb)
      `;
      return events.length;
    },
    0,
    'track.insert'
  );
}

export default async (request: Request, context: Context): Promise<Response> => {
  const answer = (accepted: number, dropped: number): Response =>
    json({ accepted, dropped } satisfies TrackResponse, 200);

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return answer(0, 0);
  }

  // Checked before parsing: the cap exists to stop the function paying to parse
  // a body it was never going to store.
  if (encoder.encode(raw).length > TRACK_MAX_BODY_BYTES) return answer(0, 0);

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return answer(0, 0);
  }

  let selfHost = '';
  try {
    selfHost = new URL(request.url).host;
  } catch {
    /* An unparseable request URL only costs the self-referral filter. */
  }

  const parsed = validateTrack(body, selfHost);
  if (!parsed) return answer(0, 0);
  if (parsed.events.length === 0) return answer(0, parsed.dropped);

  if (!isDbConfigured()) return answer(0, parsed.dropped);

  try {
    const salt = await dailySalt();
    // No salt means no anonymous identity, and an event without one is not
    // worth storing under a placeholder that would merge every visitor.
    if (!salt) return answer(0, parsed.dropped);

    const ua = request.headers.get('user-agent') ?? '';
    const hash = visitorHash(salt, context.ip ?? '', ua);
    const accepted = await insertEvents(
      parsed.events,
      parsed.sessionId,
      hash,
      parsed.referrerHost,
      deviceFromUa(ua),
      (context.geo?.country?.code ?? '').slice(0, 2)
    );
    return answer(accepted, parsed.dropped);
  } catch (error) {
    // Belt and braces: `safeQuery` already swallows query failures, and this
    // catches anything else (a pool that will not build, for instance) so the
    // contract "never a 5xx" holds no matter what.
    console.error('[track] falling back to accepted 0', error);
    return answer(0, parsed.dropped);
  }
};

export const config: Config = {
  path: '/api/track',
  method: 'POST',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
