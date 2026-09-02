/**
 * Liquid-glass verification — proves the refraction really goes up on the
 * landing card, and really gets out of the way when it cannot.
 *
 * Everything here is a DOM or computed-style assertion. The headless runner
 * paints through SwiftShader, so comparing pixels of a backdrop-filter would be
 * measuring the software rasteriser rather than the feature; what actually needs
 * locking down is the wiring, and the wiring is all readable:
 *
 *  - the panel's computed `backdrop-filter` leads with `url(#airo-lg…)` and
 *    STILL carries its blur, which is the whole safety rule — an inline filter
 *    list that replaced the blur instead of joining it would leave the card a
 *    flat translucent box over the live hero;
 *  - the filter it names exists, interpolates in sRGB (the default linearRGB
 *    would gamma-map the displacement map and halve the effect), and is fed by
 *    a PNG data URL sized to the panel's own border box;
 *  - a viewport resize rebuilds the map exactly once, so the 120ms debounce is
 *    doing its job rather than rastering per frame of a drag;
 *  - with support forced off, the panel has no `url(` at all and keeps its
 *    blur — the shipped design, untouched.
 *
 * Usage:  npx vite --port 5181
 *         BASE=http://127.0.0.1:5181 node scripts/preview/verify-liquid-glass.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:5181';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** The landing action card — the `<GlassPanel strong liquid>` over the hero. */
const PANEL = '.splatter-accent-bl';
/** Comfortably past the hook's 120ms resize debounce. */
const SETTLE_MS = 600;

/**
 * Requests that are somebody else's problem.
 *
 * The sandbox has no direct egress to Google's font CDN, and the app ships a
 * complete system fallback stack behind it (`--font-sans` in index.css), so a
 * webfont that never arrived is a runner artefact rather than a page error.
 * Supabase and favicons are excused for the same reasons shoot-ui.mjs excuses
 * them.
 */
const EXCUSED = /fonts\.(?:googleapis|gstatic)\.com|supabase\.co|favicon/;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const problems = [];

// Chromium does not read HTTPS_PROXY on its own; a local dev server needs no
// proxy at all, so it is only passed through for a remote BASE.
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const useProxy = PROXY && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  ...(useProxy ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}),
});

