/**
 * #141 depth probe: how far does a weekly anomaly move the DEPTH CEILING?
 *
 * **This is no longer a pass/fail gate (ADR-0007).** It used to be: anything
 * past ~±2 waves got `distorting: true` and was held back until a per-week
 * board partition existed. That gate shelved every eventful candidate and
 * left only composition reshuffles, all three of which were deleted on
 * 2026-08-08 for being too small to notice. The nightly PvP league is the
 * scoring metric now and it settles between players inside one week, so a
 * week-wide difficulty shift is symmetric and comes out in the wash.
 *
 * So the depth delta below is now REPORTING, not permission — it sets the
 * `distorting` label (which a restored depth board, #172, would partition on)
 * and nothing more. `DISTORTION_WAVES` is the threshold for that label, not a
 * bar to clear.
 *
 * Two things this script measures that DO still bear on shipping:
 *
 *   - **The income coupling.** Income is depth-proportional (ADR-0002), so a
 *     harder week quietly shrinks every player's bank and therefore the PvP
 *     board they can field. Symmetric across players, so still fair — but far
 *     enough and the league degrades into a tier-1 chaff fight. The implied
 *     week-income column exists for this.
 *   - **Direction.** A big NEGATIVE delta risks the playability floor; a big
 *     POSITIVE one saturates a 45-wave ladder that is already topped out by
 *     day 3 (#163). They are not symmetric problems and the summary says
 *     which one you have.
 *
 * What this script CANNOT tell you, and the reason it is not sufficient on
 * its own: it sims already-MAXED tier-3 boards, so it measures the ceiling,
 * not the floor. The floor is where the real gate lives now ("is this week
 * worth riding for a normal player"), and that needs a `balance:realistic`
 * pass with the anomaly wired into the shop calls. Shop-side anomalies are
 * entirely invisible here and will report a meaningless clean row — see the
 * Grown Past Use entry's note in `anomaly.ts`.
 *
 * Run: npx tsx scripts/anomaly-guardrail.ts   (from packages/core)
 */
import { ANOMALY_DEFS, type AnomalyDef } from '../src/anomaly';
import { generateGauntlet, WAVE_COUNT } from '../src/gauntlet';
import { simulate, BOARD_CAP } from '../src/sim';
import { scrapForDepth } from '../src/shop';
import type { Lineup } from '../src/data/units';

const START = '2026-07-06'; // a Monday
const SEASON_SAMPLES = 300;
const DAY = 7;

/**
 * Depth delta at which the `distorting` LABEL flips (ADR-0007 — a label, not
 * a gate). Was 2, calibrated against a global cross-week depth board that no
 * longer carries the game. 6 is ~13% of the 45-wave ladder and roughly where
 * the implied income delta below starts to be worth a second look; it is a
 * provisional number and wants recalibrating once a distorting week has
 * actually run live.
 */
const DISTORTION_WAVES = 6;

/**
 * Implied week-income swing (%) worth flagging. Income is 24 hourly rides a
 * day over a 7-day season (#163's method), all of it depth-proportional. A
 * board costs ~600-1 400 against a ~2 000 week for a strong player, so a
 * swing past ~20% is the band where what you can field actually changes.
 */
const INCOME_SWING_PCT = 20;

/**
 * Implied week income at a FLAT depth: 24 hourly rides a day for 7 days, all
 * depth-proportional (#163's income shape). Deliberately an upper bound — a
 * real week ramps up to its depth rather than opening there, so this reads
 * high against #163's measured totals (~3 530 here vs their ~2 980 for a
 * 45-clearer). That is fine and intended: only the DELTA between the clean
 * and anomaly rows is load-bearing, and the ramp cancels out of a ratio.
 */
const weekIncome = (avgDepth: number) => scrapForDepth(Math.round(avgDepth)) * 24 * 7;

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
console.log(`ceiling only — the playability FLOOR needs balance:realistic (ADR-0007)`);
console.log(`'distorting' LABEL at: avg/MAX delta beyond ${DISTORTION_WAVES} waves, or spread >1.5x clean`);
console.log(`income flag at: implied week-income swing beyond ${INCOME_SWING_PCT}%\n`);

