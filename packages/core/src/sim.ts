import type { Ability, Side, UnitDef } from './data/units';
import { UNIT_DEFS } from './data/units';
import type { Gauntlet } from './gauntlet';

export const BOARD_CAP = 5;
export const SCORE_PER_WAVE = 100;

export interface UnitView {
  instanceId: number;
  defId: string;
  name: string;
  attack: number;
  health: number;
  side: Side;
}

export type BattleEvent =
  | { type: 'battleStart'; horde: UnitView[] }
  | { type: 'waveStart'; wave: number; enemies: UnitView[] }
  | { type: 'clash'; hordeId: number; enemyId: number }
  | { type: 'damage'; targetId: number; amount: number; remainingHealth: number }
  | { type: 'death'; unitId: number }
  | { type: 'summon'; side: Side; index: number; unit: UnitView }
  | { type: 'buff'; targetId: number; attack: number; health: number; newAttack: number; newHealth: number }
  | { type: 'waveClear'; wave: number }
  | { type: 'battleEnd'; wavesCleared: number; score: number };

export interface BattleResult {
  wavesCleared: number;
  score: number;
  survivors: UnitView[];
  damageDealt: number;
}

interface BattleUnit {
  instanceId: number;
  defId: string;
  name: string;
  attack: number;
  health: number;
  side: Side;
  ability?: Ability;
}

/**
 * Pure and deterministic: same (lineup, gauntlet) always yields a
 * byte-identical event log. No unseeded randomness, no wall-clock,
 * no iteration over unordered collections.
 */
export function simulate(
  lineup: UnitDef[],
  gauntlet: Gauntlet
): { events: BattleEvent[]; result: BattleResult } {
  const events: BattleEvent[] = [];
  let nextInstanceId = 1;

  const instantiate = (def: UnitDef, side: Side): BattleUnit => ({
    instanceId: nextInstanceId++,
    defId: def.id,
    name: def.name,
    attack: def.attack,
    health: def.health,
    side,
    ability: def.ability,
  });

  const view = (u: BattleUnit): UnitView => ({
    instanceId: u.instanceId,
    defId: u.defId,
    name: u.name,
    attack: u.attack,
    health: u.health,
    side: u.side,
  });

  const horde: BattleUnit[] = lineup.slice(0, BOARD_CAP).map((d) => instantiate(d, 'horde'));
  events.push({ type: 'battleStart', horde: horde.map(view) });

  const applyEffect = (source: BattleUnit, index: number, board: BattleUnit[]): void => {
    if (!source.ability) return;
    const effect = source.ability.effect;
    if (effect.kind === 'summon') {
      const def = UNIT_DEFS[effect.unitId];
      for (let i = 0; i < effect.count; i++) {
        if (board.length >= BOARD_CAP) break;
        const summoned = instantiate(def, source.side);
        board.splice(index, 0, summoned);
        events.push({ type: 'summon', side: source.side, index, unit: view(summoned) });
      }
    } else if (effect.kind === 'buffBehind') {
      const target = board[index];
      if (!target) return;
      target.attack += effect.attack;
      target.health += effect.health;
      events.push({
        type: 'buff',
        targetId: target.instanceId,
        attack: effect.attack,
        health: effect.health,
        newAttack: target.attack,
        newHealth: target.health,
      });
    }
  };

  const fireStartOfBattle = (board: BattleUnit[]): void => {
    for (const unit of [...board]) {
      if (unit.ability?.trigger !== 'startOfBattle') continue;
      const index = board.findIndex((u) => u.instanceId === unit.instanceId);
      if (index === -1) continue;
      applyEffect(unit, index, board);
    }
  };

  const resolveDeaths = (enemies: BattleUnit[]): void => {
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
      if (dead.ability?.trigger === 'faint') applyEffect(dead, deadIndex, deadBoard);
    }
  };

  let wavesCleared = 0;
  let totalDamage = 0;
  let damageThisWave = 0;

  for (let w = 0; w < gauntlet.waves.length && horde.length > 0; w++) {
    const enemies = gauntlet.waves[w].units.map((d) => instantiate(d, 'gauntlet'));
    events.push({ type: 'waveStart', wave: w + 1, enemies: enemies.map(view) });
    damageThisWave = 0;

    fireStartOfBattle(horde);
    fireStartOfBattle(enemies);
    resolveDeaths(enemies);

    while (horde.length > 0 && enemies.length > 0) {
      const front = horde[0];
      const foe = enemies[0];
      events.push({ type: 'clash', hordeId: front.instanceId, enemyId: foe.instanceId });

      foe.health -= front.attack;
      events.push({ type: 'damage', targetId: foe.instanceId, amount: front.attack, remainingHealth: foe.health });
      front.health -= foe.attack;
      events.push({ type: 'damage', targetId: front.instanceId, amount: foe.attack, remainingHealth: front.health });
      damageThisWave += front.attack;

      resolveDeaths(enemies);
    }

    totalDamage += damageThisWave;
    if (enemies.length === 0 && horde.length > 0) {
      wavesCleared++;
      events.push({ type: 'waveClear', wave: w + 1 });
    }
  }

  const survivingHealth = horde.reduce((sum, u) => sum + u.health, 0);
  const score =
    wavesCleared * SCORE_PER_WAVE + survivingHealth + (horde.length === 0 ? damageThisWave : 0);
  events.push({ type: 'battleEnd', wavesCleared, score });

  return {
    events,
    result: { wavesCleared, score, survivors: horde.map(view), damageDealt: totalDamage },
  };
}
