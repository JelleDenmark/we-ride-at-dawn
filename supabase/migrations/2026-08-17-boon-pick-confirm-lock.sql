-- Boon pick confirm-and-lock (issue #184 follow-up). Design bank:
-- docs/design/boons.md, "Picks stay changeable until 22:00" section, now
-- superseded.
--
-- WHAT WAS WRONG
--
-- Two bugs, one root cause: the pick stayed freely changeable, client-side and
-- server-side, right up until the nightly job happened to read it.
--
-- 1. Deep Scout costs nothing. The app reveals every rival's exact roster the
--    instant the player TAPS Deep Scout (client-only, no round-trip needed to
--    read it), and the pick can then be swapped back to a real combat boon
--    before the round is scored. That banks the scouting AND a real boon,
--    which is strictly dominant over ever honestly keeping Deep Scout.
-- 2. The "change it until 22:00" copy was simply false. The nightly job
--    (wrad-pvp-cron.yml) fires ~22 minutes before the advertised 22:00 slot on
--    purpose (anti clock-sniping), and submit_pvp_boon deliberately had no
--    close-time lock at all ("the 22:00 lock is therefore a UI affordance,
--    not a security boundary" — this file changes that).
--
-- THE FIX
--
-- A pick is now DRAFT until the player explicitly confirms it, and CONFIRMED
-- is a one-way door: once confirmed=true, submit_pvp_boon refuses any further
-- write for that (season, ride_date, device), full stop — no more changes,
-- not even clearing back to no-pick. The app only unlocks Deep Scout's roster
-- view once the pick is confirmed, which is what actually closes the exploit:
-- you cannot see the intel without having already spent the day's pick on it,
-- irrevocably.
--
-- The nightly job (packages/core/scripts/lib/pvp-league.ts fetchBoonPicks)
-- is updated alongside this to only read confirmed=true rows — an unconfirmed
-- draft must never silently score, which is the other half of the fix.
--
-- Owner decision (Jesper, 2026-08-17): all boons lock on confirm, not just
-- Deep Scout. Simpler mental model ("pick, then confirm, then it's tonight's
-- boon") and avoids a special-cased rule that only Deep Scout is sticky.

alter table public.pvp_boon_picks
  add column if not exists confirmed boolean not null default false;

-- ---------------------------------------------------------------------
-- submit_pvp_boon — write (or clear) your own DRAFT pick, or confirm it.
--
-- Arity change from (text, text, uuid, text) to (text, text, uuid, text,
-- boolean): the explicit drop below is required, not optional — see the
-- Supabase-RPC-arity gotcha this project has hit before. Leaving both
-- signatures live would make an old 4-arg call and a new 5-arg call (with
-- p_confirm defaulted) both plausible matches for the same JSON body, and
-- PostgREST answers that ambiguity with PGRST203 rather than picking one.
-- ---------------------------------------------------------------------
drop function if exists public.submit_pvp_boon(text, text, uuid, text);
create function public.submit_pvp_boon(
  p_season text,
  p_ride_date text,
  p_device uuid,
  p_boon text,
  p_confirm boolean default false
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_confirmed boolean;
begin
  if p_season is null or p_season = '' then
    raise exception 'pvp boon season_id required';
  end if;

  -- Zero-padded YYYY-MM-DD, the shape `currentRideDate` emits. Rejecting
  -- anything else keeps the key space from silently forking into two formats
  -- that would never match the job's lookup.
  if p_ride_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'pvp boon ride_date must be YYYY-MM-DD, got %', p_ride_date;
  end if;

  select confirmed into v_confirmed
    from public.pvp_boon_picks
   where season_id = p_season and ride_date = p_ride_date and device_id = p_device;

  -- The one-way door. Once confirmed, nothing about this key moves again
  -- today — not a different boon, not a clear-to-null. A confirmed row can
  -- only be produced by this same function reaching the upsert below with
  -- p_confirm = true, so there is no path that resets it without a new day
  -- (a new ride_date is a different primary key entirely).
  if v_confirmed then
    raise exception 'pvp boon pick already confirmed for this ride-date';
  end if;

  if p_boon is null or p_boon = '' then
    -- Clearing an unconfirmed draft back to "no pick" — still a legal move,
    -- since the row we might be deleting is guaranteed unconfirmed by the
    -- check above.
    delete from public.pvp_boon_picks
     where season_id = p_season and ride_date = p_ride_date and device_id = p_device;
    return;
  end if;

  if length(p_boon) > 48 then
    raise exception 'pvp boon id implausibly long';
  end if;

  insert into public.pvp_boon_picks as p (season_id, ride_date, device_id, boon_id, confirmed, updated_at)
  values (p_season, p_ride_date, p_device, p_boon, coalesce(p_confirm, false), now())
  on conflict (season_id, ride_date, device_id) do update set
    boon_id    = excluded.boon_id,
    confirmed  = excluded.confirmed,
    updated_at = now();
end;
$function$;

grant execute on function public.submit_pvp_boon(text, text, uuid, text, boolean) to anon;

-- ---------------------------------------------------------------------
-- my_pvp_boon — read back YOUR OWN pick, now including whether it's locked.
--
-- Return shape changes from a bare `text` scalar to a one-row set
-- (boon_id, confirmed), because the app needs to know NOT just what the pick
-- is but whether it's still a changeable draft or a confirmed lock — that
-- distinction is exactly what a reload/reinstall needs to restore correctly.
-- A changed return type cannot be applied with `create or replace`, so this
-- is drop-then-create like the arity change above, same reasoning.
-- ---------------------------------------------------------------------
drop function if exists public.my_pvp_boon(text, text, uuid);
create function public.my_pvp_boon(
  p_season text,
  p_ride_date text,
  p_device uuid
)
 returns table(boon_id text, confirmed boolean)
 language sql
 security definer
 set search_path to 'public'
 stable
as $function$
  select boon_id, confirmed
    from public.pvp_boon_picks
   where season_id = p_season
     and ride_date = p_ride_date
     and device_id = p_device;
$function$;

grant execute on function public.my_pvp_boon(text, text, uuid) to anon;
