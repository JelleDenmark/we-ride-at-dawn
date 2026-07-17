import type { Side, UnitDef, Ability, Lineup } from './data/units';
import { UNIT_DEFS, tierAttackMultiplier, tierHealthMultiplier, reviveHpForTier, blockHitsForTier, poisonStacksForTier, cellarCoilChargeCapForTier } from './data/units';
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
 */
export const COMBAT_CAP_BONUS = 2;
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
export const ENEMY_HEALTH_SCALE_PER_WAVE = 0.20;
export const ENEMY_HEALTH_SCALE_QUADRATIC = 0.004;
export const ENEMY_ATTACK_SCALE_PER_WAVE = 0.05;

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
}

/** A hit reduced by armor still lands for at least this much. */
export const MIN_ATTACK_DAMAGE = 1;

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
  const events: BattleEvent[] = [];
  let nextInstanceId = 1;

  const teamRelics = (lineup.teamRelicIds ?? [])
    .map((id) => RELIC_DEFS[id])
    .filter((r): r is RelicDef => r !== undefined && r.scope === 'team');
  const teamAttack = teamRelics.reduce((s, r) => s + (r.attack ?? 0), 0);
  const teamHealth = teamRelics.reduce((s, r) => s + (r.health ?? 0), 0);
  // Whole-horde per-tick regen (The Forgotten Backpack). Same shape as a
  // unit's healPerTick (Fat Tick), just summed across team relics and applied
  // to every horde unit instead of only the carrier. Compounding-law check:
  // this is bounded exactly like Fat Tick's regen below — every tick it's
  // clamped to `maxHealth - health`, so it can never push a unit past its own
  // health ceiling no matter how many of the 45 waves it runs across.
  const teamHealPerTick = teamRelics.reduce((s, r) => s + (r.healPerTick ?? 0), 0);
  // Both sides share one in-combat ceiling. Absent (golden logs, tests,
  // gauntlet-only callers) it's BOARD_CAP, exactly as before.
  const combatCap = lineup.combatCap ?? BOARD_CAP;
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
    if (side === 'horde') {
      attack += teamAttack;
      health += teamHealth;
    }
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
          if (board.length >= combatCap) break;
          const summoned = instantiate(def, source.side);
          board.splice(index, 0, summoned);
          events.push({ type: 'summon', side: source.side, index, unit: view(summoned) });
        }
        break;
      }
      case 'buffBehind': {
        const start = removed ? index : index + 1;
        const targets = effect.all ? board.slice(start) : board.slice(start, start + 1);
        for (const target of targets) buff(target, effect.attack * tierAttackMultiplier(tier), effect.health * tierHealthMultiplier(tier));
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
        const totalAttack = source.attack;
        const totalHealth = source.maxHealth;
        const n = survivors.length;
        const perUnitAttack = Math.floor(totalAttack / n);
        const perUnitHealth = Math.floor(totalHealth / n);
        const remainderAttack = totalAttack - perUnitAttack * n;
        const remainderHealth = totalHealth - perUnitHealth * n;
        // Remainder (stat % survivor-count) goes one point each to the
        // FRONTMOST survivors first (board index order), so the full total
        // is always distributed — nothing lost to rounding.
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
        // — against a single fixed target (e.g. Boss Trial's one boss per
        // phase) this let 2-5x Plague-Bearer push well past the trial's
        // intended "a few dozen phases" ceiling, all the way to its 60-phase
        // hard cap. Capped at `poisonStacksForTier(3)` via its own budget
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
      case 'teamBuffByTime': {
        // Twilight-Runt (issue #110). Unlike `teamBuff`, this effect carries
        // NO `condition` on its ability — the startOfBattle trigger always
        // fires (once per unit instance, same fire-once rule as every other
        // startOfBattle buff below/above), and the half applied is picked
        // right here from the closure's `timeOfDay` (Lineup.timeOfDay, never
        // the wall clock — see its declaration near the top of `simulate`).
        // `timeOfDay` absent (pre-#12 lineups, every existing golden log)
        // matches neither branch, so this is a no-op — same
        // golden-log-preserving guarantee as `condition.timeOfDay` mismatching
        // on Dawn-Runt/Dusk-Runt, just enforced here instead of in
        // `fireEntryTriggers`.
        //
        // Compounding-law check: identical reasoning to `teamBuff` above —
        // `startOfBattle` fires once per unit instance, ever, so this cannot
        // re-fire on a later wave and accumulate across the 45-wave battle,
        // regardless of which half (or neither) ends up applying.
        const half =
          timeOfDay === 'beforeNoon' ? effect.beforeNoon :
          timeOfDay === 'afterNoon' ? effect.afterNoon :
          undefined;
        if (half) {
          for (const target of board) buff(target, half.attack * tierAttackMultiplier(tier), half.health * tierHealthMultiplier(tier));
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
        if (corpseIdx === -1 || board.length >= combatCap) break;
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
        // adds its own current attack directly to the frontmost enemy,
        // taking no retaliation — it never becomes `foe`/`front` in the
        // tick loop below, so there is nothing to hit it back. `index` here
        // is the source's live board position (this effect is only ever
        // wired to `startOfWave`, never `faint`, so `removed` is never
        // true, matching `buffAdjacent`'s reasoning above) — index 0 is
        // "currently at the front," which already deals damage through the
        // normal clash every tick, so it's excluded here to keep this
        // strictly a *backline* contribution, not a double-dip for a unit
        // that happens to rotate to the front.
        if (index === 0) break;
        const target = opposing(source.side)[0];
        if (!target || target.health <= 0) break;
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
        applyDamage(target, source.attack, 'attack');
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

  for (let w = 0; w < gauntlet.waves.length && horde.length > 0; w++) {
    // 1-based wave number, matching the `waveStart`/`waveClear` events below
    // (`wave: w + 1`) — see `currentWave`'s declaration above `applyEffect`
    // for why this is a mutable closure variable rather than threaded as a
    // parameter through every call site.
    currentWave = w + 1;
    enemies = gauntlet.waves[w].units.map((d) =>
      instantiate(d, 'gauntlet', [], 1, enemyAttackScale(w), enemyHealthScale(w))
    );
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

    fireEntryTriggers(horde);
    fireEntryTriggers(enemies);
    resolveDeaths();

    let ticks = 0;
    while (horde.length > 0 && enemies.length > 0 && ticks++ < MAX_TICKS_PER_WAVE) {
      // Distribute team heal pool across all horde units to cap unbounded scaling
      // with board size (issue #75: Forgotten Backpack). Instead of each unit
      // getting full teamHealPerTick, divide it evenly: total team heal per tick
      // = teamHealPerTick (e.g., 1), split among all horde units.
      const teamHealPerUnit = horde.length > 0 ? teamHealPerTick / horde.length : 0;
      for (const board of [horde, enemies]) {
        for (const unit of board) {
          const unitHeal = unit.relics.reduce((s, r) => s + (r.healPerTick ?? 0), 0);
          const totalRegen =
            unitHeal + (unit.side === 'horde' ? teamHealPerUnit : 0);
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
      // compare against the foe's health as it stood BEFORE this clash hit.
      const foeHealthBeforeClash = foe.health;
      if (blockCharges[foe.side] > 0) {
        blockCharges[foe.side]--;
        events.push({ type: 'shieldAbsorbed', targetId: foe.instanceId });
      } else {
        applyDamage(foe, damageOut, 'attack');
      }
      if (blockCharges[front.side] > 0) {
        blockCharges[front.side]--;
        events.push({ type: 'shieldAbsorbed', targetId: front.instanceId });
      } else {
        applyDamage(front, damageIn, 'attack');
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
      const executeRelic = front.relics.find((r) => r.executeThreshold !== undefined);
      const executeCutoff = executeRelic ? foe.maxHealth * executeRelic.executeThreshold! : 0;
      if (executeRelic && foe.health > 0 && foeHealthBeforeClash > executeCutoff && foe.health <= executeCutoff) {
        events.push({ type: 'relicProc', targetId: front.instanceId, relicId: executeRelic.id, name: executeRelic.name });
        // Finish the foe directly rather than routing through applyDamage:
        // this is a kill-condition check, not a fresh attack, so it must not
        // be blunted by the foe's own armor (damageReduction) the way a
        // normal hit would be.
        const finishing = foe.health;
        foe.health = 0;
        events.push({ type: 'damage', targetId: foe.instanceId, amount: finishing, remainingHealth: 0 });
      }

      // Gore-Cleaver: overkill damage that actually fells the front foe
      // carries to the next enemy in line, once, no chaining. Guard against
      // Tail-Charm (or any future surviveLethal) actually saving the foe —
      // check post-applyDamage health, not just the raw overkill math.
      if (front.relics.some((r) => r.cleaveOverkill) && foe.health <= 0) {
        // Carry what actually spilled past the kill, i.e. how far the foe's
        // health went negative — not the raw swing, which armor may have
        // blunted before it landed.
        const overkill = -foe.health;
        const next = enemies[1];
        if (overkill > 0 && next) {
          events.push({ type: 'relicProc', targetId: front.instanceId, relicId: 'gore-cleaver', name: 'Gore-Cleaver' });
          applyDamage(next, overkill, 'attack');
        }
      }

      if (front.ability?.trigger === 'afterAttack') applyEffect(front, 0, false);
      if (foe.ability?.trigger === 'afterAttack') applyEffect(foe, 0, false);

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
  };
}
