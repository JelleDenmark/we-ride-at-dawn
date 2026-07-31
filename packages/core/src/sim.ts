import type { Side, UnitDef, Ability, Lineup } from './data/units';
import { UNIT_DEFS, tierAttackMultiplier, tierHealthMultiplier, reviveHpForTier, blockHitsForTier, poisonStacksForTier, cellarCoilChargeCapForTier, backlineTargetsForTier, wardArmorForTier, buffSummonedForTier, weakenPercentForTier } from './data/units';
import { ENEMY_POOL } from './data/enemies';
import { RELIC_DEFS, type RelicDef } from './data/relics';
import type { Gauntlet } from './gauntlet';

const DEF_LOOKUP: Record<string, UnitDef> = {
  ...UNIT_DEFS,
  ...Object.fromEntries(ENEMY_POOL.map((e) => [e.id, e])),
};

/** Hard maximum number of rats you may *recruit* onto the board. The shop's
 * per-day buildable cap (boardCapForDay) grows toward this over an expedition. */
export const BOARD_CAP = 8;
/**
 * Combat leaves this much headroom above however many rats are actually
 * deployed, so summons (Rat-Piper's pups, Brood-Mother's litter, Bone-Priest's
 * revive) always have somewhere to land. Previously summons silently no-op'd
 * once the warren was full, which quietly bricked every summoner build the
 * moment you filled your board — the single most-reported confusion. Dynamic
 * per issue #69 (deployed-count + bonus, not board-cap + bonus) so the
 * headroom is always useful on a thin board but never a runaway ceiling on a
 * full one. See `combatCapForBuild` in shop.ts.
 *
 * Raised 2 -> 6 for the issue #105 summon rework: this bonus is no longer the
 * summon *firewall* it used to be. Its old job — stopping Rat-Piper's per-wave
 * summon from filling the board with permanent pups — now belongs at the
 * source (Rat-Piper's `maintainSummons` self-bounds to `count * tier`). So
 * the bonus is free to be "how many momentary bodies fit at once," sized to
 * fit Brood-Mother's babushka cascade (finite by construction — see her def).
 * PLACEHOLDER pending the balance pass; the exploit-stress probe and the
 * enemy-wave body-count check (this cap also gates enemy summoners, who share
 * the loop) are the guardrails on the exact number.
 */
export const COMBAT_CAP_BONUS = 6;
export const SCORE_PER_WAVE = 100;
/** Stalemate guard (e.g. two healers out-sustaining each other): the wave is abandoned. */
export const MAX_TICKS_PER_WAVE = 1000;

// Enemy stat-scaling by WAVE DEPTH (wave index `i`, 0-based), not by day.
// This is the primary difficulty lever: deeper waves field tankier foes, so
// pushing depth requires attack (making attack-buffing relics matter) while
// staying day-agnostic (no early-peak sweet spot for the max-depth-over-week
// leaderboard metric). Health scales faster than attack so overkill damage
// keeps being "spent" on enemy HP rather than wasted past a low cap.
// Health also carries a small quadratic term: a stronger (higher-tier)
// horde's raw attack grows multiplicatively with tier-ups, so a purely
// linear HP curve eventually falls behind and attack stops mattering again
// at high depth/tier — the same "overkill wasted" bug this whole change
// exists to fix, just recurring at a higher power level.
// 0.20 -> 0.22 (2026-07-25, issue #150): a separate, general "slightly
// harder" difficulty pass on top of the 0.08 attack bump below — NOT targeted
// at armor/sustain like that one was. Sized off three balance scripts
// (balance:realistic, balance:depth, snowball) against 0.22/0.09 and a larger
// 0.24/0.10 candidate: 0.22/0.09 knocked every depth proxy down a consistent
// ~4-7% (e.g. balance:realistic lookahead day-7 24.06 -> 23.41, snowball
// default day-7 13.86 -> 12.43) while staying monotonic/convergent and
// leaving Rusted Nail positive on every expedition day. The 0.24/0.10
// candidate cut deeper (~9-12%) but zeroed Rusted Nail's delta on three of
// seven days in balance:depth — a relic going fully inert read as more than
// "slightly" harder, so it was rejected in favor of this one. See issue #150
// for the full comparison; this does NOT touch the tier-up curve (3^(tier-1)
// per merge), which is a separate, still-open wave-10-flatten question.
export const ENEMY_HEALTH_SCALE_PER_WAVE = 0.22;
export const ENEMY_HEALTH_SCALE_QUADRATIC = 0.004;
// 0.05 -> 0.08 (2026-07-24, alongside the Ward-Weaver armor rework): a modest
// general-difficulty raise so the deep gauntlet actually pressures armor/
// sustain fronts. NOTE this is only a supporting knob — the armor+heal
// immortality it was first reached for is fixed structurally by the net-damage
// floor in the tick loop (raising this alone couldn't break that threshold
// without cratering the whole depth ladder; see the balance-pass notes).
// 0.08 -> 0.09 (2026-07-25, issue #150): layered on top as part of the same
// general difficulty pass described above the health constant; same
// balance-script evidence, same rejected 0.10 candidate.
// 0.09 -> 0.1 (2026-07-25): the 0.10 candidate #150 rejected specifically
// because it zeroed Rusted Nail's delta on three of seven balance:depth days
// (read as more than "slightly" harder at the time). Reapplied here at
// Jesper's call re: enemy scaling still reading soft against the tier-up
// curve (see the wave-10-flatten note) — re-verify Rusted Nail's delta
// against balance:depth before this ships to confirm that tradeoff is one
// he still wants.
export const ENEMY_ATTACK_SCALE_PER_WAVE = 0.1;

export function enemyHealthScale(waveIndex: number): number {
  return 1 + waveIndex * ENEMY_HEALTH_SCALE_PER_WAVE + waveIndex * waveIndex * ENEMY_HEALTH_SCALE_QUADRATIC;
}

export function enemyAttackScale(waveIndex: number): number {
  return 1 + waveIndex * ENEMY_ATTACK_SCALE_PER_WAVE;
}

export interface UnitView {
  instanceId: number;
  defId: string;
  name: string;
  attack: number;
  health: number;
  tier: number;
  side: Side;
}

export type BattleEvent =
  | { type: 'battleStart'; horde: UnitView[] }
  | { type: 'waveStart'; wave: number; enemies: UnitView[] }
  | { type: 'clash'; hordeId: number; enemyId: number }
  | { type: 'damage'; targetId: number; amount: number; remainingHealth: number }
  | { type: 'poisonApplied'; targetId: number; stacks: number; totalStacks: number }
  | { type: 'poisonTick'; targetId: number; amount: number; remainingHealth: number }
  | { type: 'heal'; targetId: number; amount: number; newHealth: number }
  | { type: 'death'; unitId: number }
  | { type: 'summon'; side: Side; index: number; unit: UnitView }
  | { type: 'revive'; side: Side; index: number; unit: UnitView }
  | { type: 'buff'; targetId: number; attack: number; health: number; newAttack: number; newHealth: number }
  /** Gutter-Acolyte's attack shred (issue #137): `attack` is the amount
   * actually removed (post-floor, so it may be less than the caster's full
   * shred). A separate event from 'buff' on purpose — the replay renders
   * buffs as green "+N" floats, and a debuff wearing that costume would
   * read as a gift. */
  | { type: 'weaken'; targetId: number; attack: number; newAttack: number }
  | { type: 'relicProc'; targetId: number; relicId: string; name: string }
  | { type: 'shieldGranted'; targetId: number; sourceId: number }
  | { type: 'shieldAbsorbed'; targetId: number }
  | { type: 'waveClear'; wave: number }
  | { type: 'battleEnd'; wavesCleared: number; score: number };

export interface BattleResult {
  wavesCleared: number;
  score: number;
  survivors: UnitView[];
  damageDealt: number;
  /** Enemies felled this battle (fallen.gauntlet.length) — the season's
   * cumulative kill-count leaderboard tiebreak is a running sum of this. */
  enemiesDefeated: number;
}

interface BattleUnit {
  instanceId: number;
  defId: string;
  name: string;
  attack: number;
  health: number;
  maxHealth: number;
  tier: number;
  side: Side;
  ability?: Ability;
  relics: RelicDef[];
  poison: number;
  firstAttackDone: boolean;
  tailCharmUsed: boolean;
  /** Flat armor against 'attack' damage; see UnitDef.damageReduction. */
  damageReduction: number;
  /** `startOfBattle` fires once per unit instance, ever — never again on later waves. */
  startOfBattleFired: boolean;
  /** A corpse may be raised once per battle. Guards the two-reviver loop. */
  raised: boolean;
  /**
   * Cellar-Coil's `chargeWhileBenched` (issue #106). How much of this
   * instance's `cellarCoilChargeCapForTier(tier)` ceiling has already been
   * banked. Persists across every Wave of the whole Ride the same way
   * `raised`/`startOfBattleFired` do (this is a per-instance field on the
   * live `BattleUnit`, never reset mid-Ride) — that persistence is exactly
   * what lets the cap be a true ceiling on total attack banked over all
   * `WAVE_COUNT` (45) Waves, not just one Wave. See `cellarCoilChargeCapForTier`
   * and the `chargeWhileBenched` Effect's doc comments in data/units.ts for
   * the full ADR-0003 compounding-law sign-off. Init 0 for every unit, not
   * just Cellar-Coil — harmless dead weight on units without the effect.
   */
  chargeStacks: number;
  /**
   * Running total of every runtime attack buff this instance has ever
   * received via `buff()` (Warren-Warden's `buffBehind`, Twilight-Runt's
   * `teamBuffByWave`, Gnawer's `bequeathAttack`, etc.) — everything added to
   * `attack` AFTER `instantiate` sets its tier-scaled base. `backlineDamage`
   * needs this to build a flat, tier-multiplier-free per-hit magnitude
   * (`def.attack` + relics + team relic attack) that still honors these
   * runtime buffs the same way `source.attack` already does for every other
   * attack-based effect — without it, a buffed Slink-Rat would silently deal
   * less backline damage than an identical unit hitting through the normal
   * clash. Never itself run through `tierAttackMultiplier` — `buff()` already
   * tier-scales its callers' inputs before adding here.
   */
  attackBuffs: number;
  /**
   * Twilight-Runt's `teamBuffByWave` (2026-07-16 rework of issue #110).
   * Tracks how far this instance has progressed through its two fire-once
   * team grants — 'none' (neither fired yet), 'early' (only the early-wave
   * dose fired), 'both' (both doses fired, ever). Each transition happens at
   * most once per unit instance — same fire-once invariant class as
   * `startOfBattleFired` — see the `teamBuffByWave` case in `applyEffect`
   * and its Effect doc comment in data/units.ts for the full compounding-law
   * reasoning. Init 'none' for every unit, harmless dead weight on units
   * without the effect.
   */
  waveBuffPhase: 'none' | 'early' | 'both';
  /**
   * instanceId of the summoner that owns this body, if it was summoned by a
   * `maintainSummons` caster (Rat-Piper, issue #105). Lets that caster count
   * how many of its OWN pups are still alive and top the litter back up to
   * target instead of adding a fresh one every wave — the source-level bound
   * that makes a raised `COMBAT_CAP_BONUS` safe. Undefined for recruited
   * units and for one-shot summons (Brood-Mother's cascade doesn't maintain).
   */
  summonedBy?: number;
}

