/**
 * Launch verification — the flags, the feedback loop, the admin gate, the 404
 * and the analytics beacon, all against stubs.
 *
 * These five features share one property that makes them hard to trust: each
 * of them is *supposed* to leave no trace when it is working. A flag that is
 * off renders nothing. A honeypot that is empty looks like a field nobody
 * filled. A 404 that carries `noindex` looks like any other page. A tracker
 * that drops an unknown event name looks like a tracker that was never called.
 * The only way to know any of it works is to drive the browser and read what
 * actually went over the wire — which is what this file does, with every
 * `/api/**` and `/rest/v1/**` call intercepted so nothing here reaches a real
 * database, a real Gemini key or the production Supabase project.
 *
 * What it locks in:
 *  1. flags OFF (the launch default): no AI copilot button in the studio, no
 *     Pad option in the phone's mode switch;
 *  2. flags ON: both come back. One direction alone proves nothing — a studio
 *     that never renders an AI button would pass check 1 on its own;
 *  3. feedback: the submit button respects the minimum length, and the POST
 *     body carries kind, message, path AND an empty honeypot — a honeypot that
 *     silently stopped being sent would take every bot's submission with it;
 *  4. the admin gate: signed out shows the login card, a successful login
 *     shows the dashboard, all four tabs render from stubbed data with the
 *     hash following them, and saving a flag POSTs the flag that was toggled;
 *  5. a mid-session 401 returns the login card WITHOUT a reload — the page
 *     must not keep drawing numbers it can no longer refresh;
 *  6. an unknown route renders the 404 and injects `noindex` (the SPA host
 *     answers 200, so the meta tag is the only signal a crawler gets);
 *  7. the analytics beacon: every event name is on the shared allowlist, read
 *     out of `src/api/contracts.ts` at runtime rather than copied here, and no
 *     room code rides along in a path;
 *  8. no console errors, page errors or failed requests along the way.
 *
 * Usage — needs an already-served build or dev server, like every other
 * harness here:
 *
 *   npx vite --port 5182 &
 *   CHROME_BIN=/opt/pw-browsers/chromium BASE=http://127.0.0.1:5182 \
 *     node scripts/preview/verify-launch.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE;
if (!BASE) {
  console.error(
    'BASE is required, e.g. BASE=http://127.0.0.1:5182 node scripts/preview/verify-launch.mjs'
  );
  process.exit(2);
}
const SHOTS = process.env.SHOT_DIR || 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const problems = [];

/**
 * Runs one group of checks, and records a failure instead of dying if it
 * throws.
 *
 * A timeout in the studio must not cost us the admin-gate result: these
 * groups are independent, they are written while the features they cover are
 * still landing, and a harness that aborts on the first missing selector
 * reports one problem when there might be six.
 */
async function step(label, fn) {
  try {
    await fn();
  } catch (err) {
    check(`${label} (group ran to completion)`, false, String(err).split('\n')[0].slice(0, 200));
  }
}

/* ------------------------------------------------------------------
   The allowlist, read from the contract rather than copied
   ------------------------------------------------------------------ */

/**
 * A copied allowlist drifts silently: the day somebody adds an event name to
 * the contract, a hard-coded copy here starts failing a legitimate event, and
 * the fix would be to loosen the check. Parsing the source keeps the two in
 * lockstep with no ceremony.
 */
function readEventNames() {
  const source = fs.readFileSync(path.resolve('src/api/contracts.ts'), 'utf8');
  const block = /export const EVENT_NAMES[^=]*=\s*\[([^\]]*)\]/.exec(source);
  if (!block) throw new Error('could not find EVENT_NAMES in src/api/contracts.ts');
  const names = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (names.length < 5) throw new Error('EVENT_NAMES parsed suspiciously short');
  return names;
}

const EVENT_NAMES = readEventNames();

