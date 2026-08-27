/**
 * Landing hero input regression harness.
 *
 * The hero is a miniature of the phone controller, and each input path gets
 * its own check via the ?debug probe (window.__airoHeroProbe):
 *
 *  1. mouse movement wakes the can (not idle) and auto-sprays as it sweeps;
 *  2. the follow is *absolute*: after a move-and-hold the aim point sits on
 *     the mouse itself (aimScreenX/aimScreenY, canvas-relative 0..1, y down),
 *     not in a stage box of its own — the whole point of the round;
 *  3. a touch on the canvas is a trigger pull: the aim lands on the finger,
 *     pressed=true, and intensity rises to a full pull even held still;
 *  4. a cross-stage drag carries the aim to the finger's endpoint and covers
 *     the travel between (a tight box reads as "nothing happened" on a phone);
 *  5. releasing the touch releases the trigger;
 *  6. synthetic deviceorientation (gyro) events steer the can and auto-spray
 *     while the device rotates — relative, since a phone has no pointer.
 *
 * Harness rules, each learned the hard way:
 *  · keep the render loop alive by awaiting rAF from inside the page. NEVER
 *    jiggle the mouse to force frames: the hero's window pointermove handler
 *    would drag the aim onto the phantom cursor and stomp the touch or gyro
 *    input under test;
 *  · give the spring time to settle before sampling a position;
 *  · sample intensity mid-gesture — it decays as a sweep decelerates.
 *
 * Env: BASE, CHROME_BIN, DESKTOP=WxH (wide viewport), SHOT_DIR.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const SHOT_DIR = process.env.SHOT_DIR || 'scripts/preview/out';
const [DESKTOP_W, DESKTOP_H] = (process.env.DESKTOP || '1400x900').split('x').map(Number);
/** Canvas-relative slop on the aim point — roughly a fingertip on a phone. */
const TOL = 0.07;

mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const probe = (page) => page.evaluate(() => window.__airoHeroProbe());

/**
 * Advance the hero by `ms` of its own clock, pumping rAF from inside the page
 * so Chromium actually produces the frames. NOT a mouse jiggle: the hero's
 * window pointermove handler would drag the aim to wherever the phantom mouse
 * sits, stomping the very input under test. The chain runs in-page rather than
 * one round trip per frame: swiftshader renders this scene at ~2 fps, so a
 * driver-side loop of "await one rAF, sleep" stretches a 600ms settle into
 * several seconds of wall clock, the 2.5s idle window expires, and the hero
 * hands the can back to its drift halfway through the assertion.
 */
