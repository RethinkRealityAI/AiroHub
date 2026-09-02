/**
 * Admin dashboard screenshots.
 *
 * Every screen here is now behind a password and fed by `/api/admin/*`, which
 * a local `vite` server answers with "signed out" and nothing else. So the
 * shots are taken against stubs: a session that says yes, one canned payload
 * per data view, and public flags. That is the only way to photograph the
 * dashboard *with data in it* without pointing a screenshot run at production
 * — and a dashboard photographed empty tells you nothing about whether it
 * reads well.
 *
 * The login card gets its own context whose session stub says no, because it
 * is the first thing anyone sees and it is the one screen that must never
 * look like an error page.
 *
 *   BASE=http://127.0.0.1:4173 node scripts/preview/shoot-admin.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(OUT, { recursive: true });

const problems = [];

/* ------------------------------------------------------------------
   Fixtures — plausible launch-week numbers, including the referrer the
   whole dashboard was built to watch.
   ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;
const day = (back) => new Date(Date.now() - back * DAY_MS).toISOString().slice(0, 10);
const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const daily = Array.from({ length: 14 }, (_, i) => {
  const back = 13 - i;
  const wave = [18, 24, 31, 27, 44, 61, 58, 72, 95, 140, 210, 188, 164, 152][i];
  return { day: day(back), views: Math.round(wave * 2.6), visitors: wave, rooms: Math.round(wave / 3.4) };
});

const OVERVIEW = {
  days: 14,
  daily,
  today: { views: 395, visitors: 152, rooms: 45, errors: 2 },
  referrers: [
    { key: 'reddit.com', hits: 612, sessions: 288 },
    { key: '', hits: 240, sessions: 121 },
    { key: 'com.reddit.frontpage', hits: 168, sessions: 74 },
    { key: 'news.ycombinator.com', hits: 96, sessions: 41 },
    { key: 'x.com', hits: 54, sessions: 27 },
    { key: 'google.com', hits: 38, sessions: 22 },
  ],
  pages: [
    { key: '/', hits: 880, sessions: 402 },
    { key: '/canvas/:room', hits: 421, sessions: 168 },
    { key: '/controller/:room', hits: 388, sessions: 155 },
    { key: '/how-it-works', hits: 204, sessions: 131 },
  ],
  devices: [
    { key: 'desktop', hits: 720, sessions: 310 },
    { key: 'mobile', hits: 640, sessions: 288 },
    { key: 'tablet', hits: 61, sessions: 29 },
    { key: 'bot', hits: 44, sessions: 44 },
  ],
  countries: [
    { key: 'gb', hits: 512, sessions: 214 },
    { key: 'us', hits: 486, sessions: 202 },
    { key: 'de', hits: 143, sessions: 61 },
    { key: 'ca', hits: 98, sessions: 44 },
    { key: 'ng', hits: 62, sessions: 28 },
  ],
  recent: [
    { occurred_at: iso(2), name: 'studio.create', path: '/', room_id: '', referrer_host: 'reddit.com', device: 'desktop', country: 'gb', props: {} },
    { occurred_at: iso(4), name: 'room.enter', path: '/canvas/:room', room_id: 'K3PQ', referrer_host: '', device: 'desktop', country: 'gb', props: { role: 'studio' } },
    { occurred_at: iso(5), name: 'controller.mode', path: '/controller/:room', room_id: 'K3PQ', referrer_host: '', device: 'mobile', country: 'gb', props: { mode: 'aim' } },
    { occurred_at: iso(9), name: 'paint.first', path: '/controller/:room', room_id: 'K3PQ', referrer_host: '', device: 'mobile', country: 'gb', props: {} },
    { occurred_at: iso(14), name: 'feedback.submit', path: '/how-it-works', room_id: '', referrer_host: 'reddit.com', device: 'mobile', country: 'us', props: { kind: 'suggestion' } },
    { occurred_at: iso(21), name: 'client.error', path: '/canvas/:room', room_id: '', referrer_host: '', device: 'desktop', country: 'us', props: { message: 'WebGL context lost', source: 'window.onerror' } },
  ],
  aiCallsToday: 137,
  feedbackCounts: { new: 3, read: 2, resolved: 6 },
};

const FEEDBACK = [
  { id: 41, created_at: iso(18), kind: 'suggestion', message: 'A colour picker with the last five colours would save so much thumb travel on the phone.', email: 'nadia@example.com', path: '/controller/:room', room_id: 'K3PQ', user_agent: '', country: 'us', status: 'new', admin_note: '', updated_at: iso(18) },
  { id: 40, created_at: iso(96), kind: 'bug', message: 'Joined from an old iPhone SE and the trigger button sat under the home bar.', email: '', path: '/controller/:room', room_id: 'B7ZK', user_agent: '', country: 'gb', status: 'new', admin_note: '', updated_at: iso(96) },
  { id: 38, created_at: iso(420), kind: 'feedback', message: 'Genuinely the most fun I have had in a browser this year. Painted a bin lorry with three strangers.', email: 'sam@example.com', path: '/', room_id: '', user_agent: '', country: 'gb', status: 'read', admin_note: 'Asked if we can quote them on the launch post.', updated_at: iso(300) },
];

const ERRORS = OVERVIEW.recent.filter((row) => row.name === 'client.error');

const SETTINGS = {
  ui: { aiPanel: false, padMode: false, stamps: true, showcase: true, uploads: true, feedbackButton: true },
  notice: '',
  ai: { dailyCap: 500 },
};

const PUBLIC_FLAGS = { ui: SETTINGS.ui, notice: '' };

const json = (body, status = 200) => ({
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

/* ------------------------------------------------------------------
   Browser
   ------------------------------------------------------------------ */

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

