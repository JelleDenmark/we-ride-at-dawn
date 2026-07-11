/**
 * #92 guardrail probe: a MAXED tier-3 board (8 units, best offensive relics) —
 * deeper than depth-scaling.ts's growing-roster model — to confirm the top of
 * the leaderboard stays comfortably under WAVE_COUNT=45 after softening enemy
 * HP scaling. Reports avg / p95 / max depth so we see the ceiling a dedicated
 * leaderboard chaser could actually hit, not just the average.
 *
 * Run: npx tsx scripts/maxed-board-guardrail.ts   (from packages/core)
 */
import { generateGauntlet } from '../src/gauntlet';
import {
  simulate,
  BOARD_CAP,
  ENEMY_HEALTH_SCALE_PER_WAVE,
  ENEMY_HEALTH_SCALE_QUADRATIC,
} from '../src/sim';
import type { Lineup } from '../src/data/units';

const START = '2026-07-06';
const SAMPLES = 600;
const DAY = 7; // deepest shop tier (t3), latest gauntlet

// Eight strong attackers, all tier 3, front-loaded with the best offensive
// relics (Gore-Cleaver front — the top depth relic per depth-scaling — then a
// spread of the strongest live-effect relics), plus the team Filth Totem. This
// is a deliberately optimistic "leaderboard chaser" board: deeper than any
// shop-economy player reaches (snowball §7 tops ~10-11), so its ceiling is the
// number the WAVE_COUNT=45 guardrail must clear.
const ORDER = [
  'dire-rat', 'warren-warden', 'corpse-glutton', 'gnawer',
  'bone-priest', 'plague-bearer', 'blight-witch', 'dire-rat',
];
const RELICS = [
  'gore-cleaver', 'rusted-nail', 'fat-tick', 'fat-tick',
  'fat-tick', 'fat-tick', 'fat-tick', 'fat-tick',
];

function maxedBoard(): Lineup {
  const units = ORDER.slice(0, BOARD_CAP).map((defId, i) => ({
    defId,
    tier: 3,
    relicIds: [RELICS[i]],
  }));
  return { units, teamRelicIds: ['filth-totem'] };
}

const lineup = maxedBoard();
const depths: number[] = [];
for (let s = 0; s < SAMPLES; s++) {
  const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
  depths.push(simulate(lineup, generateGauntlet(date, DAY)).result.wavesCleared);
}
depths.sort((a, b) => a - b);
const avg = depths.reduce((a, b) => a + b, 0) / depths.length;
const p95 = depths[Math.floor(depths.length * 0.95)];
const max = depths[depths.length - 1];

console.log(
  `enemy HP scale: perWave=${ENEMY_HEALTH_SCALE_PER_WAVE} quad=${ENEMY_HEALTH_SCALE_QUADRATIC}`
);
console.log(`maxed t3 board (8 units, gore-cleaver+rusted-nail+fat-tick, filth-totem), day ${DAY}, ${SAMPLES} dates:`);
console.log(`  avg depth ${avg.toFixed(2)}   p95 ${p95}   MAX ${max}   (WAVE_COUNT=45)`);
console.log(`  headroom below cap: avg ${(45 - avg).toFixed(1)}, max ${45 - max}`);
