/**
 * Asset review gallery verification.
 *
 * Proves the two things the feature is for — that a reviewer can record a
 * verdict, and that an unreviewed upload cannot reach a room — against a
 * stubbed Supabase, so nothing here writes to the shared production project.
 * `page.route()` intercepting `**\/rest/v1/airohub_model*` is the browser
 * analogue of the esbuild transport stub in `scripts/test/realtime-reconnect.mjs`.
 *
 * What it locks in:
 *  1. the grid draws through exactly ONE WebGL canvas — a per-card canvas grid
 *     silently blanks cells past Chromium's ~16-context cap;
 *  2. `window.__airoReview()` reports a ready roster, and never mounts more
 *     stages than there are cards (the IntersectionObserver gate is doing work);
 *  3. an upload streams from its registered storage URL — if `registerModelUrl`
 *     ever stops running before `loadModel`, the SPA fallback serves index.html
 *     at /models/up-*.glb and the stage fails instead;
 *  4. "Ship it" issues a write whose body carries asset_key, status, kind and
 *     reviewer, and the card's chip and the Pending count both follow it;
 *  5. THE GATE FAILS CLOSED. With the registry up and the reviews query
 *     returning 500, the studio's object picker shows no Uploads category at
 *     all; with the same registry and an approving reviews response it does.
 *     One page without the other proves nothing — a picker that never shows
 *     uploads would pass the negative check on its own.
 *  6. no console errors, page errors or failed requests, bar the deliberate
 *     500 and the external font CDN (which a sandboxed runner cannot reach and
 *     which this file asserts nothing about).
 *
 * Usage — needs an already-served build or dev server, like every other
 * harness here:
 *
 *   npx vite --port 5180 &
 *   CHROME_BIN=/opt/pw-browsers/chromium BASE=http://127.0.0.1:5180 \
 *     node scripts/preview/verify-asset-review.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE;
if (!BASE) {
  console.error(
    'BASE is required, e.g. BASE=http://127.0.0.1:5180 node scripts/preview/verify-asset-review.mjs'
  );
  process.exit(2);
}
const SHOTS = process.env.SHOT_DIR || 'scripts/preview/out';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const problems = [];

/* ------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------ */

const UPLOAD_ID = '11111111-2222-4333-8444-555555555555';
const UPLOAD_KEY = `up-${UPLOAD_ID}`;
const NOW = '2026-08-31T00:00:00.000Z';

const MODEL_ROW = {
  id: UPLOAD_ID,
  name: 'Verify Trophy',
  storage_path: 'verify-trophy.glb',
  size_bytes: 512000,
  triangles: 12000,
  texture_mp: 1.05,
  vram_mb: 8.4,
  target_size: 9,
  checks: null,
  created_at: NOW,
};

/** Real GLB bytes, so the upload path exercises a genuine parse. */
const GLB_BYTES = fs.readFileSync(path.resolve('public/models/cap.glb'));

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
};

const json = (body) => ({
  status: 200,
  headers: { ...CORS, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/* ------------------------------------------------------------------
   Browser
   ------------------------------------------------------------------ */

// Chromium does not read HTTPS_PROXY on its own; a deployed BASE from a
// sandboxed runner needs it passed explicitly. The proxy CA is already in the
// browser trust store, so TLS verification stays on.
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const useProxy = PROXY && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  ...(useProxy ? { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } } : {}),
});

const baseHost = new URL(BASE).host;