/* ------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;
const dayString = (back) => new Date(Date.now() - back * DAY_MS).toISOString().slice(0, 10);
const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const FLAGS_OFF = {
  ui: {
    aiPanel: false,
    padMode: false,
    stamps: true,
    showcase: true,
    uploads: true,
    feedbackButton: true,
  },
  notice: '',
};

const FLAGS_ON = {
  ui: { ...FLAGS_OFF.ui, aiPanel: true, padMode: true },
  notice: '',
};

const OVERVIEW = {
  days: 14,
  daily: Array.from({ length: 14 }, (_, i) => ({
    day: dayString(13 - i),
    views: 40 + i * 9,
    visitors: 12 + i * 4,
    rooms: 3 + i,
  })),
  today: { views: 157, visitors: 64, rooms: 16, errors: 1 },
  referrers: [
    { key: 'reddit.com', hits: 210, sessions: 96 },
    { key: '', hits: 88, sessions: 44 },
    { key: 'com.reddit.frontpage', hits: 61, sessions: 30 },
    { key: 'news.ycombinator.com', hits: 24, sessions: 12 },
  ],
  pages: [
    { key: '/', hits: 300, sessions: 140 },
    { key: '/canvas/:room', hits: 120, sessions: 58 },
    { key: '/how-it-works', hits: 76, sessions: 51 },
  ],
  devices: [
    { key: 'desktop', hits: 260, sessions: 120 },
    { key: 'mobile', hits: 210, sessions: 101 },
  ],
  countries: [
    { key: 'gb', hits: 180, sessions: 82 },
    { key: 'us', hits: 160, sessions: 74 },
  ],
  recent: [
    {
      occurred_at: iso(3),
      name: 'studio.create',
      path: '/',
      room_id: '',
      referrer_host: 'reddit.com',
      device: 'desktop',
      country: 'gb',
      props: {},
    },
    {
      occurred_at: iso(19),
      name: 'client.error',
      path: '/canvas/:room',
      room_id: '',
      referrer_host: '',
      device: 'desktop',
      country: 'us',
      props: { message: 'WebGL context lost', source: 'window.onerror' },
    },
  ],
  aiCallsToday: 96,
  feedbackCounts: { new: 2, read: 1, resolved: 4 },
};

const FEEDBACK_ROWS = [
  {
    id: 7,
    created_at: iso(30),
    kind: 'suggestion',
    message: 'A recent-colours row on the phone would save a lot of thumb travel.',
    email: 'nadia@example.com',
    path: '/controller/:room',
    room_id: 'K3PQ',
    user_agent: '',
    country: 'us',
    status: 'new',
    admin_note: '',
    updated_at: iso(30),
  },
  {
    id: 6,
    created_at: iso(240),
    kind: 'bug',
    message: 'Trigger button sat under the home bar on an old iPhone SE.',
    email: '',
    path: '/controller/:room',
    room_id: 'B7ZK',
    user_agent: '',
    country: 'gb',
    status: 'read',
    admin_note: 'Reproduced. Safe-area padding needed.',
    updated_at: iso(120),
  },
];

const SETTINGS = {
  ui: { ...FLAGS_OFF.ui },
  notice: '',
  ai: { dailyCap: 500 },
};

/* ------------------------------------------------------------------
   Browser
   ------------------------------------------------------------------ */

// Chromium does not read HTTPS_PROXY on its own; a deployed BASE from a
// sandboxed runner needs it passed explicitly. The proxy CA is already in the
// browser trust store, so TLS verification stays on.
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const useProxy = PROXY && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  ...(useProxy ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}),
});

const baseHost = new URL(BASE).host;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

