export type Side = 'horde' | 'gauntlet';

export type Archetype = 'swarm' | 'brute' | 'armored' | 'plague';

/**
 * Tier (star-level) power multiplier applied to a unit's own base ATTACK
 * and HEALTH (issue #22). Merging costs scrap super-linearly — 3 copies ->
 * one t2, 3 t2s -> one t3, i.e. 9x the scrap of a single t1 — so a flat
 * `x tier` curve (1x/2x/3x) made merging mostly a board-space play, not a
 * power one. Each tier step is now >=3x the previous step's power: 1x / 3x
 * / 9x (`3^(tier-1)`), matching the requested factor and the actual scrap
 * spent. Applied uniformly to attack and health (Jesper, 2026-07-09): the
 * owner wants a much deeper, more rewarding late-game curve, up to and
 * including players regularly pushing `WAVE_COUNT = 45` — a full-power
 * curve on both stats is the intended lever for that, not a limitation to
 * design around. See `HANDOFF.md`'s compounding-law section before adding
 * any *new* trigger effect that scales off these bigger numbers.
 */
export function tierAttackMultiplier(tier: number): number {
  return Math.pow(3, tier - 1);
}

/** Same curve as `tierAttackMultiplier` — see its doc comment. */
export function tierHealthMultiplier(tier: number): number {
  return Math.pow(3, tier - 1);
}

/**
 * HP a Bone-Priest's `revive` returns the raised ally at, by tier (issue
 * #53). Deliberately NOT `tierHealthMultiplier` or any other flat multiplier
 * of a base value — `revive` fires exactly once per Bone-Priest instance
 * (its own `faint` trigger, which a unit only hits once), so unlike
 * per-battle-recurring effects there's no compounding risk in a steep,
 * hand-tuned curve here. A flat `health * tier` (1/2/3) made merging this
 * unit nearly pointless since the ability only ever pays out once; this
 * table (1/10/20) makes tiering up actually matter. Callers must still cap
 * the result at the revived corpse's own `maxHealth` — see the `revive`
 * case in sim.ts's `applyEffect`.
 */
export function reviveHpForTier(tier: number): number {
  const table = [1, 10, 20];
  return table[tier - 1] ?? table[table.length - 1];
}

/**
 * Number of the front rat's incoming hits Ward-Weaver's `blockFrontHits`
 * blocks per wave, by tier (issue #56). Same shape as `reviveHpForTier` — a
 * small explicit table, not a multiplier of a base value — because this
 * magnitude resets every wave (see the compounding-law note on
 * `blockCharges` in sim.ts) rather than compounding like `tierAttackMultiplier`.
 * Deliberately linear (1/2/3), not `tierAttackMultiplier`'s 3^(tier-1) curve:
 * a wave only has so many meaningful hits to block, so a steep curve here
 * would just let a t3 Ward-Weaver no-sell an entire early wave.
 */
export function blockHitsForTier(tier: number): number {
  const table = [1, 2, 3];
  return table[tier - 1] ?? table[table.length - 1];
}

/**
 * Poison stacks applied by Plague-Bearer's `poisonLastEnemy` (`startOfWave`,
 * reworked from `poisonFrontEnemy` in issue #112) and Blight-Witch's
 * `poisonAllEnemies` (`startOfWave`), by tier (issue #62,
 * folding in #59's table). Same shape as `reviveHpForTier`/`blockHitsForTier`
 * — a small explicit table, not a multiplier of a base value.
 *
 * Safe under the compounding law for the same reason as `blockHitsForTier`:
 * poison stacks reset every wave (`waveClear`), so unlike `gainStats` or any
 * other permanently-accumulating effect on a per-wave trigger, a steep
 * per-tier jump here cannot snowball across the 45-wave battle — each wave
 * starts the count fresh.
 *
 * Deliberately `[1, 3, 5]`, NOT `tierAttackMultiplier`'s full `3^(tier-1)`
 * curve (which would give 1/3/9). A full exponential jump would make poison
 * a dominant, matchup-agnostic answer regardless of enemy archetype —
 * flat, depth-independent damage that ignores armor and doesn't need to
 * out-scale enemy health the way attack does. That risk is exactly the
 * still-open question flagged in `scripts/depth-scaling.ts` report section
 * "4) Poison-leaning vs attack-leaning roster": poison's flat/depth-independent
 * nature was left as a report-only, not-yet-resolved finding, not something
 * to resolve by picking a magnitude here. `[1, 3, 5]` is a moderate,
 * hand-tuned middle ground between the old flat `stacks * tier` (1/2/3) and
 * the full exponential curve.
 */
export function poisonStacksForTier(tier: number): number {
  const table = [1, 3, 5];
  return table[tier - 1] ?? table[table.length - 1];
}

/**
 * Hard ceiling on total attack Cellar-Coil's `chargeWhileBenched` may ever
 * bank onto a single instance, over the WHOLE Ride (all `WAVE_COUNT` = 45
 * Waves), by tier (issue #106). Same shape as `reviveHpForTier`/
 * `blockHitsForTier` above — a small explicit table, NOT a multiplier of a
 * base value — but unlike either of those, this table exists specifically
 * because ADR-0003 (`docs/adr/0003-compounding-law-for-repeating-triggers.md`)
 * requires one: `chargeWhileBenched` is a *permanent* stat gain on the
 * repeating `startOfWave` Trigger, which is exactly the shape that already
 * shipped once as the Warren-Warden incident (a `startOfBattle` buff
 * mistakenly re-firing every Wave). It is only safe here because the cap is
 * a hard `Math.min` clamp baked into the effect's application (see the
 * `chargeWhileBenched` case in sim.ts's `applyEffect`), not a tunable
 * suggestion — this function is the one and only source of truth for that
 * ceiling, and nothing may bank past it no matter how many of the 45 Waves
 * the unit spends off the front slot.
 *
 * Placeholder table `[6, 12, 18]` per issue #106 / `docs/design/future-minions.md`'s
 * Cellar-Coil writeup — tune the numbers during the balance pass, but the
 * existence of a hard cap here is not up for debate.
 */
export function cellarCoilChargeCapForTier(tier: number): number {
  const table = [6, 12, 18];
  return table[tier - 1] ?? table[table.length - 1];
}

