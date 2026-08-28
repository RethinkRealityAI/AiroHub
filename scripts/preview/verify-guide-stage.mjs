/**
 * GuideStage verification — proves the guide's "try it here" playground really
 * paints, headlessly.
 *
 * What it locks in:
 *  - the widget mounts on /how-it-works, streams its catalog model in and
 *    exposes the same debug hooks the studio does;
 *  - the paint layer starts empty;
 *  - the untouched widget auto-rotates, and the first interaction stops that
 *    for good;
 *  - a bare wheel over the stage scrolls the PAGE rather than dollying the
 *    camera, so the widget can never trap a reader mid-scroll;
 *  - a left-button drag across the object in Spray mode deposits paint on the
 *    real surface (texels change) and opens exactly one undoable stroke;
 *  - the paint carries the selected swatch's colour;
 *  - the same drag in Rotate mode deposits nothing.
 *
 * Headless chromium only advances rAF while frames are pumped, and nudging the
 * mouse to keep it alive would drag the live stroke somewhere else — so frames
 * are pumped with an explicit requestAnimationFrame await between the pointer
 * moves that make up the stroke.
 *
 * Usage:  npx vite build --outDir dist-guide
 *         npx vite preview --outDir dist-guide --port 4190 &
 *         node scripts/preview/verify-guide-stage.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4190';
const SHOTS = process.env.SHOT_DIR || 'scripts/preview/out';
/** Grid resolution for the "did any texel change?" sweep of the paint layer. */
const GRID = 48;

mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(`${BASE}/how-it-works`, { waitUntil: 'domcontentloaded' });

/* The widget is lazily imported and parks its frame loop while off screen, so
   bring it into view before waiting on anything it owns. GuideStage owns the
   guide's only 3D canvas; if that ever stops being true this assert fails
   loudly rather than quietly testing the wrong element. */
await page.waitForSelector('canvas', { timeout: 30000 });
const canvases = await page.locator('canvas').count();
check('guide has exactly one 3D canvas', canvases === 1, `found ${canvases}`);
const stage = page.locator('canvas').first();
await stage.scrollIntoViewIfNeeded();

await page.waitForFunction(() => typeof window.__airoGuideStage === 'function', null, {
  timeout: 30000,
});

/** One real animation frame — the only way this scene advances headlessly. */
const pump = (n = 1) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const step = () => (--left <= 0 ? resolve(undefined) : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n + 1
  );

/* The GLB streams in and the camera refits; ~11s of pumped frames covers it. */
const deadline = Date.now() + 20000;
while (Date.now() < deadline) {
  await pump(30);
  const ready = await page.evaluate(
    () => !document.body.innerText.includes('Loading the object')
  );
  if (ready) break;
}
await pump(60);

const modelReady = await page.evaluate(
  () => !document.body.innerText.includes('Loading the object')
);
check('model streams in', modelReady, modelReady ? '' : 'still showing the loading label');

/** Counts painted texels and reports the strongest sample's colour. */
const sweep = () =>
  page.evaluate((n) => {
    let painted = 0;
    let best = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const s = window.__airoPaintProbe(i / (n - 1), j / (n - 1));
        if (s[3] > 16) painted++;
        if (s[3] > best[3]) best = s;
      }
    }
    return { painted, best };
  }, GRID);

/** How far the orbit azimuth travels over `frames` frames of no input. */
const idleSpin = async (frames) => {
  const before = await page.evaluate(() => window.__airoGuideStage().azimuth);
  await pump(frames);
  const after = await page.evaluate(() => window.__airoGuideStage().azimuth);
  return Math.abs(after - before);
};

/* 1: nobody has touched it, so it turns on its own. Reading the orbit azimuth
      rather than diffing pixels keeps this immune to renderer noise. */
{
  const spin = await idleSpin(90);
  check('idle attract auto-rotates', spin > 0.05, `azimuth moved ${spin.toFixed(4)} rad over 90 idle frames`);
}

