/**
 * `GET /api/flags` — the public half of the feature flags.
 *
 * THIS ENDPOINT MUST NEVER RETURN A 5xx, and the whole file is shaped around
 * that. Every page in the app calls it on load to decide whether the AI panel,
 * Pad mode, stamps, uploads and the feedback button exist. Netlify Database
 * sleeps on inactivity, so "the database is not answering" is a normal Tuesday,
 * not an outage — and a 500 here would put a failed request in the console of
 * every visitor on a launch day and give the client nothing to render with.
 *
 * So there are three nested guards, each catching a different failure:
 * `isDbConfigured()` for a deploy with no database attached, `safeQuery` for a
 * query that throws, and the outer `try` for `getDb()` itself failing to build
 * a pool. All three end at the same place — the compiled-in defaults, which are
 * a completely serviceable answer.
 *
 * `mergeFlags` is what makes malformed rows safe: a settings row edited by hand
 * into `{"aiPanel": "yes"}` is coerced away rather than turning a feature on.
 *
 * The 60-second cache is the deliberate trade: a flag flip reaches visitors
 * within about a minute, and in exchange a burst of traffic costs one database
 * read rather than one per visitor. It is also why this is the one endpoint in
 * the launch set that is not `no-store`.
 *
 * The handler takes no arguments on purpose. `config.method` pins it to GET,
 * and every visitor gets byte-identical bytes — no cookie, no geo, no query
 * string. That is what makes a shared cache correct here, and reading nothing
 * from the request is how it stays that way.
 */
import type { Config } from '@netlify/functions';
import { DEFAULT_FLAGS, type Flags } from '../../src/api/contracts.js';
import { getDb, isDbConfigured, json, safeQuery } from './_db.js';
import { mergeFlags, publicSubset, type SettingRow } from './_flags.js';

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60' };

const respond = (flags: Flags): Response => json(publicSubset(flags), 200, CACHE_HEADERS);

export default async (): Promise<Response> => {
  try {
    if (!isDbConfigured()) return respond(DEFAULT_FLAGS);

    // Only the two public keys are read — the same pair as `PUBLIC_FLAG_KEYS`
    // in the contract. `ai.dailyCap` is an operational number and never leaves
    // the admin API, so it is filtered out here as well as by `publicSubset`.
    const rows = await safeQuery<SettingRow[]>(
      async () =>
        await getDb().sql<SettingRow>`
          select key, value from settings where key in ('ui', 'notice')
        `,
      [],
      'flags.read'
    );

    return respond(mergeFlags(rows));
  } catch (error) {
    console.error('[flags] falling back to defaults', error);
    return respond(DEFAULT_FLAGS);
  }
};

export const config: Config = {
  path: '/api/flags',
  method: 'GET',
};
