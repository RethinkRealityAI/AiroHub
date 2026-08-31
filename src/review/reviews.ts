/**
 * Review verdicts — the `airohub_model_reviews` table.
 *
 * One row per catalog id (`easel`, `up-<uuid>`), which is why this is a table
 * of its own rather than columns on `airohub_models`: built-ins have no
 * registry row to hang a column off, and `airohub_models` deliberately carries
 * no UPDATE policy — adding one so a verdict could be written would widen
 * anon writes across the whole registry on a shared production database.
 *
 * **Absence is pending.** There is no row until somebody judges an asset, so
 * `publishModel()` writes nothing here and there is exactly one source of
 * truth. The promotion gate in `src/paint/customModels.ts` reads the same
 * rule from the other side: no row, no picker entry.
 *
 * Every mutation stamps `updated_at` itself. The column defaults to `now()` on
 * INSERT, but an upsert that resolves to UPDATE would otherwise keep the
 * original timestamp forever and the checklist could not tell a verdict from
 * last month from one from a minute ago.
 */
import { getSupabaseClient, isBackendConfigured } from '../admin/supabase';

const TABLE = 'airohub_model_reviews';

/** What the reviewer decided. `pending` is also what a missing row means. */
export type Verdict = 'pending' | 'approved' | 'rejected';

/** Built-ins ship in the bundle; uploads live in `airohub_models`. */
export type AssetKind = 'builtin' | 'upload';

export interface ReviewRow {
  asset_key: string;
  kind: AssetKind;
  /** `airohub_models.id` for uploads (so a delete cascades), null for built-ins. */
  model_id: string | null;
  status: Verdict;
  note: string;
  reviewer: string;
  created_at: string;
  updated_at: string;
}

/** Keyed by `asset_key`, which is the app-wide catalog id. */
export type VerdictMap = Map<string, ReviewRow>;

export interface VerdictInput {
  assetKey: string;
  kind: AssetKind;
  modelId?: string | null;
  status: Verdict;
  note?: string;
  reviewer?: string;
}

/**
 * Every verdict on record. The table is one small row per asset and the
 * gallery needs all of them to render counts, so this is deliberately
 * unpaginated — a page size would silently make the "unreviewed" count wrong.
 */
export async function listVerdicts(): Promise<VerdictMap> {
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Could not load review verdicts: ${error.message}`);
  const map: VerdictMap = new Map();
  for (const row of (data ?? []) as ReviewRow[]) map.set(row.asset_key, row);
  return map;
}

/**
 * Writes a verdict, creating the row if this asset has never been judged.
 *
 * `onConflict: 'asset_key'` makes this INSERT … ON CONFLICT DO UPDATE, which
 * is why the migration grants UPDATE as well as INSERT: PostgREST needs both
 * policies for merge-duplicates to resolve.
 */
export async function upsertVerdict(input: VerdictInput): Promise<ReviewRow> {
  const payload = {
    asset_key: input.assetKey,
    kind: input.kind,
    model_id: input.modelId ?? null,
    status: input.status,
    note: input.note ?? '',
    reviewer: input.reviewer ?? '',
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .upsert(payload, { onConflict: 'asset_key' })
    .select()
    .single();
  if (error) throw new Error(`Could not save the verdict: ${error.message}`);
  // `.single()` should always come back with the row it just wrote. If it ever
  // does not, say so rather than letting `undefined` into the verdict map,
  // where it would read as "pending" and silently undo the click.
  if (!data) throw new Error('The verdict was written but not returned.');
  return data as ReviewRow;
}

/**
 * Removes the row entirely rather than setting `status = 'pending'`.
 *
 * Those two states are the same thing by design — absence is pending — and
 * leaving a stub row behind would mean the gate had two ways to say "no" and
 * the checklist two ways to count "unreviewed".
 */
export async function clearVerdict(assetKey: string): Promise<void> {
  const { error } = await getSupabaseClient().from(TABLE).delete().eq('asset_key', assetKey);
  if (error) throw new Error(`Could not clear the verdict: ${error.message}`);
}

/** Convenience for the UI: the effective status of an asset with no row yet. */
export function verdictOf(verdicts: VerdictMap, assetKey: string): Verdict {
  return verdicts.get(assetKey)?.status ?? 'pending';
}

/** Re-exported so the gallery can gate its controls without a second import. */
export { isBackendConfigured };
