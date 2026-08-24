/** Holds a spray in one spot — paint should build up and run downward. */
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('scripts/preview/out', { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`${process.env.BASE || 'http://127.0.0.1:4173'}/canvas/DRIPS1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

await page.mouse.move(880, 520);
await page.mouse.down();
for (let i = 0; i < 55; i++) {
  await page.mouse.move(880 + (i % 2) * 0.4, 520, { steps: 1 });
  await page.waitForTimeout(60);
}
await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: 'scripts/preview/out/verify-drips.png' });
await browser.close();
console.log('drips captured');
