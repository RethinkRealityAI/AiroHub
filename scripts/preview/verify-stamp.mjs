/**
 * Stamp-mode engine verification (written BEFORE the feature — it must fail
 * until stamp mode lands, then pass forever).
 *
 * Contract it locks in:
 *  - an 'image-stamp' event {playerId, stampId, img(dataUrl), u, v, radiusPx,
 *    rotation, tint?} applies the image to the shared paint texture at the
 *    given UV, identically on every peer (UV-anchored, camera-independent);
 *  - the stamp registers in the stroke log under its stampId, so
 *    'undo-stroke' removes it and 'redo-stroke' restores it;
 *  - a debug hook window.__airoPaintProbe(u, v) → [r,g,b,a] samples the paint
 *    layer so tests can assert without depending on any camera or model.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';

// 8x8 solid opaque red PNG. (The original literal here was a corrupt PNG —
// its deflate stream was truncated, so browsers decoded row 0 and left the
// remaining 56 pixels transparent, which no stamp implementation could turn
// red at the probed centre. Only the fixture bytes changed; every assertion
// below is untouched.)
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1Jr' +
  'AAAAEklEQVQY02P4z8DwHx9mGBkKAMLXf4FTfn5wAAAAAElFTkSuQmCC';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
await page.addInitScript(() => {
  try {
    localStorage.setItem('airo:guide:studio', '1');
    localStorage.setItem('airo:guide:controller', '1');
  } catch {}
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(`${BASE}/canvas/STAMP1?debug`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(11000);
await page.waitForFunction(() => typeof window.__airoSim === 'function');

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

// Keep the render loop alive (headless chromium only renders on demand).
const tick = async (ms) => {
  const steps = Math.ceil(ms / 60);
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(30 + (i % 2), 30);
    await page.waitForTimeout(60);
  }
};

const probe = (u, v) =>
  page.evaluate(([pu, pv]) => (window.__airoPaintProbe ? window.__airoPaintProbe(pu, pv) : null), [u, v]);
const sim = (event, payload) => page.evaluate(([e, p]) => window.__airoSim(e, p), [event, payload]);

/* 1: the probe hook exists. */
const before = await probe(0.5, 0.5);
check('probe hook', Array.isArray(before) && before.length === 4, `sample=${JSON.stringify(before)}`);

/* 2: paint layer starts clear at the target UV. */
const clearBefore = before && before[3] < 32;
check('clear before stamp', !!clearBefore, `alpha=${before ? before[3] : 'n/a'}`);

/* 3: an image-stamp event lands red paint at its UV on this peer. */
await sim('image-stamp', {
  playerId: 'sim-stamper',
  stampId: 'sim-stamper#st1',
  img: RED_PNG,
  u: 0.5,
  v: 0.5,
  radiusPx: 140,
  rotation: 0,
});
await tick(700);
const after = await probe(0.5, 0.5);
const stamped = after && after[3] > 120 && after[0] > 150 && after[1] < 110 && after[2] < 110;
check('stamp applies at UV', !!stamped, `rgba=${JSON.stringify(after)}`);

/* 4: the stamp is one undoable stroke. */
await sim('undo-stroke', { strokeId: 'sim-stamper#st1' });
await tick(600);
const undone = await probe(0.5, 0.5);
check('stamp undoes', undone && undone[3] < 32, `rgba=${JSON.stringify(undone)}`);

/* 5: and redoes. */
await sim('redo-stroke', { strokeId: 'sim-stamper#st1' });
await tick(600);
const redone = await probe(0.5, 0.5);
check(
  'stamp redoes',
  redone && redone[3] > 120 && redone[0] > 150,
  `rgba=${JSON.stringify(redone)}`
);

/* 6: tinted stencil stamping — a white-alpha stencil drawn in a chosen color. */
await sim('image-stamp', {
  playerId: 'sim-stamper',
  stampId: 'sim-stamper#st2',
  img: RED_PNG, // red source, but tint must override to pure blue
  u: 0.25,
  v: 0.25,
  radiusPx: 120,
  rotation: 0,
  tint: '#2244ee',
});
await tick(700);
const tinted = await probe(0.25, 0.25);
check(
  'tint override',
  tinted && tinted[3] > 120 && tinted[2] > 150 && tinted[0] < 110,
  `rgba=${JSON.stringify(tinted)}`
);

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} stamp checks passed`);
process.exit(failed.length ? 1 : 0);