export type Effect =
  | { kind: 'summon'; unitId: string; count: number }
  /**
   * Buffs the rat(s) behind the source (or `all` of them) by
   * `attack`/`health`, scaled by `tierAttackMultiplier`/`tierHealthMultiplier`
   * (issue #58) rather than a flat `* tier` — Gnawer wires this to `faint`,
   * Warren-Warden and MD Rattyfock wire it to `startOfBattle`; both trigger
   * kinds fire exactly once per unit instance, ever, so the steeper
   * `3^(tier-1)` curve can't accumulate across the 45-wave battle the way a
   * per-wave-recurring effect could (see the compounding-law note above the
   * `Ability` interface). A flat `* tier` left tiering these units up nearly
   * pointless since the payout only ever lands once — same rationale as
   * `reviveHpForTier`.
   */
  | { kind: 'buffBehind'; attack: number; health: number; all?: boolean }
  /**
   * Gnawer's rework (issue #111). Unlike `buffBehind`'s flat `effect.attack`
   * literal, this effect carries NO magnitude of its own — the payout is a
   * LIVE reference to the caster's own `attack` stat at the instant it
   * faints (already tier-scaled via `tierAttackMultiplier` and inflated by
   * any attack relics/team-buffs — whatever it actually had when it fell,
   * read straight off `BattleUnit.attack` in sim.ts), plus a bonus for the
   * wave number it died on. Old Gnawer's flat `+2` never aged past wave 1;
   * this makes both "how strong was this body" and "how late did it die"
   * matter, which is the point of the rework (see the issue's "placement
   * puzzle": front slot dies early for a small bonus but has everyone
   * behind it to benefit, deep slot dies late for a big bonus but only
   * helps the one rat behind it, and the last slot has nobody behind at
   * all — the payout simply evaporates).
   *
   * `waveBonusCapMultiplier` caps the WAVE-DIED-ON bonus at
   * `waveBonusCapMultiplier * ownAttack` (proposed 2x — Jesper 2026-07-15,
   * open for tuning) so a t1 chaff Gnawer can't out-scale its own body just
   * by surviving deep into a 45-wave grind. This cap lives HERE, in the
   * def/effect data, not as a loose comment or a hand-picked literal at the
   * call site — see docs/design/future-minions.md's Cellar-Coil writeup for
   * why an uncapped "reward for surviving/waiting" magnitude is exactly the
   * shape of an instant exploit, and `blockHitsForTier`/`poisonStacksForTier`
   * above for the house style of keeping magnitude tables in data, not code.
   *
   * Compounding-law note: `faint` fires on EVERY death (see
   * `resolveDeaths` in sim.ts), not just the first, so a Bone-Priest-revived
   * Gnawer that dies a second time fires this a second time. That is still
   * bounded, not a loop: `revive` is capped to once per corpse (the
   * `raised` flag — see the `revive` case in sim.ts), so a single Gnawer
   * copy can pay out at most twice per battle (the second payout later and
   * therefore larger, since the wave-died-on bonus grows with wave number).
   * The wave bonus itself never accumulates per-wave — it's read once, at
   * the moment of death, capped by `WAVE_COUNT` (45) same as any other
   * one-shot per-instance magnitude in this file (`reviveHpForTier`,
   * `buffBehind`'s fire-once reasoning). See the targeted double-payout
   * probe in compounding-law.test.ts.
   */
  | { kind: 'bequeathAttack'; waveBonusCapMultiplier: number }
  /**
   * Buffs BOTH board neighbors (index-1 and index+1), whichever exist. At
   * the front only the "behind" neighbor exists; at the back only the
   * "front" neighbor exists; a middle placement hits both — the first
   * effect in the game where being in the middle is strictly better than
   * an edge. See `buffAdjacent`'s application in sim.ts for the
   * compounding-law note (it's `startOfBattle`-gated, same shape as
   * `buffBehind` on Warren-Warden). Magnitude scales via
   * `tierAttackMultiplier`/`tierHealthMultiplier` (issue #58), same
   * fire-once reasoning as `buffBehind`.
   */
  | { kind: 'buffAdjacent'; attack: number; health: number }
  /**
   * Pack-Caller rework (issue #88 follow-up, 2026-07-16 — replaces the
   * original `buffAdjacentByTribe`). Jesper's read: the original ability was
   * mechanically a lazy Press-Kin clone (identical "both neighbors, best in
   * the middle" targeting via `buffAdjacent`), differing only by a magnitude
   * multiplier keyed off `UnitDef.tribe` — a tag the UI never surfaces
   * anywhere, so the two units read as interchangeable and the actual
   * winner was invisible board trivia, not a real player choice.
   *
   * This version drops the tribe dependency entirely and changes the shape:
   * `faint`-triggered (not `startOfBattle`), it gives away its OWN CURRENT
   * attack and max health — tier-scaled, relic-buffed, and inflated by
   * whatever startOfBattle buffs it happened to receive (Warren-Warden,
   * the Forgotten Backpack relic, ...) — split EVENLY across every other
   * living teammate, with any remainder (stat % survivor-count) going one
   * point each to the FRONTMOST survivors first. `receiveCapMultiplier`
   * (below) is the one tunable number on this effect (unlike
   * `buffBehind`/`teamBuff`'s literal `attack`/`health`, the payout ITSELF
   * is always exactly the caster's own live stat line, never a separate
   * literal) — see the sim.ts case for exactly which fields that reads.
   *
   * Compounding-law note (corrected 2026-07-17 — the previous version of
   * this note was simply wrong; see below): `faint` fires on EVERY death,
   * not just the first (`resolveDeaths` in sim.ts), so a Bone-Priest-revived
   * Pack-Caller that dies a second time pays out again — same shape as
   * Gnawer's `bequeathAttack`. Revive is capped once per corpse, so a single
   * Pack-Caller instance can pay out at most twice per battle, same bound
   * Gnawer relies on. Using the LIVE (buffed) value rather than a fixed base
   * is safe for the same reason it's safe there: every effect that could
   * have inflated this unit's stats first (buffBehind, teamBuff, relics,
   * revive itself, ...) is itself already fire-once/bounded under ADR-0003,
   * so even a twice-paid-out snapshot is bounded — it just varies with board
   * synergy, which is the intended payoff for building around it. Measured
   * impact of the revive double-payout on a 6× Pack-Caller + Bone-Priest
   * board (pre-`receiveCapMultiplier` fix below): a modest ~10-18% higher
   * peak single-unit attack than the same board without Bone-Priest — not
   * degenerate on its own.
   *
   * A board with several Pack-Callers CAN chain — one's payout can inflate
   * the live stats a later one gives away when it too falls — bounded by
   * (up to) twice the board's own size given the revive interaction above,
   * not by wave count or ride length, AND now further bounded in aggregate
   * by `totalBudgetMultiplier` below. Zero survivors (last unit standing) is
   * a no-op, not a crash.
   *
   * PAYOUT-CONCENTRATION fix, v1 — RECEIVER-side cap (issue #131, shipped
   * 2026-07-17, replaced same day): the real Boss Trial risk was never
   * Pack-Caller-buffing-Pack-Caller — it was PAYOUT CONCENTRATION as a board
   * thins: as fewer survivors remain, each subsequent faint's split lands on
   * a shrinking pool, letting a late "sink" unit (which need not be another
   * Pack-Caller — Corpse-Glutton or even a plain Dire-Rat reproduces it)
   * accumulate enough attack/health to tank far more escalating-attack Boss
   * Trial phases than the design assumes — reproduced hitting
   * `BOSS_TRIAL_MAX_PHASES` (the trial's hard safety cap, which
   * boss-trial.ts's own comment calls a bug signal, not a valid outcome),
   * highly sensitive to board ORDER (identical units/tiers scored 7 vs. 60
   * phases depending purely on ordering). The first fix capped what ANY
   * single recipient could absorb, tuned empirically against Jesper's actual
   * reported board (4x Pack-Caller + Warren-Warden + Ward-Weaver, screenshot
   * 2026-07-17) down to `receiveCapMultiplier: 1` (3x and 1.5x barely moved
   * it — Warren-Warden's own base stats are already large at tier 3, so a
   * multiple of THAT stayed enormous), which did bring the reported board to
   * 10 phases, in line with ordinary strong boards (7-9). But on review
   * (Jesper, 2026-07-17) this flattened the card's actual strategic choice:
   * anchoring the cap to each recipient's own (small, early) stats meant
   * positioning Pack-Caller to die LATE — banking a big payout to dump on
   * 1-2 chosen units, the card's other intended play pattern alongside early
   * broad-spread — mostly wasted the payout once survivors thinned, since
   * the accumulated total vastly exceeded any individual recipient's cap.
   * Early-spread became the only non-wasteful line, which wasn't the intent.
   *
   * PAYOUT-CONCENTRATION fix, v2 — SOURCE-side shared budget (shipped same
   * day, replacing v1): instead of capping what one recipient can absorb,
   * cap the TOTAL this effect can move per side over the WHOLE battle,
   * shared across every Pack-Caller on that side — same cap-not-sum idiom as
   * the poison-all/Plague-Bearer caps (`poisonAllApplied`/`poisonLastApplied`
   * in sim.ts), just scoped to the whole battle instead of one wave, since
   * this exploit plays out across many separate waves as a board thins, not
   * within one. Budget = `totalBudgetMultiplier` × a single tier-3
   * Pack-Caller's own base attack/health (see the sim.ts case for the exact
   * accounting) — sized the same way `poisonStacksForTier(3)` sizes the
   * poison-all cap: "worth of one strong instance," not tied to whichever
   * unit happens to receive it. This preserves the actual choice (spread
   * early across a full board, or bank it and dump it all on 1-2 units
   * late) since it doesn't care WHO receives, only how much this ability can
   * inject over a ride in total. Overflow past the remaining budget is
   * simply lost when the dying unit's own total is clipped, before the
   * (possibly-reduced) total is split — not redistributed to a later death,
   * same "clip, don't reroute" shape as everywhere else in this file.
   * `totalBudgetMultiplier` value: tentative pending Jesper's balance
   * sign-off like every other new magnitude in this file — re-verify against
   * the same reported board before trusting a specific number.
   */
  | { kind: 'distributeStatsOnFaint'; totalBudgetMultiplier: number }
  | { kind: 'poisonFrontEnemy'; stacks: number }
  /**
   * Plague-Bearer (issue #112, reworked from `poisonFrontEnemy`). Poisons
   * `enemies[enemies.length - 1]` — the back of the enemy line — instead of
   * the front. Stack count is NOT carried on the effect — same as its
   * siblings, it's looked up per-tier via `poisonStacksForTier` (1/3/5) at
   * apply time; this rework only moves WHERE the stacks land, never how
   * many. Always wired to `startOfWave` (unchanged): fires for every
   * Plague-Bearer regardless of board slot, landing before the wave's
   * been chipped by combat, same reasoning as Blight-Witch's
   * `poisonAllEnemies`.
   *
   * Rationale (issue #112): Plague-Bearer was strictly dominated by
   * Blight-Witch — same stack table, one enemy vs. the whole line, and the
   * front enemy it poisoned was usually dying to the clash anyway. Reaching
   * the back of the line instead pre-rots a protected backline threat
   * before the front-to-back grind gets there, giving the plague tribe two
   * distinct roles (Witch rots wide, Bearer reaches deep).
   *
   * Degenerate case: a single-enemy wave has last === front, so this
   * behaves exactly like `poisonFrontEnemy` did — no special-casing needed.
   *
   * Compounding-law note: enemies are re-instantiated every wave and
   * poison never carries across waves (`waveClear`'s antidote, plus
   * enemies simply not existing yet next wave), so this cannot accumulate
   * across the 45-wave battle. Multiple Plague-Bearers stack additively
   * within a single wave (each re-applies `poisonStacksForTier(tier)` to
   * the same last enemy) — bounded by fresh enemies next wave, not a
   * persistent-horde compounding vector.
   */
  | { kind: 'poisonLastEnemy' }
  | { kind: 'poisonTarget'; stacks: number }
  /**
   * Blight-Witch (issue #62). Poisons every living enemy currently on the
   * board, not just the front one — the first effect in the game to hit the
   * whole opposing wave at once. Stack count is NOT carried on the effect —
   * it's looked up per-tier via `poisonStacksForTier` at apply time, same
   * pattern as `revive`'s `reviveHpForTier` lookup. Always wired to
   * `startOfWave` (never `afterAttack`): `afterAttack` only fires for
   * whichever unit is currently front, which both wasted this effect on an
   * enemy already dying from the clash and left a back-line Blight-Witch
   * dead weight. `startOfWave` fires for every unit regardless of board
   * slot and lands on the whole wave before it's been chipped by combat.
   *
   * Compounding-law note: enemies are re-instantiated every wave and
   * poison never carries across waves (see `waveClear`'s antidote, and
   * enemies simply not existing yet next wave), so this cannot accumulate
   * across the 45-wave battle.
   *
   * Multi-caster cap (issue #116): Blight-Witches used to stack ADDITIVELY
   * within a wave (each re-applying `poisonStacksForTier(tier)` to every
   * enemy), which drove RatMoe's depth-45 3× board. That stacking is now
   * capped — the TOTAL poison-all stacks landed on the enemy side per wave
   * is clamped to `poisonStacksForTier(3)` (see the `poisonAllApplied`
   * budget and the `poisonAllEnemies` case in sim.ts). A lone ★3 or two ★2s
   * are essentially unaffected; a stack of three-plus casters is not. Each
   * caster's own per-tier value is untouched — the cap lives in the sim's
   * per-wave accounting, mirroring Ward-Weaver's `blockCharges` cap-not-sum.
   */
  | { kind: 'poisonAllEnemies' }
  | { kind: 'gainStats'; attack: number; health: number }
  /**
   * Cellar-Coil (issue #106; "positional patience" in
   * `docs/design/future-minions.md`). Sibling to `gainStats` above, but
   * deliberately NOT the same shape: `gainStats` is uncapped and only ever
   * safe today because its one wired-up trigger (`allyFaint`) is implicitly
   * bounded by how many allies can faint in a battle. This effect is wired
   * to `startOfWave` — a repeating Trigger — gated by the new
   * `Ability.condition.notFront` (fires only on Waves the unit survives
   * while NOT at board index 0), which is exactly the shape ADR-0003 (see
   * `docs/adr/0003-compounding-law-for-repeating-triggers.md`) flags as
   * needing an explicit hard cap: the same permanent-per-wave-gain shape
   * that shipped as the Warren-Warden incident. It is only safe here
   * because the grant is HARD-CAPPED by construction, not a suggestion:
   *
   *   - Per-wave grant is `effect.attackPerWave * tier` — deliberately
   *     LINEAR tier scaling (1/2/3), not `tierAttackMultiplier`'s
   *     exponential `3^(tier-1)` — same rationale as `blockHitsForTier`'s
   *     doc comment: an accumulating per-wave effect must not also get an
   *     exponential per-tier multiplier, or the cap becomes meaningless at
   *     tier 3.
   *   - The grant is clamped in sim.ts's `applyEffect` (`chargeWhileBenched`
   *     case) to `Math.min(effect.attackPerWave * tier, cap - source.chargeStacks)`,
   *     where `cap` comes from `cellarCoilChargeCapForTier(tier)` — see that
   *     function's doc comment for the full sign-off. Once `chargeStacks`
   *     reaches the cap the ability is a silent no-op every subsequent Wave,
   *     not an error — there is no code path that lets it exceed the cap.
   *   - `chargeStacks` lives on `BattleUnit` (see its declaration in sim.ts,
   *     next to `raised`/`startOfBattleFired`) and persists across every
   *     Wave of the whole Ride the same way those fields do, so the cap is a
   *     true ceiling on total attack ever banked over all `WAVE_COUNT` (45)
   *     Waves, not just one Wave or one Battle.
   *
   * No health is granted by this effect — only attack accumulates, matching
   * the design bank's text; the unit's base `health` is its only durability
   * lever while it waits to bank charge.
   *
   * Enemy-side note (ADR-0004): the same effect is technically available to
   * an Enemy for free, but degenerates to near-harmless there — Enemies are
   * re-instantiated fresh every Wave and `fireEntryTriggers` only runs once
   * per Wave, so an Enemy copy could bank at most one grant before the Wave
   * ends and it ceases to exist; it can never reach anywhere near the cap.
   * This is intentional, not an oversight — see ADR-0004
   * (`docs/adr/0004-enemies-share-the-unit-engine.md`) — nobody should "fix"
   * this into carrying Enemy state across Waves.
   */
  | { kind: 'chargeWhileBenched'; attackPerWave: number }
  /**
   * HP is NOT carried on the effect — it's looked up per-tier via
   * `reviveHpForTier` at apply time (issue #53), then capped at the
   * revived corpse's own `maxHealth`. See `reviveHpForTier`'s doc comment
   * for why a steep table is safe here despite the compounding law.
   */
  | { kind: 'revive' }
  /**
   * Ward-Weaver (issue #56). Grants this side a per-wave pool of "block the
   * next incoming hit to whichever unit is currently front" charges, sized
   * by `blockHitsForTier(tier)` (1/2/3). Always wired to `startOfWave`, and
   * the pool is reset to 0 at the top of every wave before this fires — see
   * `blockCharges` in sim.ts for the full compounding-law note and the
   * `Math.max` (never summed) anti-stacking rule for multiple Ward-Weavers.
   */
  | { kind: 'blockFrontHits' }
  /**
   * Backline damage path (issue #85; "Slink-Rat option B" in
   * `docs/design/future-minions.md`). The reusable primitive behind future
   * backline snipers: a non-front unit adds its own current `attack`
   * directly to the frontmost enemy, once per wave, taking no retaliation
   * (it isn't the one clashing — see `blockFrontHits`'s "front" targeting
   * for contrast, which this deliberately bypasses). Always wired to
   * `startOfWave`, same firing point as `poisonFrontEnemy`/`blockFrontHits`,
   * so it lands before the tick loop's clash/poison resolution even begins
   * for that wave (see the `backlineDamage` case in sim.ts's `applyEffect`
   * for the full ordering rationale against Marrow-Snap, Ward-Weaver, and
   * Gore-Cleaver).
   *
   * Compounding-law note: this is a FIXED, non-accumulating per-wave
   * contribution — each living non-front carrier deals its current attack
   * once at that wave's start, then nothing more until the next wave's
   * `startOfWave` fires again. It does not grow with tick count, wave
   * count, or anything other than the unit's own (tier-scaled) attack stat,
   * and multiple carriers stack only additively, bounded by however many
   * non-front slots the board cap allows — the same "safe because bounded
   * by board size" shape as `poisonAllEnemies`'s multi-caster stacking.
   */
  | { kind: 'backlineDamage' }
  /**
   * Whole-team stat grant (issue #12: Dawn-Runt/Dusk-Runt) — every horde unit
   * currently on the board gets `+attack`/`+health`, including the caster
   * itself (unlike `buffBehind`, which deliberately excludes the caster —
   * see Warren-Warden). Only ever wired to a `startOfBattle` trigger, so it
   * fires once per unit instance, ever, exactly like Warren-Warden's
   * `buffBehind`, and cannot compound across the 45-wave battle. Magnitude
   * scales via `tierAttackMultiplier`/`tierHealthMultiplier` (issue #58)
   * instead of a flat `* tier`, same fire-once reasoning as `buffBehind`/
   * `buffAdjacent` above. See the `condition` field on `Ability` for how
   * this pairs with a time-of-day gate.
   */
  | { kind: 'teamBuff'; attack: number; health: number }
  /**
   * Twilight-Runt (issue #110) — single-unit fusion of Dawn-Runt/Dusk-Runt,
   * replacing the pair's "dead half of the day" problem: instead of two
   * units that each rely on `teamBuff` + `Ability.condition.timeOfDay` (so
   * one of them is a complete no-op every battle), this bakes BOTH halves
   * onto one `startOfBattle` ability with NO `condition` at all. The
   * ability always fires (once per unit instance, same fire-once rule as
   * every other `startOfBattle` buff), and picks which half's magnitudes to
   * apply from `Lineup.timeOfDay` at apply time — see the `teamBuffByTime`
   * case in sim.ts's `applyEffect` for exactly where that branch happens.
   * `timeOfDay` omitted (pre-#12 lineups, every existing golden log) hits
   * neither `beforeNoon` nor `afterNoon`, so it no-ops exactly like the
   * `condition` mechanism does when the gate doesn't match — same
   * golden-log-preserving guarantee, different mechanism.
   *
   * Magnitudes scale via `tierAttackMultiplier`/`tierHealthMultiplier`,
   * identical to plain `teamBuff` above, and this effect is `startOfBattle`
   * -only — the fire-once compounding-law argument for `teamBuff` applies
   * here unchanged (see that doc comment).
   *
   * PLACEHOLDER MAGNITUDES, PENDING JESPER SIGN-OFF (issue #110's required
   * balance gate — do not treat these as final): Twilight-Runt ships +3
   * attack / +1 health (beforeNoon) vs +1 attack / +2 health (afterNoon),
   * DELIBERATELY asymmetric rather than a flat 2-for-2 split. Jesper
   * (2026-07-15): health generally outvalues attack in this sim, so a
   * symmetric split would leave the morning half strictly worse and no one
   * would ever ride before noon — exactly the "dead half" problem this unit
   * exists to fix, just moved from unit-choice to timing-choice.
   * `scripts/twilight-runt-probe.ts` measures the two halves separately (the
   * blended 50/50 view in `all-unit-value.ts` cannot distinguish "both
   * halves fine" from "one dead half propped up by a strong other half").
   *
   * UPDATE (issue #110, 2026-07-16 follow-up — "Option 1", the fixed-hour
   * Boss Trial fix): #120 moved the Boss Trial to a fixed 20:00 CET fight,
   * which always resolves to `afterNoon`. Because the Trial scores raw
   * damage and a pure health grant is a linear one-time HP cushion against
   * the Trial's exponentially-escalating boss, the ORIGINAL `afterNoon:
   * {attack: 0, health: 2}` measured as an exact, structural +0 Trial-score
   * contribution on a maxed board (`4486 -> 4486`, `simulateBossTrial`) —
   * not a small-numbers problem, a hard zero every single day, forever,
   * because 20:00 never resolves to `beforeNoon`. `beforeNoon`'s `health: 0`
   * has no equivalent live bug (the Trial never resolves to `beforeNoon`),
   * but was floored too for the same "no hard zero in the other stat"
   * symmetry, per Option 1's own framing.
   *
   * The floor sizes were modeled, not guessed — `twilight-runt-probe.ts`'s
   * "Option 1 candidate sweep" section ran 4 candidates (shipped baseline
   * plus 3 floor magnitudes) through BOTH the existing ride/depth probe and
   * `simulateBossTrial` on T1/T2/T3 representative boards:
   *   - {atk:3,hp:0} / {atk:1,hp:2} (floor on afterNoon only): fixes the
   *     Trial zero and keeps afterNoon's ride-depth win intact (even
   *     widens it, T3 gap -5.11 -> -9.13), but erodes the OTHER identity
   *     axis hard — afterNoon's ride damage-efficiency climbs to 86-89% of
   *     beforeNoon's at T2/T3 (was 37%), i.e. afterNoon becomes almost as
   *     good at damage while still dominating depth, collapsing the
   *     "meaningful timing tradeoff" this unit exists for. Also leaves
   *     beforeNoon's health at a literal 0, failing Option 1's own ask.
   *   - {atk:3,hp:1} / {atk:2,hp:2} (bigger afterNoon floor): preserves the
   *     ride-depth win margin best (T2/T3 gaps stay -3.27/-4.64, close to
   *     baseline), but erodes the damage axis WORSE (84-95% parity at
   *     T2/T3) — afterNoon becomes near-symmetric with beforeNoon on both
   *     axes at T3. Rejected as the most eroding of the three.
   *   - {atk:3,hp:1} / {atk:1,hp:2} — SHIPPED. Keeps beforeNoon's ride
   *     damage-efficiency clearly ahead at every tier (49-59% ratio, not
   *     eroded to near-parity like the two candidates above), afterNoon
   *     keeps its ride-depth win at T3 (gap -2.26, same sign as baseline's
   *     -5.11, smaller margin), and the Trial's afterNoon score goes from a
   *     hard 0 to a real (if modest, by design — see the compounding-law
   *     argument above for why it can't be huge) positive number on every
   *     board size tested (T1 2->4, T2-mid 258->286, T3-maxed 1050->1095).
   *     KNOWN COST, disclosed rather than hidden: giving beforeNoon a
   *     health floor narrowly flips which half wins ride-depth-efficiency
   *     at T2 specifically (beforeNoon 19.93 vs afterNoon 18.30, ~8% swing
   *     — health's outsized value for depth/survival in this sim, per the
   *     project's standing health->>attack rule, means ANY nonzero health
   *     floor on the attack half has an outsized depth effect). T1 and T3
   *     both keep their existing winner. This is a real, measured tradeoff,
   *     not an oversight — see `twilight-runt-probe.ts`'s candidate-sweep
   *     output for the full numbers before changing these magnitudes again.
   */
  | { kind: 'teamBuffByTime'; beforeNoon: { attack: number; health: number }; afterNoon: { attack: number; health: number } };

