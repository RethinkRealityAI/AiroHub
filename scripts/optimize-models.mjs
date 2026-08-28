/**
 * Turns the raw Meshy downloads into web-ready assets.
 *
 * Meshy returns ~5-9 MB GLBs with 2K/4K PBR maps. Shipping sixteen of those
 * would be ~100 MB of static assets, so each model is run through
 * glTF-Transform: geometry is welded/simplified and meshopt-compressed, and
 * textures are resized and re-encoded as WebP.
 *
 *   node scripts/optimize-models.mjs [--force]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MODEL_CATALOG } from './model-catalog.mjs';

const run = promisify(execFile);
const RAW_DIR = path.resolve('.model-cache');
const OUT_DIR = path.resolve('public/models');
const force = process.argv.includes('--force');

/**
 * Tools are rendered small and always on screen, so they get tighter textures
 * and harder simplification than the hero objects the player is painting.
 */
function settingsFor(entry) {
  return entry.isTool
    ? { textureSize: 512, simplifyRatio: 0.5 }
    : { textureSize: 1024, simplifyRatio: 0.75 };
}

const results = [];
for (const entry of MODEL_CATALOG) {
  const src = path.join(RAW_DIR, `${entry.id}.glb`);
  const dest = path.join(OUT_DIR, `${entry.id}.glb`);

  try {
    await fs.access(src);
  } catch {
    console.log(`- ${entry.id}: no raw download yet, skipping`);
    continue;
  }

  if (!force) {
    try {
      const [rawStat, outStat] = await Promise.all([fs.stat(src), fs.stat(dest)]);
      if (outStat.mtimeMs > rawStat.mtimeMs) {
        console.log(`= ${entry.id}: up to date`);
        results.push({ id: entry.id, bytes: outStat.size, skipped: true });
        continue;
      }
    } catch {
      /* not built yet */
    }
  }

  const { textureSize, simplifyRatio } = settingsFor(entry);
  const before = (await fs.stat(src)).size;

  try {
    await run(
      'npx',
      [
        'gltf-transform',
        'optimize',
        src,
        dest,
        '--compress', 'meshopt',
        '--texture-compress', 'webp',
        '--texture-size', String(textureSize),
        '--simplify', 'true',
        '--simplify-ratio', String(simplifyRatio),
        // Keeping borders locked avoids tearing holes in open shells such as
        // the helmet visor or the hoodie hem.
        '--simplify-lock-border', 'true',
        '--join', 'true',
        '--flatten', 'true',
      ],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    const after = (await fs.stat(dest)).size;
    const pct = (100 * (1 - after / before)).toFixed(0);
    console.log(
      `✓ ${entry.id}: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(2)} MB (-${pct}%)`
    );
    results.push({ id: entry.id, bytes: after });
  } catch (err) {
    console.error(`✗ ${entry.id}: ${err.stderr || err.message}`);
    process.exitCode = 1;
  }
}

const total = results.reduce((sum, r) => sum + r.bytes, 0);
console.log(`\n${results.length} models, ${(total / 1048576).toFixed(1)} MB total.`);
