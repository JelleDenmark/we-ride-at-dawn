/**
 * Headless balance report: simulates one representative lineup per
 * strategy archetype across a run of dates and prints depth stats,
 * overall and grouped by the day's primary theme.
 *
 * Run from the repo root:  npm run balance
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import type { Archetype, Lineup } from '../src/data/units';
import { UNIT_DEFS } from '../src/data/units';

const DAYS = 60;
const START = '2026-07-04';

// Each lineup is buildable within the 12-scrap daily budget (no relics,
// no rerolls assumed) so strategies are compared on equal footing.
const STRATEGIES: Record<string, Lineup> = {
  swarm: {
    units: [
      { defId: 'rat-piper' },
      { defId: 'brood-mother' },
      { defId: 'brood-mother' },
      { defId: 'gutter-runt' },
      { defId: 'gutter-runt' },
    ],
  },
  plague: {
    units: [
      { defId: 'plague-bearer' },
      { defId: 'blight-witch' },
      { defId: 'plague-bearer' },
      { defId: 'blight-witch' },
      { defId: 'gutter-runt' },
    ],
  },
  sacrifice: {
    units: [
      { defId: 'gnawer' },
      { defId: 'corpse-glutton' },
      { defId: 'gnawer' },
      { defId: 'corpse-glutton' },
      { defId: 'gutter-runt' },
    ],
  },
  bruiser: {
    units: [
      { defId: 'dire-rat' },
      { defId: 'dire-rat' },
      { defId: 'warren-warden' },
      { defId: 'gutter-runt' },
    ],
  },
  anchor: {
    units: [
      { defId: 'warren-warden' },
      { defId: 'bone-priest' },
      { defId: 'dire-rat' },
      { defId: 'gutter-runt' },
    ],
  },
};

for (const [name, lineup] of Object.entries(STRATEGIES)) {
  const cost = lineup.units.reduce((s, u) => s + UNIT_DEFS[u.defId].cost, 0);
  if (cost > 24) throw new Error(`${name} costs ${cost} > 24 scrap`);
}

const dates: string[] = [];
const base = Date.parse(`${START}T12:00:00Z`);
for (let i = 0; i < DAYS; i++) dates.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));

type Depths = number[];
const overall: Record<string, Depths> = {};
const byTheme: Record<Archetype, Record<string, Depths>> = {
  swarm: {}, brute: {}, armored: {}, plague: {},
};
const themeDays: Record<Archetype, number> = { swarm: 0, brute: 0, armored: 0, plague: 0 };

for (const date of dates) {
  const gauntlet = generateGauntlet(date);
  themeDays[gauntlet.theme.primary]++;
  for (const [name, lineup] of Object.entries(STRATEGIES)) {
    const depth = simulate(lineup, gauntlet).result.wavesCleared;
    (overall[name] ??= []).push(depth);
    (byTheme[gauntlet.theme.primary][name] ??= []).push(depth);
  }
}

const avg = (xs: Depths): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = (n: number): string => n.toFixed(2);

console.log(`balance report — ${DAYS} days from ${START}\n`);

console.log('overall depth (waves cleared)');
console.log('strategy   avg    min  max');
for (const [name, depths] of Object.entries(overall)) {
  console.log(
    `${name.padEnd(10)} ${fmt(avg(depths)).padStart(5)}  ${Math.min(...depths).toString().padStart(3)}  ${Math.max(...depths).toString().padStart(3)}`
  );
}

const themes = Object.keys(byTheme) as Archetype[];
console.log(`\navg depth by day theme (days: ${themes.map((t) => `${t} ${themeDays[t]}`).join(', ')})`);
console.log(`strategy   ${themes.map((t) => t.padStart(7)).join('')}`);
for (const name of Object.keys(STRATEGIES)) {
  const cells = themes.map((t) => {
    const d = byTheme[t][name];
    return (d && d.length > 0 ? fmt(avg(d)) : '—').padStart(7);
  });
  console.log(`${name.padEnd(10)} ${cells.join('')}`);
}
