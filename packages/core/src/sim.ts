import type { Side, UnitDef, Ability, Lineup } from './data/units';
import { UNIT_DEFS, tierAttackMultiplier, tierHealthMultiplier, reviveHpForTier, blockHitsForTier, poisonStacksForTier } from './data/units';
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
        // accumulate across the 45-wave battle. Multiple Plague-Bearers
        // stack additively within a single wave (each re-applies
        // `poisonStacksForTier(tier)` to the same last enemy) — bounded by
        // fresh enemies next wave, not a persistent-horde compounding vector.
        const foes = opposing(source.side);
        const target = foes[foes.length - 1];
        if (target) applyPoisonStacks(target, poisonStacksForTier(tier));
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
        // Multiple Blight-Witches stack additively within a single wave
        // (each re-applies `poisonStacksForTier(tier)` to every enemy), but
        // that's bounded by fresh enemies next wave and the board cap on
        // how many Blight-Witches can be fielded at once — not a
        // persistent-horde compounding vector like the shipped exploits.
        const stacks = poisonStacksForTier(tier);
        for (const target of opposing(source.side)) {
          if (target.health > 0) applyPoisonStacks(target, stacks);
        }
        break;
      }
      case 'gainStats': {
        buff(source, effect.attack * tier, effect.health * tier);
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
        // `faint` still fires exactly once per unit instance, ever (a unit
        // only dies once), so the compounding-law bound above still holds
        // regardless of how steep the HP table gets or how long the battle
        // (up to 45 waves) runs.
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
      if (condition && condition.timeOfDay !== timeOfDay) continue;
      const index = board.findIndex((u) => u.instanceId === unit.instanceId);
      if (index === -1) continue;
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

  for (let w = 0; w < gauntlet.waves.length && horde.length > 0; w++) {
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
        u.firstAttackDone ? 0 : u.relics.reduce((s, r) => s + (r.firstHitBonus ?? 0), 0);
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
          if (unit.poison > 0 && unit.health > 0) applyDamage(unit, unit.poison, 'poison');
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
