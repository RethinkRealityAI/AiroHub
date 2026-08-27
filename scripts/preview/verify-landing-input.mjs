/**
 * Landing hero input regression harness.
 *
 * The hero is a miniature of the phone controller, and each input path gets
 * its own check via the ?debug probe (window.__airoHeroProbe):
 *
 *  1. mouse movement wakes the can (not idle) and auto-sprays as it sweeps;
 *  2. a touch on the canvas is a trigger pull: the can moves to the finger,
 *     pressed=true, and intensity rises to a full pull even held still;
 *  3. releasing the touch releases the trigger;
 *  4. synthetic deviceorientation (gyro) events steer the can and auto-spray
 *     while the device rotates — the "spray as you move it" contract;
 *  5. touch travel is felt: a cross-stage finger drag moves the can by a
 *     meaningful fraction of the stage (the original regression was a travel
 *     box so tight that phone drags read as dead).
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

/* ---------------- desktop: mouse ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(`${BASE}/?debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.waitForFunction(() => typeof window.__airoHeroProbe === 'function');

  for (let i = 0; i <= 24; i++) {
    await page.mouse.move(700 + Math.sin(i / 4) * 320, 420 + Math.cos(i / 3) * 180);
    await page.waitForTimeout(40);
  }
  const probe = await page.evaluate(() => window.__airoHeroProbe());
  check(
    'mouse sweep sprays',
    !probe.idle && probe.intensity > 0.2,
    `idle=${probe.idle} intensity=${probe.intensity.toFixed(2)}`
  );
  await page.close();
}

/* ---------------- phone: touch + gyro ---------------- */
{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
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

  // Keep rAF alive between assertions. NOT a mouse jiggle: the hero's
  // window pointermove handler would drag the aim to wherever the phantom
  // mouse sits, stomping the very touch/gyro input under test. Awaiting a
  // rAF from inside the page forces Chromium to produce the frame instead.
  const tick = async (ms) => {
    const steps = Math.ceil(ms / 40);
    for (let i = 0; i < steps; i++) {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
      await page.waitForTimeout(24);
    }
  };

  /* 2: touch press = trigger pull, even held still */
  await touch('touchstart', 195, 480);
  await tick(900);
  const held = await page.evaluate(() => window.__airoHeroProbe());
  check(
    'touch hold sprays',
    held.pressed && held.intensity > 0.6 && !held.idle,
    `pressed=${held.pressed} intensity=${held.intensity.toFixed(2)}`
  );

  /* 5: drag travel is felt */
  const beforeDrag = await page.evaluate(() => window.__airoHeroProbe());
  for (let i = 0; i <= 12; i++) {
    await touch('touchmove', 60 + i * 22, 480);
    await tick(50);
  }
  await tick(500); // let the spring settle onto the final target
  const afterDrag = await page.evaluate(() => window.__airoHeroProbe());
  const travel = Math.abs(afterDrag.x - beforeDrag.x);
  check('touch drag moves the can', travel > 0.4, `travel=${travel.toFixed(2)} world units`);

  /* 3: release */
  await touch('touchend', 324, 480);
  await tick(300);
  const released = await page.evaluate(() => window.__airoHeroProbe());
  check('touch release lifts trigger', !released.pressed, `pressed=${released.pressed}`);

  /* 4: gyro steers and auto-sprays */
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
    await tick(30);
  }
  const gyroBefore = await page.evaluate(() => window.__airoHeroProbe());
  // Sample mid-sweep: intensity naturally decays as the sine decelerates, so
  // the honest metric is the peak while the device is actually rotating.
  let gyroPeak = 0;
  let gyroMaxDx = 0;
  for (let i = 0; i <= 30; i++) {
    await fire(Math.sin(i / 5) * 24, 85, 0);
    await tick(30);
    if (i % 3 === 0) {
      const s = await page.evaluate(() => window.__airoHeroProbe());
      gyroPeak = Math.max(gyroPeak, s.intensity);
      gyroMaxDx = Math.max(gyroMaxDx, Math.abs(s.x - gyroBefore.x));
    }
  }
  const gyroAfter = await page.evaluate(() => window.__airoHeroProbe());
  check(
    'gyro steers and sprays',
    !gyroAfter.idle && gyroMaxDx > 0.1 && gyroPeak > 0.2,
    `idle=${gyroAfter.idle} peak dx=${gyroMaxDx.toFixed(2)} peak intensity=${gyroPeak.toFixed(2)}`
  );

  await page.screenshot({ path: 'scripts/preview/out/landing-touch-gyro.png' });
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} landing input checks passed`);
process.exit(failed.length ? 1 : 0);
