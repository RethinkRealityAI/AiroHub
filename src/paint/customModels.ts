/**
 * Custom (admin-uploaded) models.
 *
 * The admin portal publishes optimized GLBs to the public Supabase bucket and
 * registers them in the `airohub_models` table. At runtime every client folds
 * those rows into the paintable catalog under an "Uploads" category, so
 * uploaded models behave exactly like built-ins: pickable on both screens,
 * broadcast via the same change-object event, painted through the same
 * pipeline. Fetched once per session via plain REST (no client dependency).
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

const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

let pending: Promise<number> | null = null;

/**
 * Fetches the registry and registers every row into the catalog. Idempotent
 * and cached — both views call it on mount and re-render when it resolves.
 * Returns how many custom models are registered (0 when offline).
 */
export function ensureCustomModels(): Promise<number> {
  if (pending) return pending;
  pending = (async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/airohub_models?select=id,name,storage_path,target_size&order=created_at.desc&limit=60`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (!res.ok) return 0;
      const rows: CustomModelRow[] = await res.json();
      for (const row of rows) {
        const id = `up-${row.id}` as TargetObjectType;
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
      return rows.length;
    } catch {
      return 0;
    }
  })();
  return pending;
}
