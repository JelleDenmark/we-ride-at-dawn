-- Nightly PvP league — first backend pass (WRAD's first continuously-stored
-- per-player state; every prior table is a "best run so far" snapshot,
-- these are live/ongoing state a nightly job reads and writes).
--
-- Players keep building the ONE board (horde) that already rides the PvE
-- gauntlet; this migration adds the plumbing to sync that same board
-- server-side and let a nightly 20:00 job fight everyone's ghost, all-vs-all
-- round robin (max ~6 players), football scoring (win=3/draw=1/loss=0),
-- survivor-differential tiebreak, over a 7-day league window that resets
-- Monday 06:00. The scheduling/matchmaking/scoring logic itself is NOT here
-- — this is only the three tables + one client-facing RPC the job and the
-- client both need:
--
--   * pvp_boards  — each player's current synced board (one row per player
--                   per season; overwritten in place as they keep editing).
--   * pvp_rounds  — league round lifecycle (one row per nightly round).
--   * pvp_results — standings the nightly job writes per round.
--
-- Three brand-new, independent tables — NOT a modification of `scores`,
-- `boss_trial_scores`, or anything else in this schema.
--
-- DO NOT RUN THIS AUTOMATICALLY. Apply by hand against the live Supabase
-- project (wvrllhiktnkvbpclmrpq) via the SQL editor or CLI, before any PvP
-- app code or nightly-job code ships — everything described here is inert
-- until applied.
--
-- Arity note (same guard as submit_score / submit_boss_trial — see
-- 2026-07-06-add-kills.sql lines 57-65 for the incident this protects
-- against): submit_pvp_board is a brand-new function name with no prior
-- overload, so `create or replace` below is safe as a first apply. If this
-- signature is EVER changed later (a param added/removed), that change must
-- explicitly `drop function if exists public.submit_pvp_board(<old
-- signature>)` in the same migration, or PostgREST will see two matching
-- candidates for an old-shaped call and every such submit starts failing
-- silently with PGRST203.
--
-- RLS posture note (WRAD's standing rule — see boss-trial migration and the
-- Supabase RLS/grant gotcha memory): `grant select` alone does NOT restrict
-- anon to read-only. Supabase's default privileges hand anon
-- INSERT/UPDATE/DELETE/TRUNCATE on new public tables too, so every table
-- below enables RLS with a single public-read SELECT policy and nothing
-- else — anon's only write path is through the security-definer RPC, which
-- bypasses RLS by design.

-- ---------------------------------------------------------------------
-- 1. pvp_boards — the synced current board per player per season.
--
-- Unlike `scores`/`boss_trial_scores` (best-attempt-so-far, monotonic),
-- this is live state: it always holds whatever the player's board looks
-- like RIGHT NOW, so the nightly job can pick it up and other players can
-- scout it as "last night's ghost". `board` stores the same `Lineup` shape
-- already used for gauntlet runs and (per packages/core/src/sim.ts) duel
-- mode: `{ units: [{ defId, tier?, relicIds? }], teamRelicIds?, combatCap?
-- }` — see packages/core/src/data/units.ts LineupUnit/Lineup.
--
-- season_id is `text` and device_id is `uuid`, matching every existing
-- table in this schema (`scores`, `boss_trial_scores`) — device_id comes
-- from `deviceId()` in packages/app/src/telemetry.ts
-- (`crypto.randomUUID()`, persisted in localStorage), and season_id is
-- whatever the client passes through `boardSeason()`
-- (packages/app/src/leaderboard.ts), which prepends `dev-` on dev-channel
-- builds so dev and prod boards never mix. No new prefixing logic needed
-- here — it's entirely a client-side string, same as every other board.
create table if not exists public.pvp_boards (
  season_id  text not null,
  device_id  uuid not null,
  name       text not null,
  board      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (season_id, device_id)
);

-- Public read: the client scouts opponents' current boards directly via
-- PostgREST GET, same access pattern as `scores`/`boss_trial_scores`.
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

-- Upsert RPC. Last-write-wins on updated_at (NOT a monotonic
-- greatest()-style board like depth/damage/kills — a player is allowed to
-- freely rework their horde between now and 20:00, and only the latest
-- edit should be what the nightly job fights).
--
-- Anti-cheat posture: "cheap sanity bounds", not a full server-authoritative
-- economy (matches every other board in this schema — client-trusted,
-- flagged not solved). The checks below only reject payloads that could not
-- possibly be a legal board — malformed/corrupted JSON, an absurd unit
-- count, or an absurd combat cap — they do NOT validate that the specific
-- defIds/tiers/relicIds were legitimately earned; that would need the full
-- shop economy replayed server-side, which is explicitly out of scope here.
--
-- The two bounds mirror packages/core/src/sim.ts constants, hand-copied
-- since SQL can't import them — BOARD_CAP=8 (hard deploy-slot ceiling) and
-- COMBAT_CAP_BONUS=6 (the largest summon-cap bonus above BOARD_CAP a
-- legitimate build reaches, see the summon-cap rework / issue #105). If
-- either constant changes in packages/core, these bounds should be
-- revisited in a follow-up migration — they are deliberately generous
-- ("cheap"), not exact mirrors, so a sim-side tweak won't need a same-day
-- DB migration to avoid false-rejecting legal boards.
create or replace function public.submit_pvp_board(
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
-- `status` transitions open -> scoring -> closed as the (not-yet-written)
-- nightly job processes each round: open while boards can still be synced
-- and read as "current", scoring while the job is running the round-robin,
-- closed once pvp_results for the round is final. season_id ties a round
-- back to the 7-day league window it belongs to (the league itself resets
-- Monday 06:00 — that reset is enforced by whatever seeds new rounds, not
-- by this table).
--
-- round_id is left as an opaque `text` primary key rather than a generated
-- id, same shape as the fork's pvp_rounds — the nightly job's seeding logic
-- (not written yet) decides the exact format (e.g. `${season_id}-YYYY-MM-DD`
-- for one round per night). See PVP-NOTES.md.
create table if not exists public.pvp_rounds (
  round_id   text primary key,
  season_id  text not null,
  opens_at   timestamptz not null default now(),
  closes_at  timestamptz not null,
  status     text not null default 'open' check (status in ('open', 'scoring', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists pvp_rounds_season_id_idx on public.pvp_rounds (season_id);

-- Public read only — no anon write policy. Only the service-role key
-- (bypasses RLS), used by the nightly job, opens/advances/closes rounds.
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
-- 3. pvp_results — per-round, per-player standings written by the nightly
-- job (with the service-role key, which bypasses RLS — anon has no write
-- path to this table at all, unlike pvp_boards). One row per player per
-- round: primary key (round_id, device_id).
--
-- `points` is football scoring for the round (win=3, draw=1, loss=0),
-- summed across the round's matches — the value the 7-day league table
-- ranks on. `survivor_diff` is the tiebreak (sum of your surviving units
-- minus theirs, across the round's matches) — kept as a separate column
-- rather than folded into `points` so the headline standing isn't swingy
-- (same reasoning as the fork's `margin` column, renamed here to match
-- this migration's brief).
--
-- round_id is not declared as a foreign key to pvp_rounds — no table in
-- this schema uses foreign keys (season_id on `scores` isn't FK'd to
-- anything either); the nightly job is trusted to write consistent rows,
-- matching the rest of this schema's posture.
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

-- Public read only — same posture as pvp_rounds. The client reads this
-- table directly via PostgREST GET to render standings; only the
-- service-role nightly job writes it.
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
