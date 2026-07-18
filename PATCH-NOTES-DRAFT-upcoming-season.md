# Patch notes draft — vNEXT (Monday season reset)

**STATUS: DRAFT — NOT POSTED. Nothing in this draft is live. Do not post until the release
is actually cut, merged to `master`, and prod-verified per the standard process.**

- Source: `git log --oneline master..origin/dev` (76 commits as of this update — 50 at
  draft time, plus the 3-commit `issue-121-realistic-economy-sim` branch that merged into
  `dev` as PR #125 (`fc7535f`), plus `484d5d3` (bot-playtest fixes) and `2ca87d7` (idle
  interest removed, Boss Trial portrait, scroll-to-replay), plus the 2026-07-17 evening
  batch: `63cc786` (Sluice-Bulwark art), `ca6d56b` (poison into damageDealt, scripts-only),
  the #131 exploit-cap arc (`998b3da`/`f4d78b9`/`fadb850`/`a8f3844` — Plague-Bearer poison
  cap, Pack-Caller shared-budget cap, linear Boss HP), the three description-cleanup
  commits (`5e7c1a8`/`b8f672a`/`3e28427`), `ef0ca99` (bench 3 -> 5, 2026-07-18), Gutter-Runt's
  `retireDay` moving from 3 to 1 (full-season retirement, not just day-3-on — see the
  sourcing note below), the compendium feature (`bae91c1`/`b9678f8`/`9e79556`/`d0d3a97`/
  `82e55c9`, issue #136, plus a pre-launch-review fix pass to it, `c47d60e`), and the
  2026-07-18 pre-launch balance sign-off pass: `14df91c`/`1dc5326` (fix + hardening of
  `all-unit-value.ts`'s Twilight-Runt measurement bug, issue #127) and `30b884c`
  (Twilight-Runt cost 5 -> 6, the correction that measurement fix revealed was needed —
  see the sourcing note below).
  All still `dev`-only — read directly from
  `packages/core/src/data/units.ts`, `relics.ts`, `shop.ts`, `sim.ts`, `boss-trial.ts`, and
  `packages/app/src/App.svelte`. Only the FINAL state of anything touched more than once in
  the range is described (e.g. Pack-Caller was reworked twice; only the live shape is
  written up).
- Version: **not yet bumped anywhere in this range.** Prod (`master`) currently serves
  `0.6.9`. This draft uses **v0.7.0** as a placeholder — flag for a real number when the
  release is actually cut; a season this size (five new units, a full rework of two more,
  a whole new game mode, and an in-game compendium) reads as more than a patch bump, but
  that's a judgment call, not a fact.
- This is a **balance + content release**, built for the Monday 06:00 CET season reset —
  it should NOT ship as a hotfix, and should ride the weekly leaderboard wipe like v0.6.5 did.
- Texture note: minion (unit/relic) changes are written in full stat-line detail, the way
  a single-unit balance patch would be. Boss Trial, the economy tuning, and the UI fixes
  are each one tight paragraph — real, worth a mention, not worth a bullet each.

---

## DRAFT copy (for approval)

**Title:** `v0.7.0 — the warren turns over`

the new season rides out **Monday 06:00 CET**. five new rats ride in, two get torn down
and rebuilt, three old faces leave the stalls for good, and a whole second gauntlet opens
after dark. read slow, this one's long.

**New rats**
- **Pack-Caller** — 2/3, cost 5. faint: gives away its own CURRENT attack/health (whatever
  it's grown to mid-battle — Warren-Warden buffs, relics, all of it) split evenly across
  the rest of the horde; any odd point left over goes to whoever's furthest forward. build
  it up, then let it die on purpose. the total the ability can hand out over one ride is
  capped, and every Pack-Caller you field draws from the same pool — spread it thin early
  or bank it for the survivors late, both work, but it can't compound forever.
- **Slink-Rat** — 3/1, cost 6. each wave it adds its own attack straight into the clash
  against the front foe, from anywhere in the back line — no retaliation. 1 HP means it's
  paper if it ever reaches the front itself; it wants a wall in front of it, not a fight.
- **Twilight-Runt** — 1/2, cost 6. fuses Dawn-Runt and Dusk-Runt into one card: before noon
  it mostly hits attack (+3atk/+1hp), after noon it mostly hits health (+1atk/+2hp) — never
  a dead half, whichever hour you're riding in.
- **Cellar-Coil** — 2/4, cost 5. every wave it survives anywhere but the front, it banks
  permanent attack — capped hard per tier (6/12/18 total) so waiting in the back can't
  become infinite. cash it in once the line finally breaks to it.
- **Draughtsman Moe** — 3/3, cost 8. a prestige unit honoring **RatMoe**, season 2's
  champion — it carries the very kit that won RatMoe that season at wave 45: each wave,
  poisons the whole enemy line (scales with stars, capped across multiple casters). same
  coat as Blight-Witch, new name, worn in honor. ride it well.

**Reworked**
- **Gnawer** — faint used to hand the rat behind it a flat +2 attack that never aged. now
  it bequeaths its OWN current attack (tier-scaled, relic-buffed, whatever it actually had)
  plus a bonus for how deep into the ride it died, capped at 2x its own attack. a rat that
  dies on wave 30 leaves a real inheritance now; one that dies on wave 1 barely does.
- **Plague-Bearer** — used to poison the front foe, same table as Blight-Witch, and mostly
  just died to whatever it poisoned. now it reaches the BACK of the enemy line instead —
  pre-rotting a threat before the front-to-back grind gets there. Blight-Witch rots wide,
  Plague-Bearer rots deep; they're finally different jobs. stacking several is capped the
  same way the poison-all casters are (see below).

**Rotated out of the shop stalls**
- Blight-Witch and MD Rattyfock retire from the stalls — Draughtsman Moe (above) carries
  the poison-all kit now, Warren-Warden returns to fill the tank slot he left. Anyone
  already riding the old two keeps riding them; the stalls just won't sell them anymore.
- Dawn-Runt and Dusk-Runt are gone too, replaced outright by Twilight-Runt (above).
- Gutter-Runt retires from the stalls entirely — it was only ever a throwaway day-1 body
  and barely showed up in real lineups. Anyone already riding one keeps riding it, and
  selling it refunds every scrap you spent, so nothing already in your warren is punished.

**Costs on the ladder** — six of nineteen units were priced wrong for what they actually do;
this straightens the ladder without touching a single kit:
- Bone-Priest 6 -> 5 / Brood-Mother 6 -> 5 / Ward-Weaver 6 -> 5 (all three were overpriced
  for their solo output)
- Twilight-Runt 4 -> 6 (a scouting-tool blind spot had it reading as barely worth fielding —
  fixed, it turned out to be the strongest solo unit in the game at every star level, not
  just t2. priced up to match, twice, before this ever reached a real board)
- Corpse-Glutton 6 -> 7 (the strongest realistic-board pick in the game was underpriced)
- Dire-Rat 8 -> 7 (the vanilla tank was priced almost nobody into playing it)

**More room on the bench**
- five bench slots now, up from three. enough to hold a whole merge-trio and change without
  selling off your counter-tech first. benched rats still never fight — it's storage, not a
  second board.

**Relics**
- **Glass Shard** reworked: the first-hit bonus each wave used to be a flat +3. now it
  scales with the wave number itself — +1 on wave 1, +45 by wave 45 — and it's deliberately
  left uncapped. late-ride, this relic hits harder than almost anything else you can carry.

**Poison, capped**
- Multiple poison-all casters (Blight-Witch, and now Draughtsman Moe) used to stack fully —
  three of them on one board rotted the whole enemy line hard enough to carry a run to the
  bottom of the drains on poison damage alone. total poison-all stacks per wave are now
  capped at what a single tier-3 caster deals; a lone one is untouched, a stack of them isn't.
  the same rule now covers Plague-Bearer: several of them rotting the same back-liner cap
  at one tier-3's worth. the two caps are separate budgets, though — a Plague-Bearer and a
  poison-all caster on the same board still out-poison either alone.
  the drains remember who found that one.

**New: Boss Trial**
a second gauntlet, once a day, fixed at 20:00 CET — no clicking to trigger it, your board
just fights whatever it's standing as at that hour, same as the hourly ride. it's a straight
DPS check against a boss whose attack escalates hard (1.5x per phase) while its health
climbs steadily phase over phase, scored and ranked on its own
leaderboard, with its own replay so you can watch today's fight back afterward. the panel
now shows a boss portrait instead of a blank slot, and starting either replay scrolls the
fight into view instead of leaving it playing out below your screen.

**New: Compendium**
every rat, enemy, and relic in the game now has a proper reference card. tap "rats",
"enemies", or "relics" up top to browse full stats and abilities any time — owned or not,
on your board or still sitting in the stalls. rat cards say whether they're in today's
stalls, arriving later this week, or off the roster for the season; enemy cards show their
raw stats as fielded (the gauntlet may still scale them by depth). nothing here is new —
same numbers the fight always used — there was just nowhere to look them up before now.

**Economy**
deep runs pay a little more evenly now — the old scrap curve had a flat dead zone around
depth 8-10 that felt like progress stopped paying. a new far-depth tier keeps that
generosity from also inflating the leaderboard-chasing deep runs; income smooths out, your
board's score doesn't change. the small daily interest stipend on your banked scrap is gone
too — it never amounted to more than a rounding error once depth 10+ became easy to reach,
so it's cut for a cleaner curve, not a cut to anyone's income.

**Small fixes**
a wave where you and the last enemy die on the same swing now correctly counts as cleared
instead of getting dropped — matters if you were pushing right up against your board's
limit. a pile of inspect-sheet and shop-tile text that was going blank on the newer units
is fixed too. and a bot-run playtest turned up a handful of smaller things: the
leaderboard, ride log, season-best, and your rank line all say "depth N" now instead of
"wave N" (same number as always — just matching what the game calls it everywhere else);
the claim that the drains "change anew each dawn" was wrong and is gone — the gauntlet is
fixed for the whole week, it only turns over Monday; the "your warren is empty" nudge no
longer lingers once you've benched your first rat; the shop-tile freeze toggle, ride-speed
buttons, and the leaderboard/boss-trial refresh buttons are all easier to hit on a phone
now; shop cards stop clipping ability/cost text on narrow screens; and renaming your rat
now says "save name" instead of "ride out" so it doesn't read like you're re-mustering.
every rat's ability text also got a full tightening pass — shorter sentences, every cap
disclosed right on the card, and Slink-Rat's tag now reads "snipe" instead of "strike"
(closer to what it actually does). and the Sluice-Bulwark finally shows its armored self
in battle replays instead of a plain grey block.

---

## Sourcing notes (for Jesper's review, not for players)

- **Pack-Caller final shape:** reworked twice mid-season, then capped twice more.
  `240db70`/`b798798` shipped the original `buffAdjacentByTribe` (Press-Kin clone gated on
  an invisible `tribe` tag, Jesper's own read on why it was cut). `1fc4095` reworked to
  `distributeStatsOnFaint` (faint-triggered, gives away its own BASE stats). `d6cd5de`
  switched the payout to the unit's LIVE (buffed) stats at time of death. Then #131:
  `fadb850` added a per-recipient cap (fixing a real Boss Trial exploit — Jesper's own 4x
  Pack-Caller board measured at 47/60 phases), and `a8f3844` is the FINAL commit, replacing
  that with a shared whole-battle per-side budget (`totalBudgetMultiplier: 3` = 54 atk /
  81 hp total) after Jesper's review found the recipient cap killed the bank-and-concentrate
  playstyle. This draft describes only the final shared-budget shape; the exploit itself
  never reached prod, so it's disclosed as a design cap, not an incident. Cost 5, stats 2/3
  unchanged throughout.
- **Slink-Rat:** `6fa6983` (issue #86), first consumer of the `backlineDamage` primitive
  (`0ec2ef9`/`711d06f`, issue #85). Stats 3/1/cost 6 explicitly flagged "tentative pending
  balance sign-off" in the commit — not contradicted by any later commit in range, so
  treated as final for this draft.
- **Twilight-Runt:** added `036d5c4` (issue #110) alongside Dawn/Dusk-Runt (not yet
  retiring them — that's `f84d54a`/#109, same day). Magnitudes tuned once more in `82d18d1`
  (issue #110 follow-up, "Option 1" floor) to fix a Boss Trial interaction where the
  afterNoon (pure-health) half scored a structural +0 damage — floors both halves in the
  other stat. Final: beforeNoon {atk:3,hp:1}, afterNoon {atk:1,hp:2}, both explicitly
  flagged "pending Jesper sign-off" in the code, unresolved as of the last commit in range.
  **Cost, corrected twice:** the 4->5 bump landed with the cost-rebalance merge (PR #125,
  see below). A second, separate bump to 6 followed on 2026-07-18 (`30b884c`), after fixing
  a real measurement bug in `all-unit-value.ts` (issue #127, `14df91c`) that had this unit
  reading as barely worth fielding (a fake "rising" trend, near-zero every tier) — the
  script only blended before/after-noon for units with a top-level `ability.condition.
  timeOfDay` (Dawn/Dusk-Runt's shape); Twilight-Runt's `teamBuffByTime` branches on time
  INSIDE the effect with no such condition, so the unmodified script measured it with
  `timeOfDay` unset, where `sim.ts` applies neither half. Fixed, it reads #1 in its tier at
  every star by a wide margin: 27.2/15.3/9.7 waves-per-100-scrap at cost 5 vs. the next-best
  unit's 20.1/10.5/7.6 — a structural outlier, not a small-numbers artifact. Jesper's call:
  price to 6, which keeps it #1 at every tier but with a normal-sized lead (22.7/12.8/8.1),
  leaving `unlockDay: 3` as the real limiter on how much of it a horde can field this week.
  A follow-up commit (`1dc5326`) also fixed the same script's `CANDIDATE_IDS` list, which
  was hand-copied and had gone stale the same way the cost list itself once did (still
  measuring retired MD-Rattyfock, never measuring returning Warren-Warden) — it now derives
  from `seasonUnitPool()` so it can't drift from the real shop pool again.
- **Cellar-Coil:** `1a9500e`/`1b7e4fc` (issue #106), portrait `c674064`. Stats 2/4/cost 5
  and cap table [6,12,18] (`cellarCoilChargeCapForTier`) explicitly flagged tentative.
  Description text polished in `d6cd5de` (bespoke sentence, not the generic template) —
  used that final wording's substance, not the literal string.
  `chargeWhileBenched` is capped per unit per the doc comment specifically to avoid
  reproducing the Warren-Warden startOfBattle-buff exploit shape from a prior season
  (already fixed and already disclosed in the v0.6.5 notes) — not a new incident.
- **Draughtsman Moe:** reveal/art was `fa77e3f`/`83f8f6d` earlier; `98ce5c1` completed the
  actual engine swap (unit def + shop pool rotation) which is what makes this a real,
  purchasable unit rather than a teaser. Same kit as Blight-Witch (`poisonAllEnemies`),
  stats 3/3/cost 8 identical. Rotation confirmed via `shop.ts`'s `SHOP_UNIT_POOL` filter:
  `blight-witch` and `md-rattyfock` excluded, `warren-warden` un-excluded.
- **Gnawer rework:** `f481a93` (issue #111). `bequeathAttack` effect, `waveBonusCapMultiplier: 2`
  explicitly flagged "placeholder pending Jesper sign-off" in the commit body — used anyway
  since no later commit in range revises it.
- **Plague-Bearer rework:** `a134b3a` (issue #112). `poisonLastEnemy`, stack table unchanged
  (`poisonStacksForTier`, 1/3/5) — only the target changed, not the amount.
- **Gutter-Runt retirement:** originally `f84d54a` (`retireDay: 3`, issue #109) — a day-3
  mid-week fade, not a full pull. Changed to `retireDay: 1` in `701301e` (2026-07-18),
  which excludes it from the shop pool before day 1 even rolls: a full-season
  retirement via the same day-gating primitive, rather than the Dawn-Runt/Dusk-Runt-style
  flat `SHOP_UNIT_POOL` cut (that path is reserved for units being replaced outright; Gutter-
  Runt isn't). Par-buyback severance (`sellRefund` in shop.ts) still applies from day 1 on,
  so any copy carried in from a prior season sells for exactly what was spent, never a loss.
  `shop.test.ts`'s retireDay-primitive and severance suites were updated to match (Dire-Rat
  now stands in as the "not yet retired" example where Gutter-Runt used to); full core suite
  re-run clean at 269/269.
- **Cost rebalance (six units) — MERGED to `dev` (update: confirmed after the draft was
  first written).** PR #125, commit `82a9778`, merged via `fc7535f`. "Jesper approved all
  six rows, 2026-07-17" per the commit body. `dev` still needs to reach `master` before
  this is live for players, same as everything else in this draft, but the cost-rebalance
  bullet is no longer contingent on a separate unmerged branch — sourced from `dev`'s
  actual `units.ts` like everything else here. Twilight-Runt's cost moved again after this
  merge (5->6, see its own sourcing note above) — the player-copy bullet states the net
  4->6 change, not the two intermediate steps.
- **Glass Shard:** `ea24651` (issue #122). `firstHitBonusScalesWithWave`, explicitly
  "deliberately left UNCAPPED per Jesper's explicit sign-off" in the commit body — this is
  a disclosed, accepted design risk, not an oversight or a live bug. Worth watching next
  season if a late-wave leaderboard run starts looking Glass-Shard-shaped, but nothing to
  fix right now.
- **Poison-all multi-caster cap:** `83e018f` (issue #116). Commit body states plainly: "RatMoe
  won season 2 at depth 45 on 3x Blight-Witch" — this is the SAME already-disclosed
  RatMoe/Draughtsman-Moe tribute lineage, not a new exploit reveal, and the fix (cap total
  poison-all stacks per wave at the tier-3 value) is confirmed live in this range with a
  measured before/after (3x casters: avg depth 40.1 -> 29.2). No reproduction detail
  included in the player copy per the no-recipe rule — described only as "poison-all
  casters used to stack, now capped," no unit count or tier combination given (the class
  of trick — stacking any poison-all caster — is dead now regardless of how many you field).
  **Update (#131):** `f4d78b9` extends the same cap-not-sum shape to `poisonLastEnemy`
  (Plague-Bearer) in its own separate budget (`poisonLastApplied` vs `poisonAllApplied`),
  per Jesper's call that cross-effect mixing should still stack. Verified in-commit: 1x
  Plague-Bearer + 1x Blight-Witch still sums to 10 stacks. Player copy folds this into the
  existing poison paragraph.
- **Boss Trial:** `62e127b` (#107 engine+leaderboard), `94d8906`/`3ba9b2d`/`d8e70b3`
  (#120, fixed 20:00 CET, no player trigger), `16faf78`/`63cc0a5` (#118, replay,
  boss grows 1.5^phase), `66e42f9`/`ef6a07b` (#119, boss portrait art + orientation fix),
  `d9cfd8c`/`50b9981`/`a9a6738` (dev-tooling + rollover fixes, not player-facing).
  Security note: `a6fab4a` fixed a missing-RLS gap on `boss_trial_scores` (anon could wipe
  the board) — caught and fixed within the same range, before this ever reaches prod, so
  nothing to disclose to players.
  **Update:** `2ca87d7` actually wires the `boss-trial.svg` art (hand-crafted back in #119,
  never mounted) into the panel as `<img class="bt-portrait">`, and adds a
  `scrollIntoView` call to both `watchRide` and `watchBossTrial` so starting a replay
  scrolls the battle stage into view. Closes out issue #130. Both are pure presentation,
  no scoring/engine change — folded into the existing Boss Trial paragraph above rather
  than given their own section.
  **Update (#131, `a8f3844`):** boss HP is no longer flat 120 per phase — it now grows
  LINEARLY (100 base, +8/phase), deliberately gentler than attack's 1.5x/phase exponential
  (attack must stay unbounded so the mode terminates; HP doesn't). The player copy's boss
  description now says attack escalates while health climbs steadily — the old "grows fast
  (1.5x per phase)" line described attack only and predated HP scaling entirely.
- **Economy — deep-scrap curve:** `e08a199`. `SCRAP_DEEP_RATE` 0.4->0.5 (closes a 3-depth
  dead zone at floor()), new `SCRAP_FAR_RATE`=0.34 past `SCRAP_MID_DEPTH`=16 to keep the
  generosity off leaderboard-depth runs (depth 43: ~22 old vs ~21 new scrap, essentially a
  wash at the top end). Typical week income for an 8-16-band player rises ~1140->~1332
  (+17%) — not stated as an exact number to players, but the directional claim ("pays a
  little more evenly, dead zone closed") is sourced directly to this commit.
- **Idle interest removed:** `2ca87d7`. Drops `interestFor`/`INTEREST_RATE`/`INTEREST_CAP`
  from `packages/core/src/shop.ts` entirely — the function, its exports, its test
  (`shop.test.ts`), both App.svelte dawn-advance call sites plus the "+N interest banked
  each dawn" idle-note copy, and the interest tracking/reporting in the
  snowball/realistic-player balance scripts. Commit body cites a balance-analyst sim
  (income audit + an interest-zeroed A/B run, greedy AND lookahead policies, 16 seasons
  each) showing interest was under 1% of weekly scrap income for both casual and strong
  players at current depth-reachability, and the A/B showed no directional depth/scrap
  effect beyond ordinary RNG-path noise. This is a deliberate, sim-verified simplification
  Jesper can point to if anyone asks why their bank stopped ticking up overnight — not a
  stealth nerf, and framed that way in the player copy above.
- **Wave-clear/wipe fix:** `a902051`. Simultaneous last-enemy/last-unit death on the same
  tick now credits the wave clear (was previously dropped since it also checked
  `horde.length > 0`). Real depth-scoring fix, worth the one line in player notes.
- **UI/bug fixes bucket:** `21b51ea`/`8e80952` (blank inspect text / shop-tile subtitles for
  4 newer effect kinds — `backlineDamage`, `buffAdjacentByTribe` (dead code, since removed),
  `chargeWhileBenched`, `teamBuffByTime`). Summarized as one line per the task's "broad, not
  blow-by-blow" instruction for non-minion changes.
- **Bot-playtest fixes (`484d5d3`):** landed same day as the draft's first write-up, after a
  4-agent automated playtest of `dev` (methodology now documented in
  `docs/agents/bot_test.md` for reuse next season). Each finding was individually
  re-verified against source before fixing (see that doc's "known false positives"
  section — two agents' text-extraction tooling produced phantom typos from flattened
  `<strong>` tags and joined flex-column siblings; those were correctly NOT fixed). What
  actually shipped, all confirmed in the `App.svelte` diff:
  - wave->depth relabel across six displays: leaderboard row, `lb-myrank`, ride-log row,
    season-best line, season-hint line, and the ride-result line. CONTEXT.md's glossary
    is the source of truth that these were always the Depth stat, mislabeled as Wave.
  - "changes anew each dawn" -> "hold steady all week — resets Monday" / "a new gauntlet
    awaits each Monday" (two near-duplicate strings, both fixed). Confirmed against
    `gauntlet.ts`: theme/difficulty is selected once per season, not per day.
  - onboarding-hint condition gained `&& build.bench.length === 0` — was only gating on
    `build.board.length === 0`, so benching (not fielding) your first unit left the "warren
    is empty" hint stuck on screen.
  - freeze toggle: `tabindex="-1"` + no-op `onkeydown` -> `tabindex="0"` + a real
    Enter/Space handler, plus padding/min-width/min-height for a bigger tap zone.
  - `.ride-controls button` and `.lb-refresh` padding/min-height bumped toward the ~40-44px
    mobile tap-target minimum.
  - `.tile-sub`/`.tile-cost` gained `overflow-wrap: break-word` (narrow-card text
    overflow).
  - rename-dialog primary button: `{playerName ? 'save name' : 'ride out'}` — was hardcoded
    to "ride out" even when renaming an existing name.
  - **Cross-note re: issue #84** ("Shop feedback polish: disabled-state buttons,
    star-preview legend, interest label, update-toast wording", open, `ready-for-agent`).
    Two of #84's four items now overlap with this update, and neither is resolved by it:
    item 3 ("interest projection reads as a locked value") is now moot outright — `2ca87d7`
    removes interest entirely, so there's no interest line left to relabel. The freeze-icon
    reachability fix in `484d5d3` sits in similar "shop tile polish" territory to #84 item 1
    (disabled-button styling) but doesn't touch it. Items 1, 2, and 4 on #84 are still open
    and unaddressed by anything in this range. Flagging for Jesper's triage — not closing
    or editing #84 myself.
- **Bench 3 -> 5 (`ef0ca99`, 2026-07-18):** single-constant change (`BENCH_SIZE` in
  shop.ts), UI reads it dynamically. Gets its own short player section — it's a real
  gameplay-capacity change, not a fix. Design note on file: at 5 the bench now matches the
  day-1 board cap, worth watching in playtests.
- **Description cleanup sweep (`5e7c1a8`/`b8f672a`/`3e28427`):** three commits, all copy:
  units.ts short descriptions trimmed + "(capped)" disclosures added; abilitySentence()
  inspect-sheet text tightened, a Slink-Rat grammar bug fixed, the missing Pack-Caller
  shared-budget and poison-cap disclosures added; dead `UnitDef.desc` field removed
  outright (was never rendered — abilitySentence() is the sole ability-text system now);
  Slink-Rat's keyword tag renamed "strike" -> "snipe". Summarized as one small-fixes line.
- **Sluice-Bulwark art (`63cc786`, #124):** closes the last rect-fallback gap in battle
  replays for a 0.6.0-era enemy. One small-fixes line.
- **Compendium (issue #136):** `bae91c1` (base feature — Units/Enemies/Relics tabs, full
  `abilitySentence()` reuse so cards can't drift from the sim), `b9678f8` (day-gate the
  Units tab so it doesn't leak content), `9e79556` (availability note per rat, cost display,
  Relics tab), `d0d3a97` (drop rats never actually obtainable — Pup, Blight-Witch,
  MD-Rattyfock, Dawn/Dusk-Runt — add the Boss Trial boss as its own enemy-tab entry),
  `82e55c9` (bench-board CSS: one row of 5, matching the horde board's layout — visual only,
  no capacity change, `BENCH_SIZE` was already 5 since `ef0ca99`).
  **Update, pre-launch review (`c47d60e`, same day):** two display bugs caught and fixed
  before this ever reached players, so nothing to disclose as a live issue — the summoner
  hint ("summoned rats fight beyond your warren's size...") was rendering on ENEMY cards
  too (Watch-Sergeant, Muster-Captain), describing the player's own combat cap for what are
  enemy reinforcements; and Midden-Hag's card showed the shared 1/3/5 poison table instead
  of the flat `stacks * tier` scaling `sim.ts` actually uses for that one effect (its own
  flagged exemption) — the card claimed ★2 3/★3 5, the sim does ★2 2/★3 3. Both fixed to
  match the sim exactly, same "one generator, can't drift" guarantee the rest of
  `abilitySentence()` already had.
- **Season start:** Monday 06:00 CET is now stated in the player copy's opening line, per
  Jesper's instruction (2026-07-18). Next Monday is 2026-07-20 — the release must be cut
  and prod-verified before then for the notes to be true.
- **Not mentioned to players, and why:** dev-testing tooling (`d9cfd8c`, `a9a6738`, boss
  trial dawn-rollover fixes, `docs/agents/bot_test.md` itself) — internal only, no
  player-facing behavior change worth a line. `998b3da` — doc-comment corrections only, no
  behavior change. `ca6d56b` (#126) — poison ticks now count into `BattleResult.damageDealt`,
  but that field only feeds the balance scripts; the live Boss Trial leaderboard score
  already counted poison off the event stream, so nothing player-visible changed.

---

Nothing was posted or sent. No Discord command was run. No prod-verification curl was run
(there is nothing live to verify against — see the hard-rule override in this task).
