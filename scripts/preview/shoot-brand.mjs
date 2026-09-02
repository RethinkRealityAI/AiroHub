/**
 * Landing page + studio welcome/brand screenshot harness.
 *
 *   BASE=http://127.0.0.1:4173 node scripts/preview/shoot-brand.mjs
 *
 * It also bakes one shipped asset rather than a review screenshot: the
 * `hero-poster` shot writes public/ui/hero-poster.webp, the still frame the
 * landing paints into its stage container while the (now lazily imported)
 * LandingHero and its three.js chunk are still streaming in. Capturing it from
 * the real scene is the whole point — a hand-drawn placeholder would drift the
 * moment the hero changes, and the handover from poster to live canvas is only
 * invisible if the two agree.
 *
 * ONLY=hero-poster picks a single shot, so the poster can be re-baked against a
 * dev server without booting the studio blocks:
 *
 *   ONLY=hero-poster BASE=http://127.0.0.1:5182 node scripts/preview/shoot-brand.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(OUT, { recursive: true });
const problems = [];

/** Shot filter. Unset (the default) runs everything, as it always has. */
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const want = (name) => ONLY.length === 0 || ONLY.includes(name);

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
if (want('landing-desktop')) {
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
if (want('landing-phone')) {
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

/* ---------------- landing: the shipped hero poster ---------------- */
if (want('hero-poster')) {
  const sharp = (await import('sharp')).default;
  // 1600x1000 at scale 1 is the landing screenshot's own aspect and lands the
  // file at exactly the ~1600w the poster is used at; the stage container is
  // `background-size: cover`, so any viewport crops into this rather than
  // stretching it.
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  wire(page, 'hero-poster');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(3500);

  // A short sweep so the wall carries real paint — an untouched first frame is
  // a bare concrete slab, which is a poor thing to hold the page on.
  for (const [x, y] of [[1180, 340], [1320, 470], [1080, 620], [900, 500], [1240, 380]]) {
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(x + i * 3, y + Math.sin(i) * 8, { steps: 2 });
      await page.waitForTimeout(50);
    }
  }
  // Then hand it back: after IDLE_AFTER_MS the can eases home to its stage
  // anchor and resumes the drift, which is the composed frame we want.
  await page.waitForTimeout(4200);

  // The poster sits *under* the washes and the overlay UI in the real page, so
  // it must contain neither. `[data-hero-stage]` is the landing's own marker on
  // the container the canvas lives in (R3F puts two wrapper divs between them,
  // so walking up from the canvas would stop short); hiding that container's
  // siblings removes the washes and the whole overlay in one go, and the
  // explicit false makes a DOM change fail loudly instead of baking the UI in.
  const stripped = await page.evaluate(() => {
    const stage = document.querySelector('[data-hero-stage]');
    const root = stage?.parentElement;
    if (!stage || !root) return false;
    for (const sibling of Array.from(root.children)) {
      if (sibling !== stage) sibling.style.display = 'none';
    }
    // The poster is what shows *before* the canvas paints, so it must not
    // photograph itself.
    stage.style.backgroundImage = 'none';
    return true;
  });
  if (!stripped) {
    problems.push('[hero-poster] could not isolate [data-hero-stage] — landing DOM changed?');
  }

  const png = await page.locator('canvas').first().screenshot();
  fs.mkdirSync('public/ui', { recursive: true });
  await sharp(png).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toFile('public/ui/hero-poster.webp');
  const meta = await sharp('public/ui/hero-poster.webp').metadata();
  const { size } = fs.statSync('public/ui/hero-poster.webp');
  console.log(`hero-poster  ${meta.width}x${meta.height}  ${(size / 1024).toFixed(1)} kB  -> public/ui/hero-poster.webp`);
  await page.close();
}

/* ---------------- studio: welcome guide + painted chrome ---------------- */
if (want('studio')) {
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
