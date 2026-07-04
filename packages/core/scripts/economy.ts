/**
 * Idle-economy creep model. Uses the real battle sim for a representative
 * horde's depth across the 7 escalating expedition days, then rolls the
 * hourly income forward for a PASSIVE player (builds once with starting
 * gold, never spends again) to see how fast idle scrap piles up — in raw
 * scrap and, more tellingly, in "units-worth" (bank / avg unit cost).
 *
 * Run:  npx tsx scripts/economy.ts   (from packages/core)
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import { UNIT_DEFS, type Lineup } from '../src/data/units';

// A plausible day-1 build bought with 12 base scrap (5 units).
const HORDE: Lineup = {
  units: [
    { defId: 'dire-rat' },
    { defId: 'warren-warden' },
    { defId: 'gnawer' },
    { defId: 'plague-bearer' },
    { defId: 'gutter-runt' },
  ],
};

const BASE_COSTS = Object.values(UNIT_DEFS).filter((u) => u.id !== 'pup').map((u) => u.cost);
const AVG_COST = BASE_COSTS.reduce((a, b) => a + b, 0) / BASE_COSTS.length;
const BASE_START = 12;

// Representative depth per expedition day, averaged over 20 dates (themes).
function depthForDay(day: number): number {
  const dates: string[] = [];
  const base = Date.parse('2026-07-01T12:00:00Z');
  for (let i = 0; i < 20; i++) dates.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  const ds = dates.map((d) => simulate(HORDE, generateGauntlet(d, day)).result.wavesCleared);
  return ds.reduce((a, b) => a + b, 0) / ds.length;
}
const depths = [1, 2, 3, 4, 5, 6, 7].map(depthForDay);

const interest = (bank: number, rate: number, cap: number) => Math.min(cap, Math.floor(bank * rate));

interface Cfg {
  name: string;
  costScale: number;
  startScale: number;
  rate: number;
  cap: number;
  perDepth: number;
  intPeriod: number; // hours between interest payouts (1 = hourly, 24 = daily)
}

const CFGS: Cfg[] = [
  { name: 'Current (baseline)', costScale: 1, startScale: 1, rate: 0.1, cap: 5, perDepth: 1, intPeriod: 1 },
  { name: 'x2 cost/start, 5% hourly', costScale: 2, startScale: 2, rate: 0.05, cap: 5, perDepth: 1, intPeriod: 1 },
  { name: 'x3 cost/start, 5% hourly', costScale: 3, startScale: 3, rate: 0.05, cap: 5, perDepth: 1, intPeriod: 1 },
  { name: 'x2, 5% hourly, cap 2', costScale: 2, startScale: 2, rate: 0.05, cap: 2, perDepth: 1, intPeriod: 1 },
  { name: 'x2, 5% DAILY, cap 5', costScale: 2, startScale: 2, rate: 0.05, cap: 5, perDepth: 1, intPeriod: 24 },
  { name: 'x2 cost/start, NO int', costScale: 2, startScale: 2, rate: 0, cap: 0, perDepth: 1, intPeriod: 1 },
  { name: 'x1, 1 per 2 depth, no int', costScale: 1, startScale: 1, rate: 0, cap: 0, perDepth: 0.5, intPeriod: 1 },
];

interface Row {
  cfg: Cfg;
  avgCost: number;
  startUnits: number;
  bank1: number;
  bank3: number;
  bank7: number;
  intShare: number;
}

function run(cfg: Cfg): Row {
  let bank = 0;
  let bank1 = 0;
  let bank3 = 0;
  let depthTot = 0;
  let intTot = 0;
  for (let h = 0; h < 168; h++) {
    const day = Math.min(7, Math.floor(h / 24) + 1);
    const inc = Math.floor(depths[day - 1] * cfg.perDepth);
    const intr = h % cfg.intPeriod === 0 ? interest(bank, cfg.rate, cfg.cap) : 0;
    bank += inc + intr;
    depthTot += inc;
    intTot += intr;
    if (h === 23) bank1 = bank;
    if (h === 71) bank3 = bank;
  }
  const avgCost = AVG_COST * cfg.costScale;
  return {
    cfg,
    avgCost,
    startUnits: (BASE_START * cfg.startScale) / avgCost,
    bank1,
    bank3,
    bank7: bank,
    intShare: intTot / (intTot + depthTot),
  };
}

const rows = CFGS.map(run);

console.log('representative horde depth by expedition day:');
console.log('  ' + depths.map((d, i) => `d${i + 1}:${d.toFixed(1)}`).join('  '));
console.log(`avg unit cost (base): ${AVG_COST.toFixed(2)} scrap · starting gold (base): ${BASE_START}\n`);

const f = (n: number) => n.toFixed(0).padStart(4);
const u = (n: number) => n.toFixed(1).padStart(5);
console.log('PASSIVE idle bank (build once, never spend) — raw scrap and units-worth');
console.log('config                     avgCost  start   d1 bank (u)   d3 bank (u)   d7 bank (u)   int%');
for (const r of rows) {
  console.log(
    r.cfg.name.padEnd(26) +
      ` ${r.avgCost.toFixed(1).padStart(5)}  ` +
      `${r.startUnits.toFixed(1)}u  ` +
      `${f(r.bank1)} (${u(r.bank1 / r.avgCost)})  ` +
      `${f(r.bank3)} (${u(r.bank3 / r.avgCost)})  ` +
      `${f(r.bank7)} (${u(r.bank7 / r.avgCost)})  ` +
      `${(r.intShare * 100).toFixed(0)}%`
  );
}