const verdicts: Record<string, boolean> = {};
/** Worst (largest-magnitude) income swing seen for each anomaly, any comp. */
const incomeSwings: Record<string, number> = {};

for (const [compName, order] of Object.entries(COMPS)) {
  const clean = measure(order, null);
  const cleanIncome = weekIncome(clean.avg);
  console.log(`${compName}`);
  console.log(`  ${'week'.padEnd(14)} ${'avg'.padStart(6)} ${'p95'.padStart(5)} ${'MAX'.padStart(5)} ${'sd'.padStart(5)}   ${'Δavg'.padStart(7)} ${'ΔMAX'.padStart(5)} ${'sd x'.padStart(5)} ${'Δinc%'.padStart(7)}`);
  console.log(`  ${'(clean)'.padEnd(14)} ${clean.avg.toFixed(2).padStart(6)} ${String(clean.p95).padStart(5)} ${String(clean.max).padStart(5)} ${clean.sd.toFixed(2).padStart(5)} ${''.padStart(21)} ${String(cleanIncome).padStart(6)}`);

  for (const anomaly of Object.values(ANOMALY_DEFS)) {
    const s = measure(order, anomaly);
    const dAvg = s.avg - clean.avg;
    const dMax = s.max - clean.max;
    const sdRatio = s.sd / clean.sd;
    const dIncomePct = ((weekIncome(s.avg) - cleanIncome) / cleanIncome) * 100;
    const over =
      Math.abs(dAvg) > DISTORTION_WAVES || Math.abs(dMax) > DISTORTION_WAVES || sdRatio > 1.5;
    verdicts[anomaly.id] = verdicts[anomaly.id] || over;
    if (Math.abs(dIncomePct) > Math.abs(incomeSwings[anomaly.id] ?? 0)) {
      incomeSwings[anomaly.id] = dIncomePct;
    }
    const notes = [
      over ? 'distorting' : '',
      Math.abs(dIncomePct) > INCOME_SWING_PCT ? 'income' : '',
    ].filter(Boolean);
    console.log(
      `  ${anomaly.name.padEnd(14)} ${s.avg.toFixed(2).padStart(6)} ${String(s.p95).padStart(5)} ${String(s.max).padStart(5)} ${s.sd.toFixed(2).padStart(5)}   ` +
      `${signed(dAvg).padStart(7)} ${signed(dMax, 0).padStart(5)} ${sdRatio.toFixed(2).padStart(5)} ${signed(dIncomePct, 1).padStart(7)}` +
      `${notes.length ? '  <-- ' + notes.join(' + ') : ''}`
    );
  }
  console.log('');
}

console.log('label check (worst comp decides) — informational since ADR-0007:');
for (const anomaly of Object.values(ANOMALY_DEFS)) {
  const measured = verdicts[anomaly.id];
  const declared = anomaly.distorting;
  const agree = measured === declared;
  console.log(
    `  ${anomaly.name.padEnd(14)} measured distorting=${String(measured).padEnd(5)} ` +
    `declared=${String(declared).padEnd(5)} ${agree ? 'ok' : '<-- MISMATCH: update anomaly.ts'}`
  );
}

console.log('\nincome coupling (worst comp) — the one that bears on the PvP league:');
for (const anomaly of Object.values(ANOMALY_DEFS)) {
  const swing = incomeSwings[anomaly.id] ?? 0;
  const hot = Math.abs(swing) > INCOME_SWING_PCT;
  console.log(
    `  ${anomaly.name.padEnd(14)} implied week income ${signed(swing, 1).padStart(7)}%` +
    `${hot ? '  <-- boards players can field move materially' : ''}`
  );
}

console.log(
  '\nNOTE: a clean row for a shop-side anomaly means nothing — this fixture is\n' +
  'a maxed board against a changed gauntlet, and shop overrides never reach it.'
);
