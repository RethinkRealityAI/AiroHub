/**
 * Launch endpoint suite.
 *
 * The validators are tested next door; this file tests the seven request
 * handlers themselves — status codes, cookies, headers, and which SQL actually
 * runs. Each check is a promise the rest of the launch is built on:
 *
 *  A  a wrong password is a 401 AND sets no cookie; a right one is a 200 with
 *     an HttpOnly + Secure + SameSite=Strict cookie. A login that answers 200
 *     without a cookie, or sets one on failure, is the whole gate gone.
 *  B  the session probe recognises that cookie, always answers 200, and logout
 *     deletes it. A 401 from the probe would trip the client's own 401 handler
 *     and loop the dashboard back to the login card forever.
 *  C  `/api/admin/data/*` refuses a request with no cookie before it touches
 *     the database — the gate runs first, so an unauthorised caller cannot even
 *     learn whether a database is attached.
 *  D  `/api/flags` answers 200 with the defaults and `max-age=60` WHILE THE
 *     DATABASE IS THROWING. Netlify Database sleeps on inactivity, so this is
 *     the normal state, not the exceptional one; a 5xx here breaks first paint
 *     on every page at once.
 *  E  `/api/track` accepts 20 of 25 events in ONE insert, and answers 200 with
 *     `accepted: 0` when the database is down. It is called from `sendBeacon`
 *     during page unload — there is nobody left to retry.
 *  F  the feedback honeypot answers 200 and writes NOTHING; a real message is a
 *     201 with an insert; an oversized body is a 413; a dead database is an
 *     honest 503, because silently dropping what somebody typed is worse than
 *     telling them it failed.
 *  G  the AI route with the panel flag off answers 200 with the curated result
 *     and `degraded: 'disabled'`, and never constructs a Gemini client. With
 *     the flag on and budget left, the same route falls through to the real
 *     path. This is the cost ceiling for the only endpoint that spends money.
 *
 * Runs headless: bundles the handlers with esbuild, resolving
 * `@netlify/database` and `@google/genai` to in-memory stubs the script drives
 * by hand (the `onResolve` pattern from realtime-reconnect.mjs). No Netlify, no
 * database, no network, no API key.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airo-handlers-'));

/* ------------------------------ database stub ----------------------------- */

const DB_STUB = `
export const dbStub = {
  /** Every statement the handlers ran, newest last. */
  queries: [],
  /** When true, every query rejects — a sleeping or unreachable database. */
  fail: false,
  /** [{ match: RegExp, rows: [] | Error }], first match wins; an Error rejects. */
  handlers: [],
  reset() {
    this.queries.length = 0;
    this.handlers.length = 0;
    this.fail = false;
  },
  answer(match, rows) {
    this.handlers.push({ match, rows });
  },
  matching(pattern) {
    return this.queries.filter((q) => pattern.test(q.text));
  },
  rowsFor(text) {
    for (const handler of this.handlers) {
      if (handler.match.test(text)) return handler.rows;
    }
    return [];
  },
};

function tagged(strings, params) {
  // Reconstruct something readable enough to route and assert on. The real
  // driver would emit $1, $2...; the shape is what matters here.
  return strings.join(' ? ').replace(/\\s+/g, ' ').trim();
}

const sql = (strings, ...params) => {
  const text = tagged(strings, params);
  dbStub.queries.push({ text, params });
  if (dbStub.fail) return Promise.reject(new Error('stub: database unavailable'));
  const rows = dbStub.rowsFor(text);
  if (rows instanceof Error) return Promise.reject(rows);
  return Promise.resolve(rows);
};
sql.unsafe = () => Promise.resolve([]);
sql.raw = (value) => value;

export function getDatabase() {
  return { driver: 'serverless', sql, connectionString: 'postgres://stub/airohub' };
}
`;

/* ------------------------------- gemini stub ------------------------------ */

const GENAI_STUB = `
export const genaiStub = {
  constructed: 0,
  calls: 0,
  reset() {
    this.constructed = 0;
    this.calls = 0;
  },
};

export class GoogleGenAI {
  constructor() {
    genaiStub.constructed += 1;
    this.models = {
      generateContent: async () => {
        genaiStub.calls += 1;
        throw new Error('stub: no Gemini in tests');
      },
    };
  }
}

export const Type = {
  OBJECT: 'OBJECT',
  STRING: 'STRING',
  ARRAY: 'ARRAY',
  NUMBER: 'NUMBER',
};
`;

const dbStubFile = path.join(outDir, 'database-stub.mjs');
const genaiStubFile = path.join(outDir, 'genai-stub.mjs');
fs.writeFileSync(dbStubFile, DB_STUB);
fs.writeFileSync(genaiStubFile, GENAI_STUB);

