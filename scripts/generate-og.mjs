/**
 * Builds public/og-cover.jpg — the 1200x630 card Twitter/X, Slack, iMessage and
 * every link unfurler asks for.
 *
 * The head already declared `twitter:card = summary_large_image` while shipping
 * no image at all, which is worse than declaring nothing: the crawler reserves
 * a large-image slot and renders an empty one. The fix has to be a real file in
 * the build output, because the site is a static SPA on Netlify with no SSR and
 * therefore no chance to compose a card at request time.
 *
 * Source is the guide's own landing screenshot rather than a bespoke graphic,
 * on the same rule the guide page follows: everything shown is a real shot of
 * the app, so the card can never drift from what the product looks like.
 *
 * The crop is TOP-anchored, not centred. The source is 16:10 and the card is
 * 1.91:1, so ~160 rows have to go; the wordmark chip and the spray can's nozzle
 * both sit in the top band, while the bottom row is a footer of small print no
 * social card can render legibly anyway.
 *
 *   node scripts/generate-og.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const sharp = (await import('sharp')).default;

const SRC = path.resolve('public/ui/guide/landing.webp');
const OUT = path.resolve('public/og-cover.jpg');
/** The size every unfurler documents; anything else gets re-cropped by them. */
const W = 1200;
const H = 630;

if (!fs.existsSync(SRC)) {
  console.error(`missing source: ${SRC}`);
  process.exit(1);
}

const meta = await sharp(SRC).metadata();
if (!meta.width || !meta.height) {
  console.error('could not read source dimensions');
  process.exit(1);
}

// Derived from the source rather than hard-coded, so re-shooting the landing at
// another size still produces a correct card instead of a stretched one.
const target = W / H;
let cropW = meta.width;
let cropH = Math.round(meta.width / target);
if (cropH > meta.height) {
  cropH = meta.height;
  cropW = Math.round(meta.height * target);
}
const left = Math.round((meta.width - cropW) / 2);

await sharp(SRC)
  .extract({ left, top: 0, width: cropW, height: cropH })
  .resize(W, H, { fit: 'fill' })
  // Progressive so the card paints in one pass on a slow unfurl rather than
  // top-down; 80 is the knee of the quality curve for this kind of dark render.
  .jpeg({ quality: 80, progressive: true })
  .toFile(OUT);

const { size } = fs.statSync(OUT);
const out = await sharp(OUT).metadata();
console.log(
  `og-cover.jpg  ${out.width}x${out.height}  ${(size / 1024).toFixed(1)} kB  ` +
    `(from ${meta.width}x${meta.height}, cropped ${cropW}x${cropH} at x=${left})`
);
