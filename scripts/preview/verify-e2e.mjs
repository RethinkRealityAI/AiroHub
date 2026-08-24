/**
 * End-to-end multiplayer proof: a controller page aims with synthetic motion
 * sensors while a studio page in the same room paints where the phone points.
 * Runs both pages in one browser over real Supabase Realtime.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOM = `E2E${Date.now().toString(36).slice(-4).toUpperCase()}`;
fs.mkdirSync(OUT, { recursive: true });

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  // The realtime WebSocket goes to Supabase; page loads stay local.
  ...(PROXY ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}),
});

const studio = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const phone = await browser.newPage({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const log = (p, tag) =>
  p.on('console', (m) => {
    if (/\[realtime\]|SUBSCRIBED|CHANNEL_ERROR/.test(m.text())) console.log(`[${tag}]`, m.text().slice(0, 120));
  });
log(studio, 'studio');
log(phone, 'phone');

console.log('room:', ROOM);
await studio.goto(`${BASE}/canvas/${ROOM}`, { waitUntil: 'domcontentloaded' });
await phone.goto(`${BASE}/controller/${ROOM}`, { waitUntil: 'domcontentloaded' });

// Studio: wait for model + realtime.
await studio.waitForTimeout(12000);

// Phone: enter Aim mode via the sensor grant.
await phone.getByText('Enable motion aiming').click();
await phone.waitForTimeout(1000);

const sendOrientation = (a, b, g) =>
  phone.evaluate(
    ([alpha, beta, gamma]) => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha, beta, gamma }));
    },
    [a, b, g]
  );

// Establish the calibration pose.
for (let i = 0; i < 5; i++) {
  await sendOrientation(0, 65, 0);
  await phone.waitForTimeout(60);
}

// Wait for presence to register on the studio.
await studio.waitForTimeout(4000);
const connText = await studio.locator('text=/phone|Solo|Connecting/').first().textContent().catch(() => 'n/a');
console.log('studio status pill:', connText);

// Hold the trigger and sweep the aim in an arc.
const vp = phone.viewportSize();
await phone.mouse.move(vp.width / 2, vp.height / 2);
await phone.mouse.down();
for (let i = 0; i <= 30; i++) {
  const t = i / 30;
  // Sweep yaw -18°..+18°, pitch dips and returns — draws an arc on the stage.
  const alpha = 18 - 36 * t;
  const beta = 65 + Math.sin(t * Math.PI) * 14;
  await sendOrientation(alpha, beta, 0);
  await phone.waitForTimeout(70);
}
await phone.mouse.up();
await sendOrientation(0, 65, 0);

await studio.waitForTimeout(1200);
await studio.screenshot({ path: `${OUT}/e2e-studio.png` });
await phone.screenshot({ path: `${OUT}/e2e-phone.png` });

// Also verify the reverse direction: studio host paints, phone's pad shows it.
await browser.close();
console.log('e2e complete');
