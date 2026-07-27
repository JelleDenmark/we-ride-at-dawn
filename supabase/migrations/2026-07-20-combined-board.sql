-- Combined leaderboard view (issue #132): depth stays the board's identity,
-- Boss Trial damage breaks ties in the (saturated) top band, kills drops to
-- third. Lexicographic, never a weighted formula — damage is uncapped and
-- inflates with board power every season, while depth is capped at
-- WAVE_COUNT, so any fixed weighting either lets damage swamp depth or
-- needs re-tuning every season.
--
-- security_invoker=on so the view runs under the caller and respects both
-- tables' existing public-read RLS policies instead of the view owner's
-- rights (see the RLS/grant gotcha: grants don't restrict anon, RLS does —
-- the view must not become a hole around it).
--
-- Anti-cheat note (flag, don't solve — same posture as #81/#107): boss
-- damage is client-trusted and uncapped, and this view makes it
-- rank-deciding on the main board. The #81 verify-scores pattern extends to
-- boss_trial_scores near-mechanically (simulateBossTrial is deterministic
-- from the stored lineup) if spoofing appears.
--
-- Applied to the live project 2026-07-20 via the Management API.

create or replace view public.combined_board with (security_invoker=on) as
  select s.season_id, s.device_id, s.name, s.depth, s.day, s.kills,
         s.updated_at, s.verified,
         coalesce(b.damage, 0)  as boss_damage,
         coalesce(b.phases, 0)  as phases,
         (b.device_id is not null) as boss_attempted
  from public.scores s
  left join public.boss_trial_scores b using (season_id, device_id);

grant select on public.combined_board to anon;
