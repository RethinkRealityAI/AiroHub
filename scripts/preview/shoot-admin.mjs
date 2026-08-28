import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
for (const [name, vp, mobile] of [['admin-desktop', { width: 1512, height: 950 }, false], ['admin-phone', { width: 393, height: 852 }, true]]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  await page.close();
}
await browser.close();
console.log('admin shots done');
