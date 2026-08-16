/**
 * THROWAWAY probe (2026-08-07): does a PvP duel actually run longer than a
 * PvE wave — i.e. does poison (a per-clash-tick DoT) get more opportunities
 * to fire in PvP than in PvE, independent of the already-established
 * "flat stacks vs scaling enemy HP" mechanism (wrad-pvp-season1-meta.md)?
 *
 * Measures battle length in clash-ticks (one `clash` event = one tick),
 * counted between `waveStart`/`waveClear` for PvE waves and across the
 * whole event log for a duel (duels run as a single wave — see
 * `BattleMode` doc comment in sim.ts). Not wired into package.json.
 */
import { simulateDuel } from '../src/duel';
import { simulate } from '../src/sim';
import { generateGauntlet } from '../src/gauntlet';
import { type Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS } from '../src/sim';

const CAP = BOARD_CAP;
const COMBAT_CAP = CAP + COMBAT_CAP_BONUS;

function board(defIds: string[], tier: number): Lineup {
  return {
    units: defIds.map((defId) => ({ defId, tier, relicIds: [] as string[] })),
    teamRelicIds: [],
    combatCap: COMBAT_CAP,
  };
}

// Real live T3 boards (pulled 2026-08-07 from pvp_boards_public,
// season 2026-08-03.2) — RatMoe vs Well Dressed Rat, both real opponents,
// not spam boards.
const ratMoe = board(
  ['md-rattyfock', 'steel-whisker', 'ward-weaver', 'ward-weaver', 'ward-weaver', 'gutter-gourmand', 'gutter-gourmand', 'draughtsman-moe'],
  3
);
const wellDressedRat = board(
  ['ward-weaver', 'grave-leech', 'press-kin', 'dire-rat', 'brood-mother', 'gutter-acolyte', 'draughtsman-moe', 'corpse-glutton'],
  3
);

console.log('=== PvP duel tick length ===');
const { events: duelEvents, result: duelResult } = simulateDuel(ratMoe, wellDressedRat);
const duelClashTicks = duelEvents.filter((e) => e.type === 'clash').length;
console.log(`RatMoe vs Well-Dressed-Rat (T3): winner=${duelResult.winner} clashTicks=${duelClashTicks}`);

console.log('\n=== PvE wave tick length (a single lineup across 45 waves, 10 seeded runs) ===');
const lineup = board(['gutter-acolyte', 'ward-weaver', 'dire-rat', 'dire-rat', 'md-rattyfock', 'brood-mother'], 3);
const perWaveTicks: number[] = [];
for (let day = 1; day <= 10; day++) {
  const date = `2026-0${1 + (day % 9)}-${String(1 + (day % 28)).padStart(2, '0')}`;
  const gauntlet = generateGauntlet(date, day);
  const { events } = simulate(lineup, gauntlet);
  let currentWaveTicks = 0;
  let waveIndex = 0;
  for (const e of events) {
    if (e.type === 'waveStart') {
      currentWaveTicks = 0;
    } else if (e.type === 'clash') {
      currentWaveTicks++;
    } else if (e.type === 'waveClear') {
      perWaveTicks.push(currentWaveTicks);
      waveIndex++;
    }
  }
}
const avg = perWaveTicks.reduce((a, b) => a + b, 0) / perWaveTicks.length;
const max = Math.max(...perWaveTicks);
const min = Math.min(...perWaveTicks);
console.log(`waves sampled=${perWaveTicks.length} avgTicksPerWave=${avg.toFixed(2)} min=${min} max=${max}`);
console.log(`first 10 waves' tick counts: ${perWaveTicks.slice(0, 10).join(', ')}`);
console.log(`last 10 waves' tick counts (deepest reached): ${perWaveTicks.slice(-10).join(', ')}`);
