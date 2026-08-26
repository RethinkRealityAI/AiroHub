/**
 * Stamp-mode screenshot harness.
 *
 * Captures the studio with the stamp shelf open, stamps actually placed on the
 * model, the same at phone width, and the controller's in-stage stamp picker.
 *
 *   BASE=http://127.0.0.1:4173 node scripts/preview/shoot-stamp.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(OUT, { recursive: true });
const problems = [];

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const started = Date.now();
const step = (label) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${label}`);

const watch = (page) => {
  // Library-mode Playwright waits forever by default; a wrong selector should
  // fail loudly rather than pin the harness open.
  page.setDefaultTimeout(45000);
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/WebGL|SwiftShader|GPU stall|Automatic fallback|supabase|ERR_CONNECTION|WebSocket/i.test(text)) return;
    problems.push(`console: ${text.slice(0, 200)}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${String(err).slice(0, 200)}`));
};

/**
 * Headless chromium throttles rAF without input, so the stage needs the mouse
 * nudged now and then. Every move also costs an R3F scene raycast, so the
 * cadence is deliberately sparse — a jiggle every 400ms keeps frames coming
 * without turning a 10s settle into minutes of raycasting.
 */
const spin = async (page, ms, at = { x: 30, y: 130 }) => {
  const steps = Math.max(1, Math.ceil(ms / 400));
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(at.x + (i % 2), at.y);
    await page.waitForTimeout(400);
  }
  await page.mouse.move(at.x, at.y + 1);
};

/* ------------------------------------------------------------------
   Studio
   ------------------------------------------------------------------ */

const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript(() => {
  try {
    localStorage.setItem('airo:guide:studio', '1');
    localStorage.setItem('airo:guide:controller', '1');
    localStorage.removeItem('airo:stamps:v1');
  } catch {}
});
const page = await context.newPage();
watch(page);

step('studio: loading');
await page.goto(`${BASE}/canvas/STAMP1`, { waitUntil: 'domcontentloaded' });
await spin(page, 11000);

// Into stamp mode via the dock's own control, the way a user would.
step('studio: opening the stamp tray');
await page.getByRole('tab', { name: 'Stamp' }).click();
await spin(page, 1200);
await page.screenshot({ path: `${OUT}/stamp-studio-tray.png` });
step('studio: tray captured');

// Place a few stamps on the deck. The deck fills the middle band of the stage
// at this viewport; each click is a tap (no travel), so orbit stays out of it.
const spots = [
  { name: 'Crown', at: { x: 560, y: 430 } },
  { name: 'Bolt', at: { x: 700, y: 452 } },
  { name: 'Skull', at: { x: 848, y: 430 } },
];
for (const spot of spots) {
  step(`studio: placing ${spot.name}`);
  await page.getByRole('button', { name: spot.name, exact: true }).first().click();
  await page.waitForTimeout(250);
  await page.mouse.click(spot.at.x, spot.at.y);
  await spin(page, 1200);
}
await spin(page, 900);
await page.screenshot({ path: `${OUT}/stamp-studio-placed.png` });
step('studio: placements captured');

// The skate deck's auto-unwrap is a hostile atlas; the alley wall is one flat
// chart, which is where a UV-anchored stamp reads exactly as drawn.
step('studio: switching to the alley wall');
await page.getByRole('button', { name: /Skate Deck/ }).first().click();
await page.waitForTimeout(600);
await page.getByText('Alley Wall', { exact: true }).first().click();
await spin(page, 9000);
for (const spot of [
  { name: 'Crown', at: { x: 600, y: 400 } },
  { name: 'Bolt', at: { x: 720, y: 470 } },
  { name: 'Skull', at: { x: 840, y: 400 } },
]) {
  step(`wall: placing ${spot.name}`);
  await page.getByRole('button', { name: spot.name, exact: true }).first().click();
  await page.waitForTimeout(250);
  await page.mouse.click(spot.at.x, spot.at.y);
  await spin(page, 1200);
}
await page.screenshot({ path: `${OUT}/stamp-studio-wall.png` });
step('wall: captured');

// Same session, phone width — the shelf and the dock have to coexist.
step('studio: phone width');
await page.setViewportSize({ width: 390, height: 844 });
await spin(page, 2600, { x: 24, y: 300 });
await page.screenshot({ path: `${OUT}/stamp-studio-mobile.png` });
step('studio: mobile captured');
await context.close();

/* ------------------------------------------------------------------
   Controller
   ------------------------------------------------------------------ */

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await phone.addInitScript(() => {
  try {
    localStorage.setItem('airo:guide:studio', '1');
    localStorage.setItem('airo:guide:controller', '1');
    localStorage.removeItem('airo:stamps:v1');
  } catch {}
});
const ctrl = await phone.newPage();
watch(ctrl);

step('controller: loading');
await ctrl.goto(`${BASE}/controller/STAMP1`, { waitUntil: 'domcontentloaded' });
await ctrl.waitForTimeout(1400);
await ctrl.getByText('Just paint on my screen').click();
await spin(ctrl, 9000, { x: 200, y: 300 });

step('controller: opening the stamp picker');
await ctrl.getByRole('tab', { name: 'Stamp' }).click();
await spin(ctrl, 1800, { x: 200, y: 300 });
await ctrl.screenshot({ path: `${OUT}/stamp-controller.png` });
step('controller: captured');

await browser.close();

if (problems.length) {
  console.log('Problems:');
  for (const problem of problems) console.log(' -', problem);
} else {
  console.log('No console/page errors.');
}
console.log('Wrote stamp-studio-tray, stamp-studio-placed, stamp-studio-mobile, stamp-controller');
