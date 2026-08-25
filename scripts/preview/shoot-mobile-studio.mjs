import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.addInitScript(() => { try { localStorage.setItem('airo:guide:studio','1'); localStorage.setItem('airo:guide:controller','1'); } catch {} });
await page.goto(`${BASE}/canvas/MOB1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
await page.screenshot({ path: `${OUT}/studio-mobile.png` });
await browser.close();
console.log('done');