const json = (body, status = 200) => ({
  status,
  headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

/**
 * Opens a page with error capture and every network dependency stubbed.
 *
 * The returned `state` is live: flip `state.flags`, `state.session` or
 * `state.unauthorized` between navigations and the next request sees it.
 * Everything the page sends is kept in `state.captured` so a check can assert
 * on the body rather than on the fact that *something* was posted.
 */
async function open(label, { viewport = { width: 1440, height: 900 }, mobile = false } = {}) {
  const state = {
    flags: FLAGS_OFF,
    session: { authenticated: false },
    unauthorized: false,
    captured: { track: [], feedback: [], login: [], settings: [], feedbackWrite: [] },
  };

  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();

  // The first-run guides would sit over everything these checks click.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('airo:guide:studio', '1');
      localStorage.setItem('airo:guide:controller', '1');
    } catch {}
  });

  // Vite's HMR socket, swallowed: a file written by another process mid-run
  // would full-reload the page and destroy the execution context. Supabase's
  // realtime socket goes the same way — nothing here asserts on it.
  await page.routeWebSocket(
    (url) => url.host === baseHost || url.host.endsWith('supabase.co'),
    () => {}
  );

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Software-rendering chatter is an artefact of the headless runner.
    if (/WebGL|SwiftShader|GPU stall|Automatic fallback/i.test(text)) return;
    // The deliberate 401 in check 5, as Chromium reports it.
    if (/status of 401/.test(text)) return;
    // Web fonts come from an external CDN this harness asserts nothing about.
    if (/ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL/.test(text)) return;
    problems.push(`[${label}] console: ${text.slice(0, 200)}`);
  });
  page.on('pageerror', (err) => problems.push(`[${label}] pageerror: ${String(err).slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    const reason = req.failure()?.errorText ?? '';
    if (url.includes('favicon')) return;
    if (url.includes('supabase.co')) return;
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return;
    // An abort is the browser tidying up after a navigation, and this file
    // navigates deliberately: the analytics beacon fires on the way out and
    // the model probes on the Models tab are still in flight when a check
    // moves on. Neither is a broken request — a broken one gets a real error.
    if (reason === 'net::ERR_ABORTED') return;
    problems.push(`[${label}] request failed: ${url.slice(0, 140)} (${reason})`);
  });

  // OPTIONS is answered first on every route: a preflight handed a JSON body
  // is a failed request, and failed requests fail this harness.
  const answer = (route, body, status = 200) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill(json(body, status));

  const bodyOf = (route) => {
    try {
      return JSON.parse(route.request().postData() ?? '{}');
    } catch {
      return null;
    }
  };

  // Matched by pathname on this origin, not by glob: `**/api/**` also matches
  // `/src/api/contracts.ts`, and intercepting a source module stops the app
  // booting at all — which reads in the results as "every feature is broken".
  const apiOrigin = new URL(BASE).origin;
  const api = (pathname) => (url) => url.origin === apiOrigin && url.pathname === pathname;
  const apiUnder = (prefix) => (url) =>
    url.origin === apiOrigin && url.pathname.startsWith(prefix);

  // Least specific first: Playwright gives precedence to the most recently
  // registered route, so the catch-all has to go in before the real ones.
  await page.route(apiUnder('/api/'), (route) => answer(route, { error: 'not_stubbed' }, 501));
  await page.route('**/rest/v1/**', (route) => answer(route, []));

  await page.route(api('/api/flags'), (route) => answer(route, state.flags));

  await page.route(api('/api/track'), (route) => {
    const body = bodyOf(route);
    if (body) state.captured.track.push(body);
    return answer(route, { accepted: body?.events?.length ?? 0, dropped: 0 });
  });

  await page.route(api('/api/feedback'), (route) => {
    const body = bodyOf(route);
    if (body) state.captured.feedback.push(body);
    return answer(route, { ok: true, id: 1 }, 201);
  });

  await page.route(api('/api/admin/auth/session'), (route) => answer(route, state.session));
  await page.route(api('/api/admin/auth/logout'), (route) => answer(route, { ok: true }));
  await page.route(api('/api/admin/auth/login'), (route) => {
    const body = bodyOf(route);
    if (body) state.captured.login.push(body);
    return answer(route, { ok: true, expiresAt: Date.now() + 3600000 });
  });

  await page.route(apiUnder('/api/admin/data/'), (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return answer(route, {});
    if (state.unauthorized) return answer(route, { error: 'unauthorized' }, 401);

    const view = new URL(request.url()).pathname.split('/').pop();
    if (request.method() === 'POST') {
      const body = bodyOf(route);
      if (view === 'settings' && body) state.captured.settings.push(body);
      if (view === 'feedback' && body) state.captured.feedbackWrite.push(body);
      return answer(route, { ok: true });
    }
    if (view === 'overview') return answer(route, OVERVIEW);
    if (view === 'feedback') return answer(route, { rows: FEEDBACK_ROWS });
    if (view === 'errors') return answer(route, { rows: OVERVIEW.recent.slice(1) });
    if (view === 'events') return answer(route, { rows: OVERVIEW.recent });
    if (view === 'settings') return answer(route, SETTINGS);
    return answer(route, { error: 'unknown_view' }, 404);
  });

  return { context, page, state };
}

/** One real animation frame — the only way these scenes advance headlessly. */
const pump = (page, n = 1) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const step = () => (--left <= 0 ? resolve(undefined) : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n + 1
  );

/** Waits for the flags fetch to land, so a negative check is a real negative. */
async function settleFlags(page) {
  await page
    .waitForResponse((response) => response.url().includes('/api/flags'), { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(500);
}

/* ==================================================================
   1 + 2: the flags, in both directions
   ================================================================== */

async function flagRun(label, flags) {
  const { context, page, state } = await open(label);
  state.flags = flags;

  await page.goto(`${BASE}/canvas/VLTEST`, { waitUntil: 'domcontentloaded' });
  // The first studio load on a cold SwiftShader compiles every shader from
  // scratch; on a contended runner that alone can take most of a minute.
  await page.waitForSelector('canvas', { timeout: 90000 });
  await settleFlags(page);
  await pump(page, 20);
  const aiButtons = await page.locator('[title="AI copilot"]').count();

  await page.goto(`${BASE}/controller/VLTEST`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[role="tablist"]', { timeout: 90000 });
  await settleFlags(page);
  const padTabs = await page.getByRole('tab', { name: 'Pad' }).count();

  await context.close();
  return { aiButtons, padTabs };
}

await step('flags', async () => {
  const off = await flagRun('flags-off', FLAGS_OFF);
  check('flags off: no AI copilot button in the studio', off.aiButtons === 0, `found ${off.aiButtons}`);
  check('flags off: no Pad tab on the phone', off.padTabs === 0, `found ${off.padTabs}`);

  const on = await flagRun('flags-on', FLAGS_ON);
  check('flags on: the AI copilot button is back', on.aiButtons === 1, `found ${on.aiButtons}`);
  check('flags on: the Pad tab is back', on.padTabs === 1, `found ${on.padTabs}`);
});

/* ==================================================================
   3: feedback
   ================================================================== */

await step('feedback', async () => {
  const { context, page, state } = await open('feedback');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await settleFlags(page);

  await page.locator('[aria-label="Send feedback"]').first().click();
  await page.waitForSelector('textarea[name="message"]', { timeout: 15000 });

  const submit = page.locator('form button[type="submit"]').last();
  await page.fill('textarea[name="message"]', 'x');
  const disabledAtOne = await submit.isDisabled();
  check('feedback: one character cannot be sent', disabledAtOne === true, `disabled=${disabledAtOne}`);

  await page.fill('textarea[name="message"]', 'The phone controller is genuinely lovely');
  const enabledAtTwenty = await submit.isEnabled();
  check('feedback: a real message can be sent', enabledAtTwenty === true, `enabled=${enabledAtTwenty}`);

  await submit.click();
  await page.waitForTimeout(1200);

  const sent = state.captured.feedback[0];
  check(
    'feedback POST carries kind, message and path',
    Boolean(sent) &&
      typeof sent.kind === 'string' &&
      typeof sent.message === 'string' &&
      sent.message.length >= 20 &&
      typeof sent.path === 'string',
    JSON.stringify(sent)?.slice(0, 160)
  );
  check(
    'feedback POST carries an empty honeypot',
    sent?.website === '',
    `website=${JSON.stringify(sent?.website)}`
  );

  const body = await page.locator('body').innerText();
  check('feedback: the sheet confirms it landed', /that landed/i.test(body), '');

  await context.close();
});

/* ==================================================================
   4 + 5: the admin gate
   ================================================================== */

await step('admin gate', async () => {
  const { context, page, state } = await open('admin');

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="admin-login"]', { timeout: 30000 });
  check('admin: signed out shows the login card', true, '');
  await page.screenshot({ path: `${SHOTS}/launch-admin-login.png` });

  const dashboardBefore = await page.locator('[data-testid="admin-overview"]').count();
  check('admin: the dashboard is not rendered behind the card', dashboardBefore === 0, '');

  await page.fill('[data-testid="admin-login"] input[name="password"]', 'not-the-real-one');
  state.session = { authenticated: true, expiresAt: Date.now() + 3600000 };
  await page.locator('[data-testid="admin-login"] button[type="submit"]').click();

  await page.waitForSelector('[data-testid="admin-overview"]', { timeout: 30000 });
  check(
    'admin: a successful login POSTs the password and renders the dashboard',
    state.captured.login.length === 1 && state.captured.login[0].password === 'not-the-real-one',
    JSON.stringify(state.captured.login.map((l) => Object.keys(l)))
  );

  // The tabs, and the hash that follows them.
  const tabChecks = [
    ['Overview', 'admin-overview', 'overview'],
    ['Feedback', 'admin-feedback', 'feedback'],
    ['Models', 'admin-models', 'models'],
    ['Settings', 'admin-settings', 'settings'],
  ];
  for (const [label, testid, hash] of tabChecks) {
    await page.getByRole('tab', { name: label }).click();
    const found = await page
      .waitForSelector(`[data-testid="${testid}"]`, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    const url = page.url();
    check(
      `admin: the ${label} tab renders and the hash follows`,
      found && url.endsWith(`#${hash}`),
      `${url.slice(-24)}`
    );
    await page.waitForTimeout(400);
  }

  // Numbers from the stub actually reached the tiles.
  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.waitForSelector('[data-testid="admin-overview"]', { timeout: 20000 });
  await page.waitForTimeout(900);
  const overviewText = await page.locator('[data-testid="admin-overview"]').innerText();
  check(
    'admin: the Overview tab shows the stubbed numbers',
    overviewText.includes('64') && /reddit/i.test(overviewText),
    ''
  );
  await page.screenshot({ path: `${SHOTS}/launch-admin-overview.png` });

  // Saving a flag posts the flag that was toggled.
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.waitForSelector('[data-flag="ui.aiPanel"]', { timeout: 20000 });
  await page.locator('[data-flag="ui.aiPanel"]').click();
  const pressed = await page.locator('[data-flag="ui.aiPanel"]').getAttribute('aria-pressed');
  check('admin: the AI switch flips', pressed === 'true', `aria-pressed=${pressed}`);

  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(1000);
  const saved = state.captured.settings[0];
  check(
    'admin: Save changes POSTs flags.ui.aiPanel = true',
    saved?.flags?.ui?.aiPanel === true,
    JSON.stringify(saved?.flags?.ui ?? saved)
  );
  const savedText = await page.locator('[data-testid="admin-settings"]').innerText();
  check(
    'admin: the save is explained in visitor terms',
    /within about 60 seconds/i.test(savedText),
    ''
  );

  /* 5: a 401 in the middle of a session. */
  await page.evaluate(() => {
    window.__airoLaunchMarker = 'alive';
  });
  state.unauthorized = true;
  await page.getByRole('tab', { name: 'Overview' }).click();

  const backToLogin = await page
    .waitForSelector('[data-testid="admin-login"]', { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  const marker = await page.evaluate(() => window.__airoLaunchMarker ?? null);
  check('admin: a mid-session 401 returns the login card', backToLogin, '');
  check(
    'admin: it returns WITHOUT reloading the page',
    marker === 'alive',
    `marker=${String(marker)}`
  );

  await context.close();
});

/* ==================================================================
   6: the 404
   ================================================================== */

await step('404', async () => {
  const { context, page } = await open('notfound');
  await page.goto(`${BASE}/definitely-not-a-route`, { waitUntil: 'domcontentloaded' });
  const rendered = await page
    .waitForSelector('[data-testid="not-found"]', { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('404: an unknown route renders the not-found page', rendered, '');

  const robots = await page.$$eval('meta[name="robots"]', (metas) =>
    metas.map((meta) => meta.getAttribute('content') ?? '')
  );
  check(
    '404: it asks not to be indexed',
    robots.some((content) => /noindex/i.test(content)),
    JSON.stringify(robots)
  );
  await context.close();
});

/* ==================================================================
   7: the analytics beacon
   ================================================================== */

await step('track', async () => {
  const { context, page, state } = await open('track');

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await settleFlags(page);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(600);

  await page.goto(`${BASE}/how-it-works`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(600);

  const batches = state.captured.track;
  const events = batches.flatMap((batch) => batch.events ?? []);
  check(
    'track: the beacon fired with events in it',
    batches.length > 0 && events.length > 0,
    `${batches.length} batch(es), ${events.length} event(s)`
  );
  check(
    'track: every batch identifies its session',
    batches.every((batch) => typeof batch.sessionId === 'string' && batch.sessionId.length >= 8),
    JSON.stringify(batches.map((b) => typeof b.sessionId))
  );

  const unknown = events.filter((event) => !EVENT_NAMES.includes(event.name));
  check(
    'track: every event name is on the shared allowlist',
    unknown.length === 0,
    unknown.length ? JSON.stringify(unknown.map((e) => e.name)) : `${events.length} checked`
  );

  const leaky = events.filter((event) => /\/(canvas|controller)\/[^/]+/.test(event.path ?? ''));
  check(
    'track: no room code rides along in a path',
    leaky.length === 0,
    leaky.length ? JSON.stringify(leaky.map((e) => e.path)) : ''
  );

  await context.close();
});

/* ==================================================================
   8: nothing broke on the way
   ================================================================== */

await browser.close();

const unique = [...new Set(problems)];
check('no console, page or request errors', unique.length === 0, unique.join(' | ').slice(0, 500));

console.log(`\nscreenshots: ${SHOTS}/launch-admin-login.png, launch-admin-overview.png`);
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} launch checks passed`);
process.exit(failed.length ? 1 : 0);
