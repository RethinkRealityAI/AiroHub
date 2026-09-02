/**
 * AI endpoints.
 *
 * One function serves all three routes; Netlify's path parameter keeps them on
 * the same warm instance rather than paying a cold start per endpoint.
 *
 * Three gates run before Gemini is ever called, and all of them exist because
 * this is the only endpoint in the app that costs money per request:
 *
 *  1. THE FLAG. `ui.aiPanel` is off by default at launch. If it is off, the
 *     route still answers 200 with the curated result and `degraded: 'disabled'`
 *     — the panel is not supposed to be reachable, but a stale tab, a replayed
 *     request or a curious visitor should get a usable answer rather than an
 *     error, and neither should be able to spend anything.
 *  2. THE DAILY CAP. An atomic `insert ... on conflict do update ... returning`
 *     increments and reads today's counter in one statement, so two concurrent
 *     requests cannot both see "one below the cap". Over the cap answers with
 *     the curated result and `degraded: 'cap'`.
 *  3. THE INPUTS. Prompt and custom prompt are cut to 120 characters, the
 *     preset must be one of the known ids, and the object type must match
 *     `/^[a-z0-9-]{1,40}$/`. Everything on this list is interpolated into a
 *     model prompt, so an unbounded field is both a token bill and an
 *     instruction channel.
 *
 * IT FAILS CLOSED, DELIBERATELY. If the counter query throws, or no database is
 * attached at all, the request is treated as over cap and served the curated
 * answer. The trade is explicit: a database outage costs the AI panel its live
 * answers, and the alternative — assuming the count is fine when it cannot be
 * read — is an outage with no ceiling on the bill behind it. On a deploy with
 * no database the flag gate fires first anyway, since the compiled-in default
 * has `aiPanel: false`.
 *
 * The flag read and the counter increment share ONE `Promise.all` round trip.
 * That means the counter is charged even on the disabled path; the alternative
 * is a second serial round trip on every AI request to save a count that only
 * moves when someone calls a switched-off panel.
 */
import type { Config, Context } from '@netlify/functions';
import {
  generateGraffitiWithFallback,
  generateCritiqueWithFallback,
  generateStyleTransformation,
  curatedConcept,
  curatedCritique,
  curatedStyle,
  TRANSFORMATION_PRESETS,
  DEFAULT_TRANSFORMATION,
} from './lib/ai.js';
import { DEFAULT_FLAGS, type Flags } from '../../src/api/contracts.js';
import { getDb, isDbConfigured, json, safeQuery } from './lib/db.js';
import { mergeFlags, type SettingRow } from './lib/flags.js';
import { hex } from './lib/sanitize.js';

/** Long enough for any real idea, short enough to bound the token bill. */
const PROMPT_MAX = 120;
const STYLE_MAX = 40;
const OBJECT_TYPE_RE = /^[a-z0-9-]{1,40}$/;
const DEFAULT_OBJECT_TYPE = 'easel';
const DEFAULT_STYLE = 'wildstyle';
const DEFAULT_COLOR = '#FF4D1C';

const ROUTES = ['graffiti-tag', 'critique', 'transform-style'] as const;
type Route = (typeof ROUTES)[number];

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Flags, or the compiled-in defaults if the database cannot answer. */
async function readFlags(): Promise<Flags> {
  if (!isDbConfigured()) return DEFAULT_FLAGS;
  const rows = await safeQuery<SettingRow[]>(
    async () => await getDb().sql<SettingRow>`select key, value from settings`,
    [],
    'ai.flags'
  );
  return mergeFlags(rows);
}

/**
 * Charge one call against today's budget and return the new total, or `null`
 * when it could not be charged. `null` is treated as over cap by the caller.
 *
 * `(now() at time zone 'utc')::date` rather than `current_date` so the day
 * boundary is UTC no matter what the database session's timezone is set to;
 * every other date in this schema is UTC for the same reason.
 */
async function chargeDailyCall(): Promise<number | null> {
  if (!isDbConfigured()) return null;
  try {
    const rows = await getDb().sql<{ calls: number }>`
      insert into ai_usage (day, calls)
      values ((now() at time zone 'utc')::date, 1)
      on conflict (day) do update set calls = ai_usage.calls + 1, updated_at = now()
      returning calls::int as calls
    `;
    const calls = rows[0]?.calls;
    return typeof calls === 'number' ? calls : null;
  } catch (error) {
    console.error('[ai] daily counter failed; failing closed', error);
    return null;
  }
}

export default async (request: Request, context: Context) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const route = context.params.route;
  if (!(ROUTES as readonly string[]).includes(route)) {
    // Answered before the counter is charged: an unknown route costs nothing.
    return json({ error: `Unknown AI route "${route}"` }, 404);
  }

  let payload: Record<string, any> = {};
  try {
    payload = await request.json();
  } catch {
    /* an empty body just means "use the defaults" */
  }

  const prompt = text(payload.prompt, PROMPT_MAX) || DEFAULT_STYLE;
  const customPrompt = text(payload.customPrompt, PROMPT_MAX);
  const style = text(payload.style, STYLE_MAX) || DEFAULT_STYLE;
  const objectType = OBJECT_TYPE_RE.test(String(payload.objectType ?? ''))
    ? String(payload.objectType)
    : DEFAULT_OBJECT_TYPE;
  const preset = TRANSFORMATION_PRESETS.includes(String(payload.preset ?? ''))
    ? String(payload.preset)
    : DEFAULT_TRANSFORMATION;
  const dominantColor = hex(payload.dominantColor, DEFAULT_COLOR);

  /** The answer this route gives whenever Gemini is not going to be asked. */
  const curated = (): unknown => {
    switch (route as Route) {
      case 'graffiti-tag':
        return curatedConcept(prompt);
      case 'critique':
        return curatedCritique(objectType);
      default:
        return curatedStyle(preset, customPrompt);
    }
  };

  const [flags, calls] = await Promise.all([readFlags(), chargeDailyCall()]);

  if (flags.ui.aiPanel === false) {
    return json({ ...(curated() as object), degraded: 'disabled' });
  }
  if (calls === null || calls > flags.ai.dailyCap) {
    return json({ ...(curated() as object), degraded: 'cap' });
  }

  try {
    switch (route as Route) {
      case 'graffiti-tag':
        return json(await generateGraffitiWithFallback(prompt, style));
      case 'critique':
        return json(await generateCritiqueWithFallback(objectType, dominantColor));
      default:
        return json(await generateStyleTransformation(preset, objectType, customPrompt));
    }
  } catch (error) {
    console.error(`[ai/${route}]`, error);
    // Degrade to the curated response rather than surfacing a 500 mid-session.
    return json(curated());
  }
};

export const config: Config = {
  path: '/api/ai/:route',
  method: 'POST',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
