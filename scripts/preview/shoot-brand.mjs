/**
 * Landing page + studio welcome/brand screenshot harness.
 *
 *   BASE=http://127.0.0.1:4173 node scripts/preview/shoot-brand.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(OUT, { recursive: true });
const problems = [];

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const wire = (page, label) => {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (/WebGL|SwiftShader|GPU stall|Automatic fallback|supabase|CONNECTION_RESET/i.test(t)) return;
    problems.push(`[${label}] console: ${t.slice(0, 180)}`);
  });
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${String(e).slice(0, 180)}`));
};

/* ---------------- landing: desktop, spray around ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1512, height: 950 }, deviceScaleFactor: 2 });
  wire(page, 'landing-desktop');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  // Sweep the pointer so the can chases and sprays paint onto the backdrop.
  const path = [
    [1100, 300], [1240, 420], [1050, 560], [880, 460], [1000, 320], [1220, 260],
    [1300, 500], [1080, 680], [900, 620], [1150, 380],
  ];
  for (const [x, y] of path) {
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(x + i * 3, y + Math.sin(i) * 8, { steps: 2 });
      await page.waitForTimeout(50);
    }
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/landing-desktop.png` });
  await page.close();
}

/* ---------------- landing: phone ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  wire(page, 'landing-phone');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(120 + (i % 6) * 30, 260 + Math.sin(i / 2) * 90, { steps: 2 });
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/landing-phone.png` });
  await page.close();
}

/* ---------------- studio: welcome guide + painted chrome ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  wire(page, 'studio');
  await page.goto(`${BASE}/canvas/BRAND1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/studio-guide.png` });
  await page.getByText("Let's paint").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/studio-chrome.png` });
  // Invite sheet: paint-title on sheet heading + QR
  await page.getByTitle('Invite players').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/studio-invite.png` });
  await page.close();
}

await browser.close();
if (problems.length) {
  console.error('PROBLEMS:');
  for (const p of problems) console.error(' -', p);
  process.exit(1);
}
console.log('brand screenshots written');
