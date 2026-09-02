/**
 * `/api/admin/data/:view` — everything the dashboard reads and writes.
 *
 * One function for all six views because they share a gate and a warm
 * instance: splitting them would pay a cold start per panel and give the
 * dashboard four different ways to be unauthorised.
 *
 * Two rules run before any view does. `requireAdmin` first, so an unauthorised
 * caller never learns whether a database is even attached; `isDbConfigured`
 * second, so a preview without one answers a clean 503 instead of a connection
 * error. The order matters — swapping it turns the 503 into an unauthenticated
 * probe of the deploy's configuration.
 *
 * The overview runs its six aggregates in ONE `Promise.all` round trip, each
 * wrapped in `safeQuery`. That combination is deliberate: the six are
 * independent, so running them in series would make the dashboard as slow as
 * their sum, and a single failing aggregate must cost one empty panel rather
 * than the whole page. Every count is cast to `int` in SQL because Postgres
 * returns `count(*)` as bigint and the driver hands bigints back as strings —
 * which would render as "1,234" fine and then break every chart that does
 * arithmetic on it.
 *
 * The visitor numbers are per-day by construction. See the migration header:
 * the hash salt rotates at midnight UTC, so `count(distinct visitor_hash)`
 * grouped by day is a real number and the same count over a range is not. The
 * dashboard is required to label it.
 */
import type { Config, Context } from '@netlify/functions';
import {
  FEEDBACK_NOTE_MAX,
  FEEDBACK_STATUSES,
  type DailyPoint,
  type EventRow,
  type FeedbackRow,
  type FeedbackStatus,
  type Flags,
  type OverviewResponse,
  type Ranked,
} from '../../src/api/contracts.js';
import { requireAdmin } from './lib/auth.js';
import { dbUnavailable, getDb, isDbConfigured, json, safeQuery } from './lib/db.js';
import { FLAG_KEYS, mergeFlags, type FlagKey, type SettingRow } from './lib/flags.js';

/** The two ranges the dashboard offers. Anything else falls back to 14. */
const OVERVIEW_DAYS: readonly number[] = [14, 30];
const DEFAULT_DAYS = 14;
/** A dashboard table nobody scrolls past 200 rows of. */
const LIST_LIMIT_MAX = 200;
const DEFAULT_LIST_LIMIT = 50;
const TOP_LIMIT = 12;
const RECENT_LIMIT = 40;
const ERROR_DAYS = 7;
const MAX_DAYS = 90;

/**
 * ISO-8601 in UTC, formatted in SQL so the driver never hands back a `Date` that
 * a JSON round trip would re-render in the server's local zone. Bound as a
 * parameter (`::text`) like every other interpolation in this file.
 */
const UTC_ISO = 'YYYY-MM-DD"T"HH24:MI:SS"Z"';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A query number, or `null` when the parameter is absent or not a number.
 * `Number(null)` is 0, so reading the parameter straight into `Number` would
 * turn "no limit given" into the smallest allowed limit.
 */
function readNumber(url: URL, name: string): number | null {
  const param = url.searchParams.get(name);
  if (param === null || param.trim() === '') return null;
  const raw = Number(param);
  return Number.isFinite(raw) ? Math.trunc(raw) : null;
}

function readDays(url: URL, allowed: readonly number[] | null, fallback: number): number {
  const days = readNumber(url, 'days');
  if (days === null) return fallback;
  if (allowed) return allowed.includes(days) ? days : fallback;
  return Math.min(MAX_DAYS, Math.max(1, days));
}

function readLimit(url: URL): number {
  const limit = readNumber(url, 'limit');
  if (limit === null) return DEFAULT_LIST_LIMIT;
  return Math.min(LIST_LIMIT_MAX, Math.max(1, limit));
}

