-- Daily Boss Trial (issue #107, Phase 1 — "just a number on a leaderboard",
-- explicitly NO rewards in this pass) leaderboard backend. This is a brand
-- new, independent table + RPC pair — parallel to the existing `scores` /
-- `submit_score` setup (see 2026-07-06-add-kills.sql for that pattern and its
-- greatest()/day-carry upsert shape, mirrored below) — NOT a modification of
-- `scores`. The depth board and the boss-trial board are two separate
-- leaderboards that happen to share a client-side posture.
--
-- New function signature: public.submit_boss_trial(p_season text,
-- p_device uuid, p_name text, p_damage bigint, p_phases integer,
-- p_day integer, p_lineup jsonb) returns void.
--
-- DO NOT RUN THIS AUTOMATICALLY. Apply by hand against the live Supabase
-- project (wvrllhiktnkvbpclmrpq) via the SQL editor or CLI, before the new
-- app code ships — packages/app/src/boss-trial-board.ts calls this RPC and
-- reads this table directly (PostgREST GET), and both fail/no-op until this
-- migration has been applied.
--
-- Arity note — read this before ever changing this function's signature
-- (see 2026-07-06-add-kills.sql lines 57-65 for the incident this guards
-- against, where adding a param to submit_score silently created a SECOND
-- overload and broke every legacy client call with PGRST203): this is a
-- brand-new function name with no prior overload, so `create or replace`
-- below is safe as a first apply — there is nothing to `drop function`. If
-- this signature is EVER changed later (a param added or removed), that
-- change must explicitly `drop function if exists
-- public.submit_boss_trial(<old signature>)` in the same migration, or
-- PostgREST will see two matching candidates for an old-shaped call and
-- every such submit will start failing silently.
--
-- Anti-cheat (issue #107's "Anti-cheat note", same posture as the depth
-- board / #81): this score is entirely client-trusted, with no server-side
-- re-simulation. Shipped anyway per the RFC's explicit call — flagged, not
-- solved, here and in boss-trial-board.ts's submitBossTrialScore doc comment.

-- 1. The table. One row per device per season (like `scores`), keyed by
--    (season_id, device_id) so a resubmit upserts in place rather than
--    accumulating rows. `day` stores which day-of-season the best damage was
--    set on (1..SEASON_DAYS) — purely informational here; the once-per-day
--    *gate* itself is entirely client-side (persistence.ts), same as depth's
--    day column is informational and the real state lives in seasonBest.
create table if not exists public.boss_trial_scores (
  season_id  text not null,
  device_id  uuid not null,
  name       text not null,
  damage     bigint not null default 0,
  phases     integer not null default 0,
  day        integer not null default 0,
  lineup     jsonb,
  updated_at timestamptz not null default now(),
  primary key (season_id, device_id)
);

-- 2. Public read access mirrors the existing `scores` table's setup: the app
--    reads the board directly via PostgREST GET (fetchBossTrialTop /
--    fetchBossTrialRank in boss-trial-board.ts), so anon needs SELECT.
--
--    RLS IS LOAD-BEARING HERE — DO NOT DROP IT. A `grant select` alone does
--    NOT restrict anon to reading. Supabase's default privileges for new
--    tables in `public` already hand anon INSERT/UPDATE/DELETE/TRUNCATE, so
--    without RLS the anon key (which ships in the client bundle, readable by
--    anyone) could raw-POST scores that bypass the greatest()/day-carry logic
--    in the RPC below, overwrite other riders' rows, or DELETE/TRUNCATE the
--    whole board. Enabling RLS with a single read-only policy is what actually
--    reduces anon to SELECT — exactly how the existing `scores` table is set
--    up (RLS on + a lone "scores public read" SELECT policy), and `runs`
--    ("anonymous inserts only") and `feedback` (RLS on, zero policies =
--    fully private) follow the same pattern. Every table in this schema
--    enables RLS; a new one must too.
--
--    The submit RPC below is `security definer`, so it BYPASSES RLS and can
--    still write — which is the point: writes go through the RPC's upsert
--    logic or not at all.
grant select on public.boss_trial_scores to anon;
alter table public.boss_trial_scores enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'boss_trial_scores'
      and policyname = 'boss trial public read'
  ) then
    create policy "boss trial public read"
      on public.boss_trial_scores for select to anon using (true);
  end if;
end
$$;

-- 3. Upsert RPC — verbatim structural mirror of submit_score's body
--    (2026-07-06-add-kills.sql) with depth/kills swapped for damage/phases:
--    `damage` is the primary score and is monotonic per device (greatest(),
--    same as depth), `phases` and `day`/`lineup` only update when this
--    submission actually improved `damage` (matching how depth's day/lineup
--    only carry forward on a strictly deeper run) so a lower-damage resubmit
--    can never overwrite a better phases/lineup snapshot with a worse one.
create or replace function public.submit_boss_trial(
  p_season text,
  p_device uuid,
  p_name text,
  p_damage bigint,
  p_phases integer,
  p_day integer,
  p_lineup jsonb
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.boss_trial_scores as s (season_id, device_id, name, damage, phases, day, lineup, updated_at)
  values (p_season, p_device, left(coalesce(nullif(p_name,''),'Warlord'),24),
          greatest(p_damage,0), greatest(p_phases,0), p_day, p_lineup, now())
  on conflict (season_id, device_id) do update set
    name       = excluded.name,
    day        = case when excluded.damage > s.damage then excluded.day    else s.day    end,
    lineup     = case when excluded.damage > s.damage then excluded.lineup else s.lineup end,
    phases     = case when excluded.damage > s.damage then excluded.phases else s.phases end,
    -- damage is the cumulative monotonic best — never let a resubmit lower it
    damage     = greatest(s.damage, excluded.damage),
    updated_at = now();
end;
$function$;

grant execute on function public.submit_boss_trial(text, uuid, text, bigint, integer, integer, jsonb) to anon;
