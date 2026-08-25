/**
 * Controller (phone) screenshot harness for the Aim-mode redesign.
 *
 * Walks the controller through: Aim mode with the big spray can, brush
 * variant, collapsed dock, colour picker open — and injects synthetic
 * deviceorientation events so the can is posed by the real sensor path.
 *
 *   BASE=http://127.0.0.1:4173 node scripts/preview/shoot-controller.mjs
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

const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (/WebGL|SwiftShader|GPU stall|Automatic fallback|supabase/i.test(text)) return;
  problems.push(`console: ${text.slice(0, 200)}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${String(err).slice(0, 200)}`));

await page.goto(`${BASE}/controller/SHOT1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

// Through the sensor gate: desktop Chromium has DeviceOrientationEvent but no
// requestPermission, so this lands on sensorState=granted.
await page.getByText('Enable motion aiming').click();
await page.waitForTimeout(600);

/** Feed a burst of synthetic orientation events (upright phone ≈ beta 90). */
const pose = (alpha, beta, gamma) =>
  page.evaluate(
    ([a, b, g]) => {
      const ev = new Event('deviceorientation');
      Object.assign(ev, { alpha: a, beta: b, gamma: g });
      window.dispatchEvent(ev);
    },
    [alpha, beta, gamma]
  );

// Settle the tracker at an upright pose, then keep frames alive with jiggles.
for (let i = 0; i < 30; i++) {
  await pose(0, 88 + Math.sin(i / 5) * 1.5, 0);
  await page.mouse.move(200 + (i % 2), 300);
  await page.waitForTimeout(35);
}
await page.waitForTimeout(1800);
await page.mouse.move(201, 301);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/ctrl-aim-spray.png` });

// Tilt the phone a little so the can visibly reacts.
for (let i = 0; i < 25; i++) {
  await pose(14, 84, 6);
  await page.mouse.move(200 + (i % 2), 302);
  await page.waitForTimeout(35);
}
await page.screenshot({ path: `${OUT}/ctrl-aim-spray-tilted.png` });

// Hold the trigger: recoil + mist — the mist must read as leaving, not
// arriving. Keep orientation events flowing so frames keep rendering.
await page.mouse.move(196, 420);
await page.mouse.down();
for (let i = 0; i < 22; i++) {
  await pose(14, 84, 6);
  await page.waitForTimeout(40);
}
await page.screenshot({ path: `${OUT}/ctrl-aim-spraying.png` });
await page.mouse.up();
await page.waitForTimeout(300);

// Collapse the dock — stage stays immersive, colour button stays.
await page.getByTitle('Hide the tool dock').click();
await page.waitForTimeout(500);
await page.mouse.move(202, 303);
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ctrl-aim-collapsed.png` });

// Colour picker pops from the always-present circular button.
await page.getByLabel('Choose colour').click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/ctrl-aim-collapsed-colour.png` });
await page.getByLabel('Choose colour').click();
await page.waitForTimeout(300);

// Re-open the dock and switch to the brush.
await page.getByTitle('Show the tool dock').click();
await page.waitForTimeout(500);
await page.getByRole('tab', { name: 'Brush' }).click();
for (let i = 0; i < 25; i++) {
  await pose(0, 88, 0);
  await page.mouse.move(200 + (i % 2), 304);
  await page.waitForTimeout(35);
}
await page.waitForTimeout(1500);
await page.mouse.move(203, 305);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/ctrl-aim-brush.png` });

// Paint mode with the dock collapsed, for the hint-pill behaviour.
await page.getByRole('tab', { name: 'Paint', exact: true }).first().click();
await page.waitForTimeout(2500);
await page.mouse.move(204, 306);
await page.screenshot({ path: `${OUT}/ctrl-paint-open.png` });
await page.getByTitle('Hide the tool dock').click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/ctrl-paint-collapsed.png` });

await browser.close();

if (problems.length) {
  console.error('PROBLEMS:');
  for (const p of problems) console.error(' -', p);
  process.exit(1);
}
console.log('controller screenshots written to', OUT);
