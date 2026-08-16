/**
 * THROWAWAY check (2026-08-07): with the tier-proportional floor, is the
 * "poison can never be fully zeroed" law preserved even at the maximum
 * possible multi-caster resist cap-not-sum budget (POISON_RESIST_CAP)?
 * Not wired into package.json.
 */
import { simulateDuel } from '../src/duel';
import type { Lineup, UnitDef } from '../src/data/units';
import type { BattleEvent } from '../src/sim';

const ofType = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

const attacker: Lineup = { units: [{ defId: 'dire-rat', tier: 3 }, { defId: 'draughtsman-moe', tier: 3 }] };
// Two ★3 Acolytes = max the multi-caster cap-not-sum resist budget can hold.
const defender: Lineup = {
  units: [
    { defId: 'gutter-acolyte', tier: 3 },
    { defId: 'gutter-acolyte', tier: 3 },
    ...Array.from({ length: 5 }, () => ({ defId: 'dire-rat', tier: 3 as const })),
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
console.log(`reaches 0: ${firstZero !== -1}${firstZero !== -1 ? ` at event index ${firstZero}, stays 0: ${ticks.slice(firstZero).every((t) => t.amount === 0)}` : ''}`);
