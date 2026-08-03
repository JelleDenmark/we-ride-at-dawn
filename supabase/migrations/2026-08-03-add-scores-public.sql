-- Restore a ranked read of the depth board (issue #171 / player feedback:
-- with the ranked depth board gone, the only social touchpoint left is the
-- once-a-night PvP duel, so the game reads as solo the other 23 hours).
--
-- `scores` itself still holds every device's season-best depth (submitScore
-- never stopped writing it — see the NOTE at the bottom of leaderboard.ts),
-- but the client can no longer read device_id off it directly: 2026-08-01's
-- hide-device-id migration earmarked `scores` for the same anon-select revoke
-- as pvp_boards/pvp_results, specifically BECAUSE it still published
-- device_id to anyone reading the board. Restoring a ranked view without
-- fixing that would just re-open the hole that migration closed.
--
-- So this follows the exact same shape as pvp_boards_public/pvp_results_public:
-- a security-definer view that swaps device_id for the opaque
--     player_id = sha256('wrad:' || device_id)
-- Client-side `isMe()` (leaderboard.ts) already expects `player_id` — it was
-- written against that contract when the pvp boards migrated, so this view
-- is what makes the depth board's "· you" highlight work again.
--
-- DO NOT RUN AUTOMATICALLY. Apply by hand (SQL editor / CLI). Re-run safe.

drop view if exists public.scores_public;
create view public.scores_public
with (security_invoker = false) as
select
  encode(sha256(convert_to('wrad:' || s.device_id::text, 'UTF8')), 'hex') as player_id,
  s.season_id,
  s.name,
  s.depth,
  s.day,
  s.kills,
  s.updated_at
from public.scores s;

grant select on public.scores_public to anon;

-- Verify (anon key): select * from scores_public order by depth desc limit 5;
