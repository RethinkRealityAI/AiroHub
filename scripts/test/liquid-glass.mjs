/**
 * Liquid-glass refraction suite.
 *
 * The maths in src/ui/liquidGlass.ts fails quietly. A NaN in the LUT, a
 * mis-signed normal or a `scale` that is half what it should be all produce a
 * page that still looks finished — just wrong, or flat, or bent the wrong way —
 * and there is nothing on screen to read it off. So each check below pins one
 * number that has no other witness:
 *
 *  A   the LUT is finite across the whole band (the central difference reaches
 *      past x=0, where an unclamped h() takes the fourth root of a negative)
 *  B   both ends of the band are still, and the peak sits at the rim
 *  C   the channel encoding round-trips inside one quantisation step
 *  D   direction reverses cleanly — a negated offset encodes to the mirror byte
 *  E   scale is exactly 2 x maxDisplacement, because feDisplacementMap moves a
 *      pixel by scale * (C - 0.5) and half a map is half an effect
 *  F   the rasterised map bends outward at the rim and stays neutral in the
 *      middle, which is the whole SDF-gradient wiring in three pixels
 *  G   identical specs share one map object; different ones do not
 *  H   an environment that will not render this returns null and never throws
 *
 * Runs headless: bundles the module with esbuild and stands up just enough of a
 * browser — CSS.supports, a Chromium user agent, matchMedia and a canvas that
 * records what was drawn into it — to raster one map in Node. `npm test` runs it.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airo-lg-'));
const bundle = path.join(outDir, 'liquidGlass.mjs');

await build({
  entryPoints: [path.join(repo, 'src/ui/liquidGlass.ts')],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  logLevel: 'error',
});

const LG = await import(pathToFileURL(bundle).href);

/* --------------------------- browser stand-in --------------------------- */

/** The last ImageData handed to putImageData, so a test can read the map back. */
let drawn = null;
let rasters = 0;

class FakeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
  }
  getContext(kind) {
    if (kind !== '2d') return null;
    return {
      createImageData: (w, h) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: (image) => {
        drawn = image;
      },
    };
  }
  toDataURL() {
    // Unique per raster, so a cache hit is provable rather than assumed.
    return `data:image/png;base64,RASTER${++rasters}`;
  }
}

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

/** Node 21+ owns globalThis.navigator, so it has to be redefined rather than set. */
const setUserAgent = (userAgent) =>
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent },
    configurable: true,
    writable: true,
  });

function supportBrowser({ supports = true, ua = CHROME_UA, media = () => false } = {}) {
  globalThis.CSS = { supports: () => supports };
  setUserAgent(ua);
  globalThis.window = { matchMedia: (query) => ({ matches: media(query) }) };
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? new FakeCanvas() : {}),
  };
}

function bareNode() {
  delete globalThis.CSS;
  delete globalThis.window;
  delete globalThis.document;
  setUserAgent('Node.js');
}

/* -------------------------------- harness -------------------------------- */

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const THICKNESS = 20;
const BEZEL = 24;
const RADIUS = 26;
const WIDTH = 160;
const HEIGHT = 120;

supportBrowser();

/* A: the LUT survives its own central difference. */
const lut = LG.buildLut(THICKNESS, BEZEL);
{
  const bad = [...lut].findIndex((v) => !Number.isFinite(v));
  check(
    'A LUT finite across the band',
    bad === -1 && lut.length === LG.LUT_SAMPLES,
    `${lut.length} samples, first non-finite index ${bad}`
  );
}

/* B: still at both ends, loudest at the rim. */
{
  const last = Math.abs(lut[lut.length - 1]);
  let peak = 0;
  let peakIndex = 0;
  for (let i = 0; i < lut.length; i++) {
    if (Math.abs(lut[i]) > peak) {
      peak = Math.abs(lut[i]);
      peakIndex = i;
    }
  }
  const rimBand = Math.round(0.15 * (lut.length - 1));
  check(
    'B band ends still, peak at the rim',
    last < 1e-6 && Math.abs(lut[0]) < 1e-9 && peakIndex > 0 && peakIndex <= rimBand,
    `x=0 -> ${lut[0].toFixed(6)}px, x=1 -> ${last.toExponential(2)}px, peak ${peak.toFixed(3)}px at sample ${peakIndex} (rim band 1..${rimBand})`
  );
}

/* C: the 8-bit encoding costs less than one LUT step. */
{
  const limit = 1 / 127;
  let worst = 0;
  for (let i = 0; i <= 2000; i++) {
    const v = -1 + (2 * i) / 2000;
    worst = Math.max(worst, Math.abs(LG.decodeChannel(LG.encodeChannel(v)) - v));
  }
  check(
    'C encoder round-trips',
    worst <= limit,
    `worst error ${worst.toFixed(6)} (limit ${limit.toFixed(6)})`
  );
}