/** Wires the admin API stubs onto a page. `signedIn` picks the session answer. */
async function stubAdminApi(page, signedIn = true) {
  // OPTIONS first, always: a preflight answered with a JSON body is a failed
  // request, and this harness reports failed requests.
  const answer = (route, body, status = 200) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204 })
      : route.fulfill(json(body, status));

  await page.route('**/api/admin/auth/session', (route) =>
    answer(route, signedIn ? { authenticated: true, expiresAt: Date.now() + 3600000 } : { authenticated: false })
  );
  await page.route('**/api/admin/auth/logout', (route) => answer(route, { ok: true }));
  await page.route('**/api/admin/auth/login', (route) => answer(route, { ok: true }));
  await page.route('**/api/admin/data/*', (route) => {
    const view = new URL(route.request().url()).pathname.split('/').pop();
    if (route.request().method() === 'POST') return answer(route, { ok: true });
    if (view === 'overview') return answer(route, OVERVIEW);
    if (view === 'feedback') return answer(route, { rows: FEEDBACK });
    if (view === 'errors') return answer(route, { rows: ERRORS });
    if (view === 'events') return answer(route, { rows: OVERVIEW.recent });
    if (view === 'settings') return answer(route, SETTINGS);
    return answer(route, { error: 'unknown_view' }, 404);
  });
  await page.route('**/api/flags', (route) => answer(route, PUBLIC_FLAGS));
}

async function open(label, viewport, mobile, { signedIn = true } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();

  // Vite's HMR socket, swallowed: a reload mid-capture would blank the shot.
  await page.routeWebSocket(
    (url) => url.host === new URL(BASE).host,
    () => {}
  );

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/WebGL|SwiftShader|GPU stall|Automatic fallback/i.test(text)) return;
    if (/ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL/.test(text)) return;
    problems.push(`[${label}] console: ${text.slice(0, 200)}`);
  });
  page.on('pageerror', (err) => problems.push(`[${label}] pageerror: ${String(err).slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.includes('favicon')) return;
    if (url.includes('supabase.co')) return;
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return;
    problems.push(`[${label}] request failed: ${url.slice(0, 140)}`);
  });

  await stubAdminApi(page, signedIn);
  return { context, page };
}

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`  → ${name}.png`);
};

/* ------------------------------------------------------------------
   The dashboard, tab by tab
   ------------------------------------------------------------------ */

for (const [suffix, viewport, mobile] of [
  ['desktop', { width: 1512, height: 950 }, false],
  ['phone', { width: 393, height: 852 }, true],
]) {
  console.log(`\n== ${suffix} ==`);
  const { context, page } = await open(`admin/${suffix}`, viewport, mobile);
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="admin-overview"]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot(page, `admin-${suffix}`);

  for (const tab of ['Feedback', 'Models', 'Settings']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(tab === 'Models' ? 3000 : 1000);
    await shot(page, `admin-${tab.toLowerCase()}-${suffix}`);
  }

  await context.close();
}

/* ------------------------------------------------------------------
   The login card
   ------------------------------------------------------------------ */

{
  console.log('\n== login ==');
  const { context, page } = await open('admin/login', { width: 1512, height: 950 }, false, {
    signedIn: false,
  });
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="admin-login"]', { timeout: 30000 });
  await page.waitForTimeout(600);
  await shot(page, 'admin-login-desktop');
  await context.close();
}

await browser.close();

console.log('\n' + '='.repeat(52));
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.log(' ✗ ' + p);
  process.exitCode = 1;
} else {
  console.log('admin shots done — no console errors, page errors or failed requests.');
}
