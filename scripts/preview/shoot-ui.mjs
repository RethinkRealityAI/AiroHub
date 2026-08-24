/**
 * UI screenshot harness.
 *
 * Drives the running build across desktop, tablet and phone viewports and
 * writes screenshots to scripts/preview/out/. Console errors and failed
 * requests are reported so a visually-fine-but-broken page still fails loudly.
 *
 *   BASE=http://127.0.0.1:4173 node scripts/preview/shoot-ui.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1512, height: 950 }, isMobile: false },
  { name: 'tablet', viewport: { width: 900, height: 1200 }, isMobile: true },
  { name: 'phone', viewport: { width: 393, height: 852 }, isMobile: true },
];

const problems = [];

// Chromium does not read HTTPS_PROXY on its own. Shooting a deployed URL from
// a sandboxed runner therefore needs the proxy passed explicitly; the proxy CA
// is already in the browser trust store, so TLS verification stays on.
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const useProxy = PROXY && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  ...(useProxy ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}),
});

/** Opens a page with error capture wired up. */
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
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // WebGL software-rendering chatter is an artefact of the headless runner.
    if (/WebGL|SwiftShader|GPU stall|Automatic fallback/i.test(text)) return;
    problems.push(`[${label}] console: ${text.slice(0, 200)}`);
  });
  page.on('pageerror', (err) => problems.push(`[${label}] pageerror: ${String(err).slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    if (req.url().includes('favicon')) return;
    problems.push(`[${label}] request failed: ${req.url().slice(0, 140)}`);
  });
  return { context, page };
}

const shot = async (page, name, full = false) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log(`  → ${name}.png`);
};

const ROOM = 'SHOOT1';

for (const spec of VIEWPORTS) {
  console.log(`\n== ${spec.name} ==`);

  // ---- Home ----
  {
    const { context, page } = await open(spec, `home/${spec.name}`);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await shot(page, `home-${spec.name}`);
    await context.close();
  }

  // ---- Studio ----
  {
    const { context, page } = await open(spec, `studio/${spec.name}`);
    await page.goto(`${BASE}/canvas/${ROOM}`, { waitUntil: 'domcontentloaded' });
    // Give the model fetch + first WebGL frames time to settle.
    await page.waitForTimeout(14000);
    await shot(page, `studio-${spec.name}`);

    if (spec.name === 'desktop') {
      // Object picker — the canvas-switching UI.
      await page.locator('header button:has(svg.lucide-chevron-down)').first().click().catch(() => {});
      await page.waitForTimeout(900);
      await shot(page, 'studio-objects');
      await page.keyboard.press('Escape').catch(() => {});
      await page.locator('body').click({ position: { x: 60, y: 500 } }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await context.close();
  }

  // ---- Controller ----
  {
    const { context, page } = await open(spec, `controller/${spec.name}`);
    await page.goto(`${BASE}/controller/${ROOM}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    await shot(page, `controller-gate-${spec.name}`);

    // Take the no-sensor path, which is what a desktop or a denied phone gets.
    await page.getByText('Just paint on my screen').click().catch(() => {});
    await page.waitForTimeout(14000);
    await shot(page, `controller-paint-${spec.name}`);

    if (spec.name === 'phone') {
      await page.getByRole('tab', { name: 'Pad' }).click().catch(() => {});
      await page.waitForTimeout(1200);
      await shot(page, 'controller-pad');

      await page.locator('header button:has(svg.lucide-chevron-down)').first().click().catch(() => {});
      await page.waitForTimeout(1000);
      await shot(page, 'controller-objects');
    }
    await context.close();
  }
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
