/**
 * Realistic strong-player distribution: the strongest 8-unit comp, all TIER 2
 * (not the near-unreachable t3), with a PARTIAL relic loadout ("some relics" —
 * front 4 units carry one each + the team Filth Totem; back 4 bare). Reports
 * the depth percentiles across many gauntlet seeds so we see the real spread a
 * top-but-not-maxed player lands in, day 7. sim.ts constants are UNCHANGED.
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate, BOARD_CAP, ENEMY_HEALTH_SCALE_PER_WAVE, ENEMY_HEALTH_SCALE_QUADRATIC } from '../src/sim';
import type { Lineup } from '../src/data/units';

const START = '2026-07-06';
const SAMPLES = 1200;
const DAY = 7;

const ORDER = ['md-rattyfock', 'ward-weaver', 'press-kin', 'blight-witch', 'dusk-runt', 'bone-priest', 'corpse-glutton', 'dire-rat'];
// "some relics": front 4 carry one each (best offensive set), back 4 bare, plus team Filth Totem.
const RELICS = ['gore-cleaver', 'rusted-nail', 'fat-tick', 'fat-tick', null, null, null, null];

function board(tier: number): Lineup {
  const units = ORDER.slice(0, BOARD_CAP).map((defId, i) => ({
    defId,
    tier,
    relicIds: RELICS[i] ? [RELICS[i] as string] : [],
  }));
  return { units, teamRelicIds: ['filth-totem'] };
}

function pctl(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

console.log(`enemy HP: perWave=${ENEMY_HEALTH_SCALE_PER_WAVE} quad=${ENEMY_HEALTH_SCALE_QUADRATIC} (UNCHANGED) · day ${DAY} · ${SAMPLES} seeds`);
console.log('comp: md-rattyfock/ward-weaver/press-kin/blight-witch/dusk-runt/bone-priest/corpse-glutton/dire-rat');
console.log('relics: gore-cleaver + rusted-nail + 2x fat-tick (front 4) + filth-totem team; back 4 bare\n');
console.log('tier   p5   p25   p50   p75   p95   avg    MAX');
for (const tier of [2, 3]) {
  const lineup = board(tier);
  const d: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
    d.push(simulate(lineup, generateGauntlet(date, DAY)).result.wavesCleared);
  }
  d.sort((a, b) => a - b);
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  const label = tier === 2 ? 't2 (realistic)' : 't3 (for ref)';
  console.log(
    `${label.padEnd(6)} ${String(pctl(d, 5)).padStart(2)}   ${String(pctl(d, 25)).padStart(2)}   ${String(pctl(d, 50)).padStart(2)}   ${String(pctl(d, 75)).padStart(2)}   ${String(pctl(d, 95)).padStart(2)}   ${avg.toFixed(1).padStart(4)}   ${d[d.length - 1]}`
  );
}
