/**
 * THROWAWAY check (2026-08-07): does halving decay (floor 1) collapse
 * Moe's tier-scaling (merge reward) toward flatness in a long fight, and
 * can a single T1 Gutter-Acolyte fully zero her poison given enough ticks?
 * Both flagged by the owner as un-checked in the prior analysis.
 *
 * Uses the PvE `simulate` path with a hand-built dummy enemy (0 attack,
 * huge HP) as the sole opposition — same pattern as abilities.test.ts's
 * `dummy`/`gauntletOf` helpers — so the fight runs for many ticks with NO
 * confound from either side dying early. Not wired into package.json.
 */
import { simulate } from '../src/sim';
import { simulateDuel } from '../src/duel';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';
import type { BattleEvent } from '../src/sim';

const dummy = (attack: number, health: number): UnitDef => ({ id: 'dummy', name: 'Dummy', attack, health, cost: 0 });
const gauntletOf = (...waves: UnitDef[][]): Gauntlet => ({ date: 'test', seed: 0, waves: waves.map((units) => ({ units })) });

const ofType = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

console.log('=== 1. Tier-scaling collapse: total poison Moe deals over a long fight, T1 vs T2 vs T3 ===');
console.log('(0-attack, 100000-HP dummy enemy so the fight runs long and never ends from either side dying)');
for (const tier of [1, 2, 3] as const) {
  const horde: Lineup = { units: [{ defId: 'draughtsman-moe', tier }] };
  const { events } = simulate(horde, gauntletOf([dummy(0, 100000)]));
  const ticks = ofType(events, 'poisonTick');
  const total = ticks.reduce((a, t) => a + t.amount, 0);
  console.log(`T${tier}: ticks=${ticks.length} amounts=[${ticks.map((t) => t.amount).slice(0, 20).join(',')}${ticks.length > 20 ? ',...' : ''}] total=${total}`);
}

console.log('\n=== 2. Does a single T1 Gutter-Acolyte eventually fully zero a T3 Moe\'s poison, given a long enough duel? ===');
{
  const attacker: Lineup = { units: [{ defId: 'dire-rat', tier: 3 }, { defId: 'draughtsman-moe', tier: 3 }] };
  const defender: Lineup = {
    units: [
      { defId: 'gutter-acolyte', tier: 1 },
      ...Array.from({ length: 6 }, () => ({ defId: 'dire-rat', tier: 3 as const })),
    ],
  };
  const { events, result } = simulateDuel(attacker, defender);
  const sideOf = new Map<number, 'A' | 'B'>();
  for (const e of events) {
    if (e.type === 'battleStart') for (const u of e.horde) sideOf.set(u.instanceId, 'A');
    if (e.type === 'waveStart') for (const u of e.enemies) sideOf.set(u.instanceId, 'B');
  }
  const ticks = (ofType(events, 'poisonTick') as Extract<BattleEvent, { type: 'poisonTick' }>[]).filter((t) => sideOf.get(t.targetId) === 'B');
  console.log(`winner=${result.winner} totalPoisonTickEvents=${ticks.length}`);
  console.log(`amounts=[${ticks.map((t) => t.amount).join(',')}]`);
  const firstZero = ticks.findIndex((t) => t.amount === 0);
  console.log(`reaches 0: ${firstZero !== -1}${firstZero !== -1 ? ` at event index ${firstZero}` : ''}`);
  if (firstZero !== -1) console.log(`stays 0 for the rest of the fight: ${ticks.slice(firstZero).every((t) => t.amount === 0)}`);
}
