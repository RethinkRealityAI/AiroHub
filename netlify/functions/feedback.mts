/**
 * `POST /api/feedback` — the message the feedback sheet sends.
 *
 * This is the one endpoint on the public side that is allowed to fail loudly.
 * A dropped feedback message is worse than an error message: the person typed
 * something and believes it arrived. So unlike `/api/track`, a database that is
 * not answering gets an honest 503 and the sheet can say "try again", rather
 * than a 200 that quietly discards what they wrote.
 *
 * Three defences, in the order they matter:
 *
 *  - The 16 KB body cap runs before parsing. Without it a bot posting a
 *    multi-megabyte body makes the function pay to parse it, and the rate limit
 *    only bounds the number of requests, not their size.
 *  - The honeypot is answered with the same 200 a real submission gets. Telling
 *    a bot its fill was detected is how a honeypot stops working.
 *  - Everything else is bounded by `validateFeedback` before it reaches SQL,
 *    because the table's CHECK constraints would otherwise turn a too-long
 *    message into a 500.
 *
 * The user agent and country are recorded server-side rather than trusted from
 * the body: a bug report needs to say which browser it came from, and the
 * client is the one thing that cannot be relied on when the client is broken.
 */
import type { Config, Context } from '@netlify/functions';
import { validateFeedback } from './lib/validate.js';
import { dbUnavailable, getDb, isDbConfigured, json } from './lib/db.js';

/** Well above a 2,000-character message plus overhead; far below anything abusive. */
const BODY_MAX_BYTES = 16 * 1024;
const USER_AGENT_MAX = 400;

const encoder = new TextEncoder();

export default async (request: Request, context: Context): Promise<Response> => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return json({ error: 'invalid', message: 'Could not read the request body.' }, 400);
  }

  if (encoder.encode(raw).length > BODY_MAX_BYTES) {
    return json({ error: 'too_large', message: 'That message is too long to send.' }, 413);
  }

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid', message: 'Send a JSON object.' }, 400);
  }

  const result = validateFeedback(body);

  if ('honeypot' in result) {
    // Looks like a bot. Same answer as a real submission, no row written.
    return json({ ok: true }, 200);
  }
  if ('error' in result) {
    return json({ error: 'invalid', message: result.error }, 400);
  }

  if (!isDbConfigured()) return dbUnavailable();

  const { kind, message, email, path, roomId } = result.row;
  const userAgent = (request.headers.get('user-agent') ?? '').slice(0, USER_AGENT_MAX);
  const country = (context.geo?.country?.code ?? '').slice(0, 2);

  try {
    // `id::int` because the driver hands back a bigserial as a string, and the
    // contract says `number`. A launch will not see 2^31 messages.
    const rows = await getDb().sql<{ id: number }>`
      insert into feedback (kind, message, email, path, room_id, user_agent, country)
      values (${kind}, ${message}, ${email}, ${path}, ${roomId}, ${userAgent}, ${country})
      returning id::int as id
    `;
    return json({ ok: true, id: rows[0]?.id ?? 0 }, 201);
  } catch (error) {
    console.error('[feedback] insert failed', error);
    return dbUnavailable();
  }
};

export const config: Config = {
  path: '/api/feedback',
  method: 'POST',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
