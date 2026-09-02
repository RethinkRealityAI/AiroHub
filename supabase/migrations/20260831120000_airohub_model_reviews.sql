-- AiroHub asset review verdicts.
--
-- Keyed by the app's own catalog id ('easel', 'up-<uuid>') so one table covers
-- the shipped roster and admin uploads alike; built-ins have no registry row to
-- hang a column off. Strictly additive: nothing about public.airohub_models
-- changes, and in particular no UPDATE policy is added to it.
--
-- The gate rule, stated once: a custom upload reaches the object picker only
-- when it has a row here with status 'approved'. No row means pending, which is
-- why publishing writes nothing here — absence is the default state, so there
-- is exactly one source of truth and no second failure path at publish time.
--
-- Same auth-less posture as airohub_models and the realtime channels: anon
-- read/write. /admin is public and says so on the page.
--
-- Applied to the shared Supabase project via the Supabase MCP apply_migration;
-- this file is the committed record. No local CLI stack is implied.

create table if not exists public.airohub_model_reviews (
  asset_key  text primary key check (char_length(asset_key) between 1 and 80),
  kind       text not null default 'builtin' check (kind in ('builtin', 'upload')),
  -- Set for uploads so deleting a model takes its verdict with it. Null for
  -- built-ins, which live in the bundle rather than the registry.
  model_id   uuid references public.airohub_models(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note       text not null default '' check (char_length(note) <= 2000),
  reviewer   text not null default '' check (char_length(reviewer) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists airohub_model_reviews_status_idx   on public.airohub_model_reviews (status);
create index if not exists airohub_model_reviews_model_id_idx on public.airohub_model_reviews (model_id);

alter table public.airohub_model_reviews enable row level security;

drop policy if exists "airohub_model_reviews_read" on public.airohub_model_reviews;
create policy "airohub_model_reviews_read" on public.airohub_model_reviews
  for select to anon, authenticated using (true);

drop policy if exists "airohub_model_reviews_insert" on public.airohub_model_reviews;
create policy "airohub_model_reviews_insert" on public.airohub_model_reviews
  for insert to anon, authenticated with check (true);

-- Required for upsert: PostgREST's merge-duplicates resolution is
-- INSERT ... ON CONFLICT DO UPDATE, which needs both policies. Its absence on
-- airohub_models is exactly why the verdicts do not live there.
drop policy if exists "airohub_model_reviews_update" on public.airohub_model_reviews;
create policy "airohub_model_reviews_update" on public.airohub_model_reviews
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "airohub_model_reviews_delete" on public.airohub_model_reviews;
create policy "airohub_model_reviews_delete" on public.airohub_model_reviews
  for delete to anon, authenticated using (true);

-- Grandfather anything already published. Zero rows at the time of writing,
-- but a model published between writing and applying this must not vanish
-- from the picker.
insert into public.airohub_model_reviews (asset_key, kind, model_id, status, reviewer)
select 'up-' || m.id, 'upload', m.id, 'approved', 'migration'
from public.airohub_models m
on conflict (asset_key) do nothing;
