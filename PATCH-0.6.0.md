# Patch rundown — v0.6.0 (prod)

_Staged on `dev`, verified live at the dev channel. Not yet on prod (prod = 0.5.0). This is the ready-to-go rundown for the prod push._

## Player-facing patch notes

**We Ride at Dawn — v0.6.0**

- ⚔️ **The drains run far deeper.** The gauntlet used to top out at **12 waves — now it runs to 45**, and there's real reason to chase them: enemies get genuinely tougher the deeper you push (the deep wardens are HP-heavy brutes now, not chaff), so **raw attack finally bites** where it used to glance off a one-shot.
- 🗓️ **Difficulty now comes from depth, not the day.** Before, each later day of the expedition fielded a harder gauntlet. Now **every day's ride is the same difficulty** — you reach deeper simply because your **horde grows stronger over the week** (bigger warren, tier-ups, more trinkets). Your deepest ride should land late in the week on your strongest horde, not on some mid-week sweet spot. _(The daily foe line-up still rotates; only the difficulty scaling changed.)_
- 🗡️ **New trinket — Gore-Cleaver:** a killing blow spills its overkill onto the next foe in line.
- 💀 **Rats felled this week:** your horde tallies every kill of the season — a badge of the grind, and the tiebreak when two warlords ride equally deep.
- ▶️ **Watch it your way:** 1×/2×/4× replay speed + a "skip to the final stand" button.
- 🐀 Clearer first ride, tidier leaderboard on phones, honest wording throughout (incl. a note that summons pause when your warren is full).

## What a prod deploy actually does (no reset)

- **Season does NOT reset.** Season id = the current Monday, derived from the date, not the code. The weekly board keeps every row; a reset only happens at the real Monday 06:00 CET boundary.
- **Players keep everything** — horde, scrap, expedition day, ride log, season-best all live in prod-namespaced localStorage (`wrad:*`) and a deploy never touches it. The new "felled" counter starts at 0 for the current week.
- **Existing leaderboard scores remain** in Supabase.
- **The game rules change immediately** — the gauntlet is deterministic from `(date, day, hour) + code`, so new rides run the new curve (ceiling 45, tankier depth-scaled foes, flat day-difficulty, Gore-Cleaver, kills tracked).

### ⚠️ Timing consideration — deploy at the Monday reset
A mid-week deploy leaves a **mixed-curve board**: old-curve depths (12 ceiling) next to new-curve depths (up to 45, tankier). Post-deploy re-rides can leapfrog players who finished early — through no fault of theirs. Deploying at **Monday 06:00 CET** puts everyone on the new curve with a clean board. (Forcing a mid-week reset would mean wiping the current prod season's rows by SQL — messy; players' hordes were built on the old curve anyway.)

### Minor upgrade wart
Existing players' pre-0.6.0 ride-log rows lack the `enemiesDefeated` field and would render **"undefined felled"** until they roll off (~a day of rides). Optional one-line defensive fix: `r.enemiesDefeated ?? 0` in the ride-log render.

## Operational checklist (the careful prod path)

1. **⏰ Prefer the Monday 06:00 CET reset** (see timing above).
2. **Merge `dev` → `master`.**
3. **Version bump to 0.6.0 is pre-staged** on `dev` (`telemetry.ts` `APP_VERSION`), so the merge carries it.
4. **Push `master` alone.** Do **not** push `dev` around the same time — the deploy-race rule. Then `gh run watch` to full completion.
5. If the deploy step flakes ("Deployment failed, try again later" = infra), `gh run rerun --failed` or an empty commit.
6. **Verify the live prod bundle hash + version myself** — never trust the green check alone.

## No action needed / already handled

- **DB migration already applied** to shared Supabase (kills column + updated `submit_score`), so **no database step at prod time**. Prod players simply start writing real "felled" counts.
- Board isolation holds — prod writes the bare season id, dev the `dev-` prefix; no cleanup needed.

## Still open (not blockers)

- Gore-Cleaver is a back-loaded (late-game) relic; if we want attack to feel punchier, add an execute/on-kill relic later (per roadmap).
- Poison looked healthy in one test but hasn't had a broad roster sweep.
- Summon-cap: shipped the UI clarity hint; proper summon-build rework is a roadmap item.
