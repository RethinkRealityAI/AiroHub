/**
 * Measures paint-vs-pointer offset precisely: hold a stationary spray at an
 * exact screen point over the deck, then compare the painted pixels' centroid
 * against the pointer position.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { PNG } from 'pngjs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${BASE}/canvas/OFFSET1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(11000);
if (process.env.OBJECT) {
  await page.locator('header button:has(svg.lucide-chevron-down)').first().click();
  await page.waitForTimeout(700);
  await page.getByText(process.env.OBJECT).click();
  await page.waitForTimeout(9000);
}

const TOOL = process.env.TOOL || 'spray';
if (TOOL === 'brush') {
  await page.keyboard.press('b');
  await page.waitForTimeout(400);
}
// Park the pointer far from the probe point for BOTH screenshots: the host's
// floating 3D tool (and its player-colour band and reticle) follows the mouse,
// so leaving it near the stroke would count as "paint" in the diff.
const PARK = { x: 40, y: 120 };
const TX = Number(process.env.TX || 850), TY = Number(process.env.TY || 560);
await page.mouse.move(PARK.x, PARK.y);
await page.waitForTimeout(900);
const before = PNG.sync.read(await page.screenshot());

// Hold a stationary stroke at an exact point (right of centre so symmetry
// can't mask a horizontal offset).
await page.mouse.move(TX, TY);
await page.mouse.down();
// keep frames alive with sub-pixel jiggle that stays within one CSS px
for (let i = 0; i < 25; i++) {
  await page.mouse.move(TX + (i % 2) * 0.4, TY, { steps: 1 });
  await page.waitForTimeout(60);
}
await page.mouse.up();
// Park the pointer again so the after-shot matches the before-shot except for
// the paint itself, then let the idle float settle.
await page.mouse.move(PARK.x, PARK.y);
await page.waitForTimeout(900);
const after = PNG.sync.read(await page.screenshot({ path: `${OUT}/verify-offset.png` }));

// With the tool parked identically in both shots, any meaningful colour
// change IS paint — no per-colour classifier needed (that misfired on
// objects that already contain the paint colour, like the brick wall).
let sx = 0, sy = 0, n = 0;
for (let y = 0; y < after.height; y++) {
  for (let x = 0; x < after.width; x++) {
    const i = (y * after.width + x) * 4;
    const delta =
      Math.abs(after.data[i] - before.data[i]) +
      Math.abs(after.data[i + 1] - before.data[i + 1]) +
      Math.abs(after.data[i + 2] - before.data[i + 2]);
    if (delta > 70 && Math.hypot(x - PARK.x, y - PARK.y) > 160) { sx += x; sy += y; n++; }
  }
}
if (n < 30) {
  console.log(`FAIL: only ${n} changed pixels — no paint detected`);
} else {
  const cx = sx / n, cy = sy / n;
  console.log(`pointer=(${TX},${TY}) paintCentroid=(${cx.toFixed(1)},${cy.toFixed(1)}) offset=(${(cx-TX).toFixed(1)},${(cy-TY).toFixed(1)}) px over ${n} px`);
}
await browser.close();
