-- Add a private `public.feedback` table to persist Discord "Feedback & Support"
-- submissions alongside the existing Discord-only flow. The discord-feedback
-- edge function keeps posting an embed + thread to the #wrad channel (that stays
-- the source of truth); this table is a best-effort secondary record so the raw
-- answers can be queried/triaged later.
--
-- Privacy: RLS is enabled with NO policies, so anon/public (the leaderboard's
-- anon key, PostgREST) can neither read nor write it. Only the service role,
-- which BYPASSES RLS, can touch it — that is the key the edge function uses for
-- its insert. Do not add policies unless you intend to expose rows publicly.
--
-- DO NOT RUN THIS AUTOMATICALLY. Applied by hand against the live Supabase
-- project (wvrllhiktnkvbpclmrpq) via the Management API query endpoint / SQL
-- editor. Safe to re-run: uses create ... if not exists throughout.

-- 1. The table. content holds the raw {input_custom_id: value} answers map so
--    no data is lost even if the embed layout changes.
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type       text not null,                 -- 'bug' | 'feedback' | 'question'
  author_name text,
  author_id  text,                          -- Discord user id
  guild_id   text,
  channel_id text,
  message_id text,                          -- the posted embed message id
  thread_id  text,                          -- the created thread id (nullable)
  content    jsonb not null,                -- raw {custom_id: value} answers
  status     text not null default 'open'
);

-- 2. Lock it down: RLS on, zero policies => only the service role reaches it.
alter table public.feedback enable row level security;

-- 3. Indexes for the two obvious triage queries: newest-first and by type.
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_type_idx        on public.feedback (type);
