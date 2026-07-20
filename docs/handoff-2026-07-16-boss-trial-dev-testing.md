# Handoff — Boss Trial live verification + dev testing (2026-07-16)

**For a fresh agent picking this up. Read this fully before touching code.**

## The situation

The Daily Boss Trial (issue #107, phased in through #120/#118/#119) is fully built
and deployed on `dev` — engine, fixed-hour auto-resolution, replay, boss art, and
(this session) two real bugs found and fixed. `dev` HEAD is `d6cd5de`. `master`
(prod) is untouched throughout — deploy-race rule still applies (see project
memory `wrad-deploy-race`): never push `dev` and `master` back-to-back without
re-verifying the served bundle.

**What's NOT done: live confirmation on Jesper's own device.** Everything below was
verified by me in an isolated `localhost:5173` browser session with hand-seeded
`localStorage`, never against Jesper's actual phone/device state. He said he'd
check the real 20:00 CET trigger himself and report back — that report hadn't
landed yet when this handoff was written. **Your first job is to get that
confirmation, or re-diagnose if it's still not firing.**

## What was found and fixed this session (in order)

1. **Boss orientation** — the boss SVG's own directional cue was too weak to read
   correctly once the shared gauntlet-side mirror logic applied it; fixed by
   mirroring the source art itself (`packages/app/src/replay/art/boss-trial.svg`),
   not the shared logic (which every other enemy asset correctly depends on).

2. **Blank shop-tile / inspect-sheet descriptions on 4 units** — `App.svelte`'s
   `keywordTag()` and `abilitySentence()` each had their own missing-case gap for
   `backlineDamage`/`buffAdjacentByTribe`/`chargeWhileBenched`/`teamBuffByTime`
   (two separate functions, two separate bugs, same root cause: a switch that
   hadn't kept pace with new `Effect` kinds). Fixed both.

3. **"Previous fight" persistence bug (real, user-reported)** — `bossTrial` was
   reloaded keyed to `seasonId+day`, so the moment the day-advance heartbeat fired
   (same reactive flush as a retroactive resolve, right after a delayed reopen),
   it got reloaded for the NEW day and reset to `null` — the score had already
   saved/submitted correctly, but the "watch" button vanished before the player
   ever saw it. Fixed: `bossTrial` now tracks the single most-recent fight
   (season-scoped only), with its own `day` field compared against `build.day` at
   each use site, so a resolved fight displays as "the previous fight" until the
   next 20:00 supersedes it. See `packages/app/src/persistence.ts` and the two
   `$effect`s + template block in `App.svelte` (search `bossTrial`).

4. **Dev "next day" button skips a due trial (real, found via user report)** — the
   dev-only fast-forward button (`simulateDawn`) mutates `build.date` directly in
   a click handler, with none of the real day-advance heartbeat's declaration-
   order guarantee that lets a page reload resolve today's trial before the date
   moves on. Since `bossTrialDue` deliberately refuses to fire early for a build
   that's ahead of real time (a documented, pre-existing dev-fast-forward guard),
   a skipped trial doesn't resolve late — it doesn't resolve AT ALL until real
   time independently catches up to wherever the date got pushed. **This is the
   leading suspect if Jesper's live device still isn't triggering**: if he ever
   used the dev fast-forward tools on his real device before today, its
   `build.date` may still be sitting ahead of real time, and the code (correctly,
   by design) won't fire until real Copenhagen time catches up to it. Fixed
   going forward (`resolveBossTrialIfDue` extracted, called from both the
   `$effect` and `simulateDawn`), but an EXISTING desync on his device isn't
   retroactively un-stuck by this fix — only by real time passing, or a "fresh
   build" dev reset.

5. **Pack-Caller full rework (unrelated to Boss Trial, same session)** — was a
   near-duplicate of Press-Kin with an invisible tribe-tag multiplier; reworked to
   a `faint`-triggered "gives away its own LIVE (buffed) attack/max-health, split
   evenly, remainder to the frontmost survivors" mechanic. `buffAdjacentByTribe`
   deleted entirely. Also cleaned up Cellar-Coil's inspect-sheet description
   (was a confusing cap+no-op+position-restriction run-on sentence).

## A real risk discovered this session — read before running agents here

**Another Claude Code session was operating on this SAME local checkout
concurrently** (a Glass Shard rework, PR #122, merged straight to `origin/dev` via
GitHub while I was mid-session). My `git commit` landed on a stray branch its
checkout had left behind, and local `dev` was briefly behind `origin/dev` without
me noticing until the next push. **Before every commit/push in this repo: `git
fetch && git log origin/dev -1` and confirm it matches your last known state.**
Don't assume you're the only agent touching `C:\Users\jespe\WRAD`.

## What to do next

1. **Check in with Jesper first** — has he confirmed the trial fired for real at
   20:00 CET? If yes, this handoff is basically closing paperwork (see below). If
   no or unclear, go to step 2.
2. **Diagnose a live non-fire.** Ask what the Boss Trial panel currently says
   (`"fights automatically at 20:00 CET"` = not yet due or a stuck-ahead date;
   `"have a horde standing by..."` = empty board). If it's the stuck-date case
   (see fix #4 above), the fastest confirmation is comparing the app's displayed
   "Week of ... day N/7" against the real calendar date — if the app's date is
   ahead, that's it. A "fresh build" (dev button, wipes the local pending build)
   clears it, though that also wipes his real board — coordinate before doing
   that on his device.
3. **Once confirmed working, close out the now-shipped issues**: #107, #118,
   #119, #120 are all still open on GitHub despite being fully implemented and
   live on `dev` — they were deliberately left open pending this live
   confirmation. Close with a comment linking the relevant commits once verified.
4. **Dev-testing sweep** (the "and dev testing" half of this handoff): the dev
   fast-forward panel (`⏩ +6h income` / `⏭ next day` / `fresh build` / `+10
   scrap`) is the main manual-testing surface and ships live on the deployed
   `/dev/` site (gated on `CHANNEL !== 'prod'`, not on localhost-only) — it's
   worth a fresh pass to check for other places it might silently diverge from
   real-heartbeat behavior the way the Boss Trial one did. `devSkipHours` (income
   fast-forward) is the other manual-mutation path worth the same scrutiny.

## Verification tools

- `npm run test --workspace=@wrad/core` — 264 tests, all green as of `d6cd5de`.
- `npm run build --workspace=@wrad/app` — clean build, no type errors.
- Browser-based verification pattern used this session (no dedicated script
  exists for Boss Trial timing): open the Browser pane against `localhost:5173`
  (`.claude/launch.json` has the `wrad-app` config), seed `localStorage`'s
  `wrad-dev:pending`/`wrad-dev:bosstrial` keys directly via `javascript_tool` to
  fake a populated board / a specific `build.date`/`day`, then reload and read
  the Boss Trial panel text. This is how both the persistence bug and the
  dev-button bug were caught and confirmed fixed — real end-to-end browser
  checks, not just reading the code.
- Always confirm a `dev` deploy against the LIVE served bundle after pushing
  (`curl` the deployed JS, grep for a distinguishing new string) — don't trust a
  green GitHub Actions run alone.

## Guardrails / project discipline (carried over, still apply)

- **Deploy-race rule**: never push `dev`/`master` back-to-back without verifying
  the served bundle (memory `wrad-deploy-race`).
- **Merges are permission-gated**: `gh pr merge` needs Jesper's explicit
  per-session OK (memory `wrad-merge-permission-gating`).
- **Don't trust agent-reported test/build results** — re-run them yourself.
- **Every balance/design number needs Jesper's sign-off** before being treated as
  final, per this project's standing convention.
- **User works from phone, can't run terminal commands** — he can observe/report
  what the app shows, but any git/deploy/dev-tool action needs you to do it or
  walk him through the in-app buttons only.
