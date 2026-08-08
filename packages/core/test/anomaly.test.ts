import { describe, expect, it } from 'vitest';
import { anomalyFor, ANOMALY_DEFS, ANOMALY_FIRST_SEASON } from '../src/anomaly';
import { generateGauntlet, WAVE_UNIT_CAP } from '../src/gauntlet';

/** Mondays, walking forward from a given one. */
const mondaysFrom = (start: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i * 7);
    return d.toISOString().slice(0, 10);
  });

const SEASONS = mondaysFrom(ANOMALY_FIRST_SEASON, 40);
const maxWaveSize = (waves: { units: unknown[] }[]) =>
  waves.reduce((m, w) => Math.max(m, w.units.length), 0);

describe('anomalyFor', () => {
  it('is a pure function of the season id', () => {
    for (const s of SEASONS.slice(0, 5)) {
      expect(anomalyFor(s)).toBe(anomalyFor(s));
    }
  });

  it('leaves every season before ANOMALY_FIRST_SEASON clean', () => {
    // Includes the re-issue token shape, which keeps the natural Monday as
    // its first 10 chars and must still sort before the cutover.
    for (const s of ['2026-07-06', '2026-07-13', '2026-07-13.2', '2026-07-27']) {
      expect(anomalyFor(s)).toBeNull();
    }
    expect(anomalyFor(ANOMALY_FIRST_SEASON)).not.toBeNull();
  });

  it('draws every anomaly in the pool over a run of seasons', () => {
    // Guards a dead entry: an anomaly that never rolls is content that
    // silently does not exist.
    const drawn = new Set(SEASONS.map((s) => anomalyFor(s)?.id));
    expect(drawn).toEqual(new Set(Object.keys(ANOMALY_DEFS)));
  });

  it('does not hand out the same anomaly every week', () => {
    const firstFive = SEASONS.slice(0, 5).map((s) => anomalyFor(s)?.id);
    expect(new Set(firstFive).size).toBeGreaterThan(1);
  });
});

// The single most important regression check in the anomaly work: a clean
// week must be byte-identical to the pre-anomaly generator, or every golden
// assertion and balance baseline in the repo silently moved.
describe('clean-path byte identity', () => {
  const dates = ['2026-06-29', '2026-07-03', '2026-07-06', '2026-09-09'];

  it('omitting the anomaly argument matches passing null', () => {
    for (const d of dates) {
      expect(JSON.stringify(generateGauntlet(d, 3))).toBe(
        JSON.stringify(generateGauntlet(d, 3, undefined, null))
      );
    }
  });

  it('a clean gauntlet carries no anomalyId and keeps its key order', () => {
    const g = generateGauntlet('2026-07-03');
    expect(g.anomalyId).toBeUndefined();
    expect(Object.keys(g)).toEqual(['date', 'seed', 'theme', 'waves']);
  });

  it('still honours the #41 golden theme for the 2026-06-29 season', () => {
    expect(generateGauntlet('2026-07-03').theme).toEqual({
      primary: 'plague',
      secondary: 'brute',
      pivotWave: 4,
    });
  });
});

