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
// Best offensive relic loadout, front-to-back (gore-cleaver = top deep-end
// depth relic; fat-tick = top overall). Held constant across comps below.
const RELICS = [
  'gore-cleaver', 'rusted-nail', 'fat-tick', 'fat-tick',
  'fat-tick', 'fat-tick', 'fat-tick', 'fat-tick',
];

// Several candidate 8-unit boards — we want the DEEPEST reachable, since the
// guardrail is about the ceiling. `original` is the first-cut comp; `top-depth`
// uses the units that rank highest on T3 depth-per-scrap (MD Rattyfock,
// Ward-Weaver, Press-Kin, Blight-Witch...); `press-kin-core` clusters the
// neighbour-buffer in the middle where its buff hits the most rats.
const COMPS: Record<string, string[]> = {
  original: ['dire-rat', 'warren-warden', 'corpse-glutton', 'gnawer', 'bone-priest', 'plague-bearer', 'blight-witch', 'dire-rat'],
  'top-depth': ['md-rattyfock', 'ward-weaver', 'press-kin', 'blight-witch', 'dusk-runt', 'bone-priest', 'corpse-glutton', 'dire-rat'],
  'press-kin-core': ['ward-weaver', 'md-rattyfock', 'press-kin', 'dusk-runt', 'blight-witch', 'md-rattyfock', 'corpse-glutton', 'bone-priest'],
};

function board(order: string[]): Lineup {
  const units = order.slice(0, BOARD_CAP).map((defId, i) => ({ defId, tier: 3, relicIds: [RELICS[i]] }));
  return { units, teamRelicIds: ['filth-totem'] };
}

console.log(
  `enemy HP scale: perWave=${ENEMY_HEALTH_SCALE_PER_WAVE} quad=${ENEMY_HEALTH_SCALE_QUADRATIC}  (day ${DAY}, ${SAMPLES} dates, all t3, best relics + filth-totem)\n`
);
console.log('comp             avg     p95   MAX / 45   maxHeadroom');
for (const [name, order] of Object.entries(COMPS)) {
  const lineup = board(order);
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
    `${name.padEnd(15)} ${avg.toFixed(2).padStart(6)}  ${String(p95).padStart(4)}  ${String(max).padStart(5)}       ${String(45 - max).padStart(3)}`
  );
}
