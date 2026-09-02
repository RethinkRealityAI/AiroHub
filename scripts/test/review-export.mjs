/**
 * Review checklist regression suite.
 *
 * `buildChecklist()` is the one part of the review gallery whose output a
 * human pastes somewhere and acts on, so its rules are pinned here rather than
 * eyeballed in a browser. Each check encodes a decision that would be quietly
 * wrong otherwise:
 *
 *  A  section ORDER — needs work, then flagged, then ship it, then unreviewed.
 *     Approved-first would bury the work under the wins.
 *  B  a note with NO verdict lands in Flagged, not Unreviewed and not Ship it.
 *     The pessimistic default is the whole reason the section exists.
 *  C  the counts line agrees with the sections, and every asset is in exactly
 *     one pile.
 *  D  output is stable — same inputs, same clock, byte-identical string; and
 *     input order does not leak into it.
 *  E  empty states render as sections with (0) and a placeholder, so a reader
 *     can tell "nothing rejected" from "the exporter dropped the section".
 *  F  a note is collapsed to one line, so one asset stays one checklist item.
 *
 * Runs headless: bundles src/review/exportChecklist.ts with esbuild (same
 * pattern as aim-regression.mjs) — no DOM, no network, no three.js.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airo-review-'));
const bundle = path.join(outDir, 'exportChecklist.mjs');

await build({
  entryPoints: [path.join(repo, 'src/review/exportChecklist.ts')],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  logLevel: 'error',
});

const { buildChecklist, bucketAssets } = await import(pathToFileURL(bundle).href);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

/* ------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------ */

const asset = (key, label, kind = 'builtin') => ({
  key,
  kind,
  label,
  modelId: kind === 'upload' ? '00000000-0000-4000-8000-000000000001' : null,
  category: kind === 'upload' ? 'Uploads' : 'Objects',
  blurb: '',
  targetSize: 10,
});

const ASSETS = [
  asset('easel', 'Studio Easel'),
  asset('skateboard', 'Skate Deck'),
  asset('helmet', 'Moto Helmet'),
  asset('cap', 'Snapback'),
  asset('van', 'Delivery Van'),
  asset('up-1111', 'Trophy', 'upload'),
];

const row = (assetKey, status, note = '', reviewer = 'dapo') => [
  assetKey,
  {
    asset_key: assetKey,
    kind: assetKey.startsWith('up-') ? 'upload' : 'builtin',
    model_id: null,
    status,
    note,
    reviewer,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
  },
];

const VERDICTS = new Map([
  row('easel', 'approved'),
  row('skateboard', 'rejected', 'Trucks float a centimetre off the deck.'),
  // A note, no verdict: the pessimistic default under test.
  row('helmet', 'pending', 'Visor seam looks wrong from the left.'),
  // A row with neither verdict nor note is indistinguishable from no row.
  row('cap', 'pending', '', ''),
  row('up-1111', 'approved', '', 'dapo'),
  // 'van' has no row at all.
]);

const CLOCK = Date.UTC(2026, 7, 31, 12, 0, 0);
const OUT = buildChecklist(ASSETS, VERDICTS, CLOCK);

