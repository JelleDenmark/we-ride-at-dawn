/**
 * #141 comparability probe: does a weekly anomaly move the DEPTH CEILING?
 *
 * `AnomalyDef.distorting` is the firewall that decides whether a week's
 * scores may ride the global/all-time board (ROADMAP: "never let a distorting
 * week write the global frame"). That flag must be measured, not guessed —
 * this script is where the number comes from.
 *
 * Method: the exact maxed tier-3 boards, relics and date sample from
 * `maxed-board-guardrail.ts` (so the clean row here reproduces that script's
 * numbers), re-run once per anomaly. What matters is the DELTA against the
 * clean baseline, not the absolute — the ceiling only has ~2 waves of
 * headroom under WAVE_COUNT=45, so an anomaly that lifts MAX materially is
 * saturating the board, and one that drops it materially is a difficulty
 * change wearing a variance costume.
 *
 * Run: npx tsx scripts/anomaly-guardrail.ts   (from packages/core)
 */
import { ANOMALY_DEFS, type AnomalyDef } from '../src/anomaly';
import { generateGauntlet, WAVE_COUNT } from '../src/gauntlet';
import { simulate, BOARD_CAP } from '../src/sim';
import type { Lineup } from '../src/data/units';

const START = '2026-07-06'; // a Monday
const SEASON_SAMPLES = 300;
const DAY = 7;

/** Threshold from the plan's balance gate: beyond this, flip `distorting`. */
const DISTORTION_WAVES = 2;

const RELICS = [
  'gore-cleaver', 'rusted-nail', 'fat-tick', 'fat-tick',
  'fat-tick', 'fat-tick', 'fat-tick', 'fat-tick',
];

const COMPS: Record<string, string[]> = {
  original: ['dire-rat', 'warren-warden', 'corpse-glutton', 'gnawer', 'bone-priest', 'plague-bearer', 'blight-witch', 'dire-rat'],
  'top-depth': ['md-rattyfock', 'ward-weaver', 'press-kin', 'blight-witch', 'dusk-runt', 'bone-priest', 'corpse-glutton', 'dire-rat'],
  'press-kin-core': ['ward-weaver', 'md-rattyfock', 'press-kin', 'dusk-runt', 'blight-witch', 'md-rattyfock', 'corpse-glutton', 'bone-priest'],
};

function board(order: string[]): Lineup {
  const units = order.slice(0, BOARD_CAP).map((defId, i) => ({ defId, tier: 3, relicIds: [RELICS[i]] }));
  return { units, teamRelicIds: ['filth-totem'] };
}

// One sample per SEASON, not per day. The gauntlet is season-seeded and
// byte-identical for all seven days of a week (#41), so walking consecutive
// dates — as `maxed-board-guardrail.ts` does — counts every season seven
// times over. Harmless for the mean, but it makes "spread" meaningless, and
// spread is precisely what an anomaly moves.
const seasons = Array.from({ length: SEASON_SAMPLES }, (_, s) =>
  new Date(Date.parse(`${START}T12:00:00Z`) + s * 7 * 86_400_000).toISOString().slice(0, 10)
);

interface Stats { avg: number; p95: number; max: number; sd: number }

function measure(order: string[], anomaly: AnomalyDef | null): Stats {
  const lineup = board(order);
  const depths = seasons
    .map((d) => simulate(lineup, generateGauntlet(d, DAY, undefined, anomaly)).result.wavesCleared)
    .sort((a, b) => a - b);
  const avg = depths.reduce((a, b) => a + b, 0) / depths.length;
  return {
    avg,
    p95: depths[Math.floor(depths.length * 0.95)],
    max: depths[depths.length - 1],
    // Week-to-week spread. A clean season already varies with its theme roll
    // (an armored week is simply harder than a swarm week); what matters is
    // whether an anomaly AMPLIFIES that, because a week far outside the
    // normal spread is one the all-time board can't fairly absorb.
    sd: Math.sqrt(depths.reduce((s, d) => s + (d - avg) ** 2, 0) / depths.length),
  };
}

const signed = (n: number, dp = 2) => (n >= 0 ? '+' : '') + n.toFixed(dp);

console.log(`maxed t3 boards, day ${DAY}, ${SEASON_SAMPLES} seasons, WAVE_COUNT=${WAVE_COUNT}`);
console.log(`distortion threshold: any avg/MAX delta beyond ${DISTORTION_WAVES} waves, or spread >1.5x clean\n`);

const verdicts: Record<string, boolean> = {};

for (const [compName, order] of Object.entries(COMPS)) {
  const clean = measure(order, null);
  console.log(`${compName}`);
  console.log(`  ${'week'.padEnd(14)} ${'avg'.padStart(6)} ${'p95'.padStart(5)} ${'MAX'.padStart(5)} ${'sd'.padStart(5)}   ${'Δavg'.padStart(7)} ${'ΔMAX'.padStart(5)} ${'sd x'.padStart(5)}`);
  console.log(`  ${'(clean)'.padEnd(14)} ${clean.avg.toFixed(2).padStart(6)} ${String(clean.p95).padStart(5)} ${String(clean.max).padStart(5)} ${clean.sd.toFixed(2).padStart(5)}`);

  for (const anomaly of Object.values(ANOMALY_DEFS)) {
    const s = measure(order, anomaly);
    const dAvg = s.avg - clean.avg;
    const dMax = s.max - clean.max;
    const sdRatio = s.sd / clean.sd;
    const over =
      Math.abs(dAvg) > DISTORTION_WAVES || Math.abs(dMax) > DISTORTION_WAVES || sdRatio > 1.5;
    verdicts[anomaly.id] = verdicts[anomaly.id] || over;
    console.log(
      `  ${anomaly.name.padEnd(14)} ${s.avg.toFixed(2).padStart(6)} ${String(s.p95).padStart(5)} ${String(s.max).padStart(5)} ${s.sd.toFixed(2).padStart(5)}   ` +
      `${signed(dAvg).padStart(7)} ${signed(dMax, 0).padStart(5)} ${sdRatio.toFixed(2).padStart(5)}  ${over ? '<-- DISTORTING' : ''}`
    );
  }
  console.log('');
}

console.log('verdict (worst comp decides):');
for (const anomaly of Object.values(ANOMALY_DEFS)) {
  const measured = verdicts[anomaly.id];
  const declared = anomaly.distorting;
  const agree = measured === declared;
  console.log(
    `  ${anomaly.name.padEnd(14)} measured distorting=${String(measured).padEnd(5)} ` +
    `declared=${String(declared).padEnd(5)} ${agree ? 'ok' : '<-- MISMATCH: update anomaly.ts'}`
  );
}