/** A hit reduced by armor still lands for at least this much. */
export const MIN_ATTACK_DAMAGE = 1;

/**
 * How the enemy side is sourced for a battle:
 * - `gauntlet`: the PvE wave sequence — tier-1, relic-less, wave-scaled foes,
 *   a fresh wave instantiated for each of `gauntlet.waves`.
 * - `duel`: a second player Lineup fought as ONE symmetric wave, with full
 *   tiers, per-unit relics and team relics, and no wave scaling. See
 *   `simulateDuel` in duel.ts.
 */
export type BattleMode =
  | { kind: 'gauntlet'; gauntlet: Gauntlet }
  | { kind: 'duel'; opponent: Lineup };

export interface CoreOutput {
  events: BattleEvent[];
  result: BattleResult;
  /**
   * Enemy-side survivors when the battle ended. In a duel this is side B's
   * surviving board, which is how `simulateDuel` picks a winner. The PvE
   * `simulate` wrapper drops it.
   */
  enemySurvivors: UnitView[];
}

/**
 * Pure and deterministic: same (lineup, gauntlet) always yields a
 * byte-identical event log. No unseeded randomness, no wall-clock,
 * no iteration over unordered collections.
 *
 * Tick order: heals -> simultaneous clash -> afterAttack triggers ->
 * poison ticks -> death resolution (faint ability, faint relics,
 * allyFaint listeners — horde before gauntlet, front to back).
 */
export function simulate(
  lineup: Lineup,
  gauntlet: Gauntlet
): { events: BattleEvent[]; result: BattleResult } {
  const { events, result } = simulateCore(lineup, { kind: 'gauntlet', gauntlet });
  return { events, result };
}

/**
 * Shared battle core for both PvE (`simulate`) and PvP (`simulateDuel`).
 *
 * In `gauntlet` mode this reproduces the original `simulate` behaviour
 * exactly. The generalizations the duel needs — per-SIDE team relics, and a
 * wave list that can be a single opposing board — are all strict no-ops for
 * PvE: gauntlet enemies carry no team relics, so the enemy side's pools are
 * all-zero, and the wave list is still just `gauntlet.waves`.
 *
 * Tick order: heals -> simultaneous clash -> afterAttack triggers ->
 * poison ticks -> death resolution (faint ability, faint relics,
 * allyFaint listeners — horde before gauntlet, front to back).
 */
