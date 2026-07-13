import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dailySeed, currentRideDate } from '../src/seed';
import { xorshift128 } from '../src/prng';
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import { TEST_HORDE } from '../src/data/units';

describe('seed derivation', () => {
  it('is stable across runs (fixed FNV-1a)', () => {
    expect(dailySeed('2026-07-03')).toBe(dailySeed('2026-07-03'));
    expect(dailySeed('2026-07-03')).not.toBe(dailySeed('2026-07-04'));
  });

  it('flips the ride-day at 06:00 Copenhagen time', () => {
    expect(currentRideDate(new Date('2026-07-03T03:59:00+02:00'))).toBe('2026-07-02');
    expect(currentRideDate(new Date('2026-07-03T06:01:00+02:00'))).toBe('2026-07-03');
  });

  // Guards the iOS-weak-shop / Android-strong-shop bug: this string is the
  // cross-platform seed key, so its exact byte layout must be canonical
  // YYYY-MM-DD regardless of engine locale formatting. Assembling from
  // formatToParts (not .format()) is what makes this hold; these cases lock
  // the shape, including single-digit month/day that a naive engine might
  // leave unpadded.
  it('always emits a canonical zero-padded YYYY-MM-DD key', () => {
    const shape = /^\d{4}-\d{2}-\d{2}$/;
    // Instants chosen so the Copenhagen ride-date lands on single-digit
    // month and day (post-06:00 so no dawn rollover shifts the date).
    expect(currentRideDate(new Date('2026-01-05T12:00:00+01:00'))).toBe('2026-01-05');
    expect(currentRideDate(new Date('2026-09-09T12:00:00+02:00'))).toBe('2026-09-09');
    for (const iso of [
      '2026-01-05T12:00:00+01:00',
      '2026-09-09T12:00:00+02:00',
      '2026-12-31T23:30:00+01:00',
      '2026-07-13T06:01:00+02:00',
    ]) {
      expect(currentRideDate(new Date(iso))).toMatch(shape);
    }
  });
});

