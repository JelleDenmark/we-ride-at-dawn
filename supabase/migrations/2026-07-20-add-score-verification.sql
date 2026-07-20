-- Score verification shadow flag (issue #81).
--
-- The verify-scores edge function re-simulates each submitted best ride
-- (the sim is deterministic from the snapshot the client now sends:
-- rideDate + day + lineup + rideHour) and records the outcome here.
--
--   null  = not yet checked, or unverifiable (legacy submission with no
--           ride snapshot — predates the snapshotting client)
--   true  = re-simulation reproduced at least the claimed depth
--   false = re-simulation could NOT reproduce the claimed depth
--
-- ENFORCEMENT POSTURE: shadow-flag only, first season. Nothing reads this
-- column yet — the board shows flagged rows like any other. Flipping to
-- enforcement later = filter `verified=eq.false` out of fetchTop, or reject
-- in the RPC; deliberately NOT done until a season of flag data shows the
-- false-positive rate is actually zero. See
-- supabase/functions/verify-scores/README.md for the full rationale.
--
-- Note: `scores` is public-read, so the flag is publicly visible. That is
-- deliberate — the flag carries no secret, and hiding it would need a
-- column-level view split for no confidentiality gain.
--
-- DO NOT RUN THIS AUTOMATICALLY. Apply by hand against the live Supabase
-- project (wvrllhiktnkvbpclmrpq) via the SQL editor or CLI, BEFORE deploying
-- the verify-scores function (which PATCHes this column).

alter table public.scores
  add column if not exists verified boolean;

comment on column public.scores.verified is
  'Anti-cheat re-simulation outcome (issue #81): null=unchecked/unverifiable, true=reproduced, false=mismatch. Shadow flag — not enforced yet.';

-- Reset the flag whenever a submission BEATS the stored best: the new
-- depth/lineup is a new, unchecked claim, and the sweep only re-selects
-- `verified is null` rows. Same-arity CREATE OR REPLACE (body-only change,
-- no new parameters), so this genuinely replaces the 7-arg function — no
-- second overload, no PGRST203 (the 2026-07-06 arity incident). Body is the
-- live 2026-07-06 version verbatim plus only the `verified` case line.
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
 set search_path to 'public'
as $function$
begin
  insert into public.scores as s (season_id, device_id, name, depth, day, lineup, kills, updated_at)
  values (p_season, p_device, left(coalesce(nullif(p_name,''),'Warlord'),24),
          greatest(p_depth,0), p_day, p_lineup, greatest(p_kills,0), now())
  on conflict (season_id, device_id) do update set
    name       = excluded.name,
    day        = case when excluded.depth > s.depth then excluded.day    else s.day    end,
    lineup     = case when excluded.depth > s.depth then excluded.lineup else s.lineup end,
    verified   = case when excluded.depth > s.depth then null            else s.verified end,
    depth      = greatest(s.depth, excluded.depth),
    -- kills is a cumulative monotonic total — never let a resubmit lower it
    kills      = greatest(s.kills, excluded.kills),
    updated_at = now();
end;
$function$;
