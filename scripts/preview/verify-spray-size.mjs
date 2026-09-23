/**
 * Spray size verification.
 *
 * Paints the same horizontal stroke across the skate deck at three nozzle
 * sizes (40%, 100%, 200%), each in a fresh room, and measures the painted
 * band from before/after screenshots. Fails unless the band clearly widens
 * with the size and the widest band is still solidly covered, which is the
 * regression this guards: the fan used to widen while its grains stayed
 * capped, so large sizes came out too faint to see and read as "no change".
 *
 *   BASE=http://127.0.0.1:4173 node scripts/preview/verify-spray-size.mjs
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const VIEW = { width: 1512, height: 950 };
/** Stroke across the middle of the deck, and the columns measured under it. */
const STROKE = { y: 455, x0: 560, x1: 960 };
const COLUMNS = [680, 720, 760, 800, 840];

async function paintAt(size, room) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('airo:guide:studio', '1');
    } catch {}
  });
  await page.goto(`${BASE}/canvas/${room}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  await page.evaluate((value) => {
    const input = document.querySelector('input[aria-label="Tool size"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, size);
  // Park the pointer off the model so the floating can and reticle are not
  // in either frame.
  await page.mouse.move(470, 820);
  await page.waitForTimeout(600);
  const before = PNG.sync.read(await page.screenshot());

  await page.mouse.move(STROKE.x0, STROKE.y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(STROKE.x0 + ((STROKE.x1 - STROKE.x0) * i) / 40, STROKE.y);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.mouse.move(470, 820);
  await page.waitForTimeout(900);
  const afterBuf = await page.screenshot();
  fs.writeFileSync(`${OUT}/spray-size-${Math.round(size * 100)}.png`, afterBuf);
  const after = PNG.sync.read(afterBuf);
  await context.close();

  // Per measured column: the rows whose colour moved noticeably.
  const heights = [];
  let changed = 0;
  let total = 0;
  for (const x of COLUMNS) {
    let top = Infinity;
    let bottom = -Infinity;
    for (let y = STROKE.y - 160; y <= STROKE.y + 160; y++) {
      const i = (y * VIEW.width + x) * 4;
      const d =
        Math.abs(after.data[i] - before.data[i]) +
        Math.abs(after.data[i + 1] - before.data[i + 1]) +
        Math.abs(after.data[i + 2] - before.data[i + 2]);
      if (d > 60) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (bottom >= top) {
      heights.push(bottom - top + 1);
      for (let y = top; y <= bottom; y++) {
        const i = (y * VIEW.width + x) * 4;
        const d =
          Math.abs(after.data[i] - before.data[i]) +
          Math.abs(after.data[i + 1] - before.data[i + 1]) +
          Math.abs(after.data[i + 2] - before.data[i + 2]);
        total++;
        if (d > 60) changed++;
      }
    } else heights.push(0);
  }
  heights.sort((a, b) => a - b);
  return { size, band: heights[Math.floor(heights.length / 2)], fill: total ? changed / total : 0 };
}

const results = [];
for (const [size, room] of [
  [0.4, 'SIZE040'],
  [1, 'SIZE100'],
  [2, 'SIZE200'],
]) {
  const r = await paintAt(size, room);
  results.push(r);
  console.log(`size ${Math.round(size * 100)}%: band ${r.band}px, ${(r.fill * 100).toFixed(0)}% of it covered`);
}
await browser.close();

const [small, mid, big] = results;
const problems = [];
if (!(small.band > 0 && mid.band > small.band * 1.5)) problems.push('100% is not clearly wider than 40%');
if (!(big.band > mid.band * 1.4)) problems.push('200% is not clearly wider than 100%');
if (big.fill < 0.6) problems.push(`200% band is too sparse (${(big.fill * 100).toFixed(0)}% covered)`);
if (problems.length) {
  console.error('\nFAIL:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('\nPASS: the spray band widens with the nozzle size and stays covered.');