/* D: reversing the direction reverses the offset, to within one byte. */
{
  // 127.5 is not representable in eight bits, so a value and its negation share
  // the rounding tie rather than straddling it; one LSB is the honest bound.
  const limit = 2 / 255 + 1e-9;
  let worst = 0;
  for (let i = 0; i <= 2000; i++) {
    const v = -1 + (2 * i) / 2000;
    const sum =
      LG.decodeChannel(LG.encodeChannel(v)) + LG.decodeChannel(LG.encodeChannel(-v));
    worst = Math.max(worst, Math.abs(sum));
  }
  check(
    'D direction symmetry',
    worst <= limit,
    `worst |f(v) + f(-v)| = ${worst.toFixed(6)} (limit ${limit.toFixed(6)})`
  );
}

/* E: scale decodes the map at full strength. */
const map = LG.getDisplacementMap({
  width: WIDTH,
  height: HEIGHT,
  radius: RADIUS,
  bezel: BEZEL,
  thickness: THICKNESS,
});
{
  const ok =
    map !== null &&
    map.scale === 2 * map.maxDisplacement &&
    map.maxDisplacement > 0 &&
    map.maxDisplacement <= LG.MAX_DISPLACEMENT_PX &&
    map.url.startsWith('data:image/png');
  check(
    'E scale is twice the peak',
    ok,
    map
      ? `maxDisplacement=${map.maxDisplacement.toFixed(3)}px scale=${map.scale.toFixed(3)} key=${map.key}`
      : 'no map'
  );
}

/* F: the rasterised field bends outward at the rim and is neutral in the body.
      Left and right edge midlines are pure -x and +x normals at very nearly the
      LUT peak, so they land on the two extreme bytes; the centre is flat. */
{
  const at = (x, y) => {
    const p = (y * drawn.width + x) * 4;
    return [drawn.data[p], drawn.data[p + 1], drawn.data[p + 2], drawn.data[p + 3]];
  };
  const midY = HEIGHT / 2;
  const left = at(0, midY);
  const right = at(WIDTH - 1, midY);
  const top = at(WIDTH / 2, 0);
  const middle = at(WIDTH / 2, midY);

  const ok =
    drawn &&
    drawn.width === WIDTH &&
    drawn.height === HEIGHT &&
    left[0] <= 2 &&
    right[0] >= 253 &&
    left[0] + right[0] >= 255 &&
    left[0] + right[0] <= 256 &&
    left[1] === 128 &&
    right[1] === 128 &&
    top[1] <= 2 &&
    top[0] === 128 &&
    middle[0] === 128 &&
    middle[1] === 128 &&
    middle[2] === 128 &&
    middle[3] === 255;
  check(
    'F map bends outward at the rim',
    ok,
    `left=${left} right=${right} top=${top} centre=${middle}`
  );
}

/* G: one map per spec, and specs are told apart. */
{
  const again = LG.getDisplacementMap({
    width: WIDTH,
    height: HEIGHT,
    radius: RADIUS,
    bezel: BEZEL,
    thickness: THICKNESS,
  });
  // 159 and 160 round into the same 2px bucket, so a window drag reuses the
  // raster; 162 is the next bucket along and has to build its own.
  const bucketed = LG.getDisplacementMap({
    width: WIDTH - 1,
    height: HEIGHT,
    radius: RADIUS,
    bezel: BEZEL,
    thickness: THICKNESS,
  });
  const wider = LG.getDisplacementMap({
    width: WIDTH + 2,
    height: HEIGHT,
    radius: RADIUS,
    bezel: BEZEL,
    thickness: THICKNESS,
  });
  const thicker = LG.getDisplacementMap({
    width: WIDTH,
    height: HEIGHT,
    radius: RADIUS,
    bezel: BEZEL,
    thickness: THICKNESS + 4,
  });
  check(
    'G cache is keyed, not guessed',
    again === map &&
      bucketed === map &&
      wider !== map &&
      thicker !== map &&
      thicker.url !== map.url,
    `same spec and 159px both reuse ${again === map && bucketed === map}, 162px -> ${wider.key}, +4px thickness -> ${thicker.key}`
  );
}

/* H: every reason not to render this ends in null, and none of them throws. */
{
  const cases = [
    ['no CSS.supports', () => bareNode()],
    ['backdrop-filter url() unsupported', () => supportBrowser({ supports: false })],
    ['Safari user agent', () => supportBrowser({ ua: SAFARI_UA })],
    [
      'prefers-reduced-transparency',
      () => supportBrowser({ media: (q) => q.includes('transparency') }),
    ],
    ['prefers-reduced-motion', () => supportBrowser({ media: (q) => q.includes('motion') })],
  ];
  const failures = [];
  cases.forEach(([label, setup], i) => {
    setup();
    try {
      // A size of its own each time, so a cache hit can never stand in for a
      // gate that quietly stopped working.
      const result = LG.getDisplacementMap({ width: 300 + i * 2, height: 200 });
      if (result !== null) failures.push(`${label} returned a map`);
    } catch (error) {
      failures.push(`${label} threw ${error}`);
    }
  });
  check(
    'H unsupported environments return null',
    failures.length === 0,
    failures.length ? failures.join('; ') : `${cases.length} gates, all silent`
  );
}

fs.rmSync(outDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} liquid-glass checks passed`);
process.exit(failed.length ? 1 : 0);
