import type { Archetype } from './data/units';
import type { Gauntlet } from './gauntlet';

export interface ScoutHint {
  archetype: Archetype;
  /** 1-based wave from which this threat ramps up; absent = all day. */
  fromWave?: number;
}

export interface ScoutReport {
  date: string;
  hints: ScoutHint[];
  flavor: string;
}

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  swarm: 'swarm',
  brute: 'brutes',
  armored: 'armored',
  plague: 'plague',
};

const PRIMARY_FLAVOR: Record<Archetype, string> = {
  swarm: 'The watch has emptied its barracks — bodies beyond counting.',
  brute: 'Something big paces behind the grates.',
  armored: 'Iron-shod defenders hold the tunnels.',
  plague: 'The drains smell of sickness.',
};

const SECONDARY_FLAVOR: Record<Archetype, (gate: string) => string> = {
  swarm: (gate) => `More boots muster past the ${gate} gate.`,
  brute: (gate) => `Past the ${gate} gate, something heavy drags its knuckles.`,
  armored: (gate) => `Heavy armor musters past the ${gate} gate.`,
  plague: (gate) => `Deeper down, past the ${gate} gate, the air turns foul.`,
};

const ORDINALS = [
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
];

/**
 * Derived from the gauntlet's own theme, so the report is truthful by
 * construction: it names the archetypes the generator actually favored.
 */
export function scoutReport(gauntlet: Gauntlet): ScoutReport {
  const { primary, secondary, pivotWave } = gauntlet.theme;
  const gate = ORDINALS[pivotWave - 1] ?? `${pivotWave}th`;
  return {
    date: gauntlet.date,
    hints: [{ archetype: primary }, { archetype: secondary, fromWave: pivotWave }],
    flavor: `${PRIMARY_FLAVOR[primary]} ${SECONDARY_FLAVOR[secondary](gate)}`,
  };
}
