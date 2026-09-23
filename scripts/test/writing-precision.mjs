/**
 * Writing-precision suite: can a phone still write its name in the studio?
 *
 * Replays handwriting (a row of joined loops, like cursive "e"s about 60 px
 * tall on a 900 px studio) through the exact path a motion-mode phone's aim
 * takes in the studio: packets on the controller's 25 ms cadence, delivered
 * TCP-style with jitter and bunching, into `InterpolatedCursor` (the jitter
 * buffer), then `SurfacePainter` once per 60 Hz frame against a flat panel
 * framed like the studio camera frames a model.
 *
 * Deterministic (seeded jitter, simulated clock, no GPU), so it measures the
 * pipeline rather than the machine. Measured against the ideal path, in
 * screen pixels at a 900 px tall studio:
 *   core     opacity-weighted median distance of paint from the path
 *   width    opacity-weighted 90th percentile (how wide the line reads)
 *   gaps     share of the path with no paint within 3 px of it
 *   trace    90th-percentile distance of the aim itself (the jitter buffer's
 *            output, before any spray scatter) from the path
 *
 * Runs two network scenarios: jitter only, and jitter plus periodic stalls.
 * PAINTER=<path to a SurfacePainter.ts> swaps the painter, for A/B runs
 * against an older revision.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Run both network scenarios, each in its own process (the painter's scatter
// draws on a seeded Math.random, so the runs must not share one).
if (!process.env.SCENARIO) {
  let failed = 0;
  for (const scenario of ['jitter', 'stalls']) {
    console.log(`-- ${scenario}`);
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: { ...process.env, SCENARIO: scenario },
    });
    if (run.status !== 0) failed++;
  }
  process.exit(failed ? 1 : 0);
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airo-writing-'));
const entry = path.join(outDir, 'entry.ts');
const painterPath = process.env.PAINTER
  ? path.resolve(process.env.PAINTER)
  : path.join(repo, 'src/scene/SurfacePainter.ts');
fs.writeFileSync(
  entry,
  `export { SurfacePainter } from ${JSON.stringify(painterPath)};
   export { InterpolatedCursor } from ${JSON.stringify(path.join(repo, 'src/utils/motion.ts'))};
   export * as THREE from 'three';`
);
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  outfile: path.join(outDir, 'bundle.mjs'),
  logLevel: 'error',
  nodePaths: [path.join(repo, 'node_modules')],
});
globalThis.screen = { orientation: { angle: 0 } };
globalThis.window = {};
const { SurfacePainter, InterpolatedCursor, THREE } = await import(
  pathToFileURL(path.join(outDir, 'bundle.mjs')).href
);

// Seeded RNG, installed over Math.random so the painter's scatter repeats.
let seed = 12345;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
Math.random = rand;

const W = 1400;
const H = 900;
const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
camera.position.set(0, 0, 17);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
// A 16 x 16 panel with one UV chart, at about the texel density the
// generated models carry (2048 px over 16 units = 128 texels per unit).
const panel = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial());
panel.updateMatrixWorld(true);

const painter = new SurfacePainter(
  () => [panel],
  () => camera,
  () => H
);

/** Handwriting: joined loops across the middle of the view, 0..1 screen. */
function pathAt(t) {
  const loops = 7;
  const a = 2 * Math.PI * loops * t;
  return { x: 0.36 + 0.28 * t - 0.012 * Math.sin(a), y: 0.5 - 0.033 * Math.cos(a) };
}
const DURATION = 3600;
const CADENCE = 25;
const FRAME = 1000 / 60;

// Packets: sent every 25 ms, delivered with random latency but in order.
const packets = [];
let lastDelivery = 0;
// The "stalls" scenario adds a 150 ms delivery stall every ~700 ms, like a
// congested Wi-Fi hop, on top of the jitter.
const STALLS = process.env.SCENARIO === 'stalls';
for (let i = 0; i * CADENCE <= DURATION; i++) {
  const sent = i * CADENCE;
  const stall = STALLS && sent % 700 < 150 ? 150 - (sent % 700) : 0;
  const delivery = Math.max(lastDelivery, sent + stall + rand() * rand() * 60);
  lastDelivery = delivery;
  packets.push({ at: delivery + 1000, ...pathAt(sent / DURATION) });
}

