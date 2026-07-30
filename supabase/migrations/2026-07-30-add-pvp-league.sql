-- Nightly PvP league — backend. Also a TAKEOVER of the pvp_* namespace.
--
-- WRAD's league and the retired Rats_PvP prototype share this one Supabase
-- project (wvrllhiktnkvbpclmrpq). The prototype already created pvp_boards /
-- pvp_results / pvp_rounds and a submit_pvp_board(text,uuid,text,jsonb) — all
-- ROUND-keyed, built for its 2-hourly flat-budget format. WRAD's league is
-- SEASON-keyed with a continuously-synced board (tiers + relics allowed), so
-- the schemas are incompatible: a plain `create table if not exists` no-ops
-- against the prototype's tables and the client would write season data into a
-- round-keyed shape, and `create or replace function` fails 42P13 because the
-- first parameter is renamed p_round -> p_season.
--
-- Decision (owner, 2026-07-30): retire the Rats_PvP backend and take over the
-- pvp_* names for WRAD. This migration DROPS the prototype's pvp_* tables and
-- function and rebuilds them to WRAD's schema. The prototype's PvP data is
-- discarded — that is the intent.
--
-- SIDE EFFECTS you must handle out-of-band (not SQL):
--   * The Rats_PvP repo's `rats-cron.yml` will start erroring once these
--     tables change shape — disable that workflow in the Rats_PvP repo.
--   * The deployed rats-pvp client will break (wrong submit signature, wrong
--     data shape) — expected; the fork is being retired.
-- This migration deliberately touches ONLY pvp_* + submit_pvp_board. It does
-- NOT touch scores / boss_trial_scores / runs / feedback, which WRAD still uses.
--
-- DO NOT RUN AUTOMATICALLY. Apply by hand (SQL editor / CLI) against the live
-- project before any PvP client or nightly-job code ships. Everything here is
-- inert until applied.
--
-- Re-run safety: the table drops are GUARDED on the prototype's fingerprint
-- (pvp_boards having a `round_id` column). Once WRAD's season-keyed tables are
-- in place that guard is false, so re-running this migration will NOT drop
-- WRAD's own data — it becomes a no-op past the guard. The function is
-- unconditionally dropped-then-created (same type signature either way, so this
-- is the clean idempotent path that sidesteps the 42P13 rename error).
--
-- RLS posture (WRAD's standing rule / the Supabase RLS-grant gotcha): `grant
-- select` alone does NOT restrict anon — Supabase hands anon write on new
-- public tables too. Every table below enables RLS with a single public-read
-- policy; anon's only write path is the security-definer submit RPC.

-- ---------------------------------------------------------------------
-- 0. Retire the Rats_PvP prototype's pvp_* objects (guarded).
-- ---------------------------------------------------------------------
do $$
begin
  -- Fingerprint the prototype: its pvp_boards is round-keyed (has round_id).
  -- WRAD's is season-keyed (no round_id on pvp_boards), so this is false once
  -- the takeover has happened — making the whole block a no-op on re-run.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pvp_boards'
      and column_name = 'round_id'
  ) then
    drop table if exists public.pvp_boards  cascade;
    drop table if exists public.pvp_results cascade;
    drop table if exists public.pvp_rounds  cascade;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. pvp_boards — the synced current board per player per season.
--
-- Live state (NOT best-attempt-monotonic like scores): always holds whatever
-- the player's board looks like right now, so the nightly job fights the last
-- edit and others scout it as "last night's ghost". `board` stores the same
-- Lineup shape gauntlet runs and duel mode use: { units: [{ defId, tier?,
-- relicIds? }], teamRelicIds?, combatCap? } (packages/core/src/data/units.ts).
-- season_id text / device_id uuid match every existing table in this schema
-- (scores, boss_trial_scores); device_id is deviceId() in telemetry.ts and
-- season_id is boardSeason() in leaderboard.ts (dev- prefixed on the dev
-- channel, so dev and prod boards never mix — no new prefixing here).
-- ---------------------------------------------------------------------
create table if not exists public.pvp_boards (
  season_id  text not null,
  device_id  uuid not null,
  name       text not null,
  board      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (season_id, device_id)
);

grant select on public.pvp_boards to anon;
alter table public.pvp_boards enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pvp_boards'
      and policyname = 'pvp boards public read'
  ) then
    create policy "pvp boards public read"
      on public.pvp_boards for select to anon using (true);
  end if;
end
$$;

-- Upsert RPC. Last-write-wins on updated_at (NOT monotonic like depth/kills —
-- a player reworks their horde freely through the day and the nightly 20:00
-- job fights whatever was synced last).
--
-- Anti-cheat posture: "cheap sanity bounds", not a server-authoritative
-- economy (matches every other board here — client-trusted). These checks only
-- reject payloads that could not possibly be a legal board (malformed JSON,
-- absurd unit count / combat cap); they do NOT verify the specific
-- defIds/tiers/relics were earned. The two numeric bounds mirror
-- packages/core/src/sim.ts (BOARD_CAP=8, COMBAT_CAP_BONUS=6 -> cap headroom),
-- hand-copied since SQL can't import them and deliberately loose.
--
-- Dropped-then-created (not create-or-replace): the retired prototype's
-- submit_pvp_board has the same type signature (text,uuid,text,jsonb) but a
-- renamed first param, which create-or-replace rejects with 42P13. Drop-first
-- is the clean idempotent path.
drop function if exists public.submit_pvp_board(text, uuid, text, jsonb);
create function public.submit_pvp_board(
  p_season text,
  p_device uuid,
  p_name text,
  p_board jsonb
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_units jsonb;
  v_unit_count integer;
begin
  if p_board is null or jsonb_typeof(p_board) <> 'object' then
    raise exception 'pvp board must be a json object';
  end if;

  v_units := p_board -> 'units';
  if v_units is null or jsonb_typeof(v_units) <> 'array' then
    raise exception 'pvp board.units must be a json array';
  end if;

  v_unit_count := jsonb_array_length(v_units);
  if v_unit_count < 1 or v_unit_count > 8 then
    raise exception 'pvp board.units length % out of bounds (1-8)', v_unit_count;
  end if;

  if p_board ? 'teamRelicIds'
     and jsonb_typeof(p_board -> 'teamRelicIds') = 'array'
     and jsonb_array_length(p_board -> 'teamRelicIds') > 8 then
    raise exception 'pvp board.teamRelicIds implausibly large';
  end if;

  if p_board ? 'combatCap'
     and jsonb_typeof(p_board -> 'combatCap') = 'number'
     and (p_board ->> 'combatCap')::numeric not between 0 and 20 then
    raise exception 'pvp board.combatCap out of bounds (0-20)';
  end if;

  insert into public.pvp_boards as b (season_id, device_id, name, board, updated_at)
  values (p_season, p_device, left(coalesce(nullif(p_name,''),'Warlord'),24), p_board, now())
  on conflict (season_id, device_id) do update set
    name       = excluded.name,
    board      = excluded.board,
    updated_at = now();
end;
$function$;

grant execute on function public.submit_pvp_board(text, uuid, text, jsonb) to anon;

-- ---------------------------------------------------------------------
-- 2. pvp_rounds — league round lifecycle. One row per nightly round.
-- status transitions open -> scoring -> closed as the nightly job runs.
-- season_id ties a round to its 7-day league window (the league resets Monday
-- 06:00 — enforced by whatever seeds rounds, not by this table).
-- round_id is an opaque text PK; the nightly job decides the format (e.g.
-- `${season_id}-YYYY-MM-DD` for one round per night).
-- ---------------------------------------------------------------------
create table if not exists public.pvp_rounds (
  round_id   text primary key,
  season_id  text not null,
  opens_at   timestamptz not null default now(),
  closes_at  timestamptz not null,
  status     text not null default 'open' check (status in ('open', 'scoring', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists pvp_rounds_season_id_idx on public.pvp_rounds (season_id);

grant select on public.pvp_rounds to anon;
alter table public.pvp_rounds enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pvp_rounds'
      and policyname = 'pvp rounds public read'
  ) then
    create policy "pvp rounds public read"
      on public.pvp_rounds for select to anon using (true);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3. pvp_results — per-round, per-player standings written by the nightly job
-- (service-role key, bypasses RLS — anon has NO write path here, unlike
-- pvp_boards). One row per player per round: PK (round_id, device_id).
-- `points` is football scoring for the round (win=3/draw=1/loss=0), the value
-- the 7-day league ranks on; `survivor_diff` is the tiebreak, a separate
-- column so the headline standing isn't swingy.
-- ---------------------------------------------------------------------
create table if not exists public.pvp_results (
  round_id      text not null,
  season_id     text not null,
  device_id     uuid not null,
  name          text not null,
  points        integer not null default 0,
  wins          integer not null default 0,
  draws         integer not null default 0,
  losses        integer not null default 0,
  survivor_diff integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (round_id, device_id)
);

create index if not exists pvp_results_season_id_idx on public.pvp_results (season_id);

grant select on public.pvp_results to anon;
alter table public.pvp_results enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pvp_results'
      and policyname = 'pvp results public read'
  ) then
    create policy "pvp results public read"
      on public.pvp_results for select to anon using (true);
  end if;
end
$$;