/* 2: hooks are live and the layer is blank. */
const before = await sweep();
check('probe hook', Array.isArray(before.best) && before.best.length === 4, `best=${JSON.stringify(before.best)}`);
check('paint layer starts clear', before.painted === 0, `painted=${before.painted}/${GRID * GRID}`);

const strokeBefore = await page.evaluate(() => window.__airoGuideStage().strokeId);
check('no stroke logged yet', strokeBefore === null, `strokeId=${String(strokeBefore)}`);

/* 3: a bare wheel over the stage belongs to the page. */
{
  const start = await page.evaluate(() => window.scrollY);
  const centre = await stage.boundingBox();
  await page.mouse.move(centre.x + centre.width / 2, centre.y + centre.height / 2);
  await page.mouse.wheel(0, 320);
  await pump(3);
  const moved = await page.evaluate(() => window.scrollY);
  check('wheel scrolls the page, not the camera', moved > start + 40, `scrollY ${start} -> ${moved}`);
  await stage.scrollIntoViewIfNeeded();
  await pump(3);
}

await stage.screenshot({ path: `${SHOTS}/guide-stage-idle.png` });

/* 4: drag across the object with the left button held, pumping frames between
      moves so the painter actually steps. */
const box = await stage.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

/* Two passes along the deck's long axis. The subject is framed to the widget,
   so the middle third of the stage is solidly on the object; a wider sweep
   would spend most of the stroke in empty space beside it. */
const path = (t) => [cx + (t * 2 - 1) * box.width * 0.14, cy + Math.sin(t * Math.PI * 2) * box.height * 0.035];

await page.mouse.move(...path(0));
await pump(2);
await page.mouse.down();
await pump(4);
for (let pass = 0; pass < 2; pass++) {
  for (let i = 1; i <= 26; i++) {
    const t = pass === 0 ? i / 26 : 1 - i / 26;
    await page.mouse.move(...path(t));
    await pump(2);
  }
}
await pump(4);
await page.mouse.up();
await pump(4);

/* 5: paint landed, in one stroke, in the selected colour. */
const after = await sweep();
check('drag deposits paint', after.painted > before.painted, `painted=${after.painted} (was ${before.painted})`);

const strokeAfter = await page.evaluate(() => window.__airoGuideStage().strokeId);
check(
  'one undoable stroke opened',
  strokeAfter === 'guide#1',
  `strokeId=${String(strokeAfter)}`
);

const [r, g, b, a] = after.best;
check(
  'paint carries the flame swatch',
  a > 40 && r > 120 && r > g && g > b,
  `rgba=${JSON.stringify(after.best)} (swatch #FF4D1C)`
);

/* 6: evidence — the widget with the visitor's stroke on the object. */
await stage.screenshot({ path: `${SHOTS}/guide-stage.png` });

/* 7: the same drag in Rotate mode paints nothing — the mode gate holds. */
const modeButton = (name) =>
  page.locator('[aria-label="Drag behaviour"] button', { hasText: name }).first();
await modeButton('Rotate').click();
await pump(3);
await page.mouse.move(...path(0));
await page.mouse.down();
for (let i = 1; i <= 14; i++) {
  await page.mouse.move(...path(i / 14));
  await pump(2);
}
await page.mouse.up();
await pump(4);
const rotated = await sweep();
check('rotate mode paints nothing', rotated.painted === after.painted, `painted=${rotated.painted} (was ${after.painted})`);

/* …and the orbit it did perform is worth a look too. */
await modeButton('Spray').click();
await pump(90); // let the orbit damping settle before judging stillness
await stage.screenshot({ path: `${SHOTS}/guide-stage-rotated.png` });

/* 8: and the attract loop stays stopped, now that it has been touched. */
{
  const spin = await idleSpin(90);
  check(
    'first interaction stops the attract loop',
    spin < 0.005,
    `azimuth moved ${spin.toFixed(4)} rad over 90 idle frames`
  );
}
console.log(`\nscreenshots: ${SHOTS}/guide-stage-idle.png, guide-stage.png, guide-stage-rotated.png`);

await browser.close();

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} guide-stage checks passed`);
process.exit(failed.length ? 1 : 0);