/** `YYYY-MM-DD` for each of the last `days` UTC days, oldest first. */
function dayScaffold(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/* ---------------------------------------------------------------- overview */

interface DailyRow {
  day: string;
  views: number;
  visitors: number;
  rooms: number;
}
interface TodayRow {
  views: number;
  visitors: number;
  rooms: number;
  errors: number;
}
interface TopRow {
  kind: string;
  key: string;
  hits: number;
  sessions: number;
}

async function overview(days: number): Promise<OverviewResponse> {
  const db = getDb();

  const [daily, today, top, recent, aiCalls, feedbackCounts] = await Promise.all([
    safeQuery<DailyRow[]>(
      async () =>
        await db.sql<DailyRow>`
          select to_char((occurred_at at time zone 'utc')::date, 'YYYY-MM-DD') as day,
                 (count(*) filter (where name = 'page_view'))::int as views,
                 count(distinct visitor_hash)::int as visitors,
                 count(distinct nullif(room_id, ''))::int as rooms
          from events
          where occurred_at >= now() - (${days}::int * interval '1 day')
            and device <> 'bot'
          group by 1
          order by 1
        `,
      [],
      'overview.daily'
    ),

    safeQuery<TodayRow[]>(
      async () =>
        await db.sql<TodayRow>`
          select (count(*) filter (where name = 'page_view'))::int as views,
                 count(distinct visitor_hash)::int as visitors,
                 count(distinct nullif(room_id, ''))::int as rooms,
                 (count(*) filter (where name = 'client.error'))::int as errors
          from events
          where occurred_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
            and device <> 'bot'
        `,
      [],
      'overview.today'
    ),

    // Four top-12 lists in one statement: they share the same scan, and four
    // separate round trips is four chances for the dashboard to half-load.
    safeQuery<TopRow[]>(
      async () =>
        await db.sql<TopRow>`
          with scope as (
            select referrer_host, path, device, country, session_id
            from events
            where occurred_at >= now() - (${days}::int * interval '1 day')
              and device <> 'bot'
          )
          (select 'referrer'::text as kind, referrer_host as key,
                  count(*)::int as hits, count(distinct session_id)::int as sessions
             from scope where referrer_host <> ''
             group by referrer_host order by 3 desc, 2 asc limit ${TOP_LIMIT}::int)
          union all
          (select 'page'::text, path, count(*)::int, count(distinct session_id)::int
             from scope where path <> ''
             group by path order by 3 desc, 2 asc limit ${TOP_LIMIT}::int)
          union all
          (select 'device'::text, device, count(*)::int, count(distinct session_id)::int
             from scope
             group by device order by 3 desc, 2 asc limit ${TOP_LIMIT}::int)
          union all
          (select 'country'::text, country, count(*)::int, count(distinct session_id)::int
             from scope where country <> ''
             group by country order by 3 desc, 2 asc limit ${TOP_LIMIT}::int)
        `,
      [],
      'overview.top'
    ),

    safeQuery<EventRow[]>(
      async () =>
        await db.sql<EventRow>`
          select to_char(occurred_at at time zone 'utc', ${UTC_ISO}::text) as occurred_at,
                 name, path, room_id, referrer_host, device, country, props
          from events
          order by occurred_at desc
          limit ${RECENT_LIMIT}::int
        `,
      [],
      'overview.recent'
    ),

    safeQuery<{ calls: number }[]>(
      async () =>
        await db.sql<{ calls: number }>`
          select calls::int as calls
          from ai_usage
          where day = (now() at time zone 'utc')::date
        `,
      [],
      'overview.ai'
    ),

    safeQuery<{ status: FeedbackStatus; total: number }[]>(
      async () =>
        await db.sql<{ status: FeedbackStatus; total: number }>`
          select status, count(*)::int as total from feedback group by status
        `,
      [],
      'overview.feedback'
    ),
  ]);

  const byDay = new Map(daily.map((row) => [row.day, row]));
  const series: DailyPoint[] = dayScaffold(days).map((day) => {
    const row = byDay.get(day);
    return {
      day,
      views: row?.views ?? 0,
      visitors: row?.visitors ?? 0,
      rooms: row?.rooms ?? 0,
    };
  });

  // Sorted here, not relied on from SQL: `union all` makes no promise about the
  // order rows come back in, and each of these four lists is rendered as a
  // ranked bar chart where the order IS the information.
  const rank = (kind: string): Ranked[] =>
    top
      .filter((row) => row.kind === kind)
      .map((row) => ({ key: row.key, hits: row.hits, sessions: row.sessions }))
      .sort((a, b) => b.hits - a.hits || a.key.localeCompare(b.key));

  const counts: Record<FeedbackStatus, number> = { new: 0, read: 0, resolved: 0 };
  for (const row of feedbackCounts) {
    if (row.status in counts) counts[row.status] = row.total;
  }

  return {
    days,
    daily: series,
    today: {
      views: today[0]?.views ?? 0,
      visitors: today[0]?.visitors ?? 0,
      rooms: today[0]?.rooms ?? 0,
      errors: today[0]?.errors ?? 0,
    },
    referrers: rank('referrer'),
    pages: rank('page'),
    devices: rank('device'),
    countries: rank('country'),
    recent,
    aiCallsToday: aiCalls[0]?.calls ?? 0,
    feedbackCounts: counts,
  };
}

/* ------------------------------------------------------------------ events */

async function listEvents(name: string, days: number, limit: number): Promise<EventRow[]> {
  return safeQuery<EventRow[]>(
    async () =>
      await getDb().sql<EventRow>`
        select to_char(occurred_at at time zone 'utc', ${UTC_ISO}::text) as occurred_at,
               name, path, room_id, referrer_host, device, country, props
        from events
        where occurred_at >= now() - (${days}::int * interval '1 day')
          and (${name}::text = '' or name = ${name}::text)
        order by occurred_at desc
        limit ${limit}::int
      `,
    [],
    'events.list'
  );
}

/* ---------------------------------------------------------------- feedback */

async function listFeedback(status: string, limit: number) {
  const db = getDb();
  const [rows, counts] = await Promise.all([
    safeQuery<FeedbackRow[]>(
      async () =>
        await db.sql<FeedbackRow>`
          select id::int as id,
                 to_char(created_at at time zone 'utc', ${UTC_ISO}::text) as created_at,
                 kind, message, email, path, room_id, user_agent, country, status, admin_note,
                 to_char(updated_at at time zone 'utc', ${UTC_ISO}::text) as updated_at
          from feedback
          where (${status}::text = 'all' or status = ${status}::text)
          order by created_at desc
          limit ${limit}::int
        `,
      [],
      'feedback.list'
    ),
    safeQuery<{ status: FeedbackStatus; total: number }[]>(
      async () => await db.sql<{ status: FeedbackStatus; total: number }>`
        select status, count(*)::int as total from feedback group by status
      `,
      [],
      'feedback.counts'
    ),
  ]);

  const tally: Record<FeedbackStatus, number> = { new: 0, read: 0, resolved: 0 };
  for (const row of counts) {
    if (row.status in tally) tally[row.status] = row.total;
  }
  return { rows, counts: tally };
}

/* ---------------------------------------------------------------- settings */

async function readSettings(): Promise<SettingRow[]> {
  return safeQuery<SettingRow[]>(readSettingsStrict, [], 'settings.read');
}

/**
 * The same read without the soft landing. A write merges the patch onto what
 * is stored, so a read that quietly answered "nothing is stored" would make
 * that write persist the defaults over every setting the patch did not name.
 * Here a failed read has to fail the request.
 */
async function readSettingsStrict(): Promise<SettingRow[]> {
  return await getDb().sql<SettingRow>`select key, value from settings`;
}

/* ------------------------------------------------------------------- entry */

export default async (request: Request, context: Context): Promise<Response> => {
  const denied = requireAdmin(context);
  if (denied) return denied;

  if (!isDbConfigured()) return dbUnavailable();

  const view = context.params?.view ?? '';
  const url = new URL(request.url);
  const method = request.method;

  let body: unknown = null;
  if (method === 'POST') {
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid', message: 'Send a JSON object.' }, 400);
    }
  }

  try {
    switch (view) {
      case 'overview': {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        return json(await overview(readDays(url, OVERVIEW_DAYS, DEFAULT_DAYS)));
      }

      case 'events': {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        const name = (url.searchParams.get('name') ?? '').slice(0, 40);
        return json({ rows: await listEvents(name, readDays(url, null, DEFAULT_DAYS), readLimit(url)) });
      }

      case 'errors': {
        if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        // Fixed to the one event name and a week: this view exists to answer
        // "is the app throwing at people right now", not to browse history.
        return json({ rows: await listEvents('client.error', ERROR_DAYS, readLimit(url)) });
      }

      case 'feedback': {
        if (method === 'GET') {
          const requested = url.searchParams.get('status') ?? 'all';
          const status =
            requested === 'all' || (FEEDBACK_STATUSES as readonly string[]).includes(requested)
              ? requested
              : 'all';
          return json(await listFeedback(status, readLimit(url)));
        }
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

        const patch = isPlainObject(body) ? body : {};
        const id = Number(patch.id);
        if (!Number.isInteger(id) || id <= 0) {
          return json({ error: 'invalid', message: 'id must be a positive integer.' }, 400);
        }

        let status: string | null = null;
        if (patch.status !== undefined) {
          if (
            typeof patch.status !== 'string' ||
            !(FEEDBACK_STATUSES as readonly string[]).includes(patch.status)
          ) {
            return json(
              { error: 'invalid', message: `status must be one of ${FEEDBACK_STATUSES.join(', ')}.` },
              400
            );
          }
          status = patch.status;
        }

        let adminNote: string | null = null;
        if (patch.adminNote !== undefined) {
          if (typeof patch.adminNote !== 'string') {
            return json({ error: 'invalid', message: 'adminNote must be text.' }, 400);
          }
          adminNote = patch.adminNote.slice(0, FEEDBACK_NOTE_MAX);
        }

        if (status === null && adminNote === null) {
          return json({ error: 'invalid', message: 'Nothing to update.' }, 400);
        }

        // `coalesce` is what makes this a patch rather than a replace: an
        // absent field leaves the stored column exactly as it was.
        const rows = await getDb().sql<FeedbackRow>`
          update feedback
          set status = coalesce(${status}::text, status),
              admin_note = coalesce(${adminNote}::text, admin_note),
              updated_at = now()
          where id = ${id}::bigint
          returning id::int as id,
                    to_char(created_at at time zone 'utc', ${UTC_ISO}::text) as created_at,
                    kind, message, email, path, room_id, user_agent, country, status, admin_note,
                    to_char(updated_at at time zone 'utc', ${UTC_ISO}::text) as updated_at
        `;
        if (!rows[0]) return json({ error: 'not_found', message: `No feedback with id ${id}.` }, 404);
        return json({ row: rows[0] });
      }

      case 'settings': {
        if (method === 'GET') {
          return json({ flags: mergeFlags(await readSettings()) });
        }
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

        const patch = isPlainObject(body) && isPlainObject(body.flags) ? body.flags : null;
        if (!patch) {
          return json({ error: 'invalid', message: 'Send { flags: { ... } }.' }, 400);
        }

        const supplied = FLAG_KEYS.filter((key) =>
          Object.prototype.hasOwnProperty.call(patch, key)
        ) as FlagKey[];
        if (supplied.length === 0) {
          return json(
            { error: 'invalid', message: `Supply at least one of ${FLAG_KEYS.join(', ')}.` },
            400
          );
        }

        // Validate by merging the patch onto what is already stored, then write
        // back the MERGED value. Writing the raw patch would let a partial `ui`
        // object erase the flags it did not mention, and would store whatever
        // types the caller sent.
        const current = await readSettingsStrict();
        const merged: Flags = mergeFlags([
          ...current,
          ...supplied.map((key) => ({ key, value: patch[key] })),
        ]);

        const db = getDb();
        for (const key of supplied) {
          await db.sql`
            insert into settings (key, value, updated_at)
            values (${key}, ${JSON.stringify(merged[key])}::jsonb, now())
            on conflict (key) do update set value = excluded.value, updated_at = now()
          `;
        }

        return json({ flags: merged });
      }

      default:
        return json({ error: 'not_found', message: `Unknown admin view "${view}".` }, 404);
    }
  } catch (error) {
    console.error(`[admin-data/${view}]`, error);
    return dbUnavailable();
  }
};

export const config: Config = {
  path: '/api/admin/data/:view',
};
