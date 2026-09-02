/**
 * The review checklist — a markdown snapshot of where every asset stands.
 *
 * Pure on purpose: assets in, verdicts in, clock in, string out. Nothing here
 * touches the network, the DOM or `Date.now()`, so `scripts/test/review-export.mjs`
 * can pin the exact bytes for a fixed clock and a regression in the section
 * rules fails a unit test instead of being noticed in a pasted Slack message.
 *
 * **Order is the argument.** Needs work first, then Flagged, then Ship it. A
 * checklist that opened with the approved pile would bury the two sections
 * somebody actually has to act on under the eleven they do not.
 *
 * **Flagged defaults pessimistic.** A note with no verdict means a reviewer saw
 * something and did not sign it off. That is not "unreviewed" (nobody looked)
 * and it is certainly not "ship it" — it gets its own section above the
 * approved pile, so a half-finished review round degrades toward caution.
 */
import type { ReviewAsset } from './assets';
import type { ReviewRow, VerdictMap } from './reviews';

export interface ChecklistBuckets {
  needsWork: ReviewAsset[];
  flagged: ReviewAsset[];
  shipIt: ReviewAsset[];
  unreviewed: ReviewAsset[];
}

/** Sorts by label, then key, so a run over the same data is byte-identical. */
function stable(a: ReviewAsset, b: ReviewAsset): number {
  return a.label.localeCompare(b.label, 'en') || a.key.localeCompare(b.key, 'en');
}

function hasNote(row: ReviewRow | undefined): boolean {
  return Boolean(row && row.note && row.note.trim().length > 0);
}

/**
 * Splits the roster into the four piles. Exported so the gallery's chips and
 * the checklist can never disagree about what "flagged" means.
 */
export function bucketAssets(assets: ReviewAsset[], verdicts: VerdictMap): ChecklistBuckets {
  const buckets: ChecklistBuckets = { needsWork: [], flagged: [], shipIt: [], unreviewed: [] };
  for (const asset of assets) {
    const row = verdicts.get(asset.key);
    const status = row?.status ?? 'pending';
    if (status === 'rejected') buckets.needsWork.push(asset);
    else if (status === 'approved') buckets.shipIt.push(asset);
    else if (hasNote(row)) buckets.flagged.push(asset);
    else buckets.unreviewed.push(asset);
  }
  buckets.needsWork.sort(stable);
  buckets.flagged.sort(stable);
  buckets.shipIt.sort(stable);
  buckets.unreviewed.sort(stable);
  return buckets;
}

/** Collapses a note to one line — a checklist item must stay one item. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function item(asset: ReviewAsset, row: ReviewRow | undefined, checked: boolean): string {
  const box = checked ? '- [x]' : '- [ ]';
  const kind = asset.kind === 'upload' ? 'upload' : 'built-in';
  let line = `${box} **${asset.label}** \`${asset.key}\` (${kind})`;
  const note = row && hasNote(row) ? oneLine(row.note) : '';
  if (note) line += `\n      note: ${note}`;
  const reviewer = row?.reviewer?.trim();
  if (reviewer) line += `\n      reviewer: ${reviewer}`;
  return line;
}

function section(
  title: string,
  assets: ReviewAsset[],
  verdicts: VerdictMap,
  checked: boolean,
  empty: string
): string[] {
  const lines = [`## ${title} (${assets.length})`, ''];
  if (assets.length === 0) lines.push(`_${empty}_`);
  else for (const asset of assets) lines.push(item(asset, verdicts.get(asset.key), checked));
  lines.push('');
  return lines;
}

/**
 * The whole checklist, ready for the clipboard.
 *
 * @param now Any `Date` or epoch-millis value. Only its UTC calendar day is
 *   used, so a test can pin the output without pinning a timezone.
 */
export function buildChecklist(
  assets: ReviewAsset[],
  verdicts: VerdictMap,
  now: Date | number
): string {
  const day = (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10);
  const buckets = bucketAssets(assets, verdicts);
  const total = assets.length;

  const lines: string[] = [
    `# Asset review — ${day}`,
    '',
    `${total} assets · ${buckets.shipIt.length} ship it · ${buckets.needsWork.length} needs work · ${buckets.flagged.length} flagged · ${buckets.unreviewed.length} unreviewed`,
    '',
  ];

  lines.push(...section('Needs work', buckets.needsWork, verdicts, false, 'Nothing rejected.'));
  lines.push(
    ...section('Flagged', buckets.flagged, verdicts, false, 'No notes without a verdict.')
  );
  lines.push(...section('Ship it', buckets.shipIt, verdicts, true, 'Nothing approved yet.'));

  lines.push(`## Unreviewed (${buckets.unreviewed.length})`, '');
  if (buckets.unreviewed.length === 0) {
    lines.push('_Every asset has a verdict._');
  } else {
    lines.push(`${buckets.unreviewed.length} of ${total} assets have no verdict yet.`);
    lines.push('');
    for (const asset of buckets.unreviewed) lines.push(`- ${asset.label} \`${asset.key}\``);
  }
  lines.push('');

  return lines.join('\n');
}