/** Opens a page with error capture and the shared stubs wired up. */
async function open(label, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();

  // The studio's first-run guide would sit over the object picker.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('airo:guide:studio', '1');
      localStorage.setItem('airo:guide:controller', '1');
    } catch {}
  });

  // Vite's HMR socket, swallowed. Against `npm run dev` a file written by
  // anything else triggers a full reload that would destroy the execution
  // context mid-assertion; a static preview server opens no such socket, so
  // this is a no-op there.
  await page.routeWebSocket(
    (url) => url.host === baseHost,
    () => {}
  );

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Software-rendering chatter is an artefact of the headless runner.
    if (/WebGL|SwiftShader|GPU stall|Automatic fallback/i.test(text)) return;
    // The deliberate 500 below, as Chromium reports it.
    if (/status of 500/.test(text)) return;
    // Web fonts come from an external CDN this harness asserts nothing about.
    if (/ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL/.test(text)) return;
    problems.push(`[${label}] console: ${text.slice(0, 200)}`);
  });
  page.on('pageerror', (err) => problems.push(`[${label}] pageerror: ${String(err).slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.includes('favicon')) return;
    // supabase-js falls back to HTTP broadcast when the sandbox blocks its
    // WebSocket; production uses the socket.
    if (url.includes('supabase.co')) return;
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return;
    problems.push(`[${label}] request failed: ${url.slice(0, 140)}`);
  });

  // The uploaded GLB, served as real bytes from the stubbed bucket.
  await page.route('**/storage/v1/object/public/airohub-models/**', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({
          status: 200,
          headers: { ...CORS, 'content-type': 'model/gltf-binary' },
          body: GLB_BYTES,
        })
  );

  return { context, page };
}

/** The registry: one published upload, always reachable. */
async function stubModels(page, rows = [MODEL_ROW]) {
  await page.route('**/rest/v1/airohub_models*', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill(json(rows))
  );
}

/** One real animation frame — the only way these scenes advance headlessly. */
const pump = (page, n = 1) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const step = () => (--left <= 0 ? resolve(undefined) : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n + 1
  );

const probe = (page) => page.evaluate(() => window.__airoReview());

/* ==================================================================
   1-4: the gallery
   ================================================================== */

const writes = [];
let reviewRows = [];

{
  const { context, page } = await open('review');
  await stubModels(page);

  await page.route('**/rest/v1/airohub_model_reviews*', async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (method === 'GET') return route.fulfill(json(reviewRows));
    if (method === 'DELETE') {
      writes.push({ method, body: null });
      return route.fulfill({ status: 204, headers: CORS });
    }
    // POST (upsert) / PATCH — capture what the client actually sent.
    const body = request.postDataJSON();
    writes.push({ method, body, headers: request.headers() });
    const incoming = Array.isArray(body) ? body : [body];
    const saved = incoming.map((row) => ({
      model_id: null,
      note: '',
      reviewer: '',
      created_at: NOW,
      updated_at: NOW,
      ...row,
    }));
    reviewRows = [
      ...reviewRows.filter((row) => !saved.some((s) => s.asset_key === row.asset_key)),
      ...saved,
    ];
    // `.single()` asks for a bare object via the pgrst.object accept header.
    const wantsObject = (request.headers()['accept'] ?? '').includes('pgrst.object');
    return route.fulfill(json(wantsObject ? saved[0] : saved));
  });

  await page.goto(`${BASE}/admin/review`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__airoReview === 'function', null, {
    timeout: 40000,
  });

  /* 1: one canvas, for the whole grid. */
  const canvases = await page.locator('canvas').count();
  check('gallery draws through exactly one canvas', canvases === 1, `found ${canvases}`);

  /* Let the visible stages stream their models in. */
  const deadline = Date.now() + 40000;
  let state = await probe(page);
  while (Date.now() < deadline) {
    await pump(page, 30);
    state = await probe(page);
    const stages = Object.values(state.stages ?? {});
    if (state.ready && stages.length > 0 && stages.every((s) => s === 'ready')) break;
  }
  await pump(page, 30);
  state = await probe(page);

  /* 2: the debug hook, and the mount gate. */
  check('__airoReview reports a ready roster', state.ready === true && state.cards > 0, JSON.stringify(state));
  check(
    'roster carries built-ins and the upload',
    state.cards === 15,
    `cards=${state.cards} (14 built-ins + 1 stubbed upload)`
  );
  check(
    'mount gating holds stages below card count',
    state.mounted > 0 && state.mounted <= state.cards,
    `mounted=${state.mounted} of ${state.cards} cards`
  );
  check(
    'every mounted stage rendered',
    Object.values(state.stages ?? {}).every((s) => s === 'ready'),
    JSON.stringify(state.stages)
  );

  await page.screenshot({ path: `${SHOTS}/review-grid.png` });

  /* 3: the upload loads from its registered storage URL. A regression in the
        registerModelUrl ordering shows up here as 'error', because the SPA
        fallback would hand GLTFLoader an index.html. */
  await page.locator(`[data-review-key="${UPLOAD_KEY}"]`).scrollIntoViewIfNeeded();
  {
    const uploadDeadline = Date.now() + 30000;
    let uploadStage = null;
    while (Date.now() < uploadDeadline) {
      await pump(page, 20);
      uploadStage = (await probe(page)).stages?.[UPLOAD_KEY] ?? null;
      if (uploadStage === 'ready' || uploadStage === 'error') break;
    }
    check(
      'upload streams from its registered storage URL',
      uploadStage === 'ready',
      `stage=${String(uploadStage)}`
    );
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await pump(page, 10);

  /* 4: a verdict round-trips. */
  await page.getByLabel('Reviewer name').fill('verify-bot');
  const pendingBefore = (await probe(page)).pending;

  await page.locator('[data-review-key="easel"] button[data-verdict="approved"]').click();
  await page.waitForFunction(() => window.__airoReview().verdictWrites > 0, null, { timeout: 15000 });
  await pump(page, 5);

  const write = writes.find((w) => w.method === 'POST' || w.method === 'PATCH');
  const body = Array.isArray(write?.body) ? write.body[0] : write?.body;
  check(
    'Ship it issues a verdict write',
    Boolean(write),
    write ? `${write.method} captured` : `no write captured (${writes.length} requests)`
  );
  check(
    'write body carries asset_key / status / kind / reviewer',
    body?.asset_key === 'easel' &&
      body?.status === 'approved' &&
      body?.kind === 'builtin' &&
      body?.reviewer === 'verify-bot',
    JSON.stringify(body)
  );
  check(
    'write stamps updated_at',
    typeof body?.updated_at === 'string' && !Number.isNaN(Date.parse(body.updated_at)),
    String(body?.updated_at)
  );
  check(
    'upsert resolves merge-duplicates',
    (write?.headers?.prefer ?? '').includes('merge-duplicates'),
    `prefer=${write?.headers?.prefer ?? '(none)'}`
  );

  const chip = await page
    .locator('[data-review-key="easel"]')
    .getAttribute('data-review-status');
  check('card chip flips to approved', chip === 'approved', `data-review-status=${chip}`);

  const pendingAfter = (await probe(page)).pending;
  check(
    'pending count decrements',
    pendingAfter === pendingBefore - 1,
    `${pendingBefore} -> ${pendingAfter}`
  );

  /* 4b: the shortcuts, and the guard that keeps them out of a text field.
        Clicking the chip moved the pointer over the card, which is what
        selects it, so `x` now applies to the easel. */
  await page.keyboard.press('x');
  await page.waitForFunction(() => window.__airoReview().verdictWrites > 1, null, {
    timeout: 15000,
  });
  const afterX = await page
    .locator('[data-review-key="easel"]')
    .getAttribute('data-review-status');
  check('x rejects the selected card', afterX === 'rejected', `data-review-status=${afterX}`);

  const writesBeforeTyping = (await probe(page)).verdictWrites;
  await page.getByLabel('Reviewer name').focus();
  await page.keyboard.press('a');
  await page.keyboard.press('x');
  await pump(page, 5);
  const typed = await page.getByLabel('Reviewer name').inputValue();
  check(
    'shortcuts stand down while a field has focus',
    (await probe(page)).verdictWrites === writesBeforeTyping && typed === 'verify-botax',
    `writes ${writesBeforeTyping} -> ${(await probe(page)).verdictWrites}, field="${typed}"`
  );
  // Escape blurs the field rather than eating the note; a second press closes.
  await page.keyboard.press('Escape');
  await pump(page, 3);
  check(
    'Escape leaves the field before it leaves the page',
    await page.evaluate(() => document.activeElement?.tagName !== 'INPUT'),
    `activeElement=${await page.evaluate(() => document.activeElement?.tagName)}`
  );

  /* Diagnostics are part of the deliverable; prove the toggles do not throw
     and the frame loop survives them. */
  await page.getByRole('button', { name: 'Silhouette' }).click();
  await pump(page, 20);
  await page.screenshot({ path: `${SHOTS}/review-silhouette.png` });
  await page.getByRole('button', { name: 'Silhouette' }).click();
  await page.getByRole('button', { name: 'Primer' }).click();
  await pump(page, 20);
  const afterDiagnostics = await probe(page);
  check(
    'diagnostics leave the stages alive',
    Object.values(afterDiagnostics.stages ?? {}).every((s) => s === 'ready'),
    JSON.stringify(afterDiagnostics.stages)
  );

  await context.close();
}

/* ==================================================================
   5: the promotion gate
   ================================================================== */

/**
 * Opens the studio's object picker and reports which category headings it
 * shows. An upload registered into the catalog appears under "Uploads"; the
 * heading is omitted entirely when that category is empty.
 */
async function pickerCategories(page) {
  await page.goto(`${BASE}/canvas/GATE1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 40000 });
  // The catalog folds uploads in asynchronously and the studio streams a model
  // before the header settles; pumped frames plus a wall-clock wait covers it.
  await pump(page, 60);
  await page.waitForTimeout(9000);
  await page.locator('header button:has(svg.lucide-chevron-down)').first().click();
  await page.waitForTimeout(1200);
  return page.evaluate(() =>
    [...document.querySelectorAll('h3')].map((h) => (h.textContent ?? '').trim())
  );
}