const fn = (name) => JSON.stringify(path.join(repo, 'netlify/functions', name));

// One entry so the handlers and the stubs they were bundled against are the
// same module instances — the script drives the very database the code holds.
const entryFile = path.join(outDir, 'entry.ts');
fs.writeFileSync(
  entryFile,
  [
    `export { default as adminLogin, config as adminLoginConfig } from ${fn('admin-login.mts')};`,
    `export { default as adminSession, config as adminSessionConfig } from ${fn('admin-session.mts')};`,
    `export { default as adminData, config as adminDataConfig } from ${fn('admin-data.mts')};`,
    `export { default as flags, config as flagsConfig } from ${fn('flags.mts')};`,
    `export { default as feedback, config as feedbackConfig } from ${fn('feedback.mts')};`,
    `export { default as track, config as trackConfig } from ${fn('track.mts')};`,
    `export { default as prune, config as pruneConfig } from ${fn('prune.mts')};`,
    `export { default as ai, config as aiConfig } from ${fn('ai.mts')};`,
    `export { dbStub } from '@netlify/database';`,
    `export { genaiStub } from '@google/genai';`,
  ].join('\n')
);

const bundle = path.join(outDir, 'handlers.mjs');
await build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'error',
  external: ['node:crypto'],
  plugins: [
    {
      name: 'netlify-stubs',
      setup(b) {
        b.onResolve({ filter: /^@netlify\/database$/ }, () => ({ path: dbStubFile }));
        b.onResolve({ filter: /^@google\/genai$/ }, () => ({ path: genaiStubFile }));
      },
    },
  ],
});

/* ------------------------------- environment ------------------------------ */

const PASSWORD = 'correct-horse-battery-staple';
process.env.NETLIFY_DB_URL = 'postgres://stub/airohub';
process.env.ADMIN_PASSWORD = PASSWORD;
process.env.ADMIN_SESSION_SECRET = 'k'.repeat(48);
delete process.env.GEMINI_API_KEY;

const mod = await import(pathToFileURL(bundle).href);
const {
  adminLogin,
  adminLoginConfig,
  adminSession,
  adminSessionConfig,
  adminData,
  adminDataConfig,
  flags,
  flagsConfig,
  feedback,
  feedbackConfig,
  track,
  trackConfig,
  prune,
  pruneConfig,
  ai,
  aiConfig,
  dbStub,
  genaiStub,
} = mod;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

/**
 * Most checks below drive a deliberate failure, and the handlers are supposed
 * to log it. Capturing those lines instead of printing them keeps the report
 * readable AND lets the suite assert that a degraded request left a trace —
 * silent degradation is the failure mode that costs a launch a whole day.
 */
const logged = [];
const realError = console.error;
const realWarn = console.warn;
console.error = (...args) => logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
console.warn = console.error;
const loggedSince = (from) => logged.slice(from);

const SITE = 'https://airohub.netlify.app';

function makeContext({ cookies = {}, ip = '203.0.113.7', country = 'GB', params = {} } = {}) {
  const jar = { ...cookies };
  const setCookies = [];
  const deletedCookies = [];
  return {
    jar,
    setCookies,
    deletedCookies,
    ip,
    geo: { country: { code: country } },
    params,
    log: () => {},
    cookies: {
      get: (name) => jar[name],
      set: (cookie) => {
        setCookies.push(cookie);
        jar[cookie.name] = cookie.value;
      },
      delete: (input) => {
        const name = typeof input === 'string' ? input : input.name;
        deletedCookies.push(input);
        delete jar[name];
      },
    },
  };
}

