/**
 * Proves the studio's remote-motion painting path: a simulated phone player
 * joins, holds the trigger, and sweeps their aim — the studio must render
 * their floating spray can AND paint an arc exactly along the swept path.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
// The first-run welcome guide would cover the stage in a fresh context.
await page.addInitScript(() => {
  try {
    localStorage.setItem('airo:guide:studio', '1');
    localStorage.setItem('airo:guide:controller', '1');
  } catch {}
});

page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' || /CONTEXT LOST/.test(m.text())) console.log('[console]', m.text().slice(0, 400)); });

await page.goto(`${BASE}/canvas/MOTION1?debug`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
await page.waitForFunction(() => typeof window.__airoSim === 'function');
await page.evaluate(() => {
  for (const c of document.querySelectorAll('canvas')) {
    c.addEventListener('webglcontextlost', () => console.log('WEBGL CONTEXT LOST'));
  }
});

const sim = (event, payload) => page.evaluate(([e, p]) => window.__airoSim(e, p), [event, payload]);

// A phone joins in motion (gyro) mode.
await sim('player-list-update', [
  { id: 'sim-phone', slot: 1, name: 'SimPhone', color: '#22D3EE', tool: 'spray', mode: 'motion' },
]);
await page.waitForTimeout(800);

// Trigger down…
await sim('action', { playerId: 'sim-phone', action: 'spray', state: 'start', color: '#22D3EE', size: 1 });

// …and sweep the aim in an arc across the deck (x,y are 0..1 screen space).
// Headless Chromium only produces animation frames when input/compositing
// demands them, so a tiny mouse jiggle rides along to keep the render loop
// (and therefore per-frame painting) alive — exactly as a real display would.
for (let i = 0; i <= 36; i++) {
  const t = i / 36;
  await sim('motion', {
    playerId: 'sim-phone',
    x: 0.34 + 0.34 * t,
    y: 0.56 - Math.sin(t * Math.PI) * 0.07,
  });
  await page.mouse.move(40 + (i % 2), 40);
  await page.waitForTimeout(45);
}
console.log('mid probe:', JSON.stringify(await page.evaluate(() => window.__airoProbe?.())));
for (let i = 0; i < 8; i++) {
  await page.mouse.move(41 + (i % 2), 40);
  await page.waitForTimeout(60);
}
await sim('action', { playerId: 'sim-phone', action: 'spray', state: 'stop' });
await page.waitForTimeout(900);
console.log('end probe:', JSON.stringify(await page.evaluate(() => window.__airoProbe?.())));

await page.screenshot({ path: `${OUT}/verify-motion-paint.png` });
await browser.close();
console.log('motion-paint capture complete');
