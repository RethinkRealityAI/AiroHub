/**
 * Renders every catalog GLB to public/ui/objects/<id>.webp — real model
 * thumbnails for the object picker (replacing emoji glyphs). Requires sharp
 * (npm i --no-save sharp) and the playwright chromium at /opt/pw-browsers.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_CATALOG } from './model-catalog.mjs';

const sharp = (await import('sharp')).default;
const ROOT = path.resolve('.');
const IDS = MODEL_CATALOG.map((m) => m.id);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/scripts/preview/object-thumbs.html';
  if (rel.startsWith('/models/')) {
    const file = path.join(ROOT, 'public', rel);
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
      return fs.createReadStream(file).pipe(res);
    }
  }
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('nf');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(4598, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.addInitScript((ids) => {
  window.__IDS__ = ids;
}, IDS);
await page.goto('http://127.0.0.1:4598/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__READY__ === true, { timeout: 240000 });

const { thumbs, errors } = await page.evaluate(() => ({
  thumbs: window.__THUMBS__,
  errors: window.__ERRORS__,
}));
await browser.close();
server.close();

fs.mkdirSync('public/ui/objects', { recursive: true });
for (const [id, dataUrl] of Object.entries(thumbs)) {
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  await sharp(buf).trim({ threshold: 8 }).resize(224, 224, { fit: 'inside' }).webp({ quality: 82, alphaQuality: 85 }).toFile(`public/ui/objects/${id}.webp`);
  console.log('thumb', id);
}
if (errors.length) {
  console.log('FAILURES:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`${Object.keys(thumbs).length} thumbnails written to public/ui/objects/`);