const post = (url, body, headers = {}) =>
  new Request(`${SITE}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const get = (url, headers = {}) => new Request(`${SITE}${url}`, { method: 'GET', headers });

/* ------------------------------------------------------------------
   Config exports — these are what Netlify actually routes and limits on
   ------------------------------------------------------------------ */
{
  check(
    'config admin-login is POST-only with a 5/60s limit',
    adminLoginConfig.path === '/api/admin/auth/login' &&
      adminLoginConfig.method === 'POST' &&
      adminLoginConfig.rateLimit.windowLimit === 5 &&
      adminLoginConfig.rateLimit.windowSize === 60,
    JSON.stringify(adminLoginConfig)
  );
  check(
    'config admin-session serves both routes and is NOT rate limited',
    Array.isArray(adminSessionConfig.path) &&
      adminSessionConfig.path.includes('/api/admin/auth/session') &&
      adminSessionConfig.path.includes('/api/admin/auth/logout') &&
      adminSessionConfig.rateLimit === undefined,
    JSON.stringify(adminSessionConfig)
  );
  check(
    'config the four rate limits fit inside the plan cap of five rules',
    [adminLoginConfig, feedbackConfig, trackConfig, aiConfig].filter((c) => c.rateLimit).length === 4 &&
      [adminDataConfig, adminSessionConfig, flagsConfig].every((c) => c.rateLimit === undefined),
    `ai=${aiConfig.rateLimit.windowLimit}/${aiConfig.rateLimit.windowSize}s, ` +
      `feedback=${feedbackConfig.rateLimit.windowLimit}/${feedbackConfig.rateLimit.windowSize}s, ` +
      `track=${trackConfig.rateLimit.windowLimit}/${trackConfig.rateLimit.windowSize}s, ` +
      `login=${adminLoginConfig.rateLimit.windowLimit}/${adminLoginConfig.rateLimit.windowSize}s`
  );
  check(
    'config prune is scheduled and claims no path',
    pruneConfig.schedule === '17 4 * * *' && pruneConfig.path === undefined,
    JSON.stringify(pruneConfig)
  );
}

/* ------------------------------------------------------------------
   A — login
   ------------------------------------------------------------------ */
let sessionCookie = null;
{
  dbStub.reset();

  const wrongCtx = makeContext();
  const wrong = await adminLogin(post('/api/admin/auth/login', { password: 'hunter2' }), wrongCtx);
  const wrongBody = await wrong.json();
  check(
    'A a wrong password is 401 and sets no cookie',
    wrong.status === 401 && wrongBody.error === 'invalid_password' && wrongCtx.setCookies.length === 0,
    `status=${wrong.status} body=${JSON.stringify(wrongBody)} cookies=${wrongCtx.setCookies.length}`
  );

  const emptyCtx = makeContext();
  const empty = await adminLogin(post('/api/admin/auth/login', 'not json at all'), emptyCtx);
  check(
    'A an unparseable body takes the same path as a wrong password',
    empty.status === 401 && emptyCtx.setCookies.length === 0,
    `status=${empty.status}`
  );

  const rightCtx = makeContext();
  const right = await adminLogin(post('/api/admin/auth/login', { password: PASSWORD }), rightCtx);
  const rightBody = await right.json();
  const cookie = rightCtx.setCookies[0];
  check(
    'A the right password is 200 with a hardened cookie',
    right.status === 200 &&
      rightBody.authenticated === true &&
      typeof rightBody.expiresAt === 'number' &&
      cookie &&
      cookie.name === 'airo_admin' &&
      cookie.httpOnly === true &&
      cookie.secure === true &&
      cookie.sameSite === 'Strict' &&
      cookie.path === '/',
    `status=${right.status} cookie=${JSON.stringify(
      cookie && { name: cookie.name, httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite, path: cookie.path }
    )}`
  );
  check(
    'A the response never echoes the password back',
    !JSON.stringify(rightBody).includes(PASSWORD) && !String(cookie.value).includes(PASSWORD),
    'the cookie is exp.nonce.hmac, nothing else'
  );
  check(
    'A no database is touched by a login',
    dbStub.queries.length === 0,
    `${dbStub.queries.length} queries (the password is an env var, not a row)`
  );

  sessionCookie = cookie.value;

  const wrongMethod = await adminLogin(get('/api/admin/auth/login'), makeContext());
  check('A GET on the login route is 405', wrongMethod.status === 405, `status=${wrongMethod.status}`);
}

/* ------------------------------------------------------------------
   B — session probe and logout
   ------------------------------------------------------------------ */
{
  const signedIn = await adminSession(
    get('/api/admin/auth/session'),
    makeContext({ cookies: { airo_admin: sessionCookie } })
  );
  const signedInBody = await signedIn.json();
  check(
    'B the probe recognises the login cookie',
    signedIn.status === 200 && signedInBody.authenticated === true && signedInBody.expiresAt > Date.now(),
    JSON.stringify(signedInBody)
  );

  const signedOut = await adminSession(get('/api/admin/auth/session'), makeContext());
  const signedOutBody = await signedOut.json();
  check(
    'B no cookie is still 200, just not authenticated',
    signedOut.status === 200 && signedOutBody.authenticated === false && !('expiresAt' in signedOutBody),
    `status=${signedOut.status} body=${JSON.stringify(signedOutBody)} (a 401 here would loop the gate)`
  );

  const forged = await adminSession(
    get('/api/admin/auth/session'),
    makeContext({ cookies: { airo_admin: '9999999999999.deadbeefdeadbeef.' + 'a'.repeat(64) } })
  );
  check(
    'B a forged cookie is not authenticated',
    forged.status === 200 && (await forged.json()).authenticated === false,
    'signature checked before expiry'
  );

  const logoutCtx = makeContext({ cookies: { airo_admin: sessionCookie } });
  const logout = await adminSession(post('/api/admin/auth/logout', {}), logoutCtx);
  const logoutBody = await logout.json();
  check(
    'B logout clears the cookie on the same path',
    logout.status === 200 &&
      logoutBody.authenticated === false &&
      logoutCtx.deletedCookies.length === 1 &&
      logoutCtx.deletedCookies[0].name === 'airo_admin' &&
      logoutCtx.deletedCookies[0].path === '/',
    JSON.stringify(logoutCtx.deletedCookies)
  );
}

/* ------------------------------------------------------------------
   C — the admin data gate
   ------------------------------------------------------------------ */
{
  dbStub.reset();

  const denied = await adminData(
    get('/api/admin/data/overview'),
    makeContext({ params: { view: 'overview' } })
  );
  const deniedBody = await denied.json();
  check(
    'C no cookie is 401 before any query runs',
    denied.status === 401 && deniedBody.error === 'unauthorized' && dbStub.queries.length === 0,
    `status=${denied.status} queries=${dbStub.queries.length}`
  );

  const forged = await adminData(
    get('/api/admin/data/overview'),
    makeContext({ params: { view: 'overview' }, cookies: { airo_admin: 'garbage' } })
  );
  check('C a garbage cookie is 401', forged.status === 401, `status=${forged.status}`);

  // Signed in: the six aggregates fire, and the response is the exact contract.
  dbStub.reset();
  dbStub.answer(/group by 1 order by 1/, [
    { day: new Date().toISOString().slice(0, 10), views: 12, visitors: 7, rooms: 2 },
  ]);
  dbStub.answer(/date_trunc\('day'/, [{ views: 12, visitors: 7, rooms: 2, errors: 1 }]);
  dbStub.answer(/union all/, [
    { kind: 'referrer', key: 'reddit.com', hits: 9, sessions: 5 },
    { kind: 'page', key: '/canvas/:room', hits: 4, sessions: 3 },
    { kind: 'device', key: 'mobile', hits: 8, sessions: 6 },
    { kind: 'country', key: 'GB', hits: 8, sessions: 6 },
  ]);
  dbStub.answer(/order by occurred_at desc/, [
    {
      occurred_at: '2026-09-02T10:00:00Z',
      name: 'page_view',
      path: '/',
      room_id: '',
      referrer_host: 'reddit.com',
      device: 'mobile',
      country: 'GB',
      props: {},
    },
  ]);
  dbStub.answer(/from ai_usage/, [{ calls: 3 }]);
  dbStub.answer(/from feedback group by status/, [{ status: 'new', total: 2 }]);

  const okCtx = makeContext({ params: { view: 'overview' }, cookies: { airo_admin: sessionCookie } });
  const overview = await adminData(get('/api/admin/data/overview?days=30'), okCtx);
  const body = await overview.json();
  check(
    'C a signed-in overview is 200 with the full contract shape',
    overview.status === 200 &&
      body.days === 30 &&
      Array.isArray(body.daily) &&
      body.daily.length === 30 &&
      typeof body.today.views === 'number' &&
      Array.isArray(body.referrers) &&
      Array.isArray(body.pages) &&
      Array.isArray(body.devices) &&
      Array.isArray(body.countries) &&
      Array.isArray(body.recent) &&
      typeof body.aiCallsToday === 'number' &&
      body.feedbackCounts.new === 2 &&
      body.feedbackCounts.read === 0 &&
      body.feedbackCounts.resolved === 0,
    `days=${body.days} daily=${body.daily.length} referrers=${JSON.stringify(body.referrers)} ai=${body.aiCallsToday}`
  );
  check(
    'C the six aggregates run in one round trip',
    dbStub.queries.length === 6,
    `${dbStub.queries.length} queries, all issued before the first await resolved`
  );
  check(
    'C missing days are filled with zeros, newest last',
    body.daily[body.daily.length - 1].views === 12 && body.daily[0].views === 0,
    `first=${JSON.stringify(body.daily[0])} last=${JSON.stringify(body.daily[body.daily.length - 1])}`
  );
  check(
    'C an unknown days value falls back to 14',
    (await (await adminData(get('/api/admin/data/overview?days=9999'), okCtx)).json()).days === 14,
    'only 14 and 30 are offered'
  );

  // A failing aggregate costs one panel, not the page.
  dbStub.reset();
  dbStub.fail = true;
  const degraded = await adminData(get('/api/admin/data/overview'), okCtx);
  const degradedBody = await degraded.json();
  dbStub.fail = false;
  check(
    'C every aggregate failing still renders an empty dashboard',
    degraded.status === 200 &&
      degradedBody.daily.length === 14 &&
      degradedBody.today.views === 0 &&
      degradedBody.referrers.length === 0,
    `status=${degraded.status} — safeQuery turns a dead query into an empty panel`
  );

  // Settings: validate through mergeFlags, then write one row per supplied key.
  dbStub.reset();
  dbStub.answer(/select key, value from settings/, [{ key: 'ui', value: { stamps: false } }]);
  const saved = await adminData(
    post('/api/admin/data/settings', { flags: { ui: { aiPanel: true }, notice: 'Back in 5.' } }),
    makeContext({ params: { view: 'settings' }, cookies: { airo_admin: sessionCookie } })
  );
  const savedBody = await saved.json();
  const upserts = dbStub.matching(/insert into settings/);
  check(
    'C a settings patch merges over what is stored and writes one row per key',
    saved.status === 200 &&
      savedBody.flags.ui.aiPanel === true &&
      savedBody.flags.ui.stamps === false &&
      savedBody.flags.ui.padMode === false &&
      savedBody.flags.notice === 'Back in 5.' &&
      upserts.length === 2,
    `upserts=${upserts.length} flags=${JSON.stringify(savedBody.flags.ui)}`
  );
  check(
    'C the stored value is the merged object, not the raw patch',
    upserts.some((q) => q.params.some((p) => typeof p === 'string' && p.includes('"stamps":false'))),
    'writing the patch verbatim would erase the flags it did not mention'
  );
  const rejected = await adminData(
    post('/api/admin/data/settings', { flags: { nonsense: true } }),
    makeContext({ params: { view: 'settings' }, cookies: { airo_admin: sessionCookie } })
  );
  check('C a patch with no known keys is 400', rejected.status === 400, `status=${rejected.status}`);

  // A settings read that fails must fail the WRITE, not merge the patch onto
  // "nothing stored" and persist the defaults over every unnamed setting.
  dbStub.reset();
  dbStub.answer(/select key, value from settings/, new Error('stub: read failed'));
  const blind = await adminData(
    post('/api/admin/data/settings', { flags: { ui: { aiPanel: true } } }),
    makeContext({ params: { view: 'settings' }, cookies: { airo_admin: sessionCookie } })
  );
  check(
    'C a settings write whose read failed is a 503 with nothing written',
    blind.status === 503 && dbStub.matching(/insert into settings/).length === 0,
    `status=${blind.status} upserts=${dbStub.matching(/insert into settings/).length}`
  );

  // The list limit: absent means the default page, not the smallest page.
  const feedbackCtx = () =>
    makeContext({ params: { view: 'feedback' }, cookies: { airo_admin: sessionCookie } });
  const limitOf = () => dbStub.matching(/from feedback where/).at(-1)?.params.at(-1);
  dbStub.reset();
  await adminData(get('/api/admin/data/feedback'), feedbackCtx());
  const absent = limitOf();
  await adminData(get('/api/admin/data/feedback?limit=abc'), feedbackCtx());
  const junk = limitOf();
  await adminData(get('/api/admin/data/feedback?limit=5'), feedbackCtx());
  const five = limitOf();
  await adminData(get('/api/admin/data/feedback?limit=9999'), feedbackCtx());
  const capped = limitOf();
  check(
    'C the feedback list limit defaults to a full page and clamps at the cap',
    absent === 50 && junk === 50 && five === 5 && capped === 200,
    `absent=${absent} junk=${junk} five=${five} capped=${capped}`
  );

  const unknownView = await adminData(
    get('/api/admin/data/nope'),
    makeContext({ params: { view: 'nope' }, cookies: { airo_admin: sessionCookie } })
  );
  check('C an unknown view is 404', unknownView.status === 404, `status=${unknownView.status}`);
}

/* ------------------------------------------------------------------
   D — flags never fail
   ------------------------------------------------------------------ */
{
  dbStub.reset();
  dbStub.fail = true;
  const response = await flags(get('/api/flags'), makeContext());
  const body = await response.json();
  dbStub.fail = false;

  check(
    'D a throwing database still answers 200 with the defaults',
    response.status === 200 &&
      body.ui.aiPanel === false &&
      body.ui.padMode === false &&
      body.ui.stamps === true &&
      body.notice === '',
    `status=${response.status} body=${JSON.stringify(body)}`
  );
  check(
    'D the cache header survives the failure',
    response.headers.get('cache-control') === 'public, max-age=60',
    `cache-control=${response.headers.get('cache-control')}`
  );
  check(
    'D the AI budget is never in the payload',
    !('ai' in body) && JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['notice', 'ui']),
    JSON.stringify(Object.keys(body))
  );

  dbStub.reset();
  dbStub.answer(/from settings/, [
    { key: 'ui', value: { aiPanel: true, padMode: true } },
    { key: 'notice', value: 'Painting works best in landscape.' },
  ]);
  const live = await flags(get('/api/flags'), makeContext());
  const liveBody = await live.json();
  check(
    'D stored flags reach the browser when the database answers',
    live.status === 200 &&
      liveBody.ui.aiPanel === true &&
      liveBody.ui.padMode === true &&
      liveBody.notice === 'Painting works best in landscape.',
    JSON.stringify(liveBody)
  );
  check(
    'D only the two public keys are read',
    dbStub.queries.length === 1 && /key in \('ui', 'notice'\)/.test(dbStub.queries[0].text),
    dbStub.queries[0].text
  );
}

/* ------------------------------------------------------------------
   E — track never fails
   ------------------------------------------------------------------ */
{
  dbStub.reset();
  dbStub.answer(/visitor_salts/, [{ salt: 'a'.repeat(48) }]);

  const events = Array.from({ length: 25 }, (_, i) => ({
    name: 'page_view',
    path: i === 0 ? '/canvas/AB12CD' : '/',
  }));
  const response = await track(
    post('/api/track', { sessionId: 'sess-1234abcd', referrer: 'https://www.reddit.com/r/x', events }),
    makeContext()
  );
  const body = await response.json();
  const inserts = dbStub.matching(/insert into events/);

  check(
    'E 25 events become accepted 20 / dropped 5',
    response.status === 200 && body.accepted === 20 && body.dropped === 5,
    `status=${response.status} body=${JSON.stringify(body)}`
  );
  check(
    'E the whole batch is one insert',
    inserts.length === 1 && /jsonb_to_recordset/.test(inserts[0].text),
    `${inserts.length} inserts (twenty round trips would not survive page unload)`
  );

  const payload = inserts[0].params.find((p) => typeof p === 'string' && p.startsWith('['));
  const rows = JSON.parse(payload);
  check(
    'E room codes are normalised out of the stored paths',
    rows.length === 20 &&
      rows[0].path === '/canvas/:room' &&
      !JSON.stringify(rows).includes('AB12CD'),
    `first row=${JSON.stringify(rows[0])}`
  );
  check(
    'E the referrer is reduced to a host and the visitor to a digest',
    inserts[0].params.includes('reddit.com') &&
      inserts[0].params.some((p) => typeof p === 'string' && /^[0-9a-f]{64}$/.test(p)) &&
      !inserts[0].params.includes('203.0.113.7'),
    'no IP address and no full referrer reaches the table'
  );
  check(
    "E today's salt is fetched once and reused",
    dbStub.matching(/visitor_salts/).length === 1,
    'memoised per warm instance, keyed on the UTC day'
  );

  const bad = await track(post('/api/track', { sessionId: 'short', events: [] }), makeContext());
  check(
    'E a malformed body is still 200',
    bad.status === 200 && (await bad.json()).accepted === 0,
    `status=${bad.status}`
  );

  const oversized = await track(
    post('/api/track', { sessionId: 'sess-1234abcd', events: [], pad: 'x'.repeat(70 * 1024) }),
    makeContext()
  );
  check(
    'E an oversized body is 200 with nothing accepted',
    oversized.status === 200 && (await oversized.json()).accepted === 0,
    `status=${oversized.status} (never a 413 the beacon cannot act on)`
  );

  dbStub.fail = true;
  const down = await track(
    post('/api/track', { sessionId: 'sess-1234abcd', events: [{ name: 'page_view', path: '/' }] }),
    makeContext()
  );
  const downBody = await down.json();
  dbStub.fail = false;
  check(
    'E a dead database is 200 with accepted 0, never a 5xx',
    down.status === 200 && downBody.accepted === 0,
    `status=${down.status} body=${JSON.stringify(downBody)}`
  );
}

/* ------------------------------------------------------------------
   F — feedback
   ------------------------------------------------------------------ */
{
  dbStub.reset();
  dbStub.answer(/insert into feedback/, [{ id: 42 }]);

  const honeypot = await feedback(
    post('/api/feedback', { kind: 'bug', message: 'buy cheap pills', website: 'http://spam.example' }),
    makeContext()
  );
  check(
    'F the honeypot answers 200 and writes nothing',
    honeypot.status === 200 &&
      (await honeypot.json()).ok === true &&
      dbStub.matching(/insert into feedback/).length === 0,
    `status=${honeypot.status} inserts=${dbStub.matching(/insert into feedback/).length}`
  );

  const invalid = await feedback(post('/api/feedback', { kind: 'bug', message: 'no' }), makeContext());
  const invalidBody = await invalid.json();
  check(
    'F a too-short message is 400 naming the field',
    invalid.status === 400 && invalidBody.error === 'invalid' && /message/.test(invalidBody.message),
    JSON.stringify(invalidBody)
  );

  const huge = await feedback(
    post('/api/feedback', { kind: 'bug', message: 'x'.repeat(20 * 1024) }),
    makeContext()
  );
  check('F an oversized body is 413', huge.status === 413, `status=${huge.status}`);

  const real = await feedback(
    post(
      '/api/feedback',
      { kind: 'suggestion', message: 'Let me pick my own colour.', path: '/canvas/AB12CD', roomId: 'AB12CD' },
      { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }
    ),
    makeContext()
  );
  const realBody = await real.json();
  const insert = dbStub.matching(/insert into feedback/)[0];
  check(
    'F a real message is 201 with the row id',
    real.status === 201 && realBody.ok === true && realBody.id === 42 && insert !== undefined,
    `status=${real.status} body=${JSON.stringify(realBody)}`
  );
  check(
    'F the server records the browser and country, and normalises the path',
    insert.params.includes('/canvas/:room') &&
      insert.params.includes('GB') &&
      insert.params.some((p) => typeof p === 'string' && p.includes('iPhone')),
    JSON.stringify(insert.params.slice(0, 7))
  );

  dbStub.fail = true;
  const down = await feedback(
    post('/api/feedback', { kind: 'bug', message: 'The room will not load.' }),
    makeContext()
  );
  dbStub.fail = false;
  check(
    'F a dead database is an honest 503, not a silent 200',
    down.status === 503 && (await down.json()).error === 'database_unavailable',
    `status=${down.status} — a dropped message the sender believes arrived is the worse failure`
  );
}

/* ------------------------------------------------------------------
   G — the AI cost ceiling
   ------------------------------------------------------------------ */
{
  dbStub.reset();
  genaiStub.reset();

  // No settings rows: the compiled-in default has aiPanel false.
  const disabled = await ai(
    post('/api/ai/graffiti-tag', { prompt: 'phantom' }),
    makeContext({ params: { route: 'graffiti-tag' } })
  );
  const disabledBody = await disabled.json();
  check(
    'G the panel switched off answers 200 with degraded "disabled"',
    disabled.status === 200 &&
      disabledBody.degraded === 'disabled' &&
      typeof disabledBody.title === 'string' &&
      Array.isArray(disabledBody.recommendedPalette),
    `status=${disabled.status} degraded=${disabledBody.degraded} title=${disabledBody.title}`
  );
  check(
    'G Gemini is never constructed on the disabled path',
    genaiStub.constructed === 0 && genaiStub.calls === 0,
    `constructed=${genaiStub.constructed} calls=${genaiStub.calls}`
  );
  check(
    'G the flag read and the counter share one round trip',
    dbStub.queries.length === 2 &&
      dbStub.matching(/from settings/).length === 1 &&
      dbStub.matching(/insert into ai_usage/).length === 1,
    `${dbStub.queries.length} queries: ${dbStub.queries.map((q) => q.text.slice(0, 24)).join(' | ')}`
  );
  check(
    'G the counter increment is atomic',
    /on conflict \(day\) do update set calls = ai_usage.calls \+ 1/.test(
      dbStub.matching(/insert into ai_usage/)[0].text
    ),
    'two concurrent requests cannot both read "one below the cap"'
  );

  // Flag on, budget spent.
  dbStub.reset();
  dbStub.answer(/from settings/, [
    { key: 'ui', value: { aiPanel: true } },
    { key: 'ai', value: { dailyCap: 10 } },
  ]);
  dbStub.answer(/insert into ai_usage/, [{ calls: 11 }]);
  const capped = await ai(
    post('/api/ai/transform-style', { preset: 'banksy' }),
    makeContext({ params: { route: 'transform-style' } })
  );
  const cappedBody = await capped.json();
  check(
    'G over the daily cap answers 200 with degraded "cap"',
    capped.status === 200 && cappedBody.degraded === 'cap' && cappedBody.accentColor === '#FF3D00',
    `degraded=${cappedBody.degraded} title=${cappedBody.transformedTitle}`
  );

  // Flag on, budget left: no degrade marker, and the curated answer only
  // because there is no API key in a test run.
  dbStub.reset();
  dbStub.answer(/from settings/, [{ key: 'ui', value: { aiPanel: true } }]);
  dbStub.answer(/insert into ai_usage/, [{ calls: 4 }]);
  const live = await ai(
    post('/api/ai/critique', { objectType: 'skateboard' }),
    makeContext({ params: { route: 'critique' } })
  );
  const liveBody = await live.json();
  check(
    'G under the cap the gates let the request through',
    live.status === 200 && liveBody.degraded === undefined && liveBody.exhibitionTitle.length > 0,
    `degraded=${liveBody.degraded} title=${liveBody.exhibitionTitle}`
  );

  // The counter query failing must fail CLOSED.
  dbStub.reset();
  dbStub.fail = true;
  const closed = await ai(
    post('/api/ai/graffiti-tag', { prompt: 'x' }),
    makeContext({ params: { route: 'graffiti-tag' } })
  );
  const closedBody = await closed.json();
  dbStub.fail = false;
  check(
    'G an unreadable counter fails closed, not open',
    closed.status === 200 && closedBody.degraded === 'disabled',
    `degraded=${closedBody.degraded} — with no readable flags the default already hides the panel`
  );

  // The case above is settled by the flag gate before the counter is ever
  // consulted. This one is the branch the promise is really about: the panel
  // is ON, the flags read fine, and only the counter is unreadable.
  dbStub.reset();
  dbStub.answer(/from settings/, [{ key: 'ui', value: { aiPanel: true } }]);
  dbStub.answer(/insert into ai_usage/, new Error('stub: counter unavailable'));
  const closedOn = await ai(
    post('/api/ai/graffiti-tag', { prompt: 'x' }),
    makeContext({ params: { route: 'graffiti-tag' } })
  );
  const closedOnBody = await closedOn.json();
  check(
    'G with the panel on, an unreadable counter still fails closed',
    closedOn.status === 200 && closedOnBody.degraded === 'cap' && genaiStub.calls === 0,
    `degraded=${closedOnBody.degraded} gemini calls=${genaiStub.calls}`
  );

  // Input bounds.
  dbStub.reset();
  dbStub.answer(/from settings/, [{ key: 'ui', value: { aiPanel: true } }]);
  dbStub.answer(/insert into ai_usage/, [{ calls: 1 }]);
  const bounded = await ai(
    post('/api/ai/transform-style', {
      preset: '../../etc/passwd',
      objectType: 'DROP TABLE events',
      customPrompt: 'y'.repeat(4000),
    }),
    makeContext({ params: { route: 'transform-style' } })
  );
  const boundedBody = await bounded.json();
  check(
    'G an unknown preset falls back and a long prompt is cut',
    bounded.status === 200 &&
      boundedBody.vibe === 'Cyberpunk 2099' &&
      boundedBody.tagText.length <= 24,
    `vibe=${boundedBody.vibe} tagText=${boundedBody.tagText}`
  );

  const unknownRoute = await ai(post('/api/ai/nope', {}), makeContext({ params: { route: 'nope' } }));
  check(
    'G an unknown route is 404 and costs nothing',
    unknownRoute.status === 404 && dbStub.matching(/insert into ai_usage/).length === 1,
    `status=${unknownRoute.status} (the counter was not charged again)`
  );

  const wrongMethod = await ai(get('/api/ai/critique'), makeContext({ params: { route: 'critique' } }));
  check('G GET on an AI route is 405', wrongMethod.status === 405, `status=${wrongMethod.status}`);
}

/* ------------------------------------------------------------------
   H — scheduled retention
   ------------------------------------------------------------------ */
{
  dbStub.reset();
  dbStub.answer(/delete from events/, [{ removed: 120 }]);
  dbStub.answer(/delete from visitor_salts/, [{ removed: 3 }]);

  await prune();
  const deletes = dbStub.matching(/delete from/);
  check(
    'H prune deletes events at 90 days and salts at 95, in that order',
    deletes.length === 2 &&
      /delete from events/.test(deletes[0].text) &&
      deletes[0].params.includes(90) &&
      /delete from visitor_salts/.test(deletes[1].text) &&
      deletes[1].params.includes(95),
    'a salt outliving the events it hashed is the window in which a digest could be recomputed'
  );

  const before = logged.length;
  dbStub.reset();
  dbStub.fail = true;
  let threw = false;
  try {
    await prune();
  } catch {
    threw = true;
  }
  dbStub.fail = false;
  check(
    'H a failing prune logs and swallows rather than alerting',
    !threw && loggedSince(before).some((line) => line.includes('[prune]')),
    `threw=${threw} logged=${JSON.stringify(loggedSince(before)[0] ?? '')}`
  );
}

console.error = realError;
console.warn = realWarn;

fs.rmSync(outDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.log(`\ncaptured handler logs:\n  ${logged.join('\n  ')}`);
}
console.log(`\n${results.length - failed.length}/${results.length} launch handler checks passed`);
process.exit(failed.length ? 1 : 0);