/**
 * Real-world half-day bucket, Copenhagen local time (issue #12) — matches the
 * existing Monday 06:00 CET season-reset convention. Resolved by the app
 * layer from the wall clock and threaded in via `Lineup.timeOfDay`;
 * `simulate` itself never reads `Date.now()`/`new Date()`, so this stays
 * fully deterministic for tests and golden logs (they pass, or omit,
 * `timeOfDay` explicitly).
 */
export type TimeOfDay = 'beforeNoon' | 'afterNoon';

/**
 * `startOfBattle` fires **once per unit instance, ever** — on the first wave
 * that unit is present for. `startOfWave` fires at the top of **every** wave.
 *
 * The distinction is load-bearing. `simulate` runs 45 waves against one
 * persistent horde, so any *permanent* effect on a per-wave trigger compounds
 * ~45× without bound: four tier-3 Warren-Wardens re-buffing "+1/+1 to all
 * behind" every wave took a 6-attack rat to 241 and full-cleared the gauntlet.
 * Rule of thumb: **`startOfWave` is only for effects that do not accumulate** —
 * summoning a body that will die, re-applying poison that clears at `waveClear`.
 * Anything that permanently raises a stat belongs on `startOfBattle`.
 *
 * Enemies are re-instantiated every wave, so their `startOfBattle` abilities
 * still fire each wave for free — the per-instance flag makes this automatic.
 *
 * Ward-Weaver's `blockFrontHits` (issue #56) used to be a bespoke
 * per-attack-tick trigger (`watchFrontAttack`), removed once its mechanic
 * changed from "every Nth attack landed" to "block the first N hits each
 * wave" — that reset-every-wave shape is exactly what `startOfWave` is for,
 * so it no longer needs its own trigger kind. See `blockCharges` in sim.ts.
 */
