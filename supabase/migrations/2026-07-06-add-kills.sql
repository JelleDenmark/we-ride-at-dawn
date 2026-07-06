-- Add a cumulative "enemies defeated this season" metric to the leaderboard.
-- Ordering becomes: depth desc, kills desc (tiebreak), updated_at asc (final tiebreak).
--
-- Backward compatibility: the currently-live prod app does NOT send p_kills.
-- This migration is applied to the live DB BEFORE the new app code ships, so
-- p_kills defaults to 0 and old callers keep working unchanged (their kills
-- stay 0 until they upgrade and start sending real totals).
--
-- kills is a cumulative, monotonic per-device season total (mirrors how
-- depth-best already works) — the upsert stores greatest(existing, new) so a
-- stale/lower resubmit can never lower it, independent of the depth-best logic.
--
-- DO NOT RUN THIS AUTOMATICALLY. Apply by hand against the live Supabase
-- project (wvrllhiktnkvbpclmrpq) via the SQL editor or CLI.

-- 1. New column, defaulted so existing rows/writers are unaffected.
alter table public.scores
  add column if not exists kills bigint not null default 0;

-- 2. Replace the RPC to accept p_kills (defaulted for old callers) and store
--    greatest(existing, new) for kills, while preserving the existing
--    depth-best upsert behavior untouched.
create or replace function public.submit_score(
  p_season text,
  p_device uuid,
  p_name text,
  p_depth integer,
  p_day integer,
  p_lineup jsonb,
  p_kills bigint default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.scores (season_id, device_id, name, depth, day, lineup, kills, updated_at)
  values (p_season, p_device, p_name, p_depth, p_day, p_lineup, p_kills, now())
  on conflict (season_id, device_id) do update
    set name = excluded.name,
        -- unchanged: keep each device's best (deepest) depth for the season
        depth = greatest(public.scores.depth, excluded.depth),
        day = case when excluded.depth > public.scores.depth then excluded.day else public.scores.day end,
        lineup = case when excluded.depth > public.scores.depth then excluded.lineup else public.scores.lineup end,
        -- kills is a cumulative monotonic total — never let a resubmit lower it
        kills = greatest(public.scores.kills, excluded.kills),
        updated_at = now();
end;
$$;

grant execute on function public.submit_score(text, uuid, text, integer, integer, jsonb, bigint) to anon;
