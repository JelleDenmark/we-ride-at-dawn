-- Daily PvP boon picks (issue #184, phase 1). Design bank: docs/design/boons.md
--
-- Every dawn a player is offered three boons (derived from the ride-date by
-- packages/core/src/boons.ts, never stored) and picks one. This table holds
-- the pick.
--
-- WHY ITS OWN TABLE INSTEAD OF pvp_boards.board
--
-- The pick must be SECRET until the round is scored. pvp_boards has
-- `grant select ... to anon` plus a public-read RLS policy and fetchGhosts
-- returns the whole row, so anything stored in that payload is readable by
-- anyone who curls the table. A visible pick turns the daily choice into a
-- counter-picking race instead of a simultaneous read, which is the entire
-- point of the mechanic.
--
-- So: no anon select, no RLS read policy, no view. The only ways in are the
-- two security-definer RPCs below (write your own, read your own, both keyed
-- on device_id) and the service role, which the nightly job uses to read the
-- whole round at scoring time. device_id stopped being published to anon in
-- b6489d8 — that opacity is the boundary this secrecy leans on. It is a
-- friend-group-scale boundary, not a cryptographic one, and is meant as such.
--
-- The reveal is deliberate and lives elsewhere: after scoring, the nightly job
-- writes each entrant's boon into the round's snapshotted boards, which are
-- already public post-round and are what the duel replay renders from. Hidden
-- while it could be countered, visible once it can only be learned from.
--
-- SHARED-PROJECT NOTE: this Supabase project is shared with the Rats_PvP fork
-- and the pvp_* prefix is contended (see the fingerprint dance at the top of
-- 2026-07-30-add-pvp-league.sql, which had to drop a colliding pvp_boards).
-- pvp_boon_picks is new on both sides as of 2026-08-12. If a future migration
-- finds an unexpected shape here, fingerprint before dropping — do not assume
-- this file created it.

-- ---------------------------------------------------------------------
-- pvp_boon_picks — one row per player per ride-date. Last write wins.
--
-- Keyed on (season_id, ride_date, device_id) rather than on a round_id: those
-- are the two values the client certainly knows, and ride_date is what the
-- nightly job feeds to `isBoonOffered` to check the pick was actually on that
-- day's menu. season_id matches every other table in this schema and carries
-- the dev- prefix on the dev channel, so dev and prod picks never mix.
--
-- ride_date is the 06:00-rollover ride-day (`currentRideDate`), NOT the wall
-- clock date. Between 22:00 and 06:00 the round has already been scored while
-- the ride-date has not yet rolled — the same seam that caused the 2026-07-21
-- no-rides-overnight bug — so a pick written in that window belongs to a round
-- that is already closed. That is harmless (see the lock note on
-- submit_pvp_boon) but it is why this column must never be derived from now().
-- ---------------------------------------------------------------------
create table if not exists public.pvp_boon_picks (
  season_id  text not null,
  ride_date  text not null,
  device_id  uuid not null,
  boon_id    text not null,
  updated_at timestamptz not null default now(),
  primary key (season_id, ride_date, device_id)
);

create index if not exists pvp_boon_picks_season_date_idx
  on public.pvp_boon_picks (season_id, ride_date);

-- Deliberately NO `grant select ... to anon` and NO read policy. RLS is on so
-- that a future accidental grant still cannot read rows: a table with RLS
-- enabled and no permissive policy denies everything to non-superusers, which
-- is the belt to the missing grant's braces. The service role bypasses RLS,
-- which is how the nightly job reads the round.
alter table public.pvp_boon_picks enable row level security;

-- ---------------------------------------------------------------------
-- submit_pvp_boon — write (or clear) your own pick.
--
-- Passing null for p_boon CLEARS the pick, because "no pick" is a legal state
-- that means no boon (#184 rule 7 — never an auto-pick), and a player who
-- changes their mind back to nothing should be able to say so.
--
-- Bounds only, matching submit_pvp_board's posture: this checks that the id is
-- a plausible string, NOT that the boon was on the day's menu. That check
-- needs the ride-date derivation, which lives in TypeScript
-- (boons.ts's `isBoonOffered`), and is enforced by the nightly job — the only
-- consumer whose opinion decides a round.
--
-- NO CLOSE-TIME LOCK, on purpose. A pick written after the round was scored
-- cannot affect it: the job reads every pick once at scoring time and
-- `roundAlreadyClosed` stops a round ever being scored twice, so a late write
-- lands on a round that has already resolved and is simply never read. The
-- 22:00 lock is therefore a UI affordance, not a security boundary, and
-- putting a redundant timestamp check in here would couple this RPC to the
-- round lifecycle for no gain.
-- ---------------------------------------------------------------------
drop function if exists public.submit_pvp_boon(text, text, uuid, text);
create function public.submit_pvp_boon(
  p_season text,
  p_ride_date text,
  p_device uuid,
  p_boon text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if p_boon is null or p_boon = '' then
    delete from public.pvp_boon_picks
     where season_id = p_season and ride_date = p_ride_date and device_id = p_device;
    return;
  end if;

  if length(p_boon) > 48 then
    raise exception 'pvp boon id implausibly long';
  end if;

  insert into public.pvp_boon_picks as p (season_id, ride_date, device_id, boon_id, updated_at)
  values (p_season, p_ride_date, p_device, p_boon, now())
  on conflict (season_id, ride_date, device_id) do update set
    boon_id    = excluded.boon_id,
    updated_at = now();
end;
$function$;

grant execute on function public.submit_pvp_boon(text, text, uuid, text) to anon;

-- ---------------------------------------------------------------------
-- my_pvp_boon — read back YOUR OWN pick, and only your own.
--
-- The client keeps its pick in local state, so this exists for the case that
-- state is gone: a reinstall, a cleared cache, or a second load of the same
-- device_id. Scoped to a single (season, ride_date, device) triple and
-- returning a scalar rather than a set, so it cannot be walked to enumerate
-- other players even by someone holding a list of device ids.
-- ---------------------------------------------------------------------
drop function if exists public.my_pvp_boon(text, text, uuid);
create function public.my_pvp_boon(
  p_season text,
  p_ride_date text,
  p_device uuid
)
 returns text
 language sql
 security definer
 set search_path to 'public'
 stable
as $function$
  select boon_id
    from public.pvp_boon_picks
   where season_id = p_season
     and ride_date = p_ride_date
     and device_id = p_device;
$function$;

grant execute on function public.my_pvp_boon(text, text, uuid) to anon;

-- ---------------------------------------------------------------------
-- pvp_results.boon_id — the reveal.
--
-- The pick is secret in pvp_boon_picks while the round is live and becomes
-- public HERE, once it has been scored and can no longer be countered. This
-- column is what the duel replay reads to show what each side brought.
--
-- Snapshotted for the same reason pvp_results.board already is: pvp_boon_picks
-- is live state a player can change the instant the round closes, so the only
-- trustworthy record of what was actually fielded is the copy taken at scoring
-- time. Nullable because not picking is a legal state meaning no boon
-- (#184 rule 7) — never an auto-pick.
--
-- ORDERING: this must be applied BEFORE the nightly job that writes it ships.
-- roundResultsFor emits boon_id on every result row (explicitly null when
-- there is no pick), and PostgREST rejects the whole bulk insert if the column
-- does not exist — which would fail the round, not just the boon.
-- ---------------------------------------------------------------------
alter table public.pvp_results add column if not exists boon_id text;

-- Republish the read view with the new column. Clients read
-- pvp_results_public, never the base table — anon lost select on pvp_results
-- when device_id was hidden (2026-08-01-hide-device-id.sql), so a column added
-- only to the base table is invisible to the app.
--
-- This is a full re-issue of the view definition from that migration, plus
-- boon_id. `create or replace view` cannot add a column to an existing view
-- (42P16 — replace may only append if the leading column list is unchanged,
-- and Postgres rejects the shape change), so drop-then-create is the honest
-- path, same as that migration used. The grant must be re-issued too: dropping
-- a view drops its grants with it.
--
-- security_invoker = false is load-bearing and must stay: the view reads a
-- base table anon cannot select, so it has to run as its owner.
drop view if exists public.pvp_results_public;
create view public.pvp_results_public
with (security_invoker = false) as
select
  encode(sha256(convert_to('wrad:' || r.device_id::text, 'UTF8')), 'hex') as player_id,
  r.round_id,
  r.season_id,
  r.name,
  r.points,
  r.wins,
  r.draws,
  r.losses,
  r.survivor_diff,
  r.updated_at,
  r.board,
  r.boon_id
from public.pvp_results r;

grant select on public.pvp_results_public to anon;
