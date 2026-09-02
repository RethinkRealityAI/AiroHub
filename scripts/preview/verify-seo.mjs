/**
 * SEO/GEO verification — proves the two indexable routes really carry their own
 * head, and that the structured data on them is not a lie.
 *
 * The site is a client-rendered SPA on Netlify with no SSR, so every route used
 * to soft-200 onto the landing page's HTML: /how-it-works inherited the landing
 * title, description and (absent) canonical, and `twitter:card` declared a
 * large image with no image behind it. The fix is a static multi-entry build —
 * how-it-works/index.html is a second Vite input — plus a redirect above the SPA
 * catch-all. All of that is invisible to a normal browser and therefore exactly
 * the kind of thing that rots silently, which is what this harness is for.
 *
 * What it locks in, per indexable route:
 *  - exactly one <title> in <head>, and the two routes do not share one;
 *  - exactly one <link rel="canonical">, absolute;
 *  - the full OG/Twitter card set is present and non-empty;
 *  - og:image is an absolute URL *and* the file it names really ships;
 *  - every application/ld+json block parses, and the block the route needs
 *    (WebApplication on /, FAQPage on the guide) is there;
 *  - THE HONESTY CHECK: every FAQPage question and answer string appears
 *    verbatim in the page's rendered text. Structured data that is not on the
 *    page is the one piece of SEO work search engines actively punish, and the
 *    JSON-LD lives in a static HTML file while the copy lives in a React
 *    component, so nothing but this check keeps the two in step;
 *  - a <noscript> with real content, since a crawler that does not run the
 *    bundle otherwise sees an empty #root.
 *
 * And, separately, that /canvas/:id still falls back to the app shell — the new
 * /how-it-works redirect sits above the SPA catch-all, and getting that ordering
 * wrong would break every room link in the product.
 *
 * og:image is checked in two halves on purpose. The tag must be absolute
 * (unfurlers fetch it with no document base), so it points at the production
 * host — which says nothing about the build under test. The file is therefore
 * fetched from BASE by pathname: that is what proves the asset actually ships.
 *
 * Usage:  npm run build && npx vite preview --port 4174
 *         BASE=http://127.0.0.1:4174 CHROME_BIN=/opt/pw-browsers/chromium \
 *           node scripts/preview/verify-seo.mjs
 */
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

/** Whitespace between the JSON-LD and the DOM is not meaningful; the words are. */
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

const problems = [];

/**
 * Same ignore list as shoot-ui.mjs: software rendering chatter is an artefact
 * of the headless runner, and supabase-js falls back to HTTP broadcast when the
 * sandbox blocks its WebSocket. Google Fonts is added here because these pages
 * link a stylesheet from fonts.googleapis.com and the runner has no direct
 * egress — the font is a decoration, not something this harness is testing.
 */
const IGNORE_CONSOLE = /WebGL|SwiftShader|GPU stall|Automatic fallback|fonts\.googleapis|fonts\.gstatic/i;
const IGNORE_REQUEST = /favicon|supabase\.co|fonts\.googleapis|fonts\.gstatic/i;