/* ------------------------------------------------------------------
   A — section order
   ------------------------------------------------------------------ */
{
  const headings = [...OUT.matchAll(/^## (.+?) \(\d+\)$/gm)].map((m) => m[1]);
  const expected = ['Needs work', 'Flagged', 'Ship it', 'Unreviewed'];
  check(
    'A section order',
    JSON.stringify(headings) === JSON.stringify(expected),
    `${JSON.stringify(headings)}`
  );
  const iNeeds = OUT.indexOf('## Needs work');
  const iFlag = OUT.indexOf('## Flagged');
  const iShip = OUT.indexOf('## Ship it');
  check(
    'A needs-work precedes ship-it',
    iNeeds > 0 && iNeeds < iFlag && iFlag < iShip,
    `offsets needsWork=${iNeeds} flagged=${iFlag} shipIt=${iShip}`
  );
}

/* ------------------------------------------------------------------
   B — note without a verdict is Flagged
   ------------------------------------------------------------------ */
{
  const buckets = bucketAssets(ASSETS, VERDICTS);
  const flaggedKeys = buckets.flagged.map((a) => a.key);
  check(
    'B note without verdict → Flagged',
    flaggedKeys.length === 1 && flaggedKeys[0] === 'helmet',
    `flagged=${JSON.stringify(flaggedKeys)}`
  );
  check(
    'B flagged asset is not counted unreviewed',
    !buckets.unreviewed.some((a) => a.key === 'helmet'),
    `unreviewed=${JSON.stringify(buckets.unreviewed.map((a) => a.key))}`
  );
  const flagSection = OUT.slice(OUT.indexOf('## Flagged'), OUT.indexOf('## Ship it'));
  check(
    'B flagged item is unchecked and carries its note',
    flagSection.includes('- [ ] **Moto Helmet**') &&
      flagSection.includes('Visor seam looks wrong from the left.'),
    JSON.stringify(flagSection.split('\n')[2] ?? '')
  );
}

/* ------------------------------------------------------------------
   C — counts line, and every asset in exactly one pile
   ------------------------------------------------------------------ */
{
  const line = OUT.split('\n')[2];
  check(
    'C counts summary line',
    line === '6 assets · 2 ship it · 1 needs work · 1 flagged · 2 unreviewed',
    JSON.stringify(line)
  );

  const buckets = bucketAssets(ASSETS, VERDICTS);
  const all = [
    ...buckets.needsWork,
    ...buckets.flagged,
    ...buckets.shipIt,
    ...buckets.unreviewed,
  ].map((a) => a.key);
  const unique = new Set(all);
  check(
    'C every asset in exactly one pile',
    all.length === ASSETS.length && unique.size === ASSETS.length,
    `${all.length} placed, ${unique.size} unique, ${ASSETS.length} assets`
  );

  const headingCounts = [...OUT.matchAll(/^## (.+?) \((\d+)\)$/gm)].map((m) => Number(m[2]));
  check(
    'C heading counts match the summary',
    JSON.stringify(headingCounts) === JSON.stringify([1, 1, 2, 2]),
    JSON.stringify(headingCounts)
  );

  check(
    'C unreviewed names the rowless asset',
    OUT.includes('- Delivery Van `van`') && OUT.includes('- Snapback `cap`'),
    'van (no row) and cap (empty row) both unreviewed'
  );
}

/* ------------------------------------------------------------------
   D — stability
   ------------------------------------------------------------------ */
{
  const again = buildChecklist(ASSETS, VERDICTS, CLOCK);
  check('D stable for a fixed clock', again === OUT, `${OUT.length} chars`);

  const shuffled = [...ASSETS].reverse();
  const shuffledVerdicts = new Map([...VERDICTS.entries()].reverse());
  const reordered = buildChecklist(shuffled, shuffledVerdicts, CLOCK);
  check('D input order does not leak', reordered === OUT, 'reversed inputs produce the same bytes');

  check(
    'D clock renders as a UTC day',
    OUT.startsWith('# Asset review — 2026-08-31'),
    JSON.stringify(OUT.split('\n')[0])
  );

  const later = buildChecklist(ASSETS, VERDICTS, Date.UTC(2026, 8, 1, 12, 0, 0));
  check('D a different day changes only the heading', later !== OUT &&
    later.slice(later.indexOf('\n')) === OUT.slice(OUT.indexOf('\n')), 'body identical');
}

/* ------------------------------------------------------------------
   E — empty states
   ------------------------------------------------------------------ */
{
  const empty = buildChecklist([], new Map(), CLOCK);
  check(
    'E empty roster keeps all four sections',
    ['## Needs work (0)', '## Flagged (0)', '## Ship it (0)', '## Unreviewed (0)'].every((h) =>
      empty.includes(h)
    ),
    JSON.stringify([...empty.matchAll(/^## .+$/gm)].map((m) => m[0]))
  );
  check(
    'E empty roster explains each blank section',
    empty.includes('_Nothing rejected._') &&
      empty.includes('_No notes without a verdict._') &&
      empty.includes('_Nothing approved yet._') &&
      empty.includes('_Every asset has a verdict._'),
    'four placeholders present'
  );
  check('E empty roster counts line', empty.split('\n')[2] ===
    '0 assets · 0 ship it · 0 needs work · 0 flagged · 0 unreviewed',
    JSON.stringify(empty.split('\n')[2]));

  const noVerdicts = buildChecklist(ASSETS, new Map(), CLOCK);
  check(
    'E no verdicts at all → everything unreviewed',
    noVerdicts.includes('## Unreviewed (6)') &&
      noVerdicts.includes('6 of 6 assets have no verdict yet.'),
    'all six unreviewed'
  );
}

/* ------------------------------------------------------------------
   F — a multi-line note stays one checklist item
   ------------------------------------------------------------------ */
{
  const messy = new Map([row('easel', 'rejected', '  line one\n\nline two\ttabbed  ', 'dapo')]);
  const out = buildChecklist([asset('easel', 'Studio Easel')], messy, CLOCK);
  const noteLines = out.split('\n').filter((l) => l.includes('note:'));
  check(
    'F multi-line note collapses to one line',
    noteLines.length === 1 && noteLines[0] === '      note: line one line two tabbed',
    JSON.stringify(noteLines)
  );
  check(
    'F upload vs built-in is labelled',
    out.includes('`easel` (built-in)') &&
      buildChecklist([asset('up-1111', 'Trophy', 'upload')], new Map([row('up-1111', 'approved')]), CLOCK)
        .includes('`up-1111` (upload)'),
    'kind rendered on each item'
  );
}

fs.rmSync(outDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} review export checks passed`);
process.exit(failed.length ? 1 : 0);
