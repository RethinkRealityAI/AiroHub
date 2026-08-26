/**
 * Aim-tracking regression suite.
 *
 * Locks in the properties that make the remote can feel like a mouse. Each
 * check encodes a symptom that has actually been reported and fixed — if one
 * fails, the matching feel regression WILL be noticeable on a phone:
 *
 *  A/B  handedness + sensitivity of yaw/pitch (cursor direction parity)
 *  C    rolled-grip cross-axis bleed ("I go up and it drifts sideways")
 *  C2   pure roll twist must not move the cursor
 *  D    hold steadiness under sensor noise (shimmer while aiming still)
 *  E    flick reach and no post-flick creep
 *  F    trigger-press kick suppression (tap wobble entering the integrator)
 *  G/H  receive-side interpolation: bounded steps under delivery jitter,
 *       and faithful path tracking
 *  I    translation assist: sliding the phone still moves the cursor
 *  J    calibrate (and therefore shake-to-recentre) exactly recentres
 *
 * Runs headless: bundles src/utils/motion.ts with esbuild and simulates
 * synthetic DeviceOrientation streams. `npm test` runs it.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airo-aim-'));
const bundle = path.join(outDir, 'motion.mjs');

await build({
  entryPoints: [path.join(repo, 'src/utils/motion.ts')],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  logLevel: 'error',
});

globalThis.screen = { orientation: { angle: 0 } };
globalThis.window = {};

const THREE = await import(
  pathToFileURL(path.join(repo, 'node_modules/three/build/three.module.js')).href
);
const M = await import(pathToFileURL(bundle).href);

const DEG = Math.PI / 180;
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const Q1_INV = Q1.clone().invert();

/** Tool-frame quaternion → the (alpha,beta,gamma) that reproduces it. */
function eulerFromTool(qTool) {
  const D = qTool.clone().multiply(Q1_INV);
  const e = new THREE.Euler().setFromQuaternion(D, 'YXZ');
  return { alpha: e.y / DEG, beta: e.x / DEG, gamma: -e.z / DEG };
}

const RY = (deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * DEG);
const RX = (deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg * DEG);
const RZ = (deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), deg * DEG);

const HZ = 60;
const DT = 1000 / HZ;

function run(tracker, qs, opts = {}) {
  const out = [];
  let t = 1000;
  for (let i = 0; i < qs.length; i++) {
    const { alpha, beta, gamma } = eulerFromTool(qs[i]);
    if (opts.onTick) opts.onTick(tracker, t, i);
    out.push({ t, ...tracker.update(alpha, beta, gamma, t) });
    t += DT;
  }
  return out;
}

const seq = (seconds, fn) => {
  const n = Math.round(seconds * HZ);
  return Array.from({ length: n }, (_, i) => fn(i / (n - 1), i));
};

