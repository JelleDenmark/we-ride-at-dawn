-- Stop publishing raw device_id to anon; serve an opaque player_id instead.
--
-- WHY. Identity is an unauthenticated, client-claimed `device_id`, and the
-- write RPCs (`submit_score`, `submit_pvp_board`) take it as a PARAMETER
-- without proving ownership. That vector is recorded on the security backlog;
-- the nightly PvP league sharpened it, because `pvp_boards` is deliberately
-- last-write-wins (a player reworks their horde all day), so a device_id read
-- off the public board can be used to overwrite that player's board before the
-- 20:00 job scores it. `pvp_results` is final once a round closes.
--
-- The real fix is auth-keyed writes (`auth.uid()` inside the definer body,
-- #100 Phase 2). This migration is the cheap half: it removes the KEY from
-- public view. Anyone who already harvested a device_id keeps it, and nothing
-- here stops a write from someone who has one. **This is obscurity, not
-- security** — it raises the cost of finding a target, it does not close the
-- hole. Do not let it de-prioritise Phase 2.
--
-- HOW. Two security-DEFINER views expose everything the client needs except
-- device_id, replacing it with
--     player_id = sha256('wrad:' || device_id)
-- and anon's select on the base tables is revoked. Definer (not invoker) is
-- load-bearing: an invoker view runs with the CALLER's rights, so it would
-- still need anon to hold select on the base table and would defeat the point.
--
-- `sha256()` is core Postgres 11+ (bytea in, bytea out) — deliberately NOT
-- pgcrypto's `digest()`, so this carries no extension dependency. The client
-- computes the identical digest with WebCrypto (`crypto.subtle.digest`), which
-- has SHA-256 but no MD5 — another reason for this choice. See `playerId()` in
-- packages/app/src/leaderboard.ts; the two must stay byte-identical or `isMe()`
-- silently stops matching and every player sees themselves as a stranger.
--
-- The salt is a FIXED string, not the season id. A per-season salt would stop
-- ids correlating across seasons, which sounds better but breaks the career /
-- hall-of-fame read model (#164) — that needs one stable public id per player
-- across every season. Cross-season correlation is the feature here.
--
-- DO NOT RUN AUTOMATICALLY. Apply by hand (SQL editor / CLI). Re-run safe.
--
-- ORDER OF OPERATIONS MATTERS — see PART B. Apply Part A now; Part A is purely
-- additive and breaks nothing. Part B is the revoke, and it breaks any client
-- still running the old build. Given the service-worker staleness problem
-- (a waiting SW serves the previous bundle until the player taps to reload),
-- leave a gap between them.

-- =====================================================================
-- PART A — additive. Safe to apply immediately.
-- =====================================================================

-- Dropped and recreated rather than `create or replace`: replace cannot change
-- a view's column list, and these views are defined by which column they omit.
drop view if exists public.pvp_boards_public;
create view public.pvp_boards_public
with (security_invoker = false) as
select
  encode(sha256(convert_to('wrad:' || b.device_id::text, 'UTF8')), 'hex') as player_id,
  b.season_id,
  b.name,
  b.board,
  b.updated_at
from public.pvp_boards b;

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
  r.board
from public.pvp_results r;

grant select on public.pvp_boards_public  to anon;
grant select on public.pvp_results_public to anon;

-- DIGEST CONTRACT CHECK — run this after applying Part A. It must return true.
--
-- The expected value was computed from the client implementation itself (the
-- WebCrypto path in `playerId()`), against a synthetic all-zero uuid rather
-- than a real device_id, so this file publishes nothing. If it ever returns
-- false, Postgres and the browser have drifted and `isMe()` is silently broken
-- for every player — nobody sees "· you" and everyone scouts their own board.
--
--   select encode(sha256(convert_to('wrad:00000000-0000-0000-0000-000000000000', 'UTF8')), 'hex')
--        = 'ab4227a31eaf2ac215f621b8246cae996e5b18d0b34275abebfb1512038770f3' as digest_ok;

-- =====================================================================
-- PART B — the revoke. This is the step that actually hides device_id.
--
-- APPLY ONLY AFTER the client build that reads the *_public views is live AND
-- players have rolled onto it. Until then a stale client selecting device_id
-- from the base table gets a 403 and renders "no duel yet" (the read paths all
-- fail soft to an empty array, so it degrades rather than crashes — but the
-- league looks empty, which during cutover week reads as a broken deploy).
--
-- KNOWN CONSUMERS CHECKED before writing this:
--   * packages/core/scripts/lib/pvp-league.ts `fetchBoards` read pvp_boards
--     with the ANON key so that `--dry` works without secrets. Revoking anon
--     WOULD HAVE SILENTLY KILLED THE NIGHTLY JOB. Changed in the same commit to
--     use the service-role key; it needs real device_ids anyway, since it
--     writes pvp_results keyed on them. A keyless `--dry` now also needs the
--     key for its read.
--   * pvp_rounds / pvp_config carry no device_id — untouched, still anon-read.
--   * packages/core/scripts/pvp-dry-run-leaderboard.ts reads `scores` with anon
--     (self-described throwaway analysis). Now prefers SUPABASE_SERVICE_ROLE_KEY
--     from the environment when present.
--   * verify-scores + the nightly Discord post already use the service role.
--   * `runs` (telemetry) and `feedback` both store device_id but are NOT a
--     third exposure: an anon count on each returns `Content-Range: */0`, so
--     their RLS admits inserts and hides every row. Left alone.
--
-- `scores` is included even though the client no longer reads it at all (the
-- ranked depth board died with the Boss Trial). It still serves device_id to
-- anon, and a key published anywhere is a key published — leaving it would
-- make Part A pointless.
-- =====================================================================

-- APPLIED 2026-08-13, twelve days late. It was left commented pending the
-- *_public client rollout, that rollout completed within days, and nobody came
-- back to it — so raw device_ids stayed publicly readable the whole time.
-- Found by accident: a control query while verifying the boon migration
-- returned a live device_id from pvp_results where it should have 403'd.
-- device_id is the unverified key every write RPC accepts, so this was an
-- impersonation surface, not just an information leak. See the issue.
revoke select on public.pvp_boards  from anon;
revoke select on public.pvp_results from anon;
revoke select on public.scores      from anon;

-- The "public read" RLS policies on those tables become unreachable for anon
-- once the grant is gone. Left in place deliberately: they are harmless, and
-- dropping them would make re-granting during an incident a two-step recovery
-- instead of one. Note that RLS never restricted anon here anyway — the GRANT
-- is what did, which is the inverse of the usual assumption.

-- Verify after Part B (all three should be 403 / empty, from an anon key):
--   select * from scores limit 1;
--   select * from pvp_boards limit 1;
--   select * from pvp_results limit 1;
-- And these should still work:
--   select * from pvp_boards_public limit 1;
--   select * from pvp_results_public limit 1;
