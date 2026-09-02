/**
 * Custom (admin-uploaded) models — the player-facing half of the review gate.
 *
 * The admin portal publishes optimized GLBs to the public Supabase bucket and
 * registers them in the `airohub_models` table. At runtime every client folds
 * those rows into the paintable catalog under an "Uploads" category, so
 * uploaded models behave exactly like built-ins: pickable on both screens,
 * broadcast via the same change-object event, painted through the same
 * pipeline. Fetched once per session via plain REST (no client dependency).
 *
 * **What changed, and the bug it prevents.** Until this gate existed, a model
 * appeared in the picker of every live session the moment it was published —
 * geometry nobody had ever seen rendered, on an admin page behind a shared
 * password, in a room full of people. That is the failure the review gallery
 * exists to stop, and this is where it is enforced: a row here is registered
 * only if `airohub_model_reviews` carries `status = 'approved'` for its
 * catalog id. Absence of a review row means pending, so publishing writes
 * nothing to the verdict table — there is exactly one source of truth and no
 * second failure path at publish time.
 *
 * **The gate fails closed.** If the reviews query fails while the registry
 * query succeeds, this registers ZERO uploads and warns once. Failing open
 * would be worse than having no gate at all: the one moment the check is most
 * likely to be down is the moment it would be quietly bypassed, and a
 * reviewer would have no way to tell that the rule they rely on had stopped
 * applying. Built-ins are unaffected either way — the studio always has a
 * catalog.
 *
 * Everything else about the offline path is unchanged: no Supabase env vars,
 * or an unreachable registry, still resolves to 0 in silence.
 */
import { PAINTABLE_OBJECTS, OBJECT_BY_ID, PaintableObject } from './objectCatalog';
import { registerModelUrl } from './modelRegistry';
import { TargetObjectType } from '../types';

interface CustomModelRow {
  id: string;
  name: string;
  storage_path: string;
  target_size: number | string | null;
}

interface ApprovedKeyRow {
  asset_key: string;
}

const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

let pending: Promise<number> | null = null;
let warned = false;

/** One line per session, not one per caller — both views call this on mount. */
function warnGateClosed(detail: string) {
  if (warned) return;
  warned = true;
  console.warn(
    `[customModels] review gate unreachable (${detail}) — registering no uploads. ` +
      'Unreviewed geometry is never shown to a room; approve models at /admin/review.'
  );
}

/**
 * Fetches the registry and registers every APPROVED row into the catalog.
 * Idempotent and cached — both views call it on mount and re-render when it
 * resolves. Returns how many custom models are registered (0 when offline, and
 * 0 when the gate cannot be read).
 */
export function ensureCustomModels(): Promise<number> {
  if (pending) return pending;
  pending = (async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
    const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
    try {
      // Both in flight together: the gate must not add a serial round trip to
      // the first object switch of every session.
      const [modelsRes, reviewsRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/airohub_models?select=id,name,storage_path,target_size&order=created_at.desc&limit=60`,
          { headers }
        ).catch(() => null),
        fetch(
          `${SUPABASE_URL}/rest/v1/airohub_model_reviews?select=asset_key&kind=eq.upload&status=eq.approved`,
          { headers }
        ).catch(() => null),
      ]);

      // No registry: nothing to gate, and nothing new to say — this is the
      // plain offline path the studio has always taken.
      if (!modelsRes || !modelsRes.ok) return 0;

      // Registry up, gate down. That is the case worth being loud about.
      if (!reviewsRes || !reviewsRes.ok) {
        warnGateClosed(reviewsRes ? `HTTP ${reviewsRes.status}` : 'request failed');
        return 0;
      }

      const [rows, approvedRows]: [CustomModelRow[], ApprovedKeyRow[]] = await Promise.all([
        modelsRes.json(),
        reviewsRes.json(),
      ]);
      const approved = new Set(approvedRows.map((row) => row.asset_key));

      let registered = 0;
      for (const row of rows) {
        const id = `up-${row.id}` as TargetObjectType;
        if (!approved.has(id)) continue;
        registered += 1;
        if (OBJECT_BY_ID.has(id)) continue;
        registerModelUrl(
          id,
          `${SUPABASE_URL}/storage/v1/object/public/airohub-models/${row.storage_path}`
        );
        const entry: PaintableObject = {
          id,
          label: row.name,
          short: row.name.length > 10 ? `${row.name.slice(0, 9)}…` : row.name,
          // No render exists for an uploaded model, so the picker draws its
          // glyph chip instead of a thumbnail.
          category: 'Uploads',
          blurb: 'Uploaded through the admin portal.',
          targetSize: Number(row.target_size) || 7,
        };
        PAINTABLE_OBJECTS.push(entry);
        OBJECT_BY_ID.set(id, entry);
      }
      return registered;
    } catch (err) {
      // A parse failure on either response leaves the gate unread, so it is
      // shut for the same reason as an HTTP failure.
      warnGateClosed(err instanceof Error ? err.message : 'unknown error');
      return 0;
    }
  })();
  return pending;
}
