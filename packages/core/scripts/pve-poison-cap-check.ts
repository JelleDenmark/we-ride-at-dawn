/**
 * THROWAWAY probe (2026-08-07, handoff re-analysis): does raising
 * POISON_RESIST_CAP have a measurable PvE side effect? The Acolyte's
 * `poisonResist` protects its own side against ANY incoming poison, not
 * just PvP Moe poison — gauntlet enemies (Plague-Doctor `poisonFrontEnemy`,
 * Midden-Hag `poisonTarget`) also poison the horde, and the resist budget
 * is side-keyed at tick resolution (sim.ts ~1520), not scoped to PvP.
 *
 * Measures total poison damage actually taken by the horde across many
 * seeded gauntlet runs with a Gutter-Acolyte on board, run once per cap
 * value (edit POISON_RESIST_CAP in data/units.ts between runs, same as the
 * PvP probe). Not wired into package.json.
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import type { Lineup } from '../src/data/units';
import { POISON_RESIST_CAP } from '../src/data/units';

function board(defIds: string[], tier: number): Lineup {
  return {
    units: defIds.map((defId) => ({ defId, tier, relicIds: [] as string[] })),
    teamRelicIds: [],
  };
}

const lineup = board(
  ['gutter-acolyte', 'ward-weaver', 'dire-rat', 'dire-rat', 'md-rattyfock', 'brood-mother'],
  3
);

let totalPoisonTaken = 0;
let totalWavesCleared = 0;
let runs = 0;

for (let day = 1; day <= 30; day++) {
  const date = `2026-0${1 + (day % 9)}-${String(1 + (day % 28)).padStart(2, '0')}`;
  const gauntlet = generateGauntlet(date, day);
  const { events, result } = simulate(lineup, gauntlet);
  totalWavesCleared += result.wavesCleared;
  for (const e of events) {
    // Sums BOTH sides' poison ticks. The gauntlet side never has an
    // Acolyte in this lineup, so its poison intake is cap-invariant —
    // any delta between cap runs in this total is entirely the horde's
    // resisted intake, without needing per-side event attribution.
    if (e.type === 'poisonTick') {
      totalPoisonTaken += (e as any).amount ?? 0;
    }
  }
  runs++;
}

console.log(`POISON_RESIST_CAP = ${POISON_RESIST_CAP}`);
console.log(`runs=${runs} totalWavesCleared=${totalWavesCleared} totalPoisonTakenByHorde=${totalPoisonTaken}`);