export interface Ability {
  trigger: 'startOfBattle' | 'startOfWave' | 'faint' | 'afterAttack' | 'allyFaint';
  effect: Effect;
  /**
   * Gate the ability's firing on the real-world half of the day the ride
   * belongs to (issue #12). Evaluated against `Lineup.timeOfDay` at the same
   * point the trigger itself would otherwise fire (see `fireEntryTriggers` in
   * sim.ts) — a `startOfBattle` ability still only ever gets its one shot per
   * unit instance, it just no-ops that shot when the condition doesn't match,
   * rather than retrying on a later wave.
   *
   * `notFront` (issue #106: Cellar-Coil) gates firing on the unit's own board
   * position that Wave: true only on Waves where the unit is present but NOT
   * at index 0 (the clashing slot). Evaluated in `fireEntryTriggers`
   * alongside `timeOfDay`, using the same `index` that function already
   * computes before calling `applyEffect` — a `startOfWave` ability still
   * fires every Wave the unit survives, it just no-ops on any Wave the unit
   * is currently front. Siblings, not mutually exclusive in the type, but no
   * current unit combines both.
   */
  condition?: { timeOfDay?: TimeOfDay; notFront?: boolean };
}

export interface UnitDef {
  id: string;
  name: string;
  attack: number;
  health: number;
  cost: number;
  archetype?: Archetype;
  ability?: Ability;
  /**
   * Flat armor: subtract this from every incoming **attack** hit (scaled by
   * tier, like every other magnitude). Poison bypasses it — armor doesn't stop
   * rot. A hit always lands for at least 1, so armor can never make a unit
   * immortal (cf. the Bone-Priest self-revive lesson). Strong against swarms of
   * small hits, near-useless against brutes.
   */
  damageReduction?: number;
  /**
   * Day-gated shop availability (issue #12), same mechanism as
   * `boardCapForDay` — a pure function of the expedition day, no new
   * per-account state. Absent = available from day 1 (every pre-existing
   * unit). Once a unit's `unlockDay` is reached it stays in the pool for
   * every later day too — this is not a day-exclusive appearance.
   */
  unlockDay?: number;
  /**
   * Build-around tag (issue #88: Pack-Caller). Originally the count Pack-
   * Caller's `buffAdjacentByTribe` scanned the board for; that ability was
   * reworked away from tribe entirely (2026-07-16 — see
   * `distributeStatsOnFaint`'s doc comment), so this is now PURELY
   * DESCRIPTIVE on every unit, including Pack-Caller — nothing reads it
   * mechanically. Optional and freeform-ish (kept to a small fixed
   * vocabulary in practice: "runt", "plague", "brute", "swarm"); a unit with
   * no obvious kinship gets no tag rather than a forced one. Tagging is a
   * subjective flavor read — see the tagging rationale next to `UNIT_DEFS`
   * below and the PR description for issue #88.
   */
  tribe?: string;
  /**
   * Day-gated shop retirement (issue #108/#109), mirror of `unlockDay` —
   * same pure-function-of-day mechanism, no new per-account state. Absent =
   * never retires (every pre-existing unit). Once `retireDay` is reached the
   * unit leaves the *shop pool* for every later day too (`shopUnitPoolForDay`
   * filters to `unlockDay <= day < retireDay`, both optional). This only
   * gates shop ROLLS: the `UNIT_DEFS` entry stays intact forever (golden
   * logs/replays/determinism tests reference ids directly) and any
   * already-owned copy keeps fighting untouched. See `sellRefund` in
   * shop.ts for the par-buyback severance that pairs with this — a unit sold
   * after its `retireDay` has passed refunds exactly what was spent building
   * it, never a premium, so greeding a unit early is never punished.
   */
  retireDay?: number;
}

