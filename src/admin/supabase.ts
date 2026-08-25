/**
 * Admin backend — the custom-model registry on Supabase.
 *
 * Storage bucket `airohub-models` (public, 25 MB cap) holds the GLB bytes;
 * table `public.airohub_models` is the registry row per model with its stats
 * and check verdicts. Reads the same VITE_SUPABASE_* env vars as the realtime
 * transport; when they are absent every call throws and the dashboard renders
 * an offline notice instead.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ChecksMap } from './checks';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const TABLE = 'airohub_models';
const BUCKET = 'airohub-models';

/** Storage-side hard cap; larger uploads are rejected before any network IO. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface CustomModelRow {
  id: string;
  name: string;
  storage_path: string;
  size_bytes: number;
  triangles: number;
  texture_mp: number;
  vram_mb: number;
  target_size: number;
  checks: ChecksMap | null;
  created_at: string;
}

export function isBackendConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

let client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing).');
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Public download URL for a stored model. */
export function publicModelUrl(storagePath: string): string {
  return `${SUPABASE_URL ?? ''}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

export async function listCustomModels(): Promise<CustomModelRow[]> {
  const { data, error } = await getClient()
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load the custom library: ${error.message}`);
  return (data ?? []) as CustomModelRow[];
}

export interface PublishInput {
  name: string;
  bytes: ArrayBuffer;
  targetSize: number;
  triangles: number;
  textureMP: number;
  vramMB: number;
  checks: ChecksMap;
}

/**
 * Uploads the GLB then inserts the registry row. If the row insert fails the
 * freshly-uploaded object is removed again so the bucket never accumulates
 * orphans.
 */
export async function publishModel(input: PublishInput): Promise<CustomModelRow> {
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error('File exceeds the 25 MB storage cap.');
  }
  const supabase = getClient();
  const storagePath = `${crypto.randomUUID()}.glb`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, new Blob([input.bytes], { type: 'model/gltf-binary' }), {
      contentType: 'model/gltf-binary',
      upsert: false,
    });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data, error: insertError } = await supabase
    .from(TABLE)
    .insert({
      name: input.name,
      storage_path: storagePath,
      size_bytes: input.bytes.byteLength,
      triangles: input.triangles,
      texture_mp: Number(input.textureMP.toFixed(3)),
      vram_mb: Number(input.vramMB.toFixed(2)),
      target_size: input.targetSize,
      checks: input.checks,
    })
    .select()
    .single();

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
    throw new Error(`Registry insert failed: ${insertError.message}`);
  }
  return data as CustomModelRow;
}

/** Removes the storage object first, then the registry row. */
export async function deleteCustomModel(row: CustomModelRow): Promise<void> {
  const supabase = getClient();
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([row.storage_path]);
  if (storageError) throw new Error(`Could not delete the stored file: ${storageError.message}`);

  const { error: rowError } = await supabase.from(TABLE).delete().eq('id', row.id);
  if (rowError) throw new Error(`File removed, but the registry row failed to delete: ${rowError.message}`);
}

/**
 * Danger-zone sweep. Deletes sequentially so one failure aborts with a clear
 * message instead of leaving an unknown number of half-deleted models.
 */
export async function deleteAllCustomModels(rows: CustomModelRow[]): Promise<number> {
  let deleted = 0;
  for (const row of rows) {
    await deleteCustomModel(row);
    deleted += 1;
  }
  return deleted;
}
