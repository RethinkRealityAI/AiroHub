/**
 * Scheduled retention. Runs daily at 04:17 UTC.
 *
 * Two deletes, and the order of the two windows is the point:
 *
 *  - Events older than 90 days go, because a launch dashboard has no use for
 *    them and an analytics table that only grows is a liability that only
 *    grows with it.
 *  - Salts older than 95 days go a few days LATER than the events they hashed.
 *    Deleting salts first would be harmless; deleting them earlier than the
 *    events would not — a salt outliving its events is the window in which a
 *    `visitor_hash` could still be recomputed from an IP address, so the events
 *    must always be the first to go.
 *
 * Every failure is logged and swallowed. A scheduled function that throws is
 * retried and alerts; nothing here is urgent enough for that, and tomorrow's
 * run cleans up whatever today's missed.
 *
 * 04:17 rather than 04:00: an off-the-hour minute keeps this off the crowded
 * schedule slot every other cron job in the world picked.
 */
import type { Config } from '@netlify/functions';
import { getDb, isDbConfigured } from './lib/db.js';

const EVENT_RETENTION_DAYS = 90;
const SALT_RETENTION_DAYS = 95;

export default async (): Promise<void> => {
  if (!isDbConfigured()) {
    console.log('[prune] skipped: no database configured on this deploy');
    return;
  }

  try {
    const db = getDb();

    // Counting inside a CTE returns one row instead of one row per deletion.
    const events = await db.sql<{ removed: number }>`
      with gone as (
        delete from events
        where occurred_at < now() - (${EVENT_RETENTION_DAYS}::int * interval '1 day')
        returning 1
      )
      select count(*)::int as removed from gone
    `;

    const salts = await db.sql<{ removed: number }>`
      with gone as (
        delete from visitor_salts
        where day < (now() at time zone 'utc')::date - ${SALT_RETENTION_DAYS}::int
        returning 1
      )
      select count(*)::int as removed from gone
    `;

    console.log(
      `[prune] removed ${events[0]?.removed ?? 0} events older than ${EVENT_RETENTION_DAYS} days ` +
        `and ${salts[0]?.removed ?? 0} salts older than ${SALT_RETENTION_DAYS} days`
    );
  } catch (error) {
    console.error('[prune] failed; tomorrow’s run will pick up the backlog', error);
  }
};

export const config: Config = {
  schedule: '17 4 * * *',
};