export interface LineupUnit {
  defId: string;
  tier?: number;
  relicIds?: string[];
}

export interface Lineup {
  units: LineupUnit[];
  teamRelicIds?: string[];
  /**
   * How many bodies this side may hold *during combat*, summons included.
   * Callers building from a `BuildState` (see `lineupFromBuild`/
   * `combatCapForBuild` in shop.ts) set this to `units.length + 2` — always
   * larger than however many rats were actually deployed, so a summoner is
   * never starved by a full warren, but never banks more than 2 spare slots
   * either (issue #69). Omitted = `BOARD_CAP`, which keeps every pre-existing
   * golden log byte-identical.
   */
  combatCap?: number;
  /**
   * Real-world half-day this ride's rats fight in (issue #12) — drives
   * Dawn-Runt/Dusk-Runt's `condition.timeOfDay` gate. Omitted = neither
   * condition matches, so any lineup that predates or doesn't care about
   * time-of-day (every golden log, every existing test) behaves exactly as
   * it did before this field existed. The app layer resolves this from the
   * wall clock (see `copenhagenSeconds`/`timeOfDayAt` in App.svelte);
   * `simulate` never reads the clock itself.
   */
  timeOfDay?: TimeOfDay;
}

/**
 * Full spec §5.4 roster. Archetypes: Breed/Swarm, Plague, Sacrifice, Bruiser/Anchor.
 *
 * `tribe` tagging rationale (issue #88, Pack-Caller) — a subjective read of
 * each unit's flavor/mechanics, called out here since it's a judgment call:
 *   - "runt": small, cheap, or literally-named-Runt bodies — Pup, Gutter
 *     Runt, Dawn-Runt, Dusk-Runt. Gnawer joins this tribe too: fragile
 *     (1 health) glass-cannon chaff, thematically a scrappy little biter
 *     rather than a brute or plague unit. Pack-Caller itself is tagged
 *     "runt" — it's a rallying caller for the horde's little guys, and this
 *     tribe already has the deepest bench (5 other units), which makes an
 *     all-runt board a genuinely buildable theme rather than a trap with no
 *     support.
 *   - "swarm": breeding/summon-focused units — Rat-Piper (pipes in pups
 *     every wave) and Brood-Mother (births pups on faint).
 *   - "plague": poison-dealing units — Plague-Bearer and Blight-Witch.
 *   - "brute": big, tanky anchors — Warren-Warden, Dire-Rat (armored),
 *     MD Rattyfock (Warren-Warden's kit, reskinned).
 *   - Left untagged: Corpse-Glutton, Bone-Priest, Press-Kin, Ward-Weaver.
 *     None of these read as belonging to an obvious kinship group — forcing
 *     a tag on a unit with no real thematic tribe would just be noise (the
 *     issue explicitly says use judgment, not "tag everything").
 *
 * NON-MECHANICAL as of the 2026-07-16 Pack-Caller rework: `tribe` was
 * counting fodder for `buffAdjacentByTribe`, and Pack-Caller was its only
 * reader — that ability is gone (see `distributeStatsOnFaint`'s doc comment
 * above), so no unit currently reads this field at all. Left in place as
 * flavor/taxonomy (the categorization above still describes the roster
 * honestly) rather than stripped from every tagged unit, since a future
 * tribe-synergy mechanic may want it — but don't assume it does anything
 * today.
 */