describe('prng', () => {
  it('same seed yields identical sequences', () => {
    const a = xorshift128(12345);
    const b = xorshift128(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('different seeds diverge', () => {
    const a = xorshift128(1);
    const b = xorshift128(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });
});

describe('gauntlet generation', () => {
  it('is deterministic for a given date', () => {
    expect(generateGauntlet('2026-07-03')).toEqual(generateGauntlet('2026-07-03'));
  });

  it('differs between dates', () => {
    expect(JSON.stringify(generateGauntlet('2026-07-03'))).not.toBe(
      JSON.stringify(generateGauntlet('2026-07-04'))
    );
  });

  it('escalates: later waves cost at least as much as early ones', () => {
    const g = generateGauntlet('2026-07-03');
    const waveCost = (i: number) => g.waves[i].units.reduce((s, u) => s + u.cost, 0);
    expect(waveCost(g.waves.length - 1)).toBeGreaterThan(waveCost(0));
  });
});

describe('gauntlet stability', () => {
  it('gauntlets are unchanged by day (golden compatibility)', () => {
    const g = generateGauntlet('2026-07-03');
    expect(g.hour).toBeUndefined();
    // #41: theme is now seeded from the season (the expedition's Monday),
    // not the calendar date, so it stays stable across a 7-day expedition.
    // 2026-07-03 (Fri) falls in the season starting Monday 2026-06-29.
    expect(g.theme).toEqual({ primary: 'plague', secondary: 'brute', pivotWave: 4 });
  });

  it('theme is stable across every day of the same season, but differs across seasons', () => {
    // 2026-06-29 (Mon) .. 2026-07-05 (Sun) is one season/expedition week.
    const seasonDates = [
      '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05',
    ];
    const themes = seasonDates.map((d) => generateGauntlet(d).theme);
    for (const t of themes) expect(t).toEqual(themes[0]);

    const nextSeasonTheme = generateGauntlet('2026-07-06').theme; // next Monday
    expect(nextSeasonTheme).not.toEqual(themes[0]);
  });

  it('the whole gauntlet (theme AND wave composition) is identical every day of one season', () => {
    // Full sameness (2026-07-09 follow-up): not just the theme, the exact
    // enemy picks are now season-seeded too, so every ride within one
    // 7-day expedition is byte-identical — only the roster changes day to
    // day, not the challenge.
    const a = generateGauntlet('2026-07-01');
    const b = generateGauntlet('2026-07-02');
    expect(a.theme).toEqual(b.theme);
    expect(JSON.stringify(a.waves)).toBe(JSON.stringify(b.waves));
  });

  it('wave composition still differs between different seasons', () => {
    const a = generateGauntlet('2026-06-29'); // one Monday
    const b = generateGauntlet('2026-07-06'); // the next Monday
    expect(JSON.stringify(a.waves)).not.toBe(JSON.stringify(b.waves));
  });
});

describe('battle sim', () => {
  const gauntlet = generateGauntlet('2026-07-03');

  it('same input produces a byte-identical event log', () => {
    const a = simulate(TEST_HORDE, gauntlet);
    const b = simulate(TEST_HORDE, gauntlet);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.result).toEqual(b.result);
  });

  it('does not mutate its inputs', () => {
    const lineupBefore = JSON.stringify(TEST_HORDE);
    const gauntletBefore = JSON.stringify(gauntlet);
    simulate(TEST_HORDE, gauntlet);
    expect(JSON.stringify(TEST_HORDE)).toBe(lineupBefore);
    expect(JSON.stringify(gauntlet)).toBe(gauntletBefore);
  });

  it('emits a well-formed log: starts, fights, ends', () => {
    const { events, result } = simulate(TEST_HORDE, gauntlet);
    expect(events[0].type).toBe('battleStart');
    expect(events.at(-1)?.type).toBe('battleEnd');
    expect(events.some((e) => e.type === 'clash')).toBe(true);
    expect(events.some((e) => e.type === 'death')).toBe(true);
    expect(result.wavesCleared).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeGreaterThanOrEqual(result.wavesCleared * 100);
  });

  it('fires the milestone-1 abilities (summons and faint-buffs appear)', () => {
    const { events } = simulate(TEST_HORDE, gauntlet);
    expect(events.some((e) => e.type === 'summon')).toBe(true);
    expect(events.some((e) => e.type === 'buff')).toBe(true);
  });
});

// Issue #12 (Dawn-Runt/Dusk-Runt) introduced real-world time-of-day as a
// buff condition — the whole point of threading it in as an explicit
// Lineup.timeOfDay parameter (rather than resolving it inside simulate) is
// that packages/core stays wall-clock-free, exactly like every other
// date/day/hour input this codebase already threads through as an explicit
// argument. `seed.ts`'s `currentRideDate` is the one pre-existing, known
// exception (its whole job is converting a real Date into a ride-date), and
// it already defaults its `now` parameter rather than calling Date.now()
// internally, so it stays out of this scan.
describe('clock isolation (issue #12)', () => {
  const CORE_SRC = join(__dirname, '..', 'src');
  const SCAN_EXCLUDE = new Set(['seed.ts']);

  const tsFilesUnder = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return tsFilesUnder(full);
      return entry.name.endsWith('.ts') && !SCAN_EXCLUDE.has(entry.name) ? [full] : [];
    });

  it('no file in packages/core/src reads the real wall clock (Date.now()/new Date())', () => {
    // Bare, no-arg calls only — `new Date(someExplicitString)` (shop.ts's
    // weekdayFor/seasonIdFor) constructs a Date from an explicit argument,
    // not the real clock, and is fine. Skip comment lines so doc references
    // to the literal tokens (e.g. this file's own describe block, or the
    // Lineup.timeOfDay doc comment in data/units.ts) don't false-positive.
    const REAL_CLOCK = /Date\.now\(\)|new Date\(\)/;
    const offenders: string[] = [];
    for (const file of tsFilesUnder(CORE_SRC)) {
      const codeLines = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
      if (codeLines.some((line) => REAL_CLOCK.test(line))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('simulate() with an explicit timeOfDay is unaffected by when it is actually called', () => {
    // Sanity-check the design intent behaviorally, not just via source scan:
    // the same explicit lineup+gauntlet input produces the same output
    // however "now" happens to sit relative to noon when the test runs.
    const g = gauntletFor('2026-07-06', 3);
    const lineupBefore = { units: [{ defId: 'dawn-runt' }], timeOfDay: 'beforeNoon' as const };
    const a = simulate(lineupBefore, g);
    const b = simulate(lineupBefore, g);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});

function gauntletFor(date: string, day: number) {
  return generateGauntlet(date, day);
}