/** A landing page with error capture wired up, optionally with support denied. */
async function openHome(label, { denySupport = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  if (denySupport) {
    // The gate's first question. Answering no here is indistinguishable from
    // running in a browser that cannot render a filter in a backdrop.
    await page.addInitScript(() => {
      CSS.supports = () => false;
    });
  }

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // WebGL software-rendering chatter is an artefact of the headless runner.
    if (/WebGL|SwiftShader|GPU stall|Automatic fallback/i.test(text)) return;
    if (EXCUSED.test(text) || EXCUSED.test((msg.location() || {}).url || '')) return;
    problems.push(`[${label}] console: ${text.slice(0, 200)}`);
  });
  page.on('pageerror', (err) => problems.push(`[${label}] pageerror: ${String(err).slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    if (EXCUSED.test(req.url())) return;
    problems.push(`[${label}] request failed: ${req.url().slice(0, 140)}`);
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(PANEL, { timeout: 30000 });
  return { context, page };
}

/* ------------------------- the enhanced landing ------------------------- */
{
  const { context, page } = await openHome('home');

  // The hook applies nothing until the map exists, and stamps the element with
  // the filter id at the same moment — so this waits on the real thing.
  await page.waitForSelector('[data-airo-liquid]', { timeout: 30000 });

  const applied = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    const id = el.dataset.airoLiquid;
    const filter = id ? document.getElementById(id) : null;
    const image = filter && filter.querySelector('feImage');
    const displace = filter && filter.querySelector('feDisplacementMap');
    const blur = filter && filter.querySelector('feGaussianBlur');
    const rect = el.getBoundingClientRect();
    const host = filter && filter.closest('svg');
    return {
      id,
      backdrop: getComputedStyle(el).backdropFilter,
      hasFilter: !!filter,
      interpolation: filter && filter.getAttribute('color-interpolation-filters'),
      filterUnits: filter && filter.getAttribute('filterUnits'),
      hostDisplay: host && getComputedStyle(host).display,
      href: image && (image.getAttribute('href') || '').slice(0, 26),
      hrefIsPng: !!image && (image.getAttribute('href') || '').startsWith('data:image/png'),
      imageWidth: image && parseFloat(image.getAttribute('width')),
      imageHeight: image && parseFloat(image.getAttribute('height')),
      preserveAspectRatio: image && image.getAttribute('preserveAspectRatio'),
      channels: displace && [
        displace.getAttribute('xChannelSelector'),
        displace.getAttribute('yChannelSelector'),
      ].join(''),
      scale: displace && parseFloat(displace.getAttribute('scale')),
      blurDeviation: blur && parseFloat(blur.getAttribute('stdDeviation')),
      specularPasses: filter ? filter.querySelectorAll('feSpecularLighting').length : -1,
      panelWidth: rect.width,
      panelHeight: rect.height,
      counters: { ...window.__airoLiquidGlass },
    };
  }, PANEL);

  console.log(`\n  backdrop-filter: ${applied.backdrop}`);
  console.log(`  filter #${applied.id}: feImage ${applied.imageWidth}x${applied.imageHeight} href ${applied.href}…`);
  console.log(`  panel border box: ${applied.panelWidth.toFixed(2)}x${applied.panelHeight.toFixed(2)}`);
  console.log(`  counters: ${JSON.stringify(applied.counters)}\n`);

  // Chromium may serialise the reference as `url("#id")` or absolutise it
  // against the document; either way the refraction has to come first.
  const leadsWithFilter = /^url\(["']?[^"')]*#airo-lg-\d+["']?\)/.test(applied.backdrop);
  check(
    'refraction leads the backdrop chain',
    leadsWithFilter,
    `computed: ${applied.backdrop.slice(0, 90)}`
  );
  check(
    'the class blur survives underneath it',
    applied.backdrop.includes('blur('),
    'an inline chain that dropped the blur would flatten the card'
  );
  check(
    'filter exists and interpolates in sRGB',
    applied.hasFilter && applied.interpolation === 'sRGB' && applied.filterUnits === 'userSpaceOnUse',
    `color-interpolation-filters=${applied.interpolation} filterUnits=${applied.filterUnits}`
  );
  check(
    'host svg is not display:none',
    applied.hostDisplay && applied.hostDisplay !== 'none',
    `display=${applied.hostDisplay} (none would stop the reference resolving)`
  );
  check(
    'feImage is a PNG data URL over the border box',
    applied.hrefIsPng &&
      Math.abs(applied.imageWidth - applied.panelWidth) < 1 &&
      Math.abs(applied.imageHeight - applied.panelHeight) < 1 &&
      applied.preserveAspectRatio === 'none',
    `${applied.href}… ${applied.imageWidth}x${applied.imageHeight} vs ${applied.panelWidth.toFixed(2)}x${applied.panelHeight.toFixed(2)}`
  );
  check(
    'displacement reads R/G at a live scale',
    applied.channels === 'RG' && applied.scale > 0 && applied.blurDeviation === 0.4,
    `channels=${applied.channels} scale=${applied.scale} stdDeviation=${applied.blurDeviation}`
  );
  check(
    'no second specular pass',
    applied.specularPasses === 0,
    'glass-sheen already draws the highlight'
  );
  check(
    'one instance registered',
    applied.counters.instances === 1 && applied.counters.rebuilds >= 1,
    `instances=${applied.counters.instances} rebuilds=${applied.counters.rebuilds} (StrictMode mounts twice)`
  );

  /* A resize has to rebuild the map once — not per frame, not never. The card
     is max-w-[27rem], so the viewport has to go narrow enough to actually
     squeeze it before the observer has anything to report. */
  const before = await page.evaluate(() => window.__airoLiquidGlass.rebuilds);
  await page.setViewportSize({ width: 420, height: 900 });
  // ResizeObserver delivers at the end of a rendering opportunity, and a
  // headless page that has gone quiet is not producing them; pump a few frames
  // by hand before waiting out the debounce, the same way verify-guide-stage
  // has to pump for its scene to advance.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let left = 8;
        const step = () => (--left <= 0 ? resolve(undefined) : requestAnimationFrame(step));
        requestAnimationFrame(step);
      })
  );
  await page.waitForTimeout(SETTLE_MS);
  const after = await page.evaluate(() => window.__airoLiquidGlass.rebuilds);
  const resized = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    const image = document.getElementById(el.dataset.airoLiquid).querySelector('feImage');
    return {
      width: el.getBoundingClientRect().width,
      imageWidth: parseFloat(image.getAttribute('width')),
    };
  }, PANEL);
  check(
    'resize rebuilds exactly once',
    after - before === 1 && Math.abs(resized.imageWidth - resized.width) < 1,
    `rebuilds ${before} -> ${after}, map now ${resized.imageWidth}px for a ${resized.width.toFixed(2)}px card`
  );

  await context.close();
}

/* --------------------------- support denied ---------------------------- */
{
  const { context, page } = await openHome('home/unsupported', { denySupport: true });
  await page.waitForTimeout(SETTLE_MS * 2);

  const fallback = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    return {
      backdrop: getComputedStyle(el).backdropFilter,
      stamped: el.hasAttribute('data-airo-liquid'),
      filters: document.querySelectorAll('filter[id^="airo-lg-"]').length,
      inline: el.style.getPropertyValue('backdrop-filter'),
    };
  }, PANEL);

  console.log(`\n  unsupported backdrop-filter: ${fallback.backdrop}\n`);
  check(
    'no filter reference when unsupported',
    !fallback.backdrop.includes('url(') && !fallback.stamped && fallback.inline === '',
    `computed: ${fallback.backdrop.slice(0, 90)} (stamped=${fallback.stamped})`
  );
  check(
    'the shipped blur is exactly what is left',
    fallback.backdrop.includes('blur('),
    `computed: ${fallback.backdrop.slice(0, 90)}`
  );
  check(
    'nothing was left behind in the defs',
    fallback.filters === 0,
    `${fallback.filters} airo-lg filters in the document`
  );

  await context.close();
}

await browser.close();

if (problems.length) {
  console.log('');
  for (const p of [...new Set(problems)]) console.log(' ✗ ' + p);
}
check('no console, page or request errors', problems.length === 0, `${problems.length} problem(s)`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} liquid-glass checks passed`);
process.exit(failed.length ? 1 : 0);