export const UNIT_DEFS: Record<string, UnitDef> = {
  pup: { id: 'pup', name: 'Pup', attack: 1, health: 1, cost: 0, tribe: 'runt' },
  'gutter-runt': {
    id: 'gutter-runt', name: 'Gutter Runt', attack: 1, health: 1, cost: 2,
    tribe: 'runt',
    // Season unit-churn (issue #109) originally cut this to a day-1/2-only
    // body (retireDay: 3) — cheap filler was polluting late-week rolls
    // (evidence: appeared once across two full seasons of leaderboard
    // lineups). Season 3: retired outright instead (retireDay: 1, so the
    // shop pool excludes it from day 1 on) — a mid-week fade was still
    // reading as a schedule tax rather than a decision, and there was no
    // sign any all-runt Pack-Caller board (#88) actually wanted it late-week
    // over the other cheap runt bodies. Par-buyback severance (`sellRefund`
    // in shop.ts) still applies, so any copy carried in from a prior season
    // sells for exactly what was spent, never a loss.
    retireDay: 1,
  },
  'rat-piper': {
    id: 'rat-piper', name: 'Rat-Piper', attack: 1, health: 2, cost: 4,
    ability: { trigger: 'startOfWave', effect: { kind: 'summon', unitId: 'pup', count: 1 } },
    tribe: 'swarm',
  },
  'brood-mother': {
    id: 'brood-mother', name: 'Brood-Mother', attack: 2, health: 3, cost: 5,
    ability: { trigger: 'faint', effect: { kind: 'summon', unitId: 'pup', count: 2 } },
    tribe: 'swarm',
  },
  'plague-bearer': {
    id: 'plague-bearer', name: 'Plague-Bearer', attack: 2, health: 2, cost: 4,
    ability: { trigger: 'startOfWave', effect: { kind: 'poisonLastEnemy' } },
    tribe: 'plague',
  },
  'blight-witch': {
    id: 'blight-witch', name: 'Blight-Witch', attack: 3, health: 3, cost: 8,
    ability: { trigger: 'startOfWave', effect: { kind: 'poisonAllEnemies' } },
    tribe: 'plague',
  },
  // Season-3 prestige tribute (issue #115): Draughtsman Moe reskins
  // Blight-Witch's exact kit/stats to honor RatMoe, the season-2 champion who
  // maxed depth 45 on a 3× Blight-Witch poison-swarm. Same reskin precedent as
  // MD Rattyfock (Warren-Warden) — the base `blight-witch` def stays in
  // UNIT_DEFS for golden logs/replays, but is removed from the purchasable pool
  // (see SHOP_UNIT_POOL in shop.ts) so the poison-all kit is only offered under
  // the prestige name. Stays `plague`-tribe so it supports the archetype he
  // pioneered and pairs with the reworked Plague-Bearer (#112, poisons the
  // back): Moe rots wide, Bearer rots deep. Balance of the shared poison-all
  // kit is tracked in #116 — tune the kit there, since Moe IS that kit.
  'draughtsman-moe': {
    id: 'draughtsman-moe', name: 'Draughtsman Moe', attack: 3, health: 3, cost: 8,
    ability: { trigger: 'startOfWave', effect: { kind: 'poisonAllEnemies' } },
    tribe: 'plague',
  },
  gnawer: {
    id: 'gnawer', name: 'Gnawer', attack: 3, health: 1, cost: 4,
    // Issue #111 rework: was a flat `buffBehind` +2 that never aged. Now a
    // `bequeathAttack` (own live attack + capped wave-died-on bonus) — see
    // that effect kind's doc comment above for the full formula and the
    // compounding-law/Cellar-Coil reasoning behind the cap living here.
    ability: { trigger: 'faint', effect: { kind: 'bequeathAttack', waveBonusCapMultiplier: 2 } },
    tribe: 'runt',
  },
  'corpse-glutton': {
    id: 'corpse-glutton', name: 'Corpse-Glutton', attack: 3, health: 2, cost: 7,
    ability: { trigger: 'allyFaint', effect: { kind: 'gainStats', attack: 1, health: 1 } },
  },
  'bone-priest': {
    id: 'bone-priest', name: 'Bone-Priest', attack: 1, health: 4, cost: 5,
    ability: { trigger: 'faint', effect: { kind: 'revive' } },
  },
  'warren-warden': {
    id: 'warren-warden', name: 'Warren-Warden', attack: 2, health: 6, cost: 6,
    ability: { trigger: 'startOfBattle', effect: { kind: 'buffBehind', attack: 1, health: 1, all: true } },
    tribe: 'brute',
  },
  'dire-rat': {
    id: 'dire-rat', name: 'Dire-Rat', attack: 4, health: 5, cost: 7,
    damageReduction: 2,
    // Day-1 shop is deliberately kept plain (Jesper, 2026-07-11): the three
    // strongest early picks — the armored tank, the Season-1 anchor, and the
    // front-shield — hold back to day 2, so day 1 is a humble scramble and the
    // shop gets visibly stronger as the expedition opens up (days 2-4 are the
    // exciting stretch). Only gates the SHOP roll; a unit already owned/on the
    // board is unaffected, and the balance scripts build lineups directly so
    // they don't see this gate.
    unlockDay: 2,
    tribe: 'brute',
  },
  'md-rattyfock': {
    id: 'md-rattyfock', name: 'MD Rattyfock', attack: 2, health: 6, cost: 6,
    ability: { trigger: 'startOfBattle', effect: { kind: 'buffBehind', attack: 1, health: 1, all: true } },
    unlockDay: 2, // day-1 shop kept plain — see Dire-Rat's note.
    tribe: 'brute',
  },
  'press-kin': {
    id: 'press-kin', name: 'Press-Kin', attack: 2, health: 4, cost: 5,
    ability: { trigger: 'startOfBattle', effect: { kind: 'buffAdjacent', attack: 2, health: 2 } },
  },
  'ward-weaver': {
    id: 'ward-weaver', name: 'Ward-Weaver', attack: 1, health: 3, cost: 5,
    ability: { trigger: 'startOfWave', effect: { kind: 'blockFrontHits' } },
    unlockDay: 2, // day-1 shop kept plain — see Dire-Rat's note.
  },
  // Issue #12: a parallel "Runt" pair (Gutter-Runt precedent) tied to the
  // game's dawn/dusk duality rather than literal noon-splitting — the actual
  // trigger condition is the broader before/after-noon Copenhagen split, but
  // the flavor leans poetic. Day-gated (unlockDay) rather than depth-gated,
  // per #6's fairness resolution, so the shop stays a pure function of
  // (date, day) with no new per-account state.
  'dawn-runt': {
    id: 'dawn-runt', name: 'Dawn-Runt', attack: 1, health: 2, cost: 4,
    ability: {
      trigger: 'startOfBattle',
      effect: { kind: 'teamBuff', attack: 2, health: 0 },
      condition: { timeOfDay: 'beforeNoon' },
    },
    unlockDay: 3,
    tribe: 'runt',
  },
  'dusk-runt': {
    id: 'dusk-runt', name: 'Dusk-Runt', attack: 1, health: 2, cost: 4,
    ability: {
      trigger: 'startOfBattle',
      effect: { kind: 'teamBuff', attack: 0, health: 2 },
      condition: { timeOfDay: 'afterNoon' },
    },
    unlockDay: 3,
    tribe: 'runt',
  },
  // Issue #88, reworked 2026-07-16 (see `distributeStatsOnFaint`'s doc
  // comment above for the full rationale — was a lazy Press-Kin clone with
  // an invisible-mechanic magnitude). Stats (attack 2 / health 3 / cost 5)
  // are unchanged from the original, still the design doc's rough starting
  // point, NOT final — flagged for Jesper's balance sign-off, same as every
  // other tentative stat line in this file. Still tagged "runt" as pure
  // flavor (see the tagging-rationale comment above `UNIT_DEFS`) — no unit
  // currently reads `tribe` mechanically now that this was its only reader.
  'pack-caller': {
    id: 'pack-caller', name: 'Pack-Caller', attack: 2, health: 3, cost: 5,
    // faint: fires on every death, so a Bone-Priest-revived Pack-Caller that
    // dies a second time pays out twice (revive is capped once per corpse,
    // same as Gnawer's `bequeathAttack`). `totalBudgetMultiplier` (issue
    // #131 v2, tentative pending balance sign-off, see `distributeStatsOnFaint`'s
    // doc comment above for the full history — a receiver-side cap shipped
    // first and was replaced same day for flattening the card's late-death
    // playstyle): every Pack-Caller on a side shares one lifetime budget for
    // this effect, sized to one tier-3 Pack-Caller's own base attack/health
    // — spread it thin early or bank it for one big late payout, your call,
    // but the total across the whole battle is capped either way.
    ability: { trigger: 'faint', effect: { kind: 'distributeStatsOnFaint', totalBudgetMultiplier: 3 } },
    tribe: 'runt',
  },
  // Issue #86: Slink-Rat — first consumer of the `backlineDamage` primitive
  // (#85). Attack 3 / health 1 / cost 6 are the design doc's rough starting
  // point, NOT final — flagged for Jesper's balance sign-off. 1 HP is
  // deliberate: worthless (dies to almost anything) if it ever reaches the
  // front, rewarding a durable front wall built to protect it.
  'slink-rat': {
    id: 'slink-rat', name: 'Slink-Rat', attack: 3, health: 1, cost: 6,
    // startOfWave, via `backlineDamage` (see that Effect's doc comment for
    // the full compounding-law note and the four resolved interaction
    // decisions against Marrow-Snap/Ward-Weaver/Gore-Cleaver). Fixed
    // per-wave damage equal to this unit's own (tier-scaled) attack — no
    // accumulation; multiple Slink-Rats stack additively, bounded by board size.
    ability: { trigger: 'startOfWave', effect: { kind: 'backlineDamage' } },
  },
  // Issue #110: single-unit fusion of the Dawn-Runt/Dusk-Runt pair above —
  // ADDED alongside them, not a replacement. Retiring Dawn/Dusk-Runt from
  // the shop pool is issue #109's job, not this one; doing it here would
  // conflict with that issue's own SHOP_UNIT_POOL edit. Every ride now has
  // a unit that's never a dead card regardless of which half of the day it
  // fires in — see `teamBuffByTime`'s doc comment above for the mechanism
  // and the placeholder-magnitude flag.
  'twilight-runt': {
    id: 'twilight-runt', name: 'Twilight-Runt', attack: 1, health: 2, cost: 5,
    ability: {
      trigger: 'startOfBattle',
      effect: {
        kind: 'teamBuffByTime',
        beforeNoon: { attack: 3, health: 1 },
        afterNoon: { attack: 1, health: 2 },
      },
    },
    unlockDay: 3,
  },
  // Issue #106: Cellar-Coil — "positional patience" (docs/design/future-minions.md
  // concept 2). Attack 2 / health 4 / cost 5 are the design doc's rough
  // starting point, NOT final — flagged for Jesper's balance sign-off.
  // Squishy on purpose: 4 HP is little enough that benching it for the 6+
  // Waves it takes to fill the cap is a real risk, not a free stat stick.
  'cellar-coil': {
    id: 'cellar-coil', name: 'Cellar-Coil', attack: 2, health: 4, cost: 5,
    // startOfWave + `condition.notFront` (see both doc comments above): fires
    // every Wave the unit survives while NOT at board index 0, and is a
    // no-op the Wave it's front (or the Wave it doesn't survive). The
    // `chargeWhileBenched` effect is HARD-CAPPED via
    // `cellarCoilChargeCapForTier` — see that function's and the effect's
    // doc comments in this file, and the `chargeWhileBenched` case in
    // sim.ts's `applyEffect`, for the full ADR-0003 compounding-law sign-off.
    // `attackPerWave: 1` here is the PRE-tier-scale literal — the case in
    // sim.ts multiplies by `tier` (linear, 1/2/3), matching
    // `cellarCoilChargeCapForTier`'s own linear-not-exponential rationale.
    ability: {
      trigger: 'startOfWave',
      effect: { kind: 'chargeWhileBenched', attackPerWave: 1 },
      condition: { notFront: true },
    },
  },
};

/** Hardcoded showcase lineup until the shop lands (milestone 4). Index 0 = front. */
export const TEST_HORDE: Lineup = {
  units: [
    { defId: 'gnawer', relicIds: ['rusted-nail'] },
    { defId: 'plague-bearer' },
    { defId: 'corpse-glutton', relicIds: ['fat-tick'] },
    { defId: 'brood-mother' },
    { defId: 'bone-priest', relicIds: ['tail-charm'] },
  ],
  teamRelicIds: ['filth-totem'],
};
