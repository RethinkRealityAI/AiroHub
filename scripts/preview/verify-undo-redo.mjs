/**
 * Undo / redo / replay-colour semantics, end to end in the studio.
 *
 * Paints stroke A (red) and stroke B (azure) at separate spots, then checks:
 *   1. Undo removes ONLY stroke B (A must survive).
 *   2. Redo restores stroke B.
 *   3. Replay repaints stroke B in ITS OWN colour (blue-dominant, not red).
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
// The first-run welcome guide would cover the stage in a fresh context.
await page.addInitScript(() => {
  try {
    localStorage.setItem('airo:guide:studio', '1');
    localStorage.setItem('airo:guide:controller', '1');
  } catch {}
});

await page.goto(`${BASE}/canvas/UNDO1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(11000);

const PARK = { x: 40, y: 120 };
const A = { x: 620, y: 450 };
const B = { x: 790, y: 480 };

const park = async () => {
  await page.mouse.move(PARK.x, PARK.y);
  await page.waitForTimeout(900);
};

const shot = async (name) => {
  await park();
  return PNG.sync.read(await page.screenshot({ path: `${OUT}/${name}.png` }));
};

/** Paints a short horizontal stroke centred on p. */
const stroke = async (p) => {
  await page.mouse.move(p.x - 30, p.y);
  await page.mouse.down();
  for (let i = 0; i <= 12; i++) {
    await page.mouse.move(p.x - 30 + i * 5, p.y, { steps: 1 });
    await page.waitForTimeout(45);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
};

/** Region stats vs a baseline: changed-pixel count and mean colour. */
const region = (img, base, p, radius = 34) => {
  let n = 0, r = 0, g = 0, b = 0;
  for (let y = p.y - radius; y <= p.y + radius; y++) {
    for (let x = p.x - radius; x <= p.x + radius; x++) {
      const i = (y * img.width + x) * 4;
      const delta =
        Math.abs(img.data[i] - base.data[i]) +
        Math.abs(img.data[i + 1] - base.data[i + 1]) +
        Math.abs(img.data[i + 2] - base.data[i + 2]);
      if (delta > 70) {
        n++;
        r += img.data[i];
        g += img.data[i + 1];
        b += img.data[i + 2];
      }
    }
  }
  return n ? { n, r: r / n, g: g / n, b: b / n } : { n: 0, r: 0, g: 0, b: 0 };
};

const before = await shot('ur-0-before');

// Stroke A in the default red.
await stroke(A);

// Switch to Azure, stroke B.
await page.getByLabel('Choose colour').click();
await page.waitForTimeout(400);
await page.getByTitle('Azure').click();
await page.waitForTimeout(400);
await stroke(B);

const painted = await shot('ur-1-painted');
const a1 = region(painted, before, A);
const b1 = region(painted, before, B);

// Undo (Ctrl+Z) must remove ONLY stroke B.
await page.keyboard.press('Control+z');
await page.waitForTimeout(700);
const afterUndo = await shot('ur-2-undo');
const a2 = region(afterUndo, before, A);
const b2 = region(afterUndo, before, B);

// Redo restores stroke B.
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(700);
const afterRedo = await shot('ur-3-redo');
const b3 = region(afterRedo, before, B);

// Replay: run the montage, then check stroke B kept its own colour.
await page.getByTitle('Replay the artwork painting itself').click();
await page.waitForTimeout(6000);
const afterReplay = await shot('ur-4-replay');
const a4 = region(afterReplay, before, A);
const b4 = region(afterReplay, before, B);

const results = [];
const check = (label, ok, detail) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label} ${detail}`);
  return ok;
};

let all = true;
all = check('paint: both strokes landed', a1.n > 60 && b1.n > 60, `(A=${a1.n}px B=${b1.n}px)`) && all;
all = check('undo: only B removed', a2.n > 60 && b2.n < 15, `(A=${a2.n}px B=${b2.n}px)`) && all;
all = check('redo: B restored', b3.n > 60, `(B=${b3.n}px)`) && all;
all = check(
  'replay: A stays red-dominant',
  a4.n > 60 && a4.r > a4.b + 30,
  `(A n=${a4.n} rgb=${a4.r.toFixed(0)},${a4.g.toFixed(0)},${a4.b.toFixed(0)})`
) && all;
all = check(
  'replay: B stays blue-dominant',
  b4.n > 60 && b4.b > b4.r + 30,
  `(B n=${b4.n} rgb=${b4.r.toFixed(0)},${b4.g.toFixed(0)},${b4.b.toFixed(0)})`
) && all;

console.log(results.join('\n'));
await browser.close();
process.exit(all ? 0 : 1);
