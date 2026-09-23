/**
 * Tool-placement suite: the floating can must glide over humps and edges.
 *
 * Sweeps the aim steadily left to right across a flat deck with a raised
 * block on it (a skateboard truck, 2.5 units proud, with a side face the
 * camera can see) at 60 fps, and checks where the can's nozzle lands on
 * screen. It must follow the aim closely and never move backwards while the
 * aim moves forwards. The old placement (hit + normal x hover, eased) is run
 * through the same sweep for comparison: the block's side-face normal shoved
 * it back against the direction of travel, which is the "stuck on the axle,
 * then jumps" users felt.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airo-place-'));
const entry = path.join(outDir, 'entry.ts');
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(repo, 'src/scene/toolPlacement.ts'))};
   export * as THREE from 'three';`
);
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  outfile: path.join(outDir, 'bundle.mjs'),
  logLevel: 'error',
  nodePaths: [path.join(repo, 'node_modules')],
});
const { createToolPlacement, stepToolPlacement, THREE } = await import(
  pathToFileURL(path.join(outDir, 'bundle.mjs')).href
);

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const W = 1400;
const H = 900;
const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
camera.position.set(7, 1.5, 17);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const camPos = camera.position.clone();

// The deck is the plane z = 0; the truck a box standing 2.5 units off it.
const truck = new THREE.Box3(new THREE.Vector3(-1, -4, 0), new THREE.Vector3(1, 4, 2.5));
const ray = new THREE.Ray();
const hitPoint = new THREE.Vector3();
function cast(ndcX, ndcY) {
  const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
  ray.set(camPos, v.sub(camPos).normalize());
  if (ray.intersectBox(truck, hitPoint)) {
    const e = 1e-4;
    const n = new THREE.Vector3(
      Math.abs(hitPoint.x - truck.max.x) < e ? 1 : Math.abs(hitPoint.x - truck.min.x) < e ? -1 : 0,
      0,
      Math.abs(hitPoint.z - truck.max.z) < e ? 1 : 0
    );
    return { point: hitPoint.clone(), normal: n.normalize() };
  }
  const t = -ray.origin.z / ray.direction.z;
  return { point: ray.at(t, new THREE.Vector3()), normal: new THREE.Vector3(0, 0, 1) };
}
const toScreenX = (p) => ((p.clone().project(camera).x + 1) / 2) * W;

const HOVER = 1.05;
const DT = 1 / 60;
const FRAMES = 150;

function sweep(place) {
  const xs = [];
  const errs = [];
  for (let i = 0; i <= FRAMES; i++) {
    const ndcX = -0.5 + (1.0 * i) / FRAMES; // steady left-to-right sweep
    const hit = cast(ndcX, -0.05);
    const pos = place(hit, i === 0);
    xs.push(toScreenX(pos));
    errs.push(Math.abs(toScreenX(pos) - toScreenX(hit.point)));
  }
  let backwards = 0;
  for (let i = 1; i < xs.length; i++) backwards = Math.max(backwards, xs[i - 1] - xs[i]);
  const steady = errs.slice(10);
  return { backwards, maxLead: Math.max(...steady) };
}

// New: on the aim ray.
const state = createToolPlacement();
const out = new THREE.Vector3();
const now = sweep((hit) => stepToolPlacement(state, camPos, hit.point, HOVER, DT, out).clone());

// Old: hit + (filtered) normal x hover, position eased at 26/s.
const oldPos = new THREE.Vector3();
const oldN = new THREE.Vector3(0, 0, 1);
const before = sweep((hit, first) => {
  if (first) oldN.copy(hit.normal);
  else oldN.lerp(hit.normal, 1 - Math.exp(-30 * DT)).normalize();
  const target = hit.point.clone().addScaledVector(oldN, HOVER);
  if (first) oldPos.copy(target);
  else oldPos.lerp(target, 1 - Math.exp(-26 * DT));
  return oldPos.clone();
});

console.log(
  `old placement: moved backwards ${before.backwards.toFixed(1)} px, strayed ${before.maxLead.toFixed(1)} px from the aim`
);
check(
  'crossing the truck never moves the can backwards',
  now.backwards < 0.5,
  `largest backward step ${now.backwards.toFixed(2)} px (old: ${before.backwards.toFixed(1)} px)`
);
check(
  'the nozzle stays on the aim across the edge',
  now.maxLead < 6,
  `max ${now.maxLead.toFixed(1)} px from the aim point (old: ${before.maxLead.toFixed(1)} px)`
);

fs.rmSync(outDir, { recursive: true, force: true });
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} tool-placement checks passed`);
process.exit(failed ? 1 : 0);
