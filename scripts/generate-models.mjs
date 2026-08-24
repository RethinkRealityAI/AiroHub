/**
 * Generates every entry in the model catalog with the Meshy text-to-3D API.
 *
 * Meshy runs as a two-stage job: a `preview` task produces untextured geometry,
 * then a `refine` task textures it with PBR maps. Both stages are polled to
 * completion, and the finished GLB is written to public/models/raw/<id>.glb.
 *
 * State lives in scripts/.meshy-state.json so an interrupted run resumes instead
 * of paying for the same geometry twice.
 *
 *   MESHY_API_KEY=... node scripts/generate-models.mjs [--only id1,id2]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { MODEL_CATALOG } from './model-catalog.mjs';

const API = 'https://api.meshy.ai/openapi';
const KEY = process.env.MESHY_API_KEY;
if (!KEY) {
  console.error('MESHY_API_KEY is not set.');
  process.exit(1);
}

const OUT_DIR = path.resolve('.model-cache');
const STATE_FILE = path.resolve('scripts/.meshy-state.json');
const AI_MODEL = process.env.MESHY_AI_MODEL || 'meshy-5';

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > -1 ? process.argv[onlyArg + 1].split(',') : null;

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

let state = await loadState();
let stateWriteQueue = Promise.resolve();
function saveState() {
  stateWriteQueue = stateWriteQueue.then(() =>
    fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2))
  );
  return stateWriteQueue;
}

/**
 * Meshy call with backoff. Egress allowlists and Meshy's own rate limiter both
 * surface as transient 4xx/5xx here, and a half-finished run wastes credits, so
 * retry the whole request rather than letting one blip kill the batch.
 */
async function api(pathname, init = {}, attempt = 0) {
  const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 8;
  let res;
  try {
    res = await fetch(`${API}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    return api(pathname, init, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) {
    if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      return api(pathname, init, attempt + 1);
    }
    throw new Error(`${res.status} ${pathname}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Polls a Meshy task until it leaves the pending/running states. */
async function waitForTask(id, label) {
  let lastProgress = -1;
  for (let attempt = 0; attempt < 360; attempt++) {
    const task = await api(`/v2/text-to-3d/${id}`);
    if (task.progress !== lastProgress) {
      lastProgress = task.progress;
      console.log(`  [${label}] ${task.status} ${task.progress}%`);
    }
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`${label} ${task.status}: ${JSON.stringify(task.task_error)}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`${label} timed out`);
}

async function download(url, dest, attempt = 0) {
  const res = await fetch(url).catch((err) => {
    if (attempt >= 5) throw err;
    return null;
  });
  if (!res || !res.ok) {
    if (attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      return download(url, dest, attempt + 1);
    }
    throw new Error(`download ${res?.status} ${url}`);
  }
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  const { size } = await fs.stat(dest);
  return size;
}

async function generate(entry) {
  const st = (state[entry.id] ||= {});
  const dest = path.join(OUT_DIR, `${entry.id}.glb`);

  if (st.done) {
    try {
      await fs.access(dest);
      console.log(`= ${entry.id}: already downloaded, skipping`);
      return { id: entry.id, skipped: true };
    } catch {
      st.done = false;
    }
  }

  // Stage 1 - untextured geometry.
  if (!st.previewId) {
    const { result } = await api('/v2/text-to-3d', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'preview',
        prompt: entry.prompt,
        art_style: 'realistic',
        ai_model: AI_MODEL,
        should_remesh: true,
        topology: 'triangle',
        target_polycount: entry.polycount,
        symmetry_mode: 'auto',
      }),
    });
    st.previewId = result;
    await saveState();
    console.log(`+ ${entry.id}: preview task ${result}`);
  }
  if (!st.previewDone) {
    await waitForTask(st.previewId, `${entry.id} preview`);
    st.previewDone = true;
    await saveState();
  }

  // Stage 2 - PBR texturing on top of the approved geometry.
  if (!st.refineId) {
    const { result } = await api('/v2/text-to-3d', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'refine',
        preview_task_id: st.previewId,
        enable_pbr: true,
        texture_prompt: entry.texturePrompt,
      }),
    });
    st.refineId = result;
    await saveState();
    console.log(`+ ${entry.id}: refine task ${result}`);
  }
  const refined = await waitForTask(st.refineId, `${entry.id} refine`);

  const url = refined.model_urls?.glb;
  if (!url) throw new Error(`${entry.id}: refine returned no glb url`);
  const bytes = await download(url, dest);
  st.done = true;
  st.bytes = bytes;
  await saveState();
  console.log(`✓ ${entry.id}: ${(bytes / 1048576).toFixed(1)} MB -> ${dest}`);
  return { id: entry.id, bytes };
}

await fs.mkdir(OUT_DIR, { recursive: true });
const targets = MODEL_CATALOG.filter((e) => !only || only.includes(e.id));
console.log(`Generating ${targets.length} models with ${AI_MODEL}\n`);

// Meshy queues concurrent tasks server-side, so fan out and let the polling
// loops interleave rather than paying the full latency serially.
const results = await Promise.allSettled(targets.map(generate));

const failed = results
  .map((r, i) => ({ r, entry: targets[i] }))
  .filter(({ r }) => r.status === 'rejected');

console.log(`\nDone. ${results.length - failed.length}/${results.length} succeeded.`);
for (const { r, entry } of failed) console.error(`✗ ${entry.id}: ${r.reason?.message || r.reason}`);
const { balance } = await api('/v1/balance');
console.log(`Meshy credits remaining: ${balance}`);
if (failed.length) process.exitCode = 1;
