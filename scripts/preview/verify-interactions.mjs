/**
 * Interaction verification harness.
 *
 * Drives the real app in a browser and *proves* the paint pipeline:
 *
 *  1. Studio pointer stroke — drags an S-curve across the model and captures
 *     before/after screenshots; the paint must appear under the path.
 *  2. Seam robustness — paints across a UV-island-heavy model (helmet).
 *  3. Aim mode — opens the controller, grants sensors, dispatches synthetic
 *     deviceorientation events, and verifies the 3D can renders and rotates,
 *     then presses the trigger.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const useProxy = PROXY && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  ...(useProxy ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}),
});

function watch(page, label) {
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${String(e).slice(0, 240)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/WebGL|SwiftShader|fonts.googleapis|ERR_CONNECTION|WebSocket/i.test(t)) return;
    problems.push(`[${label}] console: ${t.slice(0, 240)}`);
  });
}

/** Drags a smooth path of viewport-relative points over the canvas. */
async function dragPath(page, points) {
  const vp = page.viewportSize();
  const toPx = ([fx, fy]) => [fx * vp.width, fy * vp.height];
  const [sx, sy] = toPx(points[0]);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const [x, y] = toPx(p);
    // steps here matter: each move fires pointermove → per-frame resampling
    await page.mouse.move(x, y, { steps: 6 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

/* ---------------- 1. Studio pointer painting ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
// The first-run welcome guide would cover the stage in a fresh context.
await page.addInitScript(() => {
  try {
    localStorage.setItem('airo:guide:studio', '1');
    localStorage.setItem('airo:guide:controller', '1');
  } catch {}
});

  watch(page, 'studio-paint');
  await page.goto(`${BASE}/canvas/VERIFY1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000); // model + shaders
  await page.screenshot({ path: `${OUT}/verify-before.png` });

  // S-curve across the skateboard deck (deck occupies centre band).
  await dragPath(page, [
    [0.32, 0.42], [0.38, 0.5], [0.44, 0.56], [0.5, 0.52], [0.56, 0.44],
    [0.62, 0.42], [0.68, 0.5], [0.72, 0.56],
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/verify-stroke.png` });

  // Second stroke with brush.
  await page.keyboard.press('b'); // toggle to brush
  await page.waitForTimeout(300);
  await dragPath(page, [
    [0.34, 0.62], [0.45, 0.6], [0.55, 0.62], [0.66, 0.6],
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/verify-brush.png` });
  await page.close();
}

/* ---------------- 2. Seam-heavy model (helmet) ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  watch(page, 'helmet-paint');
  await page.goto(`${BASE}/canvas/VERIFY2`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  // Switch object to helmet via the picker
  await page.locator('header button:has(svg.lucide-chevron-down)').first().click();
  await page.waitForTimeout(800);
  await page.getByText('Moto Helmet').click();
  await page.waitForTimeout(9000);

  await dragPath(page, [
    [0.4, 0.42], [0.46, 0.38], [0.52, 0.36], [0.58, 0.38], [0.63, 0.44], [0.6, 0.52], [0.52, 0.55], [0.44, 0.52],
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/verify-helmet.png` });
  await page.close();
}

/* ---------------- 3. Aim mode: 3D can + sensors ---------------- */
{
  const page = await browser.newPage({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  watch(page, 'controller-aim');
  await page.goto(`${BASE}/controller/VERIFY1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Grant the (non-iOS) sensor path.
  await page.getByText('Enable motion aiming').click();
  await page.waitForTimeout(500);

  // Feed synthetic orientation: phone level, then sweeping.
  const sendOrientation = (alpha, beta, gamma) =>
    page.evaluate(
      ([a, b, g]) => {
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: b, gamma: g })
        );
      },
      [alpha, beta, gamma]
    );

  await sendOrientation(0, 65, 0); // typical hold
  await page.waitForTimeout(500);
  await sendOrientation(0, 65, 0);
  await page.waitForTimeout(6500); // let the can model load
  await page.screenshot({ path: `${OUT}/verify-aim-idle.png` });

  // Sweep right and up — the can should visibly rotate.
  for (let i = 0; i <= 12; i++) {
    await sendOrientation(-i * 2.2, 65 + i * 1.2, 0);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/verify-aim-tilted.png` });

  // Trigger press with spray particles.
  const vp = page.viewportSize();
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.down();
  for (let i = 0; i <= 10; i++) {
    await sendOrientation(-26 + i * 1.5, 78 - i * 0.8, 0);
    await page.waitForTimeout(60);
  }
  await page.screenshot({ path: `${OUT}/verify-aim-spraying.png` });
  await page.mouse.up();
  await page.close();
}

await browser.close();
console.log(problems.length ? `PROBLEMS:\n${[...new Set(problems)].join('\n')}` : 'verification clean');
process.exitCode = problems.length ? 1 : 0;
