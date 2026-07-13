# Patch notes draft — v0.6.5 (Monday season reset)

**STATUS: DRAFT — NOT POSTED. Awaiting Jesper's approval.**

> **2026-07-11 update (issues #90/#91):** the Economy section has been reconciled with the
> Monday progression fix. The earlier draft touted #70's buy-only-slots economy ("no free
> growth, 60/120/220"); #91 partially RESTORED free board growth (up to a 7-rat board over the
> week, 8th seat still a buy) and #90 made idle income diminish past the early waves. The prose
> below is written curve-agnostic (true for either candidate growth curve) but the exact growth
> pace is **pending Jesper's sign-off** — see the session report. #92 (enemy-HP softening) was
> dropped, so "the drains eased their grip" refers only to the earlier in-range `bfdae62`
> softening, not a Monday change.

- Source: full delta `origin/master..origin/dev` (fetched 2026-07-10), read directly
  from `packages/core/src/data/units.ts`, `relics.ts`, `shop.ts`, `sim.ts`, `gauntlet.ts`,
  and `packages/app/src/App.svelte`. Only the FINAL state of anything touched more than
  once in the range is described (e.g. Marrow-Snap's execute threshold went 0.3 → 0.55 →
  0.65 → final 0.5 with crossing semantics; notes only describe the final "drops to half,
  the blow must do the work" behavior).
- Version: this range's handoff commit (`5da3104`) states the Monday balance cut ships as
  **v0.6.5**. `packages/app/src/telemetry.ts` on `dev` hasn't been bumped yet (still reads
  the pre-release placeholder) — bump it as part of cutting the release, then verify prod
  serves 0.6.5 per the standard prod-verification steps *before* this is ever posted.
- This is a **balance release** (ships at the Monday 06:00 CET season reset), not a hotfix —
  it rides along with the weekly leaderboard wipe.
