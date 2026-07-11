# Handoff — Monday progression fix (2026-07-11)

**For a fresh agent picking this up. Read this fully before touching code.**

## The situation

The 0.6.5 season cut is being held for Jesper's approval and ships at the **Monday
2026-07-13 06:00 CET** season reset. Everything below is **launch-critical for that
cut** — Jesper's words: *"we need this fixed by Monday, otherwise players might give
up day two."* You have ~2 days.

`dev` is at a clean state (all this session's work merged, 189 tests + a clean app
build). `master` is prod and has NOT been touched — do not deploy without Jesper's
explicit go (see the deploy-race rule in project memory).

## The problem, precisely (this is verified, not a hunch)

Player progression feels flat: a real player's max depth crawls and then plateaus,
so grinding a full day nets ~+1 wave. Measured real-player curve (the honest one —
`npm run snowball`, section 7, "default player, board floor 5, no purchased slots"):

| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| avg depth | 2.95 | 4.05 | 5.60 | 6.87 | 7.25 | 7.89 | 7.88 |

Decent to day 4, then dead flat. The `depth-scaling.ts` "ceiling" (hand-built
optimal roster) reaches ~16 — so headroom exists, the median player just can't
reach it.

**Root cause (proven in-session, DON'T re-derive the wrong fix):** it is a
**roster-progression problem, NOT an enemy-difficulty problem.** I softened enemy
health meaningfully (0.20/0.004 → 0.18/0.0025) and the median moved only **+0.5
waves and still plateaued**. Because:

- The gauntlet is **fixed all week** (season-seeded, `difficultyForDay` returns 1),
  so day-to-day progress is *purely* your roster improving against a static 45-wave
  wall.
- The median roster **stops growing after ~day 4**: it's locked at **5 units all
  week** (the #70 buy-only slots at 60/120/220 mean the sensible player never
  expands — only 3/12 board-maxers reach 8), and never assembles a tier-3 board.

So the exact thing that made #70 a good "earned, slow" economy is the direct cause
of the flat curve. That tension is what this fix resolves.

## The plan (issues #90 → #93, do IN ORDER — they're dependency-chained)

The two constraints throughout: **do not exceed `WAVE_COUNT = 45`** (leaderboard
metric saturates), and **do not inflate the economy** (income = depth × rides, so
deeper runs snowball the bank #70 just tuned).

1. **#90 — Decouple income from depth (THE ENABLER, do first).** Add a shared
   `scrapForDepth(depth)` in core with *diminishing* returns (first ~8 waves worth
   1 scrap, deeper worth less). Leaderboard SCORE stays raw depth (depth = prestige);
   only INCOME diminishes. Tune so week income at current depths ≈ today's ~1020.
   This is what lets depth climb (in #91/#92) without snowballing the bank. Nothing
   else is safe until this is in.

2. **#91 — Accelerate roster growth (the actual feel fix).** Give the median horde
   room to grow — the 5-unit lock is the single biggest throttle. Proposal to model:
   partially restore free board growth (e.g. 5,5,6,6,7,7,7, keep the 8th slot a steep
   buy) and/or lower `SLOT_PRICES`. Model with snowball §7 until the median curve
   steepens and stops plateauing. **This revisits #70 and the patch-notes draft touts
   buy-only slots** — reconcile in #93.

3. **#92 — Soften the enemy HP quadratic (deep runs + leaderboard).** Candidate
   0.20/0.004 → 0.18/0.0025 (may need more). Its value is mostly at the deep end and
   in combination with #91. **Guardrail:** model a MAXED t3 board (deeper than
   depth-scaling's 5-unit ceiling) and confirm the top stays comfortably under 45.
   Regenerates golden logs.

4. **#93 — Integrate, re-verify balance, update patch notes.** Changing depth+income
   shifts every downstream number — re-run the FULL suite (snowball, all-unit-value,
   relic-value, stress + the compounding canary, depth). Verify day-1/2 is rewarding
   ("don't give up day 2" is the acceptance test). Reconcile `PATCH-NOTES-DRAFT.md`
   with whatever #91 changed about the economy.

## Scope reality / de-risking (READ THIS)

This is a lot of interconnected balance change to land, verify, and re-tune in 2 days,
**revisiting an economy shipped days ago**, right before a launch. Real risk of
introducing a new imbalance under time pressure.

- **Minimum viable for "don't give up day 2":** #90 (decouple) + #91 (roster
  acceleration) alone likely fixes the acute early-mid feel. #92 (enemy softening) is
  the leaderboard-depth polish and can be a fast-follow if time runs short.
- **Non-negotiable:** #93's re-verification. Do NOT ship any of this without re-running
  the balance suite — depth/income changes ripple through every unit and relic number.
- **Every specific number (income curve, board-growth curve, softening magnitude) needs
  Jesper's sign-off** — propose + model + flag, same pattern as #70. He is close to
  this and wants to make the tuning calls.

## Tools & how to verify (all exist on dev)

- `npm run snowball` — **§7 is the real-player depth+income-per-day curve you're
  tuning against** (added this session). §5 = income, §6 = board-slot reachability.
- `npm run balance:depth` — the optimal-roster ceiling (overstates the median; don't
  tune to it).
- `npm run balance:all-unit-value` / `balance:relic-value` — unit/relic cost-efficiency
  (their bands shift when depth/income change — re-check in #93).
- `npm run balance:stress` + `test/compounding-law.test.ts` — exploit/compounding
  guards (the Corpse-Glutton allyFaint canary must stay bounded under a bigger board).
- Difficulty knobs live in `gauntlet.ts` (`WAVE_BUDGET_*`, `WAVE_UNIT_CAP`) and
  `sim.ts` (`ENEMY_HEALTH_SCALE_*`, `ENEMY_ATTACK_SCALE_PER_WAVE`). Income constant
  `SCRAP_PER_DEPTH` is in `shop.ts`.

## Guardrails / project discipline (do not skip)

- **Worktree discipline:** do risky/agent work in an isolated git worktree branched off
  `origin/dev`, never in the main checkout — and instruct any sub-agents NOT to `cd` to
  the main repo path (their `git checkout` leaks into the shared checkout otherwise;
  this bit us this session). Verify `pwd` contains `.claude/worktrees/agent-`.
- **Don't trust agent-reported numbers** — independently re-run tests/balance before
  merging any PR. An agent this session reported a Marrow-Snap fix "successful" while
  its own numbers showed it hadn't met the bar.
- **Benchmark blind spots** (see memory `wrad-benchmark-blind-spots`): the balance
  scripts under-measure execute relics and cross-unit combos, and `damageDealt` ignores
  poison. Probe the actual failure shape, don't just read the generic rank.
- **The compounding law** (memory `wrad-compounding-law`): 45 waves, one persistent
  horde — any permanent effect on a repeating trigger compounds. A bigger board (#91)
  raises the ceiling on the Corpse-Glutton allyFaint combo (#82) — the canary must
  still pass.
- **Merges are permission-gated** (memory `wrad-merge-permission-gating`): `gh pr merge`
  needs Jesper's explicit per-session OK or a standing Bash rule he adds — you can't
  self-grant it.

## RESULTS (2026-07-11, branch `progression-fix` off dev — NOT merged/deployed)

**#90 done — diminishing income.** `scrapForDepth(depth)` in `shop.ts` is the single income
source (App.svelte, snowball, slot-value all use it). `SCRAP_FULL_DEPTH=7`, `SCRAP_DEEP_RATE=0.4`:
first 7 waves pay full, deeper pay 0.4, floored. Leaderboard score stays raw depth. A depth-20
run now pays 13 not 20 (throttle grows with depth). Week income lands 1029 (+0.9% vs 1020).

**#91 done — free board growth restored.** `BOARD_GROWTH = [5,6,6,7,7,7,7]` (day-indexed;
front-loaded curve SIGNED OFF by Jesper 2026-07-11 over the neutral `[5,5,6,6,7,7,7]` — day 1
is a build-only freeze so day 2 is the quit day, and this opens the 6th seat there). 8th seat
still buy-only via `SLOT_PRICES` (now stacks on top of free growth). Median depth curve
(snowball §7): before `2.95/4.05/5.60/6.87/7.25/7.89/7.88` → after
`2.95/4.51/6.58/8.78/10.05/10.80/10.41`. Day-2 hook 4.05→4.51, day-6 peak +37%, plateau GONE.
`SCRAP_FULL_DEPTH` retuned 9→7 so #90 absorbs the deeper runs; week income 1068 (+4.7%,
accepted). (Neutral alt `[5,5,6,6,7,7,7]`: +0.9% income, day-7 10.61, no dip — swap is a
one-line `BOARD_GROWTH` change + the shop-test curve assertion if reconsidered.)

**#92 DROPPED (data-backed).** New probe `scripts/maxed-board-guardrail.ts`: a maxed 8-unit t3
board already tops **avg 28 / p95 41 / MAX 43 of 45** at CURRENT (unsoftened) constants.
Softening 0.20/0.004→0.18/0.0025 pushes it to MAX 44 / p95 43 (saturates the WAVE_COUNT=45
leaderboard) while adding only +0.07 to the median (the median is roster-limited, which #91 already
fixes). A targeted linear-down/quadratic-up variant held the ceiling but gave the median nothing.
So `sim.ts` is UNCHANGED — no golden-log regeneration needed. Recommend defer/skip #92 entirely.

**#93 verification (all on the branch):** 189/189 tests pass (shop tests updated for the new
board curve); app build compiles; snowball §1 edges CONVERGE (not a snowball); exploit-stress
0/13 flagged; compounding-law canary 9/9; unit/relic/depth bands unchanged (Fat Tick→Marrow-Snap
ordering intact, no dead-weight/dominant outlier). Interest share still ~1%. `PATCH-NOTES-DRAFT.md`
Economy section reconciled (buy-only claim was stale) — curve-agnostic prose, pending sign-off.

**Not done (needs Jesper):** sign off #90 numbers (`SCRAP_FULL_DEPTH=7`/`SCRAP_DEEP_RATE=0.4`);
merge `progression-fix`→dev; deploy decision (deploy-race rule). Growth curve ✓ signed off
(front-loaded). #92 recommended dropped.

## Related open issues (not part of this fix, context only)

#81 leaderboard has no server-side score verification (pre-existing, launch-risk call
for Jesper); #82 Corpse-Glutton allyFaint 39/45 balance call; #83 week-reset needs a
UI announcement; #84 shop feedback polish; #85–#89 future-season minion concepts (post-
launch). The patch-notes draft is `PATCH-NOTES-DRAFT.md` (held for approval, not posted).
EOF
)"