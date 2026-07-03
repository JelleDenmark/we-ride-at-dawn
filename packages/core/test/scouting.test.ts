import { describe, expect, it } from 'vitest';
import { generateGauntlet } from '../src/gauntlet';
import { scoutReport } from '../src/scout';
import { simulate } from '../src/sim';
import type { Archetype } from '../src/data/units';

const datesFrom = (start: string, days: number): string[] => {
  const out: string[] = [];
  const base = Date.parse(`${start}T12:00:00Z`);
  for (let i = 0; i < days; i++) out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  return out;
};

describe('themed gauntlet generation', () => {
  it('theme is deterministic per date and varies across dates', () => {
    expect(generateGauntlet('2026-07-03').theme).toEqual(generateGauntlet('2026-07-03').theme);
    const themes = new Set(datesFrom('2026-07-01', 10).map((d) => JSON.stringify(generateGauntlet(d).theme)));
    expect(themes.size).toBeGreaterThan(1);
  });

  it("the primary archetype dominates the gauntlet's actual spend", () => {
    for (const date of datesFrom('2026-07-01', 20)) {
      const g = generateGauntlet(date);
      const spend: Record<Archetype, number> = { swarm: 0, brute: 0, armored: 0, plague: 0 };
      for (const wave of g.waves) {
        for (const u of wave.units) if (u.archetype) spend[u.archetype] += u.cost;
      }
      const ranked = (Object.keys(spend) as Archetype[]).sort((a, b) => spend[b] - spend[a]);
      expect(ranked.slice(0, 2), `primary not dominant on ${date}`).toContain(g.theme.primary);
    }
  });

  it('the secondary archetype ramps up at the pivot wave', () => {
    for (const date of datesFrom('2026-07-01', 20)) {
      const g = generateGauntlet(date);
      const { secondary, pivotWave } = g.theme;
      const share = (waves: typeof g.waves): number => {
        let match = 0;
        let total = 0;
        for (const wave of waves) {
          for (const u of wave.units) {
            total += u.cost;
            if (u.archetype === secondary) match += u.cost;
          }
        }
        return total === 0 ? 0 : match / total;
      };
      const before = share(g.waves.slice(0, pivotWave - 1));
      const after = share(g.waves.slice(pivotWave - 1));
      expect(after, `secondary did not ramp on ${date}`).toBeGreaterThan(before);
    }
  });
});

describe('scout report', () => {
  it('names the theme archetypes and the pivot wave', () => {
    const g = generateGauntlet('2026-07-03');
    const report = scoutReport(g);
    expect(report.hints[0].archetype).toBe(g.theme.primary);
    expect(report.hints[1].archetype).toBe(g.theme.secondary);
    expect(report.hints[1].fromWave).toBe(g.theme.pivotWave);
    expect(report.flavor.length).toBeGreaterThan(20);
  });

  it('is deterministic', () => {
    expect(scoutReport(generateGauntlet('2026-07-05'))).toEqual(
      scoutReport(generateGauntlet('2026-07-05'))
    );
  });
});

describe('plague enemies vs the horde', () => {
  it('enemy poison ticks on horde units and clears between waves', () => {
    const doctor = {
      id: 'plague-doctor',
      name: 'Plague-Doctor',
      attack: 0,
      health: 1,
      cost: 0,
      ability: {
        trigger: 'startOfBattle' as const,
        effect: { kind: 'poisonFrontEnemy' as const, stacks: 1 },
      },
    };
    const gauntlet = {
      date: 'test',
      seed: 0,
      theme: { primary: 'plague' as const, secondary: 'swarm' as const, pivotWave: 4 },
      waves: [{ units: [doctor] }, { units: [{ id: 'd', name: 'D', attack: 0, health: 5, cost: 0 }] }],
    };
    const { events } = simulate({ units: [{ defId: 'dire-rat' }] }, gauntlet);
    const wave2Start = events.findIndex((e) => e.type === 'waveStart' && e.wave === 2);
    const ticksWave1 = events.slice(0, wave2Start).filter((e) => e.type === 'poisonTick');
    const ticksWave2 = events.slice(wave2Start).filter((e) => e.type === 'poisonTick');
    expect(ticksWave1.length).toBeGreaterThan(0);
    expect(ticksWave2.length).toBe(0);
  });
});
