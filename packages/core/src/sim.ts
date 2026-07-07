import type { Side, UnitDef, Ability, Lineup } from './data/units';
import { UNIT_DEFS } from './data/units';
import { ENEMY_POOL } from './data/enemies';
import { RELIC_DEFS, type RelicDef } from './data/relics';
import type { Gauntlet } from './gauntlet';

const DEF_LOOKUP: Record<string, UnitDef> = {
  ...UNIT_DEFS,
  ...Object.fromEntries(ENEMY_POOL.map((e) => [e.id, e])),
};

/** Hard maximum board size (incl. battle summons). The shop's per-day
 * buildable cap (boardCapForDay) grows toward this over an expedition. */
export const BOARD_CAP = 8;
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
export const ENEMY_HEALTH_SCALE_PER_WAVE = 0.35;
export const ENEMY_HEALTH_SCALE_QUADRATIC = 0.012;
export const ENEMY_ATTACK_SCALE_PER_WAVE = 0.08;

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
  const events: BattleEvent[] = [];
  let nextInstanceId = 1;

  const teamRelics = (lineup.teamRelicIds ?? [])
    .map((id) => RELIC_DEFS[id])
    .filter((r): r is RelicDef => r !== undefined && r.scope === 'team');
  const teamAttack = teamRelics.reduce((s, r) => s + (r.attack ?? 0), 0);
  const teamHealth = teamRelics.reduce((s, r) => s + (r.health ?? 0), 0);

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
      Math.round(def.attack * tier * attackScale) + relics.reduce((s, r) => s + (r.attack ?? 0), 0);
    let health =
      Math.round(def.health * tier * healthScale) + relics.reduce((s, r) => s + (r.health ?? 0), 0);
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
    unit.health -= amount;
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
      amount,
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
          if (board.length >= BOARD_CAP) break;
          const summoned = instantiate(def, source.side);
          board.splice(index, 0, summoned);
          events.push({ type: 'summon', side: source.side, index, unit: view(summoned) });
        }
        break;
      }
      case 'buffBehind': {
        const start = removed ? index : index + 1;
        const targets = effect.all ? board.slice(start) : board.slice(start, start + 1);
        for (const target of targets) buff(target, effect.attack * tier, effect.health * tier);
        break;
      }
      case 'poisonFrontEnemy': {
        const target = opposing(source.side)[0];
        if (target) applyPoisonStacks(target, effect.stacks * tier);
        break;
      }
      case 'poisonTarget': {
        const target = opposing(source.side)[0];
        if (target && target.health > 0) applyPoisonStacks(target, effect.stacks * tier);
        break;
      }
      case 'gainStats': {
        buff(source, effect.attack * tier, effect.health * tier);
        break;
      }
      case 'revive': {
        // Raise the oldest fallen ally — but never the caster itself. A
        // fainting unit is pushed to `fallen` *before* its own faint trigger
        // fires, so shifting the first corpse would resurrect the reviver
        // forever (a lone Bone-Priest was clearing the whole gauntlet,
        // unkillable). Skip the source and raise the next-oldest ally.
        const corpseIdx = fallen[source.side].findIndex((c) => c !== source);
        if (corpseIdx === -1 || board.length >= BOARD_CAP) break;
        const [corpse] = fallen[source.side].splice(corpseIdx, 1);
        corpse.health = effect.health * tier;
        corpse.poison = 0;
        board.splice(index, 0, corpse);
        events.push({ type: 'revive', side: source.side, index, unit: view(corpse) });
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

  const fireStartOfBattle = (board: BattleUnit[]): void => {
    for (const unit of [...board]) {
      if (unit.ability?.trigger !== 'startOfBattle') continue;
      const index = board.findIndex((u) => u.instanceId === unit.instanceId);
      if (index === -1) continue;
      applyEffect(unit, index, false);
    }
  };

  let wavesCleared = 0;
  let totalDamage = 0;
  let damageThisWave = 0;

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

    fireStartOfBattle(horde);
    fireStartOfBattle(enemies);
    resolveDeaths();

    let ticks = 0;
    while (horde.length > 0 && enemies.length > 0 && ticks++ < MAX_TICKS_PER_WAVE) {
      for (const board of [horde, enemies]) {
        for (const unit of board) {
          const regen = unit.relics.reduce((s, r) => s + (r.healPerTick ?? 0), 0);
          const amount = Math.min(regen, unit.maxHealth - unit.health);
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

      const foeHealthBefore = foe.health;
      applyDamage(foe, damageOut, 'attack');
      applyDamage(front, damageIn, 'attack');
      damageThisWave += damageOut;

      // Gore-Cleaver: overkill damage that actually fells the front foe
      // carries to the next enemy in line, once, no chaining. Guard against
      // Tail-Charm (or any future surviveLethal) actually saving the foe —
      // check post-applyDamage health, not just the raw overkill math.
      if (front.relics.some((r) => r.cleaveOverkill) && foe.health <= 0) {
        const overkill = damageOut - foeHealthBefore;
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
    if (enemies.length === 0 && horde.length > 0) {
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