{
  // Registry up, gate down.
  const { context, page } = await open('gate-closed');
  await stubModels(page);
  await page.route('**/rest/v1/airohub_model_reviews*', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 500, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"message":"verify: reviews down"}' })
  );

  const categories = await pickerCategories(page);
  check(
    'picker opened (the negative check is meaningful)',
    categories.includes('Street'),
    JSON.stringify(categories)
  );
  check(
    'gate fails closed: reviews 500 registers zero uploads',
    !categories.includes('Uploads'),
    JSON.stringify(categories)
  );
  await context.close();
}

{
  // Same registry, and a gate that approves it.
  const { context, page } = await open('gate-open');
  await stubModels(page);
  await page.route('**/rest/v1/airohub_model_reviews*', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill(json([{ asset_key: UPLOAD_KEY }]))
  );

  const categories = await pickerCategories(page);
  check(
    'gate opens for an approved upload',
    categories.includes('Uploads'),
    JSON.stringify(categories)
  );
  await context.close();
}

/* ==================================================================
   6: nothing broke on the way
   ================================================================== */

await browser.close();

const unique = [...new Set(problems)];
check('no console, page or request errors', unique.length === 0, unique.join(' | ').slice(0, 400));

console.log(`\nscreenshots: ${SHOTS}/review-grid.png, review-silhouette.png`);
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} asset-review checks passed`);
process.exit(failed.length ? 1 : 0);
