// One-off analysis: with a FIXED roster (no growth), how much does achievable
// depth swing from one calendar day to the next, purely from the daily
// gauntlet's random theme/composition draw? Isolates day-to-day variance
// from the roster-growth signal (which is expected and fine).
import { simulate, generateGauntlet, boardCapForDay } from '../src/index';
import type { Lineup } from '../src/index';

// Same "strong, actively-improving player" roster as depth-scaling.ts, incl.
// relics on the units that matter (dire-rat front w/ Gore-Cleaver, Corpse-
// Glutton w/ Fat Tick) — a realistic optimized build, not filler.
const ORDER = [
  'dire-rat', 'warren-warden', 'corpse-glutton', 'gnawer',
  'bone-priest', 'plague-bearer', 'blight-witch', 'dire-rat',
];

function fixedRoster(day: number, tier: number): Lineup {
  const cap = boardCapForDay(day);
  const units: Lineup['units'] = ORDER.map((defId, i) => {
    const relicIds: string[] = [];
    if (i === 0) relicIds.push('gore-cleaver');
    else if (i === 2) relicIds.push('fat-tick');
    return { defId, tier, relicIds };
  });
  return { units: units.slice(0, cap), teamRelicIds: ['filth-totem'] };
}

const N_DAYS = 40;
const START = '2026-07-06';

for (const [label, day, tier] of [
  ['day-1-ish (tier 1, cap 5)', 1, 1],
  ['day-4-ish (tier 2, cap 6)', 4, 2],
  ['day-7-ish (tier 3, cap 8)', 7, 3],
] as const) {
  const lineup = fixedRoster(day, tier);
  const depths: number[] = [];
  for (let i = 0; i < N_DAYS; i++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    depths.push(simulate(lineup, generateGauntlet(date, day)).result.wavesCleared);
  }
  const min = Math.min(...depths);
  const max = Math.max(...depths);
  const avg = depths.reduce((a, b) => a + b, 0) / depths.length;
  const swings = depths.slice(1).map((d, i) => d - depths[i]);
  const maxSwing = Math.max(...swings.map(Math.abs));
  console.log(`${label}: min ${min} avg ${avg.toFixed(2)} max ${max} (spread ${max - min}) | max single-day-to-next swing: ${maxSwing}`);
  console.log(`  sequence: ${depths.join(', ')}`);
}
