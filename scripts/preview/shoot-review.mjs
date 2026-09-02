/**
 * Asset review gallery screenshots.
 *
 * Drives /admin/review at desktop and phone widths and writes the grid, the
 * silhouette diagnostic and the detail modal to scripts/preview/out/. Console
 * errors and failed requests are reported so a visually-fine-but-broken page
 * still fails loudly, same as shoot-ui.mjs.
 *
 * The page is behind the admin password now, so the session probe is stubbed
 * "signed in" before the first navigation — otherwise every shot here would be
 * a photograph of the login card.
 *
 *   BASE=http://127.0.0.1:4173 node scripts/preview/shoot-review.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(OUT, { recursive: true });

const problems = [];

// Chromium does not read HTTPS_PROXY on its own. Unlike shoot-ui this passes
// the proxy even for a local BASE, with localhost bypassed: the page itself is
// served locally but it reads the real Supabase registry, and a shot of the
// gallery's "uploads could not be listed" state is not the shot we want.
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  ...(PROXY ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}),
});

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true },
];

async function open(spec, label) {
  const context = await browser.newContext({
    viewport: spec.viewport,
    deviceScaleFactor: 2,
    isMobile: spec.isMobile,
    hasTouch: spec.isMobile,
    userAgent: spec.isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await context.newPage();

  // Vite's HMR socket, swallowed. Against `npm run dev` a file written by
  // anything else full-reloads the page mid-capture; a static preview server
  // opens no such socket, so this is a no-op there.
  await page.routeWebSocket(
    (url) => url.host === new URL(BASE).host,
    () => {}
  );

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // WebGL software-rendering chatter is an artefact of the headless runner.
    if (/WebGL|SwiftShader|GPU stall|Automatic fallback/i.test(text)) return;
    // Web fonts come from an external CDN a sandboxed runner cannot reach;
    // the page is legible either way and this harness asserts nothing about it.
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

  // The admin gate. OPTIONS is answered first everywhere: a preflight handed a
  // JSON body counts as a failed request, which this harness reports.
  const answer = (route, body, status = 200) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204 })
      : route.fulfill({
          status,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
          body: JSON.stringify(body),
        });
  await page.route('**/api/admin/auth/session', (route) =>
    answer(route, { authenticated: true, expiresAt: Date.now() + 3600000 })
  );
  await page.route('**/api/admin/auth/logout', (route) => answer(route, { ok: true }));
  await page.route('**/api/flags', (route) =>
    answer(route, {
      ui: {
        aiPanel: false,
        padMode: false,
        stamps: true,
        showcase: true,
        uploads: true,
        feedbackButton: true,
      },
      notice: '',
    })
  );

  return { context, page };
}

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  → ${name}.png`);
};

/** Pumped frames: headless chromium only advances rAF when asked. */
const pump = (page, n = 30) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const step = () => (--left <= 0 ? resolve(undefined) : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n + 1
  );

/** Waits until every mounted stage has streamed its model in. */
async function settle(page, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await pump(page, 30);
    const state = await page.evaluate(() =>
      typeof window.__airoReview === 'function' ? window.__airoReview() : null
    );
    const stages = Object.values(state?.stages ?? {});
    if (state?.ready && stages.length > 0 && stages.every((s) => s === 'ready')) break;
  }
  await pump(page, 30);
}

for (const spec of VIEWPORTS) {
  console.log(`\n== ${spec.name} ==`);
  const { context, page } = await open(spec, `review/${spec.name}`);

  await page.goto(`${BASE}/admin/review`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__airoReview === 'function', null, {
    timeout: 40000,
  });
  await settle(page);
  await shot(page, `review-grid-${spec.name}`);

  // The diagnostic that sells the feature.
  await page.getByRole('button', { name: 'Silhouette' }).click().catch(() => {});
  await pump(page, 30);
  await shot(page, `review-silhouette-${spec.name}`);
  await page.getByRole('button', { name: 'Silhouette' }).click().catch(() => {});
  await pump(page, 20);

  // The detail modal, on the first card.
  await page
    .locator('[data-review-key] button[aria-label^="Open"]')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(700);
  await pump(page, 60);
  await page.waitForTimeout(2500);
  await pump(page, 60);
  await shot(page, `review-detail-${spec.name}`);

  await context.close();
}

await browser.close();

console.log('\n' + '='.repeat(52));
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.log(' ✗ ' + p);
  process.exitCode = 1;
} else {
  console.log('No console errors, page errors or failed requests.');
}
