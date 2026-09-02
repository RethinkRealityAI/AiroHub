-- AiroHub launch schema: settings, feedback, analytics, visitor salts, AI usage.
--
-- WHY THIS FILE IS WRITTEN THE WAY IT IS
--
-- Netlify applies every file in this directory on each deploy, and a statement
-- that errors fails the deploy. So every statement here is idempotent
-- (`if not exists`), additive, and made of plain, portable Postgres — no
-- extensions, no `alter table`, no seed rows. Re-running it must be a no-op.
--
-- NO PII IN THE ANALYTICS TABLE
--
-- `events` never stores an IP address, a raw user agent, or a cookie. Identity
-- is `visitor_hash` = sha256(daily_salt | ip | user_agent), computed in the
-- function and stored as hex. The salt lives in `visitor_salts`, is generated
-- once per UTC day, and is deleted by the prune job a few days later. Once the
-- salt is gone the hash cannot be recomputed from an IP, which is the whole
-- point: the table cannot be turned back into a list of people, by us or by
-- anyone who obtains it.
--
-- The direct consequence, and it must be labelled honestly wherever the number
-- is shown: COUNT(DISTINCT visitor_hash) IS A PER-DAY FIGURE ONLY. The salt
-- rotates at midnight UTC, so the same person gets a different hash tomorrow.
-- Grouping by day is correct; summing those daily counts gives visitor-days,
-- not people, and a DISTINCT across a multi-day range is meaningless.
--
-- `feedback` is the one table that holds anything a person typed. It keeps the
-- user agent and country code because a bug report without "which browser" is
-- not actionable, and an email address only when someone chose to type one so
-- we can reply. It is deliberately never pruned.
--
-- `props` is capped rather than trusted: the track endpoint already rejects
-- oversized payloads, and this is the backstop that keeps one bad client from
-- turning the analytics table into a document store.

-- Feature flags and any other small operator-controlled setting. One row per
-- top-level flag group ('ui', 'notice', 'ai'); an empty table means the
-- compiled-in defaults apply, which is why there are no seed rows.
create table if not exists settings (
  key         text        primary key check (char_length(key) <= 40),
  value       jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Messages people send from the feedback sheet, plus the owner's triage state.
create table if not exists feedback (
  id          bigserial   primary key,
  created_at  timestamptz not null default now(),
  kind        text        not null check (kind in ('feedback', 'suggestion', 'bug')),
  message     text        not null check (char_length(message) between 3 and 2000),
  email       text        not null default '' check (char_length(email) <= 160),
  path        text        not null default '' check (char_length(path) <= 200),
  room_id     text        not null default '' check (char_length(room_id) <= 16),
  user_agent  text        not null default '' check (char_length(user_agent) <= 400),
  country     text        not null default '' check (char_length(country) <= 2),
  status      text        not null default 'new' check (status in ('new', 'read', 'resolved')),
  admin_note  text        not null default '' check (char_length(admin_note) <= 2000),
  updated_at  timestamptz not null default now()
);

-- The dashboard's default view is "new, newest first"; the second is the
-- unfiltered feed.
create index if not exists feedback_status_created_idx on feedback (status, created_at desc);
create index if not exists feedback_created_idx on feedback (created_at desc);

-- First-party, cookieless analytics. `path` arrives already normalised: room
-- codes are replaced with ':room' by the function so a throwaway session code
-- never becomes a row of its own here.
create table if not exists events (
  id             bigserial   primary key,
  occurred_at    timestamptz not null default now(),
  name           text        not null check (char_length(name) <= 40),
  session_id     text        not null check (char_length(session_id) between 8 and 64),
  visitor_hash   char(64)    not null,
  path           text        not null default '' check (char_length(path) <= 200),
  room_id        text        not null default '' check (char_length(room_id) <= 16),
  referrer_host  text        not null default '' check (char_length(referrer_host) <= 120),
  device         text        not null default 'unknown'
                             check (device in ('mobile', 'tablet', 'desktop', 'bot', 'unknown')),
  country        text        not null default '' check (char_length(country) <= 2),
  props          jsonb       not null default '{}'::jsonb
                             check (octet_length(props::text) <= 4096)
);

-- Every dashboard query is a time range; two of them also pin a name.
create index if not exists events_occurred_idx on events (occurred_at desc);
create index if not exists events_name_occurred_idx on events (name, occurred_at desc);

-- One random salt per UTC day. Written by whichever function instance gets
-- there first (insert ... on conflict do nothing), read by all of them. The
-- prune job deletes rows older than the events they salted are kept for, so an
-- old hash can never be reversed.
create table if not exists visitor_salts (
  day         date        primary key,
  salt        text        not null check (char_length(salt) between 32 and 96),
  created_at  timestamptz not null default now()
);

-- The AI copilot's daily spend counter. One row per UTC day, incremented
-- atomically by the AI function before it calls Gemini; when the count passes
-- the configured cap the copilot serves curated answers instead.
create table if not exists ai_usage (
  day         date        primary key,
  calls       integer     not null default 0 check (calls >= 0),
  updated_at  timestamptz not null default now()
);