const cursor = new InterpolatedCursor();
const stamps = [];
const aims = [];
let next = 0;
let painting = false;
for (let now = 1000; now <= 1000 + DURATION + 400; now += FRAME) {
  while (next < packets.length && packets[next].at <= now) {
    cursor.push(packets[next].x, packets[next].y, packets[next].at);
    next++;
  }
  const s = cursor.step(now);
  const ndcX = s.x * 2 - 1;
  const ndcY = -(s.y * 2 - 1);
  // Trigger held from the first frame the buffer plays until the path ends.
  if (!painting && next > 0) {
    painter.begin({ tool: 'spray', size: 1 });
    painting = true;
  }
  if (painting && now > 1150 && now < 1000 + DURATION) aims.push([s.x, s.y]);
  const result = painter.frame(ndcX, ndcY, painting, FRAME / 1000);
  stamps.push(...result.stamps);
}
painter.end();

// Ideal path in texture pixels (raycast through the same camera).
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const toUvPx = (sx, sy) => {
  ndc.set(sx * 2 - 1, -(sy * 2 - 1));
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(panel)[0];
  return hit ? [hit.uv.x * 2048, hit.uv.y * 2048] : null;
};
const ideal = [];
for (let i = 0; i <= 3000; i++) {
  const p = pathAt(0.02 + (0.96 * i) / 3000);
  const uv = toUvPx(p.x, p.y);
  if (uv) ideal.push(uv);
}
// Texture px -> screen px at a 900 px tall studio.
const a = toUvPx(0.5, 0.5);
const b = toUvPx(0.5, 0.6);
const texPerScreenPx = Math.abs(b[1] - a[1]) / (0.1 * H);

const dist = (x, y) => {
  let best = Infinity;
  for (const [px, py] of ideal) {
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
};
const weighted = stamps.map((s) => ({
  d: (dist(s.u * 2048, s.v * 2048) + s.r * 0.5) / texPerScreenPx,
  w: s.o * s.r * s.r,
}));
weighted.sort((p, q) => p.d - q.d);
const totalW = weighted.reduce((sum, p) => sum + p.w, 0);
const wpct = (q) => {
  let acc = 0;
  for (const p of weighted) {
    acc += p.w;
    if (acc >= q * totalW) return p.d;
  }
  return NaN;
};
// Gaps: path points with no stamp covering within 3 screen px.
let covered = 0;
const probes = 400;
for (let i = 0; i < probes; i++) {
  const p = pathAt(0.03 + (0.94 * i) / (probes - 1));
  const [ux, uy] = toUvPx(p.x, p.y);
  const reach = 3 * texPerScreenPx;
  if (stamps.some((s) => Math.hypot(s.u * 2048 - ux, s.v * 2048 - uy) <= s.r + reach)) covered++;
}

// Trace: the aim's own distance from the path, in screen px.
const idealScreen = [];
for (let i = 0; i <= 4000; i++) {
  const p = pathAt(i / 4000);
  idealScreen.push([p.x * W, p.y * H]);
}
const traceD = aims
  .map(([x, y]) => {
    let best = Infinity;
    for (const [px, py] of idealScreen) best = Math.min(best, (px - x * W) ** 2 + (py - y * H) ** 2);
    return Math.sqrt(best);
  })
  .sort((p, q) => p - q);

const result = {
  painter: path.relative(repo, painterPath),
  trace: +traceD[Math.floor(traceD.length * 0.9)].toFixed(2),
  stamps: stamps.length,
  core: +wpct(0.5).toFixed(2),
  width: +wpct(0.9).toFixed(2),
  gaps: +(1 - covered / probes).toFixed(3),
};
console.log(JSON.stringify(result));

// Limits: the tuned default stroke people write with sits at core ~5.2 px,
// width ~18.7 px, no gaps, and an aim within ~0.15 px of the path. A soft
// core laid under it (PR #6) moved core to 8.3 px, which these catch.
const LIMITS = { core: 5.6, width: 20, gaps: 0.02, trace: 1 };
const fails = [];
if (!(result.trace <= LIMITS.trace)) fails.push(`trace ${result.trace}px > ${LIMITS.trace}px`);
if (!(result.core <= LIMITS.core)) fails.push(`core ${result.core}px > ${LIMITS.core}px`);
if (!(result.width <= LIMITS.width)) fails.push(`width ${result.width}px > ${LIMITS.width}px`);
if (!(result.gaps <= LIMITS.gaps)) fails.push(`gaps ${result.gaps} > ${LIMITS.gaps}`);
console.log(fails.length ? `FAIL: ${fails.join('; ')}` : 'writing precision checks passed');
process.exit(fails.length ? 1 : 0);
