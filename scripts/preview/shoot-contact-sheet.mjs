/** Renders every generated model to a single contact sheet for eyeball checks. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_CATALOG } from '../model-catalog.mjs';

const ROOT = path.resolve('.');
const IDS = MODEL_CATALOG.map((m) => m.id);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/scripts/preview/contact-sheet.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    console.log('404', rel);
    res.writeHead(404); return res.end('nf');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// public/ is served at the web root in the real app; mirror that here.
const origHandler = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
  if (req.url.startsWith('/models/')) {
    const file = path.join(ROOT, 'public', req.url.split('?')[0]);
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
      return fs.createReadStream(file).pipe(res);
    }
  }
  origHandler(req, res);
});

await new Promise((r) => server.listen(4599, r));

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: 2 });
page.on('console', (m) => console.log('[console:'+m.type()+']', m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));

await page.addInitScript((ids) => { window.__IDS__ = ids; }, IDS);
await page.goto('http://127.0.0.1:4599/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__READY__ === true, { timeout: 180000 });
await page.waitForTimeout(800);

fs.mkdirSync('scripts/preview/out', { recursive: true });
await page.locator('#grid').screenshot({ path: 'scripts/preview/out/models.png' });
const failures = await page.locator('.err').allTextContents();
console.log(failures.length ? `FAILURES:\n${failures.join('\n')}` : 'all models rendered');

await browser.close();
server.close();
