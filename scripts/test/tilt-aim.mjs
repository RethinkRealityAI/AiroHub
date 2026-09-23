/**
 * Tilt-aim regression suite: the landing page's phone steering.
 *
 * The landing hero used to drive the can through the controller's
 * AimTracker, which models a phone pointed at a TV and ignores roll by
 * design. Held like a phone and tilted, the can would not move sideways and
 * moved up when the phone tipped down. These checks pin the directions and
 * the feel of `src/utils/tiltAim.ts` so that cannot come back silently.
 *
 * Runs headless: bundles the module with esbuild and feeds it synthetic
 * DeviceOrientation angles at 60 Hz.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airo-tilt-'));
const bundle = path.join(outDir, 'tilt.mjs');
await build({
  entryPoints: [path.join(repo, 'src/utils/tiltAim.ts')],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  logLevel: 'error',
});
const { TiltAim } = await import(pathToFileURL(bundle).href);

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

/** Feeds a pose for `ms` at 60 Hz and returns the last sample. */
function hold(aim, clock, beta, gamma, ms = 500, angle = 0, noise = 0) {
  let s;
  for (let t = 0; t < ms; t += 1000 / 60) {
    clock.t += 1000 / 60;
    const n = () => (Math.random() - 0.5) * 2 * noise;
    s = { ...aim.update(beta + n(), gamma + n(), clock.t, angle) };
  }
  return s;
}
const fresh = (beta, gamma, angle = 0) => {
  const aim = new TiltAim();
  const clock = { t: 0 };
  hold(aim, clock, beta, gamma, 400, angle);
  return { aim, clock };
};
const f = (n) => n.toFixed(3);

// Portrait, held like a phone you are reading (screen tilted ~55 deg up).
{
  const { aim, clock } = fresh(55, 0);
  const s = hold(aim, clock, 55, 10);
  check('portrait: right edge down moves right', s.x > 0.3 && Math.abs(s.y) < 0.08, `x=${f(s.x)} y=${f(s.y)}`);
}
{
  const { aim, clock } = fresh(55, 0);
  const s = hold(aim, clock, 55, -10);
  check('portrait: left edge down moves left', s.x < -0.3 && Math.abs(s.y) < 0.08, `x=${f(s.x)} y=${f(s.y)}`);
}
{
  const { aim, clock } = fresh(55, 0);
  const s = hold(aim, clock, 45, 0);
  check('portrait: tipping the top away moves down', s.y < -0.3 && Math.abs(s.x) < 0.05, `x=${f(s.x)} y=${f(s.y)}`);
}
{
  const { aim, clock } = fresh(55, 0);
  const s = hold(aim, clock, 65, 0);
  check('portrait: raising the top moves up', s.y > 0.3 && Math.abs(s.x) < 0.05, `x=${f(s.x)} y=${f(s.y)}`);
}

// Landscape, device turned counter-clockwise (orientation angle 90): the
// screen's top edge is the device's right edge.
{
  const { aim, clock } = fresh(0, -55, 90);
  const right = hold(aim, clock, 10, -55, 500, 90);
  const { aim: aim2, clock: clock2 } = fresh(0, -55, 90);
  const down = hold(aim2, clock2, 0, -45, 500, 90);
  check(
    'landscape: same directions as portrait',
    right.x > 0.3 && down.y < -0.3,
    `right-edge-down x=${f(right.x)}  top-away y=${f(down.y)}`
  );
}

// A held tilt stays put (absolute), and returning to neutral comes back.
{
  const { aim, clock } = fresh(55, 0);
  const a = hold(aim, clock, 55, 8, 300);
  const b = hold(aim, clock, 55, 8, 3000);
  const back = hold(aim, clock, 55, 0, 600);
  check(
    'held tilt holds, neutral returns',
    Math.abs(a.x - b.x) < 0.02 && b.x > 0.3 && Math.abs(back.x) < 0.03,
    `after 0.3s x=${f(a.x)} after 3.3s x=${f(b.x)} back at neutral x=${f(back.x)}`
  );
}

// Sensor jitter while still: the aim must not shimmer.
{
  const { aim, clock } = fresh(55, 0);
  const xs = [];
  for (let i = 0; i < 180; i++) {
    clock.t += 1000 / 60;
    xs.push(aim.update(55 + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, clock.t, 0).x);
  }
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  check('still phone with +/-0.4 deg noise is steady', sd < 0.006, `sd=${sd.toFixed(4)} NDC`);
}

// Quick moves are not smeared by the filter.
{
  const { aim, clock } = fresh(55, 0);
  let reached = null;
  for (let i = 0; i < 30; i++) {
    clock.t += 1000 / 60;
    const s = aim.update(55, 10, clock.t, 0);
    if (reached === null && s.x > 0.45) reached = (i + 1) * (1000 / 60);
  }
  check('a sudden 10 deg tilt lands within 120 ms', reached !== null && reached <= 120, `reached 90% at ${reached?.toFixed(0)} ms`);
}

// Edge ratchet: over-tilting and coming back responds at once.
{
  const { aim, clock } = fresh(55, 0);
  const pinned = hold(aim, clock, 55, 40, 500); // well past the range
  const back = hold(aim, clock, 55, 30, 500); // 10 deg back
  check(
    'edge ratchet: tilting back from past the edge moves at once',
    pinned.x === 1 && pinned.x - back.x > 0.2,
    `pinned x=${f(pinned.x)}, x after 10 deg back=${f(back.x)}`
  );
}

// Tipping through upright (beta crosses 90) stays continuous.
{
  const aim = new TiltAim();
  const clock = { t: 0 };
  let prev = null;
  let worst = 0;
  for (let b = 80; b <= 100; b += 0.5) {
    clock.t += 1000 / 60;
    const s = aim.update(b, 3, clock.t, 0);
    if (prev) worst = Math.max(worst, Math.abs(s.x - prev.x) + Math.abs(s.y - prev.y));
    prev = { ...s };
  }
  check('tipping past upright has no jump', worst < 0.06, `largest step=${f(worst)} NDC`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} tilt-aim checks passed`);
process.exit(failed ? 1 : 0);