const makeGauss = (seed) => {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return () => {
    const u = Math.max(rnd(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

/* A: yaw handedness + sensitivity. CCW turn (world +yaw) → cursor LEFT. */
{
  const stream = [...seq(0.8, (u) => RY(10 * u)), ...seq(0.4, () => RY(10))];
  const r = run(new M.AimTracker(), stream);
  const dx = r[r.length - 1].x - 0.5;
  check('A yaw handedness', dx < -0.05 && dx > -0.14, `dx=${dx.toFixed(4)} (expect ~-0.08)`);
}

/* B: pitch handedness + sensitivity. Wrist up → cursor UP (y decreases). */
{
  const stream = [...seq(0.8, (u) => RX(10 * u)), ...seq(0.4, () => RX(10))];
  const r = run(new M.AimTracker(), stream);
  const dy = r[r.length - 1].y - 0.5;
  check('B pitch handedness', dy < -0.05 && dy > -0.14, `dy=${dy.toFixed(4)} (expect ~-0.08)`);
}

/* C: rolled-grip cross-axis bleed. 20° grip roll + pure wrist-pitch stroke. */
{
  const grip = RZ(20);
  const stream = [
    ...seq(0.5, () => grip.clone()),
    ...seq(1.0, (u) => grip.clone().multiply(RX(20 * u))),
    ...seq(0.4, () => grip.clone().multiply(RX(20))),
  ];
  const r = run(new M.AimTracker(), stream);
  const dx = Math.abs(r[r.length - 1].x - 0.5);
  const dy = Math.abs(r[r.length - 1].y - 0.5);
  const bleed = dx / Math.max(dy, 1e-6);
  check('C rolled-grip bleed', bleed < 0.02, `bleed=${(bleed * 100).toFixed(2)}% of stroke (limit 2%)`);
}

/* C2: pure roll twist moves nothing. */
{
  const stream = [...seq(0.4, () => RZ(0)), ...seq(0.8, (u) => RZ(25 * u))];
  const r = run(new M.AimTracker(), stream);
  const d = Math.hypot(r[r.length - 1].x - 0.5, r[r.length - 1].y - 0.5);
  check('C2 roll immunity', d < 0.01, `moved ${(d * 100).toFixed(2)}% of stage (limit 1%)`);
}

/* D: hold steadiness — radial σ under gaussian Euler noise (0.25°, 60Hz). */
{
  const gauss = makeGauss(42);
  const base = eulerFromTool(new THREE.Quaternion());
  const tracker = new M.AimTracker();
  const xs = [];
  const ys = [];
  let t = 1000;
  for (let i = 0; i < 6 * HZ; i++) {
    const s = tracker.update(
      base.alpha + gauss() * 0.25,
      base.beta + gauss() * 0.25,
      base.gamma + gauss() * 0.25,
      (t += DT)
    );
    xs.push(s.x);
    ys.push(s.y);
  }
  const sd = (a) => {
    const v = a.slice(Math.floor(a.length / 2));
    const m = v.reduce((p, c) => p + c, 0) / v.length;
    return Math.sqrt(v.reduce((p, c) => p + (c - m) ** 2, 0) / v.length);
  };
  const radial = Math.hypot(sd(xs), sd(ys));
  check('D hold steadiness', radial < 0.0008, `radial σ=${(radial * 1000).toFixed(2)}‰ (limit 0.8‰)`);
}

/* E: fast flick reaches, then holds without creep. */
{
  const stream = [
    ...seq(0.3, () => RY(0)),
    ...seq(0.2, (u) => RY(-30 * u)),
    ...seq(0.6, () => RY(-30)),
  ];
  const r = run(new M.AimTracker(), stream);
  const dx = r[r.length - 1].x - 0.5;
  const holdStart = Math.round(0.55 * HZ);
  const creep = Math.abs(r[r.length - 1].x - r[r.length - 1 - holdStart + 20].x);
  check(
    'E flick reach',
    dx > 0.22 && dx < 0.46 && creep < 0.01,
    `dx=${dx.toFixed(3)} (expect 0.22-0.46) creep=${creep.toFixed(4)}`
  );
}

/* F: trigger-press wobble must not move the cursor when suppression is armed. */
{
  const wobble = (u) => {
    const a = Math.sin(Math.PI * u) * 1.5;
    return RZ(a).multiply(RX(-a * 0.8));
  };
  const stream = [...seq(0.5, () => RZ(0)), ...seq(0.1, wobble), ...seq(0.4, () => RZ(0))];
  const pressAt = 1000 + 0.5 * HZ * DT - 5;
  const disp = (r) => Math.max(...r.map((s) => Math.hypot(s.x - 0.5, s.y - 0.5)));

  const bare = disp(run(new M.AimTracker(), stream));
  const armed = disp(
    run(new M.AimTracker(), stream, {
      onTick: (tr, t) => {
        if (Math.abs(t - pressAt) < DT / 2) tr.notifyTriggerEdge(true, t);
      },
    })
  );
  check(
    'F press suppression',
    armed < 0.004 && armed < bare,
    `unsuppressed peak=${(bare * 100).toFixed(2)}% suppressed peak=${(armed * 100).toFixed(2)}%`
  );
}

/* G: receive-side interpolation stays smooth under TCP-style delivery jitter. */
{
  const gauss = makeGauss(7);
  const pathX = (t) => 0.5 + 0.25 * Math.sin(2 * Math.PI * 0.5 * (t / 1000));
  const pathY = (t) => 0.5 + 0.18 * Math.cos(2 * Math.PI * 0.35 * (t / 1000));
  const packets = [];
  let prevArrive = 0;
  for (let send = 0; send <= 3000; send += 25) {
    let arrive = send + 40 + Math.abs(gauss()) * 12;
    if (send > 1400 && send < 1490) arrive += 90; // dropout burst
    // One WebSocket = TCP = ordered delivery: bunching, never reordering.
    arrive = Math.max(arrive, prevArrive + 0.1);
    prevArrive = arrive;
    packets.push({ x: pathX(send), y: pathY(send), at: arrive });
  }
  const frameDt = 1000 / 144;
  const idealStep = 0.25 * 2 * Math.PI * 0.5 * (frameDt / 1000);
  const interp = new M.InterpolatedCursor();
  let maxStep = 0;
  let prev = null;
  let qi = 0;
  for (let now = 200; now <= 3100; now += frameDt) {
    while (qi < packets.length && packets[qi].at <= now) {
      interp.push(packets[qi].x, packets[qi].y, packets[qi].at);
      qi++;
    }
    const p = interp.step(now);
    if (prev) maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = { ...p };
  }
  check(
    'G jitter smoothness',
    maxStep < idealStep * 2.6,
    `max step=${maxStep.toFixed(4)} (limit ${(idealStep * 2.6).toFixed(4)})`
  );
}

/* H: interpolation tracks the true path accurately at its fixed delay. */
{
  const pathX = (t) => 0.5 + 0.25 * Math.sin(2 * Math.PI * 0.5 * (t / 1000));
  const interp = new M.InterpolatedCursor();
  const packets = [];
  for (let send = 0; send <= 3000; send += 25) packets.push({ x: pathX(send), at: send + 40 });
  let qi = 0;
  let sum = 0;
  let n = 0;
  for (let now = 200; now <= 2900; now += 1000 / 144) {
    while (qi < packets.length && packets[qi].at <= now) {
      interp.push(packets[qi].x, 0.5, packets[qi].at);
      qi++;
    }
    const p = interp.step(now);
    if (now < 800) continue; // playhead settles first
    const truth = pathX(now - 40 - 90); // transport + interpolation delay
    sum += (p.x - truth) ** 2;
    n++;
  }
  const rms = Math.sqrt(sum / n);
  check('H interp accuracy', rms < 0.01, `rms=${rms.toFixed(4)} of stage width (limit 0.01)`);
}

/* I: translation assist — a rotationally-quiet slide still moves the cursor. */
{
  const tracker = new M.AimTracker();
  const base = eulerFromTool(new THREE.Quaternion());
  let t = 1000;
  for (let i = 0; i < 60; i++) tracker.update(base.alpha, base.beta, base.gamma, (t += DT));
  for (let i = 0; i < 120; i++) {
    tracker.update(base.alpha, base.beta, base.gamma, (t += DT));
    const u = i / 120;
    const ax = u < 0.25 ? 1.4 : u < 0.5 ? -1.4 : 0;
    tracker.addTranslation(ax, 0, 0, DT / 1000);
  }
  const s = tracker.update(base.alpha, base.beta, base.gamma, (t += DT));
  const dx = s.x - 0.5;
  check('I translation assist', dx > 0.05, `slide-right dx=${dx.toFixed(4)} (expect > 0.05)`);
}

/* J: calibrate — and therefore shake-to-recentre — exactly recentres. */
{
  const tracker = new M.AimTracker();
  const stream = [...seq(0.6, (u) => RY(18 * u)), ...seq(0.2, () => RY(18))];
  const r = run(tracker, stream);
  const off = Math.hypot(r[r.length - 1].x - 0.5, r[r.length - 1].y - 0.5);
  tracker.calibrate();
  const { alpha, beta, gamma } = eulerFromTool(RY(18));
  const s = tracker.update(alpha, beta, gamma, 1000 + stream.length * DT + DT);
  const centred = Math.hypot(s.x - 0.5, s.y - 0.5);
  check(
    'J recalibrate recentres',
    off > 0.1 && centred < 0.005,
    `off-centre=${off.toFixed(3)} → after calibrate=${centred.toFixed(4)}`
  );
}

fs.rmSync(outDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} aim regression checks passed`);
process.exit(failed.length ? 1 : 0);