const tick = (page, ms) =>
  page.evaluate(
    (budget) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        const step = () => {
          if (performance.now() - t0 >= budget) resolve(undefined);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    ms
  );

/**
 * Pump frames until the aim point stops moving, or `maxFrames` runs out.
 * Duration is the wrong unit for "let the spring settle": the hero clamps its
 * frame delta at 50ms, so on a renderer producing 2 fps a second of wall clock
 * buys a tenth of a second of simulation and the assertion samples a can still
 * in flight. Only safe while the trigger is held — an unpressed pointer would
 * cross the idle window while this waits.
 */
const settle = (page, maxFrames = 40) =>
  page.evaluate(
    (cap) =>
      new Promise((resolve) => {
        let last = null;
        let still = 0;
        let frames = 0;
        const step = () => {
          const p = window.__airoHeroProbe();
          if (last && Math.hypot(p.aimScreenX - last[0], p.aimScreenY - last[1]) < 0.002) still++;
          else still = 0;
          last = [p.aimScreenX, p.aimScreenY];
          if (still >= 3 || ++frames >= cap) resolve(frames);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    maxFrames
  );

const near = (probeState, u, v) =>
  Math.abs(probeState.aimScreenX - u) <= TOL && Math.abs(probeState.aimScreenY - v) <= TOL;

/** Tolerant of a probe that has no aim fields at all, so a build predating
 *  them reports a readable FAIL instead of throwing. */
const f = (value) => (typeof value === 'number' ? value.toFixed(3) : String(value));
const at = (probeState) => `aim=(${f(probeState.aimScreenX)}, ${f(probeState.aimScreenY)})`;

/* ---------------- desktop: mouse ---------------- */
{
  const page = await browser.newPage({ viewport: { width: DESKTOP_W, height: DESKTOP_H } });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(`${BASE}/?debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.waitForFunction(() => typeof window.__airoHeroProbe === 'function');

  /* 1: a sweep wakes the can and sprays */
  for (let i = 0; i <= 24; i++) {
    await page.mouse.move(
      DESKTOP_W * (0.5 + Math.sin(i / 4) * 0.23),
      DESKTOP_H * (0.47 + Math.cos(i / 3) * 0.2)
    );
    await page.waitForTimeout(40);
  }
  const swept = await probe(page);
  check(
    'mouse sweep sprays',
    !swept.idle && swept.intensity > 0.2,
    `idle=${swept.idle} intensity=${swept.intensity.toFixed(2)}`
  );

  /* 2: absolute follow — the aim ends up under the mouse, wherever that is */
  const U = 0.72;
  const V = 0.3;
  await page.mouse.move(DESKTOP_W * U, DESKTOP_H * V, { steps: 12 });
  await tick(page, 600);
  const held = await probe(page);
  check(
    'mouse hold aims at the pointer',
    near(held, U, V) && held.intensity > 0.2 && !held.idle,
    `${at(held)} want=(${U}, ${V}) intensity=${held.intensity.toFixed(2)} idle=${held.idle}`
  );

  await page.screenshot({ path: path.join(SHOT_DIR, `landing-mouse-${DESKTOP_W}x${DESKTOP_H}.png`) });
  await page.close();
}

/* ---------------- phone: touch + gyro ---------------- */
{
  const W = 390;
  const H = 844;
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    hasTouch: true,
    isMobile: true,
  });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(`${BASE}/?debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.waitForFunction(() => typeof window.__airoHeroProbe === 'function');

  const touch = (type, x, y) =>
    page.evaluate(
      ([t, px, py]) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return false;
        const touchInit = new Touch({
          identifier: 1,
          target: canvas,
          clientX: px,
          clientY: py,
        });
        canvas.dispatchEvent(
          new TouchEvent(t, {
            touches: t === 'touchend' ? [] : [touchInit],
            changedTouches: [touchInit],
            bubbles: true,
            cancelable: true,
          })
        );
        return true;
      },
      [type, x, y]
    );

  /* 3: touch press = trigger pull at the finger, even held still */
  const U0 = 0.25;
  const V0 = 0.65;
  await touch('touchstart', W * U0, H * V0);
  await tick(page, 900); // intensity has to build as well as the position
  await settle(page);
  const held = await probe(page);
  check(
    'touch hold sprays at the finger',
    held.pressed && held.intensity > 0.6 && !held.idle && near(held, U0, V0),
    `${at(held)} want=(${U0}, ${V0}) pressed=${held.pressed} intensity=${held.intensity.toFixed(2)}`
  );

  /* 4: a drag lands on the endpoint, and covers the ground between */
  const U1 = 0.75;
  const V1 = 0.4;
  for (let i = 1; i <= 12; i++) {
    const k = i / 12;
    await touch('touchmove', W * (U0 + (U1 - U0) * k), H * (V0 + (V1 - V0) * k));
    await tick(page, 50);
  }
  await settle(page); // land on the final target before reading the endpoint
  const dragged = await probe(page);
  const travel = Math.hypot(dragged.aimScreenX - held.aimScreenX, dragged.aimScreenY - held.aimScreenY);
  check(
    'touch drag tracks the finger',
    near(dragged, U1, V1) && travel > 0.4,
    `${at(dragged)} want=(${U1}, ${V1}) travel=${travel.toFixed(3)} of the canvas`
  );

  /* 5: release */
  await touch('touchend', W * U1, H * V1);
  await tick(page, 300);
  const released = await probe(page);
  check('touch release lifts trigger', !released.pressed, `pressed=${released.pressed}`);

  /* 6: gyro steers (relative) and auto-sprays */
  const fire = (alpha, beta, gamma) =>
    page.evaluate(
      ([a, b, g]) => {
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: b, gamma: g })
        );
      },
      [alpha, beta, gamma]
    );
  // settle a reference pose, then sweep alpha (world yaw) back and forth
  for (let i = 0; i < 10; i++) {
    await fire(0, 85, 0);
    await tick(page, 30);
  }
  const gyroBefore = await probe(page);
  // Sample mid-sweep: intensity naturally decays as the sine decelerates, so
  // the honest metric is the peak while the device is actually rotating.
  let gyroPeak = 0;
  let gyroMaxDx = 0;
  for (let i = 0; i <= 30; i++) {
    await fire(Math.sin(i / 5) * 24, 85, 0);
    await tick(page, 30);
    if (i % 3 === 0) {
      const s = await probe(page);
      gyroPeak = Math.max(gyroPeak, s.intensity);
      gyroMaxDx = Math.max(gyroMaxDx, Math.abs(s.aimScreenX - gyroBefore.aimScreenX));
    }
  }
  const gyroAfter = await probe(page);
  check(
    'gyro steers and sprays',
    !gyroAfter.idle && gyroMaxDx > 0.04 && gyroPeak > 0.2,
    `idle=${gyroAfter.idle} peak dx=${gyroMaxDx.toFixed(3)} peak intensity=${gyroPeak.toFixed(2)}`
  );

  await page.screenshot({ path: path.join(SHOT_DIR, 'landing-touch-gyro.png') });
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} landing input checks passed`);
process.exit(failed.length ? 1 : 0);