function wire(page, label) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // A failed subresource logs only "Failed to load resource: net::ERR_…" —
    // the URL that failed is in location(), so filtering on the text alone
    // would either miss it or force a blanket ignore of every network error.
    const url = msg.location()?.url || '';
    if (IGNORE_CONSOLE.test(text) || IGNORE_REQUEST.test(url)) return;
    problems.push(`[${label}] console: ${text.slice(0, 200)}${url ? ` <- ${url.slice(0, 120)}` : ''}`);
  });
  page.on('pageerror', (err) => problems.push(`[${label}] pageerror: ${String(err).slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    if (IGNORE_REQUEST.test(req.url())) return;
    problems.push(`[${label}] request failed: ${req.url().slice(0, 140)}`);
  });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

/** Everything a crawler reads out of one document. */
async function readHead(page) {
  return page.evaluate(() => {
    const meta = (sel) => document.head.querySelector(sel)?.getAttribute('content') ?? null;
    return {
      titles: Array.from(document.head.querySelectorAll('title')).map((t) => t.textContent || ''),
      canonicals: Array.from(document.head.querySelectorAll('link[rel="canonical"]')).map((l) =>
        l.getAttribute('href')
      ),
      description: meta('meta[name="description"]'),
      og: {
        title: meta('meta[property="og:title"]'),
        description: meta('meta[property="og:description"]'),
        type: meta('meta[property="og:type"]'),
        url: meta('meta[property="og:url"]'),
        siteName: meta('meta[property="og:site_name"]'),
        image: meta('meta[property="og:image"]'),
        imageAlt: meta('meta[property="og:image:alt"]'),
      },
      twitter: {
        card: meta('meta[name="twitter:card"]'),
        title: meta('meta[name="twitter:title"]'),
        description: meta('meta[name="twitter:description"]'),
        image: meta('meta[name="twitter:image"]'),
      },
      ld: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
        (s) => s.textContent || ''
      ),
      noscript: document.querySelector('noscript')?.textContent ?? null,
      noscriptHtml: document.querySelector('noscript')?.innerHTML ?? '',
    };
  });
}

const ROUTES = [
  { path: '/', label: 'landing', ldType: 'WebApplication' },
  { path: '/how-it-works', label: 'guide', ldType: 'FAQPage' },
];

const titlesSeen = new Map();

for (const route of ROUTES) {
  console.log(`\n== ${route.path} ==`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  wire(page, route.label);

  const response = await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' });
  check(`${route.path} responds 200`, response?.status() === 200, `status ${response?.status()}`);

  const head = await readHead(page);

  check(`${route.path} has exactly one <title>`, head.titles.length === 1, JSON.stringify(head.titles));
  const title = head.titles[0] || '';
  check(`${route.path} title is non-empty`, flat(title).length > 0, JSON.stringify(title));
  titlesSeen.set(route.path, flat(title));

  check(
    `${route.path} has exactly one canonical`,
    head.canonicals.length === 1,
    JSON.stringify(head.canonicals)
  );
  const canonical = head.canonicals[0] || '';
  check(
    `${route.path} canonical is absolute and points at this route`,
    /^https:\/\//.test(canonical) && new URL(canonical).pathname.replace(/\/$/, '') === route.path.replace(/\/$/, ''),
    canonical
  );

  check(`${route.path} has a meta description`, flat(head.description || '').length > 40, `${flat(head.description || '').length} chars`);

  // The whole card, not just the half that used to be here.
  const cardFields = [
    ['og:title', head.og.title],
    ['og:description', head.og.description],
    ['og:type', head.og.type],
    ['og:url', head.og.url],
    ['og:site_name', head.og.siteName],
    ['og:image', head.og.image],
    ['og:image:alt', head.og.imageAlt],
    ['twitter:card', head.twitter.card],
    ['twitter:title', head.twitter.title],
    ['twitter:description', head.twitter.description],
    ['twitter:image', head.twitter.image],
  ];
  const missing = cardFields.filter(([, v]) => !v || !flat(v)).map(([k]) => k);
  check(`${route.path} carries the full OG/Twitter card`, missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${cardFields.length} tags`);

  // Absolute for the crawler...
  const ogImage = head.og.image || '';
  let ogPath = null;
  try {
    ogPath = new URL(ogImage).pathname;
  } catch {
    /* handled by the check below */
  }
  check(`${route.path} og:image is an absolute https URL`, /^https:\/\//.test(ogImage), ogImage);
  check(
    `${route.path} twitter:image matches og:image`,
    head.twitter.image === ogImage,
    head.twitter.image || ''
  );

  // ...and really present in this build.
  if (ogPath) {
    const res = await page.request.get(`${BASE}${ogPath}`);
    const type = res.headers()['content-type'] || '';
    check(
      `${route.path} og:image resolves (${ogPath})`,
      res.status() === 200 && /^image\//.test(type),
      `status ${res.status()} type ${type || 'none'}`
    );
  } else {
    check(`${route.path} og:image resolves`, false, 'og:image is not a URL');
  }

  // ---- structured data
  check(`${route.path} has at least one ld+json block`, head.ld.length > 0, `${head.ld.length} block(s)`);
  const parsed = [];
  let allParsed = true;
  for (const [i, raw] of head.ld.entries()) {
    try {
      const value = JSON.parse(raw);
      parsed.push(value);
      if (typeof value['@type'] !== 'string') {
        allParsed = false;
        console.log(`      block ${i} has no string @type`);
      }
    } catch (err) {
      allParsed = false;
      console.log(`      block ${i} failed to parse: ${String(err).slice(0, 120)}`);
    }
  }
  check(`${route.path} every ld+json block parses with an @type`, allParsed && parsed.length === head.ld.length);
  check(
    `${route.path} declares @type ${route.ldType}`,
    parsed.some((b) => b['@type'] === route.ldType),
    parsed.map((b) => b['@type']).join(', ')
  );

  // ---- noscript: real content, not an apology
  check(
    `${route.path} <noscript> carries real copy and a link`,
    flat(head.noscript || '').length > 120 && /<a\s/i.test(head.noscriptHtml),
    `${flat(head.noscript || '').length} chars`
  );

  // ---- the honesty check
  const faq = parsed.find((b) => b['@type'] === 'FAQPage');
  if (faq) {
    // Bring the whole document into play: the guide reveals sections on scroll,
    // and the FAQ is the last block before the footer.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    const body = flat(await page.evaluate(() => document.body.innerText));

    const questions = (faq.mainEntity || []).filter((q) => q && q['@type'] === 'Question');
    check(`${route.path} FAQPage lists questions`, questions.length > 0, `${questions.length} question(s)`);

    const missingQ = questions.filter((q) => !body.includes(flat(q.name))).map((q) => q.name);
    check(
      `${route.path} every FAQ question appears on the page`,
      missingQ.length === 0,
      missingQ.length ? `missing: ${missingQ.join(' | ')}` : `${questions.length} question(s) matched`
    );

    const missingA = questions
      .filter((q) => !body.includes(flat(q.acceptedAnswer?.text ?? '')))
      .map((q) => q.name);
    check(
      `${route.path} every FAQ answer appears on the page`,
      missingA.length === 0,
      missingA.length ? `answers missing under: ${missingA.join(' | ')}` : `${questions.length} answer(s) matched`
    );
  }

  await context.close();
}

check(
  'the two indexable routes do not share a title',
  titlesSeen.get('/') !== titlesSeen.get('/how-it-works'),
  `${JSON.stringify(titlesSeen.get('/'))} vs ${JSON.stringify(titlesSeen.get('/how-it-works'))}`
);

/* ---------------- the SPA fallback still works ----------------
   Fetched as raw HTTP rather than driven in a browser: what a room link needs
   is for the server to hand back the app shell, and booting a WebGL studio
   under SwiftShader would test the renderer instead of the redirect ordering
   this pass actually changed. */
{
  console.log('\n== /canvas/ZZTEST (SPA fallback) ==');
  const context = await browser.newContext();
  const res = await context.request.get(`${BASE}/canvas/ZZTEST`);
  const html = await res.text();
  check('/canvas/:id responds 200', res.status() === 200, `status ${res.status()}`);
  check('/canvas/:id serves the app shell', /<div id="root">\s*<\/div>/.test(html) && /<script type="module"/.test(html));
  const shellTitle = flat((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
  check(
    '/canvas/:id falls back to the landing document, not the guide',
    shellTitle === titlesSeen.get('/'),
    JSON.stringify(shellTitle)
  );
  await context.close();
}

/* ---------------- crawler plumbing ---------------- */
{
  console.log('\n== crawler files ==');
  const context = await browser.newContext();
  const robots = await context.request.get(`${BASE}/robots.txt`);
  const robotsBody = robots.status() === 200 ? await robots.text() : '';
  check('robots.txt is served', robots.status() === 200, `status ${robots.status()}`);
  check(
    'robots.txt disallows the session routes and names the sitemap',
    ['/canvas/', '/controller/', '/admin'].every((p) => robotsBody.includes(`Disallow: ${p}`)) &&
      /^Sitemap:\s*https:\/\/\S+\/sitemap\.xml$/m.test(robotsBody)
  );

  const sitemap = await context.request.get(`${BASE}/sitemap.xml`);
  const sitemapBody = sitemap.status() === 200 ? await sitemap.text() : '';
  const locs = [...sitemapBody.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check('sitemap.xml is served', sitemap.status() === 200, `status ${sitemap.status()}`);
  check(
    'sitemap lists exactly the two indexable routes',
    locs.length === 2 && locs.some((l) => new URL(l).pathname === '/') && locs.some((l) => new URL(l).pathname === '/how-it-works'),
    locs.join(', ')
  );
  await context.close();
}

await browser.close();

console.log('\n' + '='.repeat(52));
if (problems.length) {
  console.log(`${problems.length} console/page/request problem(s):`);
  for (const p of [...new Set(problems)]) console.log(' ✗ ' + p);
} else {
  console.log('No console errors, page errors or failed requests.');
}

const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} SEO checks passed`);
process.exit(failed.length || problems.length ? 1 : 0);