describe('anomaly overrides actually change the week', () => {
  // Arbitrary Wednesday. These tests pass the anomaly explicitly rather than
  // going through anomalyFor's ANOMALY_FIRST_SEASON gate, so the date just
  // needs to be a valid season day, not inside the live window.
  const date = '2026-08-05';

  // Grown Past Use (#165 Part 2) is the first SHOP-side anomaly: it sets no
  // `gauntlet` override at all, so `generateGauntlet` is byte-identical to a
  // clean week under it, by design — its promise is enforced in the shop
  // (see the "Grown Past Use" describe block below), not here. The two tests
  // in this block are specifically about gauntlet reshaping, so they only
  // apply to anomalies that set one.
  const gauntletAnomalies = Object.values(ANOMALY_DEFS).filter(
    (a) => Object.keys(a.gauntlet).length > 0
  );

  it('every gauntlet-shaping anomaly produces a gauntlet different from the clean one', () => {
    const cleanWaves = JSON.stringify(generateGauntlet(date, 3).waves);
    for (const anomaly of gauntletAnomalies) {
      const under = generateGauntlet(date, 3, undefined, anomaly);
      expect(JSON.stringify(under.waves)).not.toBe(cleanWaves);
      expect(under.anomalyId).toBe(anomaly.id);
    }
  });

  it('is never a no-op on ANY season, and reshapes most of the week', () => {
    // Checking one date is not enough, and this is not hypothetical: the
    // first cut of Two Warrens (secondary share 0.4, primary left at 0.6)
    // passed the single-date check above while being a complete no-op on 62
    // of 200 seasons — the app would have announced an anomaly and dealt a
    // clean week. An anomaly that sometimes does nothing is worse than no
    // anomaly, because the banner is a promise.
    for (const anomaly of gauntletAnomalies) {
      let noopSeasons = 0;
      let changedWaves = 0;
      for (const s of SEASONS) {
        const clean = generateGauntlet(s, 3).waves;
        const under = generateGauntlet(s, 3, undefined, anomaly).waves;
        const diff = clean.filter((w, i) => JSON.stringify(w) !== JSON.stringify(under[i])).length;
        if (diff === 0) noopSeasons++;
        changedWaves += diff;
      }
      expect(noopSeasons, `${anomaly.name} is a no-op on some seasons`).toBe(0);
      // A floor, not a target: an anomaly that only nudges a couple of waves
      // is not worth a banner either.
      expect(
        changedWaves / SEASONS.length,
        `${anomaly.name} changes too little of the week`
      ).toBeGreaterThan(10);
    }
  });

  it('never changes WHICH archetypes a season fields', () => {
    // Rule 2b: forcing an archetype is a difficulty lever, not a variance
    // lever — measured at up to +7.3 avg waves for a forced swarm week. An
    // anomaly reshapes how the budget is spent, and lets the season keep
    // deciding what it is spent on.
    for (const s of SEASONS) {
      const clean = generateGauntlet(s, 1).theme;
      for (const anomaly of Object.values(ANOMALY_DEFS)) {
        const { theme } = generateGauntlet(s, 1, undefined, anomaly);
        expect(theme.primary).toBe(clean.primary);
        expect(theme.secondary).toBe(clean.secondary);
        expect(theme.primary).not.toBe(theme.secondary);
      }
    }
  });

  it('One Warren commits the week to the season’s own primary', () => {
    // Checked across seasons, not one date: the whole point is that the
    // archetype it commits to varies with the season's roll.
    for (const s of SEASONS.slice(0, 12)) {
      const g = generateGauntlet(s, 3, undefined, ANOMALY_DEFS['one-warren']);
      const all = g.waves.flatMap((w) => w.units);
      const share = all.filter((u) => u.archetype === g.theme.primary).length / all.length;
      const cleanAll = generateGauntlet(s, 3).waves.flatMap((w) => w.units);
      const cleanShare =
        cleanAll.filter((u) => u.archetype === g.theme.primary).length / cleanAll.length;
      expect(share).toBeGreaterThan(cleanShare);
      expect(share).toBeGreaterThan(0.7);
    }
  });

  it('Teeming Dark raises the per-wave body cap by exactly one', () => {
    const clean = generateGauntlet(date, 3);
    const teeming = generateGauntlet(date, 3, undefined, ANOMALY_DEFS['teeming-dark']);
    expect(maxWaveSize(clean.waves)).toBe(WAVE_UNIT_CAP);
    expect(maxWaveSize(teeming.waves)).toBe(WAVE_UNIT_CAP + 1);
  });

  it('Two Warrens musters the secondary from the very first wave', () => {
    const anomaly = ANOMALY_DEFS['two-warrens'];
    const g = generateGauntlet(date, 3, undefined, anomaly);
    expect(g.theme.pivotWave).toBe(1);
    // Clean weeks always open single-archetype (pivot rolls 4–7); this week
    // must not.
    const clean = generateGauntlet(date, 3);
    expect(clean.theme.pivotWave).toBeGreaterThanOrEqual(4);
    const earlySecondary = g.waves
      .slice(0, 3)
      .some((w) => w.units.some((u) => u.archetype === g.theme.secondary));
    expect(earlySecondary).toBe(true);
  });

  it('leaves the wave count and the season seed alone', () => {
    // An anomaly reshapes a week; it does not reseed it or resize it.
    for (const anomaly of Object.values(ANOMALY_DEFS)) {
      const g = generateGauntlet(date, 3, undefined, anomaly);
      expect(g.waves).toHaveLength(generateGauntlet(date, 3).waves.length);
      expect(g.seed).toBe(generateGauntlet(date, 3).seed);
    }
  });
});