- Two easter eggs in this range are deliberately omitted per instruction: the new team relic
  (a "someone else's gear" flavor item) and a new unit (a patched-up returning face). Warren-Warden's
  retirement from the shop pool IS mentioned (that part's fair flavor on its own), nothing about
  what replaced him.
- Structured as two Discord messages (embed descriptions run ~1.6-1.7k chars each, over the
  ~1500 soft guideline for one message but each within Discord's per-embed limit). Message 1:
  summary + New rats + Reworked. Message 2: exploit disclosure + Economy + Relics + QoL + tease.

---

## Message 1/2

**Title:** `v0.6.5 — the drains run deeper (1/2)`

⏳ **24 hours to a new season.** Monday 06:00 CET the drains reset — new week, new board, and the biggest shake-up to the curve since launch: star tiers hit way harder, the horde grows into a bigger board as the week goes on, and four new rats join the warren.

**New rats** (Ward-Weaver unlocks day 2; Dawn/Dusk-Runt day 3)
• Press-Kin — battle: buffs both rats beside it; the middle of the line is the strongest seat now.
• Ward-Weaver — each wave: wards the front rat against its first hit outright (★2 blocks 2, ★3 blocks 3), resets clean every wave.
• Dawn-Runt & Dusk-Runt — a matched pair. Dawn-Runt wakes before noon CET and hardens the horde's attack; Dusk-Runt takes over after noon and hardens its health.

**Reworked**
• Star power hits harder: every star is now 3x the last star's attack AND health, on every unit (was a flat multiply). Tiering up finally feels like tiering up.
• The drains eased their grip to match — the curve isn't just a stomp or a wall now.
• Blight-Witch stopped poking single targets — she opens every wave by rotting the whole enemy line. Costs more to match (6 → 8 scrap).
• Poison stacks scale on a steeper table per star.
• Bone-Priest's revive brings a rat back on a real per-star HP curve, capped at their own max — tiering the priest up finally matters.
• Rat-Piper and Plague-Bearer fire every wave now instead of once a battle.
• Dire-Rat finally has a job: 2 flat armor shrugs off every attack that lands (poison still gets through — armor doesn't stop rot).
• Warren-Warden has retired from the shop stalls. Still rides if you've already got one; the stalls don't sell him anymore.

---

## Message 2/2

**Title:** `v0.6.5 — the drains run deeper (2/2)`

**Exploit, fixed**
• A repeatable battle-start buff was quietly re-firing every wave instead of once — a board of maxed Warren-Wardens rode that all the way to clearing the gauntlet. Dead now: those buffs land once per rat, like everyone assumed they already did.

**Economy**
• Your warren grows as the week rides on — from a 5-rat board up to a 7-rat horde by mid-week — with the 8th and final seat still a steep scrap buy. Room to build into a real board by Sunday.
• Deeper runs still pay, but less: past the first stretch of waves each extra depth earns a little less scrap. Depth is still your score on the board — the bank just doesn't balloon when you push deep.
• Summon headroom now tracks your actual deployed horde (+2 spare slots), so pups and revives stop getting silently swallowed by a full board.
• Reroll costs 2 scrap now (was 1).
• Sell price scales properly with star tier — merging up is finally worth what you paid for it.
• Relics pinned to a sold or merged-away rat refund half their cost instead of vanishing.
• Shop auto-rerolls for free once every stall's bought out.
• Relic stalls now grey out instead of soft-locking your shop when no rat on your board can carry them.
• Day 1: rides don't start earning until 10:00 CET. Build your board first — the first haul lands then.
• One gauntlet per day, locked for the whole week by the season — no more depth swinging wildly hour to hour.

**Relics**
• Marrow-Snap — pure execute: a blow that knocks a foe below half its own health snaps it outright. The killing stroke has to do the work — rot-softened foes don’t count.

**Quality of life**
• Shop and board cards show a compact tag instead of the full ability text now — tap a card for the full read.
• Mobile shop overflow fixed.
• Replay: the whole horde fits on stage now, and health readouts stop at 0.
• Installable — add We Ride at Dawn to your home screen and it runs like an app.
• Scout report is gone; the shop panel just shows your live scrap count instead.

not everything that rode in with this season is written here.

---

## Raw JSON (for `post-patch-notes.sh` once approved — DO NOT RUN YET)

```json
{
  "messages": [
    {
      "embeds": [
        {
          "title": "v0.6.5 — the drains run deeper (1/2)",
          "description": "⏳ **24 hours to a new season.** Monday 06:00 CET the drains reset — new week, new board, and the biggest shake-up to the curve since launch: star tiers hit way harder, the horde grows into a bigger board as the week goes on, and four new rats join the warren.\n\n**New rats** (Ward-Weaver unlocks day 2; Dawn/Dusk-Runt day 3)\n• Press-Kin — battle: buffs both rats beside it; the middle of the line is the strongest seat now.\n• Ward-Weaver — each wave: wards the front rat against its first hit outright (★2 blocks 2, ★3 blocks 3), resets clean every wave.\n• Dawn-Runt & Dusk-Runt — a matched pair. Dawn-Runt wakes before noon CET and hardens the horde's attack; Dusk-Runt takes over after noon and hardens its health.\n\n**Reworked**\n• Star power hits harder: every star is now 3x the last star's attack AND health, on every unit (was a flat multiply). Tiering up finally feels like tiering up.\n• The drains eased their grip to match — the curve isn't just a stomp or a wall now.\n• Blight-Witch stopped poking single targets — she opens every wave by rotting the whole enemy line. Costs more to match (6 → 8 scrap).\n• Poison stacks scale on a steeper table per star.\n• Bone-Priest's revive brings a rat back on a real per-star HP curve, capped at their own max — tiering the priest up finally matters.\n• Rat-Piper and Plague-Bearer fire every wave now instead of once a battle.\n• Dire-Rat finally has a job: 2 flat armor shrugs off every attack that lands (poison still gets through — armor doesn't stop rot).\n• Warren-Warden has retired from the shop stalls. Still rides if you've already got one; the stalls don't sell him anymore.",
          "color": 5793266,
          "footer": {
            "text": "we ride at dawn · season resets Monday 06:00 CET"
          }
        }
      ]
    },
    {
      "embeds": [
        {
          "title": "v0.6.5 — the drains run deeper (2/2)",
          "description": "**Exploit, fixed**\n• A repeatable battle-start buff was quietly re-firing every wave instead of once — a board of maxed Warren-Wardens rode that all the way to clearing the gauntlet. Dead now: those buffs land once per rat, like everyone assumed they already did.\n\n**Economy**\n• Your warren grows as the week rides on — from a 5-rat board up to a 7-rat horde by mid-week — with the 8th and final seat still a steep scrap buy. Room to build into a real board by Sunday.\n• Deeper runs still pay, but less: past the first stretch of waves each extra depth earns a little less scrap. Depth is still your score on the board — the bank just doesn't balloon when you push deep.\n• Summon headroom now tracks your actual deployed horde (+2 spare slots), so pups and revives stop getting silently swallowed by a full board.\n• Reroll costs 2 scrap now (was 1).\n• Sell price scales properly with star tier — merging up is finally worth what you paid for it.\n• Relics pinned to a sold or merged-away rat refund half their cost instead of vanishing.\n• Shop auto-rerolls for free once every stall's bought out.\n• Relic stalls now grey out instead of soft-locking your shop when no rat on your board can carry them.\n• Day 1: rides don't start earning until 10:00 CET. Build your board first — the first haul lands then.\n• One gauntlet per day, locked for the whole week by the season — no more depth swinging wildly hour to hour.\n\n**Relics**\n• Marrow-Snap — pure execute: a blow that knocks a foe below half its own health snaps it outright. The killing stroke has to do the work — rot-softened foes don’t count.\n\n**Quality of life**\n• Shop and board cards show a compact tag instead of the full ability text now — tap a card for the full read.\n• Mobile shop overflow fixed.\n• Replay: the whole horde fits on stage now, and health readouts stop at 0.\n• Installable — add We Ride at Dawn to your home screen and it runs like an app.\n• Scout report is gone; the shop panel just shows your live scrap count instead.\n\nnot everything that rode in with this season is written here.",
          "color": 5793266,
          "footer": {
            "text": "we ride at dawn · season resets Monday 06:00 CET"
          }
        }
      ]
    }
  ]
}
```

## Sourcing notes (for Jesper's review, not for players)

- **3x-per-star curve (attack + health):** `units.ts` `tierAttackMultiplier`/`tierHealthMultiplier`
  (`3^(tier-1)`), commit `f85768e`. Enemy curve softened in the same range (`bfdae62`,
  `ENEMY_HEALTH_SCALE_PER_WAVE` 0.35→0.20 etc.) — mentioned only in general terms ("eased their
  grip"), no exact multipliers given to players.
- **Press-Kin / Ward-Weaver / Dawn-Runt / Dusk-Runt:** added `a744a37`/`9e332e5`, reworked/tuned
  by `1e1e270` (Ward-Weaver → per-wave block charges), `e887645` (unlock day aligned to 3). Final
  shapes only.
- **Blight-Witch rework:** `faa7645a`/`532fbaa` — `afterAttack` single-target → `startOfWave`
  whole-wave AoE, cost 6→8 to compensate.
- **Poison table [1,3,5] / revive table [1,10,20] / block table [1,2,3]:** `units.ts` doc comments,
  issues #62, #53, #56.
- **Rat-Piper / Plague-Bearer → startOfWave:** part of the startOfBattle-compounding fix (`c9ff335`),
  changed from a one-shot to a per-wave re-fire — genuinely a buff for players.
- **Dire-Rat armor:** `damageReduction: 2`, `c9ff335` + `9783f48` re-test. Attack-only, poison
  bypasses, floored at 1 dmg.
- **Warren-Warden shop retirement:** `shop.ts` `SHOP_UNIT_POOL` filter, commit `e887645`. Confirmed
  the excluded unit (MD Rattyfock) is its replacement — that link is NOT stated to players per
  instruction.
- **Exploit disclosure (Warren-Warden startOfBattle compounding):** `c9ff335` commit body: "Four
  tier-3 Warren-Wardens re-buffing... took a 6-attack rat to 241 attack... The live #1 board rode
  this to 44/45 on day 3 of 7." This is a DIFFERENT, already-dead-and-fixed exploit from the
  Bone-Priest double-revive (already announced in the live v0.6.4 hotfix, not repeated here).
  Described only as "a repeatable battle-start buff was re-firing every wave" — no exact unit
  count or tier combination given, per the no-recipe rule; the class of trick (any permanent
  `startOfBattle`-style effect firing every wave) is generically dead now, not just this one case.
- **Board slot economy:** `shop.ts` `BOARD_FLOOR = 5`, hard cap `BOARD_CAP = 8` (unchanged),
  commit `d666fb6` (issue #70) — but #70's flat-5/`SLOT_PRICES = [60,120,220]` buy-only economy
  was PARTIALLY REVERSED by issue #91: `BOARD_GROWTH` restores free growth to a 7-rat board over
  the week (`[5,6,6,7,7,7,7]`, front-loaded curve signed off 2026-07-11), with the 8th seat bought from the
  `SLOT_PRICES` ladder (which now stacks on top of free growth). Player notes describe the FINAL
  state only (no mention of the intermediate buy-only version, which never reached players).
- **Diminishing idle income (issue #90):** `shop.ts` `scrapForDepth(depth)` — first
  `SCRAP_FULL_DEPTH` (=8) waves pay full `SCRAP_PER_DEPTH`, deeper waves pay `SCRAP_DEEP_RATE`
  (=0.4). Leaderboard score is still raw depth; only income diminishes. Throttles the deep
  leaderboard chase from snowballing the bank; week income lands ~1140 (a deliberate ~+12% over
  the old ~1020, Jesper's call, to fund merge-fishing toward T3 — validate with live feedback).
- **Enemy-HP softening (#92): NOT SHIPPED.** Modeled and dropped — a maxed t3 board already tops
  ~43/45, so softening would saturate the WAVE_COUNT=45 leaderboard for ~0 median benefit (the
  median is roster-limited, which #91 already fixes). `sim.ts` enemy constants are unchanged.
- **Summon headroom:** `combatCapForBuild` = deployed board length + `COMBAT_CAP_BONUS` (2),
  commit `f8e6d31` (issue #69) — supersedes the earlier day-based headroom from `c9ff335`.
- **Reroll cost 1→2:** commit `209bcba`.
- **Sell price tier²:** `sellRefund`, commit `6950579`.
- **Relic refund on sell/merge-dedup:** commits `238bcb2`, and the `relicRefund` helper extended
  to `sellUnit`/`sellBenchUnit` in the economy-rework commit.
- **Shop auto-reroll when bought out:** `ac59e42`, `isShopDead`/`autoRerollShop`.
- **Relic soft-lock fix:** `250020d`/`hasValidRelicTarget`.
- **Day-1 recruitment window (10:00 CET):** `d833d09` (issue #47/#46).
- **One fixed gauntlet per day, season-seeded:** `3b99891` (hourly reshuffle removed) +
  `2426d68` (season-seeded, not calendar-date-seeded) — fixes an 11-wave day-to-day depth swing
  for the same unchanged roster.
- **Marrow-Snap:** added `084966c`, threshold tuned `c6a5083`→`69db2de`, finalized at 0.5 with crossing semantics (launch-day change: the executing blow itself must cross the line, so poison can no longer set up executes).
  `executeThreshold`, foe-relative, stateless.
- **Compact tile tags / tap-to-inspect:** `f458d70` — tiles show a symbol+keyword, full sentence
  already lived behind tap-to-inspect.
- **Mobile shop overflow fix:** `f458d70` (`.tile` missing `min-width: 0` in a fixed grid).
- **PWA installability:** `3b8804a` — manifest, service worker, install nudge, `pwaInstall.ts`/`pwaUpdate.ts`.
- **Scout report removed, live scrap count at shop:** `1373287`.
- **No leaderboard-specific changes found in this range** — omitted from notes rather than guessed.