export function simulateCore(lineup: Lineup, mode: BattleMode): CoreOutput {
  const events: BattleEvent[] = [];
  let nextInstanceId = 1;

  /**
   * Team-relic stat pools, resolved PER SIDE (was horde-only). A duel has a
   * real board on both sides, each bringing its own team relics; in gauntlet
   * mode the enemy side has none, so its pool is all-zero and every number
   * below is byte-identical to the pre-duel engine.
   */
  const teamPool = (ids?: string[]) => {
    const rs = (ids ?? [])
      .map((id) => RELIC_DEFS[id])
      .filter((r): r is RelicDef => r !== undefined && r.scope === 'team');
    return {
      attack: rs.reduce((s, r) => s + (r.attack ?? 0), 0),
      health: rs.reduce((s, r) => s + (r.health ?? 0), 0),
      // Whole-board per-tick regen (The Forgotten Backpack). Same shape as a
      // unit's healPerTick (Fat Tick), just summed across team relics and
      // applied to every unit on that side instead of only the carrier.
      // Compounding-law check: bounded exactly like Fat Tick's regen below —
      // every tick it's clamped to `maxHealth - health`, so it can never push
      // a unit past its own health ceiling no matter how many of the 45 waves
      // it runs across.
      healPerTick: rs.reduce((s, r) => s + (r.healPerTick ?? 0), 0),
    };
  };
  const hordeTeam = teamPool(lineup.teamRelicIds);
  const enemyTeam = mode.kind === 'duel' ? teamPool(mode.opponent.teamRelicIds) : teamPool([]);
  const teamOf = (side: Side) => (side === 'horde' ? hordeTeam : enemyTeam);
  // In-combat body ceiling, resolved PER SIDE. In gauntlet mode both sides
  // share the horde-derived cap — the deliberate enemy-cap coupling from #148
  // (a bigger player board also loosens enemy summoner waves), preserved here
  // byte-identical: `enemyCombatCap === hordeCombatCap`, so `capOf` returns
  // the same single value the old shared `combatCap` did. In a duel each board
  // brings its own cap, so side B's summoners are bounded by B's board, not by
  // whichever seat it was assigned — the seat-fairness the mirror relies on.
  // Absent (golden logs, tests, gauntlet-only callers) it's BOARD_CAP.
  const hordeCombatCap = lineup.combatCap ?? BOARD_CAP;
  const enemyCombatCap =
    mode.kind === 'duel' ? (mode.opponent.combatCap ?? BOARD_CAP) : hordeCombatCap;
  const capOf = (side: Side): number => (side === 'horde' ? hordeCombatCap : enemyCombatCap);
  // Real-world half-day this ride belongs to (issue #12: Dawn-Runt/Dusk-Runt).
  // Never read from the clock here — the app layer resolves it and passes it
  // in via Lineup.timeOfDay. Omitted = matches neither ability condition, so
  // any lineup that doesn't know about time-of-day is unaffected.
  const timeOfDay = lineup.timeOfDay;

  const instantiate = (
    def: UnitDef,
    side: Side,
    relicIds: string[] = [],
    tier = 1,
    attackScale = 1,
    healthScale = 1
  ): BattleUnit => {
    const relics = relicIds
      .map((id) => RELIC_DEFS[id])
      .filter((r): r is RelicDef => r !== undefined && r.scope === 'unit');
    let attack =
      Math.round(def.attack * tierAttackMultiplier(tier) * attackScale) +
      relics.reduce((s, r) => s + (r.attack ?? 0), 0);
    let health =
      Math.round(def.health * tierHealthMultiplier(tier) * healthScale) +
      relics.reduce((s, r) => s + (r.health ?? 0), 0);
    const team = teamOf(side);
    attack += team.attack;
    health += team.health;
    return {
      instanceId: nextInstanceId++,
      defId: def.id,
      name: def.name,
      attack,
      health,
      maxHealth: health,
      tier,
      side,
      ability: def.ability,
      relics,
      poison: 0,
      firstAttackDone: false,
      tailCharmUsed: false,
      damageReduction: (def.damageReduction ?? 0) * tier,
      startOfBattleFired: false,
      raised: false,
      chargeStacks: 0,
      waveBuffPhase: 'none',
      attackBuffs: 0,
    };
  };

  const view = (u: BattleUnit): UnitView => ({
    instanceId: u.instanceId,
    defId: u.defId,
    name: u.name,
    attack: u.attack,
    health: u.health,
    tier: u.tier,
    side: u.side,
  });

  const horde: BattleUnit[] = lineup.units
    .slice(0, BOARD_CAP)
    .map((u) => instantiate(UNIT_DEFS[u.defId], 'horde', u.relicIds, u.tier ?? 1));
  let enemies: BattleUnit[] = [];
  const fallen: Record<Side, BattleUnit[]> = { horde: [], gauntlet: [] };

  const boardOf = (side: Side): BattleUnit[] => (side === 'horde' ? horde : enemies);
  const opposing = (side: Side): BattleUnit[] => (side === 'horde' ? enemies : horde);

  events.push({ type: 'battleStart', horde: horde.map(view) });

  const applyDamage = (unit: BattleUnit, amount: number, cause: 'attack' | 'poison'): void => {
    // Armor blunts attacks only — poison is rot, it goes around the hide. The
    // floor keeps armor from ever producing an unkillable front rat.
    const dealt =
      cause === 'attack' && unit.damageReduction > 0
        ? Math.max(MIN_ATTACK_DAMAGE, amount - unit.damageReduction)
        : amount;
    unit.health -= dealt;
    let charmProc = false;
    if (unit.health <= 0 && !unit.tailCharmUsed) {
      const charm = unit.relics.find((r) => r.surviveLethal);
      if (charm) {
        unit.tailCharmUsed = true;
        unit.health = 1;
        charmProc = true;
      }
    }
    events.push({
      type: cause === 'poison' ? 'poisonTick' : 'damage',
      targetId: unit.instanceId,
      amount: dealt,
      remainingHealth: unit.health,
    });
    if (charmProc) {
      events.push({ type: 'relicProc', targetId: unit.instanceId, relicId: 'tail-charm', name: 'Tail-Charm' });
    }
  };

  const applyPoisonStacks = (target: BattleUnit, stacks: number): void => {
    target.poison += stacks;
    events.push({
      type: 'poisonApplied',
      targetId: target.instanceId,
      stacks,
      totalStacks: target.poison,
    });
  };

  const buff = (target: BattleUnit, attack: number, health: number): void => {
    target.attack += attack;
    target.attackBuffs += attack;
    target.health += health;
    target.maxHealth += health;
    events.push({
      type: 'buff',
      targetId: target.instanceId,
      attack,
      health,
      newAttack: target.attack,
      newHealth: target.health,
    });
  };

  /**
   * 1-based wave number currently in progress, updated at the top of the
   * outer wave loop below (`currentWave = w + 1`). Threaded in as a mutable
   * closure variable rather than a parameter because `applyEffect` fires
   * from several call sites at different points in a wave (entry triggers,
   * `afterAttack`, death resolution) and all of them should see whatever
   * wave is actually in progress at that instant — Gnawer's `bequeathAttack`
   * (issue #111) is the first effect that needs "what wave is this" at
   * apply time. Read once per `faint`, never accumulated — see that
   * effect's doc comment in data/units.ts for the compounding-law reasoning.
   */
  let currentWave = 0;

  /**
   * TARGETED triggers (issue #133/#134: `allySummoned`, `onHurt`): their
   * effects act on a specific other unit (the newly-summoned body, the
   * attacker) that the positional `applyEffect` below has no way to name, so
   * they resolve here instead. Magnitudes scale LINEARLY with the source's
   * tier (`* tier`, 1/2/3) — both triggers repeat (every summon, every hit),
   * and a repeating trigger must never also get `tierAttackMultiplier`'s
   * exponential curve (see `chargeWhileBenched`'s rationale in units.ts).
   */
  const applyTargetedEffect = (
    source: BattleUnit,
    target: BattleUnit,
    buffSummonedBudget?: { attack: number; health: number }
  ): void => {
    if (!source.ability) return;
    const effect = source.ability.effect;
    const tier = source.tier;
    switch (effect.kind) {
      case 'buffSummoned': {
        // Squeak-Sensei (issue #133). The buff lands on the NEWCOMER only —
        // that targeting is the ADR-0003 safety (a fresh instance, buffed
        // once at birth; nothing accumulates on a persistent unit). See the
        // Effect's doc comment in units.ts before ever widening the target.
        // Magnitude comes from `buffSummonedForTier` ([1, 3, 5], not `* tier`)
        // — see that function's doc comment for the 2026-07-25 curve bump.
        //
        // Multi-caster stack cap (2026-07-25, per Jesper's "5x Sensei + 1-2
        // Brood-Mother" concern): every OTHER Sensei on the board witnesses
        // the same summon (see `fireAllySummoned` below), so without a cap
        // N Senseis grant N times the buff to one newcomer — the exact
        // additive-stacking shape that caused the `poisonAllEnemies` RatMoe
        // exploit (issue #116). Mirror that fix: cap the TOTAL grant one
        // summoned body can receive from all witnessing Senseis combined at
        // `buffSummonedForTier(3)` (one ★3's worth) — cap-not-sum, same
        // precedent as `poisonAllEnemies`/`blockCharges`. No single caster's
        // per-summon grant changes; you can still field 2 tier-2s, just not
        // stack 5 tier-3s onto one newcomer.
        const scale = buffSummonedForTier(tier);
        let grantAttack = effect.attack * scale;
        let grantHealth = effect.health * scale;
        if (buffSummonedBudget) {
          grantAttack = Math.min(grantAttack, buffSummonedBudget.attack);
          grantHealth = Math.min(grantHealth, buffSummonedBudget.health);
          buffSummonedBudget.attack -= grantAttack;
          buffSummonedBudget.health -= grantHealth;
        }
        if (grantAttack > 0 || grantHealth > 0) buff(target, grantAttack, grantHealth);
        break;
      }
      case 'reflectDamage': {
        // Steel-Whisker (issue #134). A normal 'attack' hit back at the
        // attacker, so the attacker's own armor blunts it and the
        // MIN_ATTACK_DAMAGE floor applies. Fires whether or not the victim
        // survived the blow (the bristles cut as it falls), but never lands
        // on an attacker some earlier source already felled this tick.
        if (target.health > 0) applyDamage(target, effect.damage * tier, 'attack');
        break;
      }
    }
  };

  /**
   * `allySummoned` fire-point (issue #133): called once per summoned body,
   * right after its 'summon' event, from the `summon` case below. Every
   * OTHER living unit on that side that watches for summons reacts, in board
   * order; the newcomer never witnesses its own arrival. `revive` is a
   * raising, not a summoning, and deliberately never calls this.
   *
   * `buffSummonedBudget` is a fresh cap-not-sum budget PER SUMMON EVENT
   * (`buffSummonedForTier(3)` in each of attack/health) — see the
   * `buffSummoned` case in `applyTargetedEffect` above for why multiple
   * Senseis must share one budget rather than each granting in full.
   */
  const fireAllySummoned = (summoned: BattleUnit): void => {
    const buffSummonedBudget = { attack: buffSummonedForTier(3), health: buffSummonedForTier(3) };
    for (const witness of [...boardOf(summoned.side)]) {
      if (witness === summoned || witness.health <= 0) continue;
      if (witness.ability?.trigger === 'allySummoned') {
        applyTargetedEffect(witness, summoned, buffSummonedBudget);
      }
    }
  };

  /**
   * Insert one summoned body at `index` on `side`, respecting the combat cap.
   * Returns false (and does nothing) when the side is already at the cap, so
   * callers can stop their litter loop. `owner` tags the body's `summonedBy`
   * for `maintainSummons` accounting (Rat-Piper); omit it for one-shot summons
   * (Brood-Mother's cascade). Fires `allySummoned` (Squeak-Sensei) per body.
   */
  const spawn = (def: UnitDef, index: number, side: Side, owner?: number): boolean => {
    const board = boardOf(side);
    if (board.length >= capOf(side)) return false;
    const summoned = instantiate(def, side);
    summoned.summonedBy = owner;
    board.splice(index, 0, summoned);
    events.push({ type: 'summon', side, index, unit: view(summoned) });
    fireAllySummoned(summoned);
    return true;
  };

  /**
   * `index` is the source's current board index, or — when `removed` —
   * the index it occupied before dying, which is where "behind" now starts
   * and where summons/revives are inserted.
   */
  // Ability magnitudes scale with the source's tier (a tier-2 Brood-Mother
  // births 4 pups, a tier-2 Gnawer grants +4 attack).
  const applyEffect = (source: BattleUnit, index: number, removed: boolean): void => {
    if (!source.ability) return;
    const board = boardOf(source.side);
    const effect = source.ability.effect;
    const tier = source.tier;
    switch (effect.kind) {
      case 'summon': {
        const def = DEF_LOOKUP[effect.unitId];
        for (let i = 0; i < effect.count * tier; i++) {
          if (!spawn(def, index, source.side)) break;
        }
        break;
      }
      case 'maintainSummons': {
        // Rat-Piper (issue #105): top the litter up to `count * tier`, don't
        // pile on a fresh one every wave. Only bodies THIS caster summoned
        // and that are still alive count toward the target, so re-summoning
        // fills the shortfall left by pups that fell — and does nothing when
        // the litter is already full. That caps this per-wave summoner's
        // permanent contribution at `count * tier`, ever.
        const def = DEF_LOOKUP[effect.unitId];
        const target = effect.count * tier;
        const living = board.filter(
          (u) => u.summonedBy === source.instanceId && u.health > 0
        ).length;
        for (let i = 0; i < target - living; i++) {
          if (!spawn(def, index, source.side, source.instanceId)) break;
        }
        break;
      }
      case 'buffBehind': {
        const start = removed ? index : index + 1;
        const targets = effect.all ? board.slice(start) : board.slice(start, start + 1);
        for (const target of targets) buff(target, effect.attack * tierAttackMultiplier(tier), effect.health * tierHealthMultiplier(tier));
        break;
      }
      case 'grantArmor': {
        // Ward-Weaver rework (2026-07-24). `startOfBattle`-fired, so like
        // `buffBehind`/`teamBuff` this is a fire-once-per-instance grant that
        // cannot re-stack across waves (see the effect's doc comment in
        // data/units.ts). Adds flat `damageReduction` — subtracted per hit
        // with a MIN_ATTACK_DAMAGE floor in `applyDamage`, so it can NEVER
        // fully negate a hit, which is the whole point of replacing the old
        // `blockFrontHits` full-negate pool. `all` wards the whole warren
        // (including the caster and units already in front of it), matching
        // `teamBuff`'s whole-board reach; otherwise just the caster. Reuses
        // the `shieldGranted` event (no matching `shieldAbsorbed` needed —
        // that pair only tracked the old per-hit block drain).
        const amount = wardArmorForTier(tier);
        const targets = effect.all ? board : board.slice(index, index + 1);
        for (const target of targets) {
          target.damageReduction += amount;
          events.push({ type: 'shieldGranted', targetId: target.instanceId, sourceId: source.instanceId });
        }
        break;
      }
      case 'bequeathAttack': {
        // Gnawer rework (issue #111). See the effect's doc comment in
        // data/units.ts for the full formula and compounding-law reasoning;
        // this mirrors `buffBehind`'s single-target (`start`/`removed`)
        // targeting logic but computes the magnitude from the caster's OWN
        // live `attack` (already tier-scaled and relic-buffed) rather than a
        // flat effect literal, plus a wave-died-on bonus capped in the def.
        const start = removed ? index : index + 1;
        const target = board[start];
        // Last slot: nobody behind to inherit. Payout evaporates — no crash,
        // no fallback target (this is the intended "wasted" placement case
        // the issue's placement puzzle calls out).
        if (!target) break;
        const ownAttack = source.attack;
        const waveBonus = Math.min(currentWave, effect.waveBonusCapMultiplier * ownAttack);
        buff(target, ownAttack + waveBonus, 0);
        break;
      }
      case 'buffAdjacent': {
        // `startOfBattle`-gated (see fireEntryTriggers: fires once per unit
        // instance, ever), so this is the same compounding-law shape as
        // Warren-Warden's `buffBehind` — it cannot re-fire on a later wave
        // and re-stack. `removed` is never true here (buffAdjacent is only
        // ever wired to `startOfBattle`, not `faint`), so `index` is always
        // the source's live board position; front has no index-1 neighbor,
        // back has no index+1 neighbor, middle placements get both — the
        // intended "middle is strictly better" shape.
        const targets: BattleUnit[] = [];
        if (index > 0) targets.push(board[index - 1]);
        if (index < board.length - 1) targets.push(board[index + 1]);
        for (const target of targets) buff(target, effect.attack * tierAttackMultiplier(tier), effect.health * tierHealthMultiplier(tier));
        break;
      }
      case 'distributeStatsOnFaint': {
        // Pack-Caller rework (issue #88 follow-up). Only ever wired to
        // `faint`, so `removed` is always true and `board` has already had
        // this unit spliced out (same precondition `bequeathAttack` above
        // relies on) — it's already exactly "the rest of the team," no
        // manual filtering needed.
        const survivors = board;
        if (survivors.length === 0) break; // Last unit standing — no-op, no crash.
        // Own LIVE stats at the moment of death — `source.attack` (tier-
        // scaled, relic-buffed, and inflated by any startOfBattle buff this
        // instance received, e.g. Warren-Warden's buffBehind or the
        // Forgotten Backpack relic) and `source.maxHealth` (same, but the
        // buffed CEILING rather than however much current health remains —
        // a unit whose max was raised gives away that raised max even if
        // it's about to die at 1 HP). Same "own live stat, not a flat
        // literal" pattern as Gnawer's `bequeathAttack` above, and safe for
        // the same reason: every input that could have inflated these
        // values (buffBehind, teamBuff, relics, ...) is itself already
        // fire-once/bounded under ADR-0003, so a one-time snapshot at death
        // is bounded too — just variable with board synergy, which is the
        // point (the more you've invested in it, the bigger its send-off).
        // Shared per-side, whole-battle budget (issue #131 v2): clip the
        // TOTAL this death gives away, before splitting, against whatever
        // budget every Pack-Caller on this side has left for the rest of the
        // battle. Deliberately does NOT care who ends up with it — spreading
        // early across a full board or banking it for one late payout both
        // draw from the same pool, preserving the card's actual choice.
        // Same "clip, don't reroute" shape as the poison-all/Plague-Bearer
        // caps: whatever this death COULD have given beyond the remaining
        // budget is simply lost, not carried to a later death.
        const budgetAttack = Math.round(
          UNIT_DEFS['pack-caller'].attack * tierAttackMultiplier(3) * effect.totalBudgetMultiplier
        );
        const budgetHealth = Math.round(
          UNIT_DEFS['pack-caller'].health * tierHealthMultiplier(3) * effect.totalBudgetMultiplier
        );
        const spent = distributeStatsOnFaintSpent[source.side];
        const totalAttack = Math.max(0, Math.min(source.attack, budgetAttack - spent.attack));
        const totalHealth = Math.max(0, Math.min(source.maxHealth, budgetHealth - spent.health));
        spent.attack += totalAttack;
        spent.health += totalHealth;
        if (totalAttack <= 0 && totalHealth <= 0) break;
        const n = survivors.length;
        const perUnitAttack = Math.floor(totalAttack / n);
        const perUnitHealth = Math.floor(totalHealth / n);
        const remainderAttack = totalAttack - perUnitAttack * n;
        const remainderHealth = totalHealth - perUnitHealth * n;
        // Remainder (stat % survivor-count) goes one point each to the
        // FRONTMOST survivors first (board index order), so the (possibly
        // budget-reduced) total is always fully distributed — nothing lost
        // to rounding once it's past the budget clip above.
        survivors.forEach((target, i) => {
          const atk = perUnitAttack + (i < remainderAttack ? 1 : 0);
          const hp = perUnitHealth + (i < remainderHealth ? 1 : 0);
          if (atk > 0 || hp > 0) buff(target, atk, hp);
        });
        break;
      }
      case 'poisonFrontEnemy': {
        // Plague-Doctor (data/enemies.ts), the only remaining user after
        // issue #112 moved Plague-Bearer to `poisonLastEnemy` below. Stack
        // count still comes from `poisonStacksForTier` (1/3/5) instead of a
        // flat `effect.stacks * tier`, same table Blight-Witch's
        // `poisonAllEnemies` and Plague-Bearer's `poisonLastEnemy` use —
        // unchanged from before #112, just no longer Plague-Bearer's case.
        const target = opposing(source.side)[0];
        if (target) applyPoisonStacks(target, poisonStacksForTier(tier));
        break;
      }
      case 'poisonLastEnemy': {
        // Plague-Bearer (issue #112, reworked from `poisonFrontEnemy`).
        // Stack count comes from `poisonStacksForTier` (1/3/5), same table
        // Blight-Witch's `poisonAllEnemies` uses — this rework only moves
        // WHERE the stacks land, never how many. Targets the back of the
        // enemy line (`enemies[enemies.length - 1]`) instead of the front,
        // pre-rotting a protected backline threat before the front-to-back
        // grind reaches it. Single-enemy waves degenerate to last === front,
        // so this behaves exactly like the old `poisonFrontEnemy` did there.
        //
        // Compounding-law check: enemies are re-instantiated every wave and
        // poison never carries across waves (`waveClear`'s antidote, plus
        // enemies simply not existing yet next wave), so this cannot
        // accumulate across the 45-wave battle.
        //
        // Multi-caster stack cap (issue #131, same shape as #116's
        // `poisonAllEnemies` cap): multiple Plague-Bearers used to stack
        // additively onto the same single last-enemy target with no ceiling
        // — against a single fixed target (a lone high-HP enemy; originally
        // reproduced on the since-removed Boss Trial's one escalating boss)
        // this let 2-5x Plague-Bearer push runaway stacks well past the
        // intended ceiling. Capped at `poisonStacksForTier(3)` via its own budget
        // (`poisonLastApplied`, separate from `poisonAllApplied`) — same
        // cap-not-sum precedent as `blockCharges`/`poisonAllEnemies`: one ★3
        // fills it, extra Plague-Bearers clip rather than add. Kept
        // independent of the poison-all budget on purpose — a Plague-Bearer
        // and a poison-all caster (Blight-Witch/Draughtsman Moe) together
        // should still out-poison either alone; only stacking copies of the
        // SAME effect is capped.
        const foes = opposing(source.side);
        const target = foes[foes.length - 1];
        if (target) {
          const cap = poisonStacksForTier(3);
          const remaining = cap - poisonLastApplied[source.side];
          const stacks = Math.min(poisonStacksForTier(tier), remaining);
          if (stacks > 0) {
            applyPoisonStacks(target, stacks);
            poisonLastApplied[source.side] += stacks;
          }
        }
        break;
      }
      case 'poisonTarget': {
        // Midden-Hag (data/enemies.ts), the only user: `afterAttack`, so this
        // fires on every clash tick the enemy survives, not once per wave.
        // NOTE: uses flat `effect.stacks * tier` scaling, unlike its poison
        // siblings (poisonFrontEnemy/poisonAllEnemies), which both read from
        // the shared `poisonStacksForTier` table — no design note explains
        // the exemption; flagged here as an inconsistency, not confirmed
        // intentional. Compounding-law check: safe across the 45-wave battle
        // regardless (enemies are re-instantiated every wave, and poison on
        // the horde is cleared at `waveClear` same as the enemy side), but a
        // long single wave could still stack this unusually high within that
        // one wave given the per-tick trigger — not benchmarked.
        const target = opposing(source.side)[0];
        if (target && target.health > 0) applyPoisonStacks(target, effect.stacks * tier);
        break;
      }
      case 'poisonAllEnemies': {
        // Blight-Witch (issue #62). `startOfWave`-fired, so `fireEntryTriggers`
        // runs this for every live Blight-Witch on the board, in board order,
        // regardless of slot — fixing the old `afterAttack` positional dead
        // zone where a back-line Blight-Witch never got to act. Hits every
        // living enemy present at wave start, not just `opposing(...)[0]`.
        //
        // Compounding-law check: enemies are re-instantiated every wave and
        // poison never persists on the horde (`waveClear`'s antidote), so
        // this per-wave AoE cannot accumulate across the 45-wave battle.
        //
        // Multi-caster stack cap (issue #116): multiple poison-all casters
        // (Blight-Witch / its Draughtsman Moe reskin) used to stack ADDITIVELY
        // within a wave — the direct cause of RatMoe's season-2 depth-45 run on
        // 3× Blight-Witch (a probe measured +10 avg depth going 0→3 casters,
        // poison then >50% of all damage dealt, ignoring armor and the wave HP
        // curve). We now cap the TOTAL poison-all stacks dispensed to the enemy
        // side this wave at `poisonStacksForTier(3)` (Jesper's call, 2026-07-16:
        // "max should equal the tier-3 damage — you can still field 2 tier-2s
        // but not exploit a stack"). Each caster fires in board order and takes
        // only the remaining budget: one ★3 fills it (5), two ★2s clip 3+3=6→5,
        // 3×★3 collapses 15→5. No single caster's `poisonStacksForTier` value
        // changes, mirroring Ward-Weaver's `blockCharges` cap-not-sum precedent.
        const cap = poisonStacksForTier(3);
        const remaining = cap - poisonAllApplied[source.side];
        const stacks = Math.min(poisonStacksForTier(tier), remaining);
        if (stacks > 0) {
          for (const target of opposing(source.side)) {
            if (target.health > 0) applyPoisonStacks(target, stacks);
          }
          poisonAllApplied[source.side] += stacks;
        }
        break;
      }
      case 'gainStats': {
        buff(source, effect.attack * tier, effect.health * tier);
        break;
      }
      case 'healSelf': {
        // Grave-Leech (issue #135). `afterAttack`-fired, i.e. every clash
        // tick this unit is front for — but only a clash it SURVIVED pays
        // out: at 0 or less health the faint is already owed and a drain
        // must not quietly resurrect it ahead of resolveDeaths. The clamp
        // at maxHealth lives HERE, in the effect application (per the
        // issue), which is the whole ADR-0003 bound: no matter how many of
        // the 45 waves it fights, it can never bank health past its own
        // ceiling. Same clamp shape as the healPerTick regen in the tick
        // loop below (Fat Tick / Forgotten Backpack).
        if (source.health <= 0) break;
        const amount = Math.min(effect.amount * tier, source.maxHealth - source.health);
        if (amount > 0) {
          source.health += amount;
          events.push({ type: 'heal', targetId: source.instanceId, amount, newHealth: source.health });
        }
        break;
      }
      case 'weakenAllEnemies': {
        // Gutter-Acolyte (issue #137, converted to percentage 2026-07-25).
        // `startOfWave`-fired, so this runs for every live Acolyte in board
        // order at the top of the wave, same firing point as
        // `poisonAllEnemies` — and same compounding bound: enemies are
        // re-instantiated fresh every wave, so the shred can never carry
        // across waves. Percentage is taken off the target's ORIGINAL
        // wave-start attack (`weakenOriginalAttack`, snapshotted before any
        // Acolyte fires), not whatever it's already been shredded down to —
        // see `weakenPercentForTier`'s doc comment for why. That makes
        // multi-caster stacking a simple ADDITIVE cap-not-sum budget
        // (`weakenAppliedPercent`, capped at `weakenPercentForTier(3)` total
        // per enemy per wave), same precedent as `poisonAllEnemies`. The
        // MIN_ATTACK_DAMAGE floor still applies on top (enemies always hit
        // for at least 1). `attack` on the event is the amount actually
        // removed post-floor, so replays never show a bigger shred than what
        // happened.
        const capPct = weakenPercentForTier(3);
        const ownPct = effect.percent * weakenPercentForTier(tier);
        for (const target of opposing(source.side)) {
          if (target.health <= 0) continue;
          const original = weakenOriginalAttack.get(target.instanceId) ?? target.attack;
          const appliedSoFar = weakenAppliedPercent.get(target.instanceId) ?? 0;
          const pct = Math.min(ownPct, Math.max(0, capPct - appliedSoFar));
          if (pct <= 0) continue;
          const shred = Math.round(original * pct);
          const reduced = Math.max(MIN_ATTACK_DAMAGE, target.attack - shred);
          const delta = target.attack - reduced;
          if (delta <= 0) continue;
          target.attack = reduced;
          weakenAppliedPercent.set(target.instanceId, appliedSoFar + pct);
          events.push({ type: 'weaken', targetId: target.instanceId, attack: delta, newAttack: target.attack });
        }
        break;
      }
      case 'chargeWhileBenched': {
        // Cellar-Coil (issue #106). See this Effect's doc comment in
        // data/units.ts and `cellarCoilChargeCapForTier`'s doc comment for
        // the full ADR-0003 compounding-law sign-off — this is the one and
        // only place the grant is actually applied, and it is a hard
        // `Math.min` clamp, not a suggestion. `fireEntryTriggers` already
        // gated this call on `condition.notFront` (the unit is not at board
        // index 0 this Wave), so nothing here re-checks board position.
        //
        // Linear tier scaling (`attackPerWave * tier`, i.e. 1/2/3), NOT
        // `tierAttackMultiplier`'s exponential `3^(tier-1)` — see the effect
        // doc comment for why an accumulating per-wave grant must not also
        // get an exponential per-tier multiplier.
        const cap = cellarCoilChargeCapForTier(tier);
        const remaining = cap - source.chargeStacks;
        if (remaining <= 0) break; // Cap already reached — hard stop, no-op forever after.
        const grant = Math.min(effect.attackPerWave * tier, remaining);
        source.chargeStacks += grant;
        buff(source, grant, 0);
        break;
      }
      case 'teamBuff': {
        // Compounding-law check: this effect is only ever wired to a
        // startOfBattle ability (see the Effect doc comment in
        // data/units.ts), which fires once per unit instance, ever — nothing
        // re-applies it on a later wave, so it cannot accumulate across the
        // 45-wave battle. Issue #58: magnitude now comes from
        // tierAttackMultiplier/tierHealthMultiplier (1x/3x/9x) instead of a
        // flat `* tier` (1x/2x/3x), matching the same fire-once reasoning as
        // buffBehind/buffAdjacent below and the unit's own stat curve
        // (issue #22) — still non-stacking across waves, just steeper per use.
        for (const target of board) buff(target, effect.attack * tierAttackMultiplier(tier), effect.health * tierHealthMultiplier(tier));
        break;
      }
      case 'teamBuffByWave': {
        // Twilight-Runt wave-based rework (2026-07-16, replaces
        // teamBuffByTime). `startOfWave`-triggered — fires for every unit,
        // every wave (see fireEntryTriggers) — so unlike startOfBattle
        // effects there is no free fire-once gate at the trigger level;
        // `source.waveBuffPhase` does that job instead. Two grants, each
        // landing at most once per unit instance ever: the early dose the
        // first wave this unit is alive for, the late dose the first wave
        // `currentWave >= effect.switchWave` holds. ADDITIVE, not a swap —
        // the early dose is never revoked, so once both have fired a battle
        // holds the sum of both. See the Effect's doc comment in
        // data/units.ts for the full compounding-law reasoning and why this
        // is deliberately simpler than a revoke-and-reapply swap.
        if (source.waveBuffPhase === 'none') {
          for (const target of board) buff(target, effect.early.attack * tierAttackMultiplier(tier), effect.early.health * tierHealthMultiplier(tier));
          source.waveBuffPhase = 'early';
        }
        if (source.waveBuffPhase === 'early' && currentWave >= effect.switchWave) {
          for (const target of board) buff(target, effect.late.attack * tierAttackMultiplier(tier), effect.late.health * tierHealthMultiplier(tier));
          source.waveBuffPhase = 'both';
        }
        break;
      }
      case 'revive': {
        // Raise the oldest fallen ally — never the caster, and never a corpse
        // that has already been raised once.
        //
        // Two guards, two separate exploits. A fainting unit is pushed to
        // `fallen` *before* its own faint trigger fires, so raising the first
        // corpse resurrected the reviver forever (a lone Bone-Priest cleared
        // the whole gauntlet, unkillable — fixed in 0.6.2). Skipping only the
        // caster was not enough: two Bone-Priests each raise the *other's*
        // corpse, which dies, re-enters `fallen`, and gets raised again — an
        // immortal pair that full-cleared all 45 waves for 12 scrap. The
        // `raised` flag makes resurrection a once-per-corpse resource, so any
        // reviver ring is finite no matter how many priests you stack.
        //
        // Issue #53: revive HP now comes from `reviveHpForTier` (1/10/20)
        // instead of a flat `health * tier`, capped at the revived corpse's
        // own `maxHealth` so a low-tier ally can't be overhealed past its
        // ceiling. This is a magnitude change only, not a frequency one —
        // `faint` fires on EVERY death (see `resolveDeaths` below), so a
        // revived unit that dies again fires its faint ability a second time
        // (see Gnawer's `bequeathAttack` doc comment and Pack-Caller's
        // `distributeStatsOnFaint` doc comment, both in units.ts, for the
        // per-ability bound this produces). What keeps THIS effect's own
        // compounding-law bound intact regardless is the `raised` flag two
        // paragraphs up: revival itself is capped to once per corpse, so no
        // single unit instance can be revived more than once no matter how
        // steep the HP table gets or how long the battle (up to 45 waves) runs.
        const corpseIdx = fallen[source.side].findIndex((c) => c !== source && !c.raised);
        if (corpseIdx === -1 || board.length >= capOf(source.side)) break;
        const [corpse] = fallen[source.side].splice(corpseIdx, 1);
        corpse.raised = true;
        corpse.health = Math.min(reviveHpForTier(tier), corpse.maxHealth);
        corpse.poison = 0;
        board.splice(index, 0, corpse);
        events.push({ type: 'revive', side: source.side, index, unit: view(corpse) });
        break;
      }
      case 'blockFrontHits': {
        // Ward-Weaver (issue #56). `startOfWave`-fired, so this runs for
        // every live Ward-Weaver on the board at the top of the wave, in
        // board order. The pool is sized by Math.max across all of them —
        // NEVER summed — so two t3 Ward-Weavers still only grant 3 charges
        // that wave, not 6. See `blockCharges`'s declaration for the full
        // compounding-law note.
        const charges = blockHitsForTier(tier);
        blockCharges[source.side] = Math.max(blockCharges[source.side], charges);
        const currentFront = board[0];
        if (currentFront) {
          events.push({ type: 'shieldGranted', targetId: currentFront.instanceId, sourceId: source.instanceId });
        }
        break;
      }
      case 'backlineDamage': {
        // Backline damage path (issue #85; the "Slink-Rat option B"
        // primitive from docs/design/future-minions.md). A non-front unit
        // hits the front of the enemy line directly, taking no retaliation
        // — it never becomes `foe`/`front` in the tick loop below, so there
        // is nothing to hit it back. `index` here is the source's live board
        // position (this effect is only ever wired to `startOfWave`, never
        // `faint`, so `removed` is never true, matching `buffAdjacent`'s
        // reasoning above) — index 0 is "currently at the front," which
        // already deals damage through the normal clash every tick, so it's
        // excluded here to keep this strictly a *backline* contribution, not
        // a double-dip for a unit that happens to rotate to the front.
        if (index === 0) break;
        // Merge scaling (issue #86 follow-up): tier grows how many enemies
        // get hit (backlineTargetsForTier: 1/2/3), NOT how hard each hit
        // lands. Per-hit damage is the unit's own def base attack plus its
        // relics, the team-attack pool (horde units), and any runtime attack
        // buffs it's received (`attackBuffs` — Warren-Warden's `buffBehind`,
        // Twilight-Runt's `teamBuffByWave`, etc.), but with
        // `tierAttackMultiplier` deliberately left out — see
        // `backlineTargetsForTier`'s doc comment for why stacking the
        // exponential 1x/3x/9x attack curve on top of a growing target count
        // was rejected as an AOE-nuke risk. `attackBuffs` mirrors
        // `source.attack` for every OTHER attack-based effect in this file —
        // omitting it would make a buffed Slink-Rat silently under-hit.
        const def = UNIT_DEFS[source.defId];
        const perHitAttack =
          (def?.attack ?? 0) +
          source.relics.reduce((s, r) => s + (r.attack ?? 0), 0) +
          teamOf(source.side).attack +
          source.attackBuffs;
        if (perHitAttack <= 0) break;
        // First-hit relics (Glass Shard) — same `firstAttackDone`-gated bonus
        // the tick loop's front-vs-front clash grants below (see `bonusOf`
        // there), extended to this path since this hit lands BEFORE the tick
        // loop even starts and previously bypassed the bonus entirely (a
        // Slink-Rat wearing Glass Shard got no bonus, ever — reported bug).
        // Applied to only the FIRST target, not every target this hits at
        // ★2/★3: Glass Shard's wave-scaling bonus is deliberately uncapped
        // (accepted risk, see its declaration in units.ts), so letting merge
        // tier multiply it too would stack two unbounded axes (wave number
        // AND target count) — exactly the compounding-law risk
        // `backlineTargetsForTier`'s doc comment already rejected once for
        // per-hit damage itself. "First hit each wave" reads as one bonus
        // per unit per wave, not one per enemy struck.
        const firstHitBonus = source.firstAttackDone
          ? 0
          : source.relics.reduce(
              (s, r) => s + (r.firstHitBonusScalesWithWave ? currentWave : (r.firstHitBonus ?? 0)),
              0
            );
        source.firstAttackDone = true;
        const targets = opposing(source.side).slice(0, backlineTargetsForTier(source.tier));
        targets.forEach((target, i) => {
          if (!target || target.health <= 0) return;
          const amount = perHitAttack + (i === 0 ? firstHitBonus : 0);
          // Deliberately a direct `applyDamage` call, not routed through the
          // tick loop's clash machinery below — this is what keeps the three
          // interaction questions answered by construction rather than by a
          // special-cased guard:
          //  - Marrow-Snap's execute (relics.ts's `executeThreshold`) only
          //    checks `foeHealthBeforeClash` captured immediately around the
          //    tick loop's own clash hit, further down this file. This call
          //    happens at `startOfWave`, entirely before that tick loop even
          //    starts for the wave, so it can never be mistaken for "the
          //    crossing blow" — a swarm of backline snipers cannot cheapen
          //    Marrow-Snap's execute condition.
          //  - Ward-Weaver's `blockCharges` pool only guards the tick loop's
          //    two `applyDamage` calls against `front`/`foe`. This hits the
          //    enemy side directly and never touches `blockCharges` at all,
          //    so block charges are neither consumed nor checked here — they
          //    protect the horde's own front from incoming hits, and this
          //    effect only ever deals outgoing damage to the enemy.
          //  - Gore-Cleaver's cleave-overkill spillover is computed only
          //    right after the tick loop's own front-vs-front clash, reading
          //    `front.relics` and the foe's post-clash health from that same
          //    hit. This call never runs inside that block, so it can never
          //    feed a stacked Gore-Cleaver's overkill carry.
          // Ordering vs poison: this fires at `startOfWave`, before the first
          // clash tick and before any poison ticks that wave (poison only
          // ticks inside the tick loop, after the clash) — so backline damage
          // always lands first, same relative order as Plague-Bearer's
          // `poisonFrontEnemy` already establishes for its own startOfWave hit.
          applyDamage(target, amount, 'attack');
        });
        break;
      }
    }
  };

  const resolveDeaths = (): void => {
    for (;;) {
      let dead: BattleUnit | undefined;
      let deadIndex = -1;
      let deadBoard: BattleUnit[] | undefined;
      for (const board of [horde, enemies]) {
        deadIndex = board.findIndex((u) => u.health <= 0);
        if (deadIndex !== -1) {
          deadBoard = board;
          dead = board[deadIndex];
          break;
        }
      }
      if (!dead || !deadBoard) return;
      deadBoard.splice(deadIndex, 1);
      events.push({ type: 'death', unitId: dead.instanceId });
      fallen[dead.side].push(dead);

      if (dead.ability?.trigger === 'faint') applyEffect(dead, deadIndex, true);
      for (const relic of dead.relics) {
        if (!relic.onFaintDamageAll) continue;
        events.push({ type: 'relicProc', targetId: dead.instanceId, relicId: relic.id, name: relic.name });
        for (const foe of [...opposing(dead.side)]) applyDamage(foe, relic.onFaintDamageAll, 'attack');
      }
      for (const ally of [...deadBoard]) {
        if (ally.ability?.trigger === 'allyFaint' && ally.health > 0) applyEffect(ally, deadBoard.indexOf(ally), false);
      }
    }
  };

  /**
   * Entry triggers, fired in board order at the top of every wave:
   * `startOfWave` for every unit, `startOfBattle` only for units that have
   * never fired it. See `Ability` in data/units.ts for why the split exists.
   */
  const fireEntryTriggers = (board: BattleUnit[]): void => {
    for (const unit of [...board]) {
      const trigger = unit.ability?.trigger;
      if (trigger !== 'startOfBattle' && trigger !== 'startOfWave') continue;
      if (trigger === 'startOfBattle') {
        if (unit.startOfBattleFired) continue;
        unit.startOfBattleFired = true;
      }
      // Time-of-day-conditional abilities (Dawn-Runt/Dusk-Runt, issue #12):
      // only fire when the ride's resolved time-of-day matches. A
      // startOfBattle ability still only ever gets its one shot per unit
      // instance (the flag above is already set) — a mismatched condition
      // just means that one shot is a no-op, it does not retry on a later
      // wave once the real-world half-day flips mid-battle.
      const condition = unit.ability?.condition;
      if (condition?.timeOfDay !== undefined && condition.timeOfDay !== timeOfDay) continue;
      const index = board.findIndex((u) => u.instanceId === unit.instanceId);
      if (index === -1) continue;
      // notFront-conditional abilities (Cellar-Coil, issue #106): only fire
      // on Waves the unit is present for but NOT at board index 0 — the
      // clashing slot. A `startOfWave` ability still fires every Wave the
      // unit survives, it just no-ops the Wave it's currently front.
      if (condition?.notFront && index === 0) continue;
      applyEffect(unit, index, false);
    }
  };

  let wavesCleared = 0;
  let totalDamage = 0;
  let damageThisWave = 0;
  /**
   * Ward-Weaver's per-wave "block the current front unit's next incoming
   * hit" pool, keyed by side (issue #56). Reset to 0 at the top of every
   * wave (below), then sized by `Math.max` — never summed — across every
   * live `blockFrontHits` watcher's `blockHitsForTier` on that side (see the
   * `blockFrontHits` case in `applyEffect`), and drained by 1 each time that
   * side's current front-line unit would otherwise take a hit (below, in the
   * tick loop). It follows "whoever is currently front," not a fixed unit
   * instance, matching the pre-#56 `watchFrontAttack` mechanic's targeting.
   *
   * Compounding-law check: this is a per-wave-reset magnitude, not a
   * cumulative one — it cannot carry charges from wave N into wave N+1, the
   * same shape as Plague-Bearer's `startOfWave` poison re-application. That
   * bound holds regardless of how many Ward-Weavers (or what tiers) are on
   * the board, because the grant is `Math.max`, not a sum: two tier-3
   * Ward-Weavers together still only produce a 3-charge pool for that wave,
   * not 6, so this can never snowball across the 45-wave battle.
   */
  let blockCharges: Record<Side, number> = { horde: 0, gauntlet: 0 };

  /**
   * Total `poisonAllEnemies` stacks already dispensed this wave, keyed by the
   * CASTER's side (issue #116). Reset to 0 every wave (below), then each
   * poison-all caster's contribution is capped so the running total never
   * exceeds `poisonStacksForTier(3)` — see the `poisonAllEnemies` case in
   * `applyEffect`. Same per-wave, `Math.max`/cap-not-sum anti-stack shape as
   * `blockCharges` above: it stops a stack of poison-all casters (RatMoe's
   * depth-45 3× Blight-Witch board) from applying additively without touching
   * a single caster's `poisonStacksForTier` value, so a lone ★3 (or two ★2s,
   * which sum to 6 and clip to the 5 cap) is essentially unaffected while
   * 3×★3 (15 → 5) is not. Keyed by caster side so poison-all casters on one
   * side share one budget. Plague-Bearer's single-target `poisonLastEnemy` is
   * a different effect and is NOT counted against this cap — it has its own,
   * separate budget (`poisonLastApplied` below), deliberately independent so
   * a Plague-Bearer and a poison-all caster (Blight-Witch/Draughtsman Moe) on
   * the same board still stack with each other; only same-effect stacking is
   * capped.
   */
  let poisonAllApplied: Record<Side, number> = { horde: 0, gauntlet: 0 };
  /**
   * Total `poisonLastEnemy` stacks already dispensed this wave, keyed by the
   * CASTER's side (issue #131 follow-up to #116). Multiple Plague-Bearers all
   * target the same back-of-line enemy on `startOfWave` — before this cap,
   * they stacked additively onto that single target with no ceiling, which a
   * balance-analyst pass found let 2-5x Plague-Bearer + a sustain wall push
   * Boss Trial to its 60-phase hard cap (a fixed single target is exactly the
   * shape #116 already fixed for poison-all; Plague-Bearer's single-target
   * cousin was missed at the time). Same cap-not-sum shape as
   * `poisonAllApplied`: total capped at `poisonStacksForTier(3)`, one ★3
   * fills it, extra casters clip rather than add. Kept in a SEPARATE budget
   * from `poisonAllApplied` (not merged into one shared cap) so a
   * Plague-Bearer and a poison-all caster together still deal MORE poison
   * than either alone — only stacking the same effect twice is capped, not
   * poison in general.
   */
  let poisonLastApplied: Record<Side, number> = { horde: 0, gauntlet: 0 };

  /**
   * Each living enemy's attack AT WAVE START, keyed by instanceId — the
   * denominator `weakenAllEnemies` (Gutter-Acolyte, issue #137) percentages
   * are taken against, snapshotted fresh every wave right after enemies are
   * instantiated, before any Acolyte fires. See `weakenPercentForTier`'s doc
   * comment in data/units.ts for why "original", not "current", is the base.
   */
  let weakenOriginalAttack: Map<number, number> = new Map();
  /**
   * Total fraction of `weakenOriginalAttack` already granted to each enemy
   * this wave (issue #137), keyed by instanceId. Reset every wave alongside
   * `poisonAllApplied`, same cap-not-sum shape: each `weakenAllEnemies`
   * caster's own percent is clipped to whatever's left of
   * `weakenPercentForTier(3)` for that specific enemy, so multiple Acolytes
   * stack additively up to one ★3's worth, not without bound.
   */
  let weakenAppliedPercent: Map<number, number> = new Map();

  /**
   * Total attack/health every `distributeStatsOnFaint` caster (Pack-Caller)
   * on a side has EVER given away, across the WHOLE battle — unlike
   * `poisonAllApplied`/`poisonLastApplied` above, this is deliberately NOT
   * reset per wave (see the wave loop below: no reset line for this one).
   * A per-wave reset would be meaningless here anyway, since the exploit
   * this fixes (issue #131) plays out across MANY separate waves/phases as a
   * board thins over a long Boss Trial, not within one wave.
   *
   * Design history: the first shipped fix (2026-07-17) was a RECEIVER-side
   * cap (how much any one unit could absorb, tracked per-instance) — it
   * closed the exploit but, on review, gutted half of Pack-Caller's
   * intended play pattern: positioning it to die LATE and dump a big
   * payout onto 1-2 chosen units stopped working, because by the time few
   * survivors remain the payout has grown far past what those (still
   * board-average-sized) survivors' own caps allow, wasting most of it.
   * Early-death broad-spread became the only non-wasteful line, which
   * wasn't the intent.
   *
   * This version caps the SOURCE side instead: total `distributeStatsOnFaint`
   * output per side per battle is capped at `totalBudgetMultiplier` × a
   * single tier-3 Pack-Caller's own base attack/health (same "sized to one
   * strong instance" idiom as `poisonStacksForTier(3)`), shared across every
   * Pack-Caller on that side — same cap-not-sum precedent as
   * `poisonAllApplied`/`blockCharges`, just scoped to the whole battle
   * instead of one wave. This preserves the actual choice the card offers
   * (spread it early across many survivors, or bank it and dump it all on
   * one or two late) while still bounding the aggregate power this ability
   * can inject over a ride — see the `distributeStatsOnFaint` case for the
   * exact accounting, and that Effect's doc comment in data/units.ts for the
   * balance-analyst numbers behind the multiplier.
   */
  let distributeStatsOnFaintSpent: Record<Side, { attack: number; health: number }> = {
    horde: { attack: 0, health: 0 },
    gauntlet: { attack: 0, health: 0 },
  };

  // The enemy side as a list of wave builders. In `gauntlet` mode this is the
  // PvE wave sequence exactly as before — one builder per wave, each
  // instantiating tier-1 relic-less foes with that wave's depth scaling. A
  // `duel` is a single wave: the opponent's real board, full tiers and relics,
  // NO wave scaling (attack/health scale default to 1). Both go through the
  // same `instantiate(... 'gauntlet' ...)` path, so the opponent is the enemy
  // side of one symmetric fight.
  const enemyWaves: Array<() => BattleUnit[]> =
    mode.kind === 'gauntlet'
      ? mode.gauntlet.waves.map((wave, w) => () =>
          wave.units.map((d) =>
            instantiate(d, 'gauntlet', [], 1, enemyAttackScale(w), enemyHealthScale(w))
          )
        )
      : [
          () =>
            mode.opponent.units
              .slice(0, BOARD_CAP)
              .map((u) => instantiate(UNIT_DEFS[u.defId], 'gauntlet', u.relicIds, u.tier ?? 1)),
        ];

  for (let w = 0; w < enemyWaves.length && horde.length > 0; w++) {
    // 1-based wave number, matching the `waveStart`/`waveClear` events below
    // (`wave: w + 1`) — see `currentWave`'s declaration above `applyEffect`
    // for why this is a mutable closure variable rather than threaded as a
    // parameter through every call site.
    currentWave = w + 1;
    enemies = enemyWaves[w]();
    events.push({ type: 'waveStart', wave: w + 1, enemies: enemies.map(view) });
    damageThisWave = 0;
    // First-hit relics (Glass Shard) fire anew each wave — clear the horde's
    // "already swung" flag at every wave start. Enemies are re-instantiated
    // per wave, so they begin fresh already.
    for (const u of horde) u.firstAttackDone = false;
    // Ward-Weaver's block-charge pool resets every wave — see the
    // compounding-law note on `blockCharges` above. `fireEntryTriggers`
    // below re-populates it via any `blockFrontHits` watchers present.
    blockCharges = { horde: 0, gauntlet: 0 };
    // Poison-all's per-wave stack budget resets alongside the block pool (issue
    // #116) — see `poisonAllApplied` above. Re-filled by any `poisonAllEnemies`
    // casters in the `fireEntryTriggers` pass below, capped at tier-3's stacks.
    poisonAllApplied = { horde: 0, gauntlet: 0 };
    // Plague-Bearer's own separate per-wave budget (issue #131) — see
    // `poisonLastApplied` above. Independent of `poisonAllApplied`.
    poisonLastApplied = { horde: 0, gauntlet: 0 };
    // weakenAllEnemies (Gutter-Acolyte, issue #137): snapshot each enemy's
    // fresh attack as the percentage denominator, and reset the per-enemy
    // cap-not-sum budget — see both maps' doc comments above.
    weakenOriginalAttack = new Map(enemies.map((e) => [e.instanceId, e.attack]));
    weakenAppliedPercent = new Map();

    fireEntryTriggers(horde);
    fireEntryTriggers(enemies);
    resolveDeaths();

    let ticks = 0;
    while (horde.length > 0 && enemies.length > 0 && ticks++ < MAX_TICKS_PER_WAVE) {
      // Net-damage floor (2026-07-24): the two units about to clash — captured
      // BEFORE this tick's regen — so we can guarantee each loses at least
      // MIN_ATTACK_DAMAGE net this tick if its clash blow lands (see the clamp
      // after the clash below). Without this, a per-tick heal (Fat Tick's
      // `healPerTick`, or a team heal relic) exactly cancels the armor floor's
      // 1-damage minimum, making a high-armor front unkillable — which defeats
      // the very "armor can never make a unit immortal" guarantee the floor in
      // `applyDamage` exists to provide. Fat Tick's sustain still fully applies
      // against any real (>1) hit; it just can't manufacture immortality.
      const frontStartHealth = horde[0].health;
      const foeStartHealth = enemies[0].health;
      // Distribute each side's team heal pool across that side's units to cap
      // unbounded scaling with board size (issue #75: Forgotten Backpack).
      // Instead of each unit getting the full pool, divide it evenly. In
      // gauntlet mode only the horde carries a pool (enemyTeam is all-zero),
      // so the enemy line stays byte-identical to before; a duel gives each
      // board its own pool split across its own survivors.
      const teamHealPerUnit = (side: Side, count: number) =>
        count > 0 ? teamOf(side).healPerTick / count : 0;
      const hordeHealPerUnit = teamHealPerUnit('horde', horde.length);
      const enemyHealPerUnit = teamHealPerUnit('gauntlet', enemies.length);
      for (const board of [horde, enemies]) {
        for (const unit of board) {
          const unitHeal = unit.relics.reduce((s, r) => s + (r.healPerTick ?? 0), 0);
          const totalRegen =
            unitHeal + (unit.side === 'horde' ? hordeHealPerUnit : enemyHealPerUnit);
          const amount = Math.min(totalRegen, unit.maxHealth - unit.health);
          if (amount > 0) {
            unit.health += amount;
            events.push({ type: 'heal', targetId: unit.instanceId, amount, newHealth: unit.health });
          }
        }
      }

      const front = horde[0];
      const foe = enemies[0];
      events.push({ type: 'clash', hordeId: front.instanceId, enemyId: foe.instanceId });

      const bonusOf = (u: BattleUnit): number =>
        u.firstAttackDone ? 0 : u.relics.reduce((s, r) => s + (r.firstHitBonusScalesWithWave ? currentWave : (r.firstHitBonus ?? 0)), 0);
      const damageOut = front.attack + bonusOf(front);
      const damageIn = foe.attack + bonusOf(foe);
      front.firstAttackDone = true;
      foe.firstAttackDone = true;

      // Ward-Weaver's block charges (issue #56) absorb a whole attack hit
      // outright, so this must resolve before applyDamage even runs — that
      // also means it resolves before Tail-Charm's lethal-hit check inside
      // applyDamage, which is the intended order: a fully-blocked hit was
      // never lethal to begin with, so it should never consume Tail-Charm.
      // `blockCharges` is a per-wave pool keyed by side (see its declaration
      // above), not a per-unit flag — it follows whichever unit is
      // currently front on that side, draining by 1 per hit that would
      // otherwise land, until the wave's pool (set at `startOfWave`, sized
      // by `Math.max` across that side's Ward-Weavers) is exhausted.
      // Captured for Marrow-Snap's crossing check below: the execute must
      // compare against each unit's health as it stood BEFORE this clash hit.
      // Both sides are snapshotted so the execute (and cleave) can resolve
      // symmetrically in a duel, where the enemy front can also carry relics;
      // in gauntlet mode `front`'s snapshot is simply never consulted (enemy
      // foes hold no relics), so this is byte-identical for PvE.
      const foeHealthBeforeClash = foe.health;
      const frontHealthBeforeClash = front.health;
      // Whether each side's clash blow actually LANDED this tick — a
      // Ward-Weaver-absorbed hit never touched the body, so it must not
      // fire `onHurt` (issue #134) below.
      let foeTookBlow = false;
      let frontTookBlow = false;
      if (blockCharges[foe.side] > 0) {
        blockCharges[foe.side]--;
        events.push({ type: 'shieldAbsorbed', targetId: foe.instanceId });
      } else {
        applyDamage(foe, damageOut, 'attack');
        foeTookBlow = true;
      }
      if (blockCharges[front.side] > 0) {
        blockCharges[front.side]--;
        events.push({ type: 'shieldAbsorbed', targetId: front.instanceId });
      } else {
        applyDamage(front, damageIn, 'attack');
        frontTookBlow = true;
      }
      // Net-damage floor: a unit whose clash blow landed must end the tick at
      // least MIN_ATTACK_DAMAGE below where it started (pre-regen), so per-tick
      // healing can never fully offset the armor floor and manufacture an
      // immortal front. Guarded to units that started ABOVE the floor: a unit
      // already at/below it is left to the normal clash + surviveLethal
      // (Tail-Charm) path, so this never bypasses a death-cheat rescue. The
      // clamp only ever removes healing the unit gained THIS tick — it can't
      // deal fresh damage past the raw clash, so it never front-runs a faint.
      if (frontTookBlow && frontStartHealth > MIN_ATTACK_DAMAGE) {
        front.health = Math.min(front.health, frontStartHealth - MIN_ATTACK_DAMAGE);
      }
      if (foeTookBlow && foeStartHealth > MIN_ATTACK_DAMAGE) {
        foe.health = Math.min(foe.health, foeStartHealth - MIN_ATTACK_DAMAGE);
      }
      damageThisWave += damageOut;

      // Marrow-Snap: if THIS clash hit drove the foe from above the execute
      // line to at or below it (executeThreshold of the foe's OWN max
      // health), the foe dies outright instead of surviving on a sliver.
      // CROSSING semantics, not a stateless health check (changed for the
      // season launch, Jesper 2026-07-11): the old "any foe currently at or
      // below the line dies to the next clash" let Blight-Witch's wave-start
      // AoE poison pre-soften the whole wave under the line, turning every
      // front tap into a kill — with a Marrow-Snap rotating on the front
      // rat, enemies effectively fought with a third of their health bar.
      // Now the executing blow itself must do the threshold-crossing work;
      // a foe already under the line (poison chip, earlier clashes) can NOT
      // be tap-executed — poison steals the crossing rather than enabling
      // it. Still pure execute, no stat gain anywhere, foe-relative, so the
      // compounding law holds exactly as before (see `executeThreshold` in
      // data/relics.ts). Only fires if the foe actually survived this clash
      // (a kill is a kill, not an execute) and skips a foe a surviveLethal
      // relic just rescued to 1 health.
      // Marrow-Snap execute and Gore-Cleaver cleave, both factored into
      // direction-agnostic helpers and fired in BOTH directions. Originally
      // both only ever checked the horde front's relics against the enemy —
      // safe in PvE because gauntlet enemies never carry relics, but in a
      // duel the enemy front is a real player board that can carry either
      // relic, so an unmirrored version would resolve differently by seat
      // (a Gore-Cleaver in seat A cleaving while the identical board in seat
      // B does not — a mirror match would not draw). The enemy-direction call
      // is a strict no-op in gauntlet mode (no relics to match), so PvE stays
      // byte-identical; the pair is symmetric, so a true mirror always draws.
      const tryExecute = (
        attacker: BattleUnit,
        defender: BattleUnit,
        defenderHealthBeforeClash: number
      ): void => {
        const relic = attacker.relics.find((r) => r.executeThreshold !== undefined);
        if (!relic) return;
        const cutoff = defender.maxHealth * relic.executeThreshold!;
        // CROSSING semantics: this clash blow must have driven the defender
        // from above the line to at or below it. A defender already under the
        // line (poison chip, an earlier clash) is NOT tap-executable.
        if (defender.health > 0 && defenderHealthBeforeClash > cutoff && defender.health <= cutoff) {
          events.push({ type: 'relicProc', targetId: attacker.instanceId, relicId: relic.id, name: relic.name });
          // Finish directly rather than through applyDamage: a kill-condition
          // check, not a fresh attack, so armor (damageReduction) must not
          // blunt it.
          const finishing = defender.health;
          defender.health = 0;
          events.push({ type: 'damage', targetId: defender.instanceId, amount: finishing, remainingHealth: 0 });
        }
      };
      const tryCleave = (attacker: BattleUnit, defender: BattleUnit): void => {
        // Overkill that actually fells the front defender carries to the next
        // unit in the defender's OWN line, once, no chaining. Guard against a
        // surviveLethal (Tail-Charm) rescue by checking post-damage health.
        if (!attacker.relics.some((r) => r.cleaveOverkill) || defender.health > 0) return;
        // Carry what actually spilled past the kill — how far health went
        // negative — not the raw swing, which armor may have blunted.
        const overkill = -defender.health;
        const next = boardOf(defender.side)[1];
        if (overkill > 0 && next) {
          events.push({ type: 'relicProc', targetId: attacker.instanceId, relicId: 'gore-cleaver', name: 'Gore-Cleaver' });
          applyDamage(next, overkill, 'attack');
        }
      };
      // Execute before cleave (an execute can feed the cleave), each side's
      // own before-clash snapshot. Front direction first keeps PvE event order
      // identical; the foe-direction calls insert nothing in gauntlet mode.
      tryExecute(front, foe, foeHealthBeforeClash);
      tryExecute(foe, front, frontHealthBeforeClash);
      tryCleave(front, foe);
      tryCleave(foe, front);

      if (front.ability?.trigger === 'afterAttack') applyEffect(front, 0, false);
      if (foe.ability?.trigger === 'afterAttack') applyEffect(foe, 0, false);

      // `onHurt` reflect (issue #134: Steel-Whisker) resolves HERE — after
      // the execute (Marrow-Snap) and cleave (Gore-Cleaver) blocks above,
      // alongside the other post-clash triggers — deliberately, so the
      // reflect's extra damage can never be mistaken for part of the
      // crossing blow (Marrow-Snap compares against the clash hit only) and
      // never feeds cleave-overkill (computed from the clash hit only,
      // before this line runs). Only a blow that actually LANDED fires it:
      // a shield-absorbed hit was never taken (see foeTookBlow/frontTookBlow
      // above), and poison ticks below are rot, not blows. The reflect is
      // fired symmetrically so an enemy-side thorns def (ADR-0004) works for
      // free.
      if (frontTookBlow && front.ability?.trigger === 'onHurt') applyTargetedEffect(front, foe);
      if (foeTookBlow && foe.ability?.trigger === 'onHurt') applyTargetedEffect(foe, front);

      for (const board of [horde, enemies]) {
        for (const unit of [...board]) {
          if (unit.poison > 0 && unit.health > 0) {
            // Only poison landed on the gauntlet side counts as damage dealt
            // (issue #126) — the horde's own poison intake is upkeep, not
            // output. Poison bypasses armor (see applyDamage), so the amount
            // dealt always equals unit.poison exactly; no need to read a
            // return value back out of applyDamage for the true dealt amount.
            if (board === enemies) totalDamage += unit.poison;
            applyDamage(unit, unit.poison, 'poison');
          }
        }
      }

      resolveDeaths();
    }

    totalDamage += damageThisWave;
    if (ticks > MAX_TICKS_PER_WAVE) break;
    if (enemies.length === 0) {
      // Credit the wave clear even if the horde's last unit died on the same
      // tick as the last enemy (batch damage resolution, not incremental —
      // both sides resolve before resolveDeaths() runs, so a simultaneous
      // wipe is possible). Killing every enemy still counts as clearing the
      // wave; whether the horde can fight the NEXT wave is a separate
      // question, already gated by the outer loop's `horde.length > 0`
      // guard, which will correctly stop the run here if horde is empty.
      wavesCleared++;
      events.push({ type: 'waveClear', wave: w + 1 });
      // Antidote between waves: carried damage persists, poison does not —
      // otherwise plague enemies would compound with attrition (tunable).
      for (const unit of horde) unit.poison = 0;
    }
  }

  const survivingHealth = horde.reduce((sum, u) => sum + u.health, 0);
  const score =
    wavesCleared * SCORE_PER_WAVE + survivingHealth + (horde.length === 0 ? damageThisWave : 0);
  events.push({ type: 'battleEnd', wavesCleared, score });

  return {
    events,
    result: {
      wavesCleared,
      score,
      survivors: horde.map(view),
      damageDealt: totalDamage,
      enemiesDefeated: fallen.gauntlet.length,
    },
    // Whatever the enemy side has left standing when the battle ended. In a
    // duel this is side B's surviving board (the winner signal); the PvE
    // `simulate` wrapper drops it.
    enemySurvivors: enemies.map(view),
  };
}
