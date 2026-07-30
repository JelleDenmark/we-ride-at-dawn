import { describe, expect, it } from 'vitest';
import { simulateDuel } from '../src/duel';
import { simulate } from '../src/sim';
import { generateGauntlet } from '../src/gauntlet';
import type { Lineup } from '../src/data/units';

const board = (
  units: Lineup['units'],
  extra?: { teamRelicIds?: string[]; combatCap?: number }
): Lineup => ({
  units,
  ...(extra?.teamRelicIds ? { teamRelicIds: extra.teamRelicIds } : {}),
  ...(extra?.combatCap !== undefined ? { combatCap: extra.combatCap } : {}),
});

// A spread of boards, deliberately mixed: mono-stacks, relic carriers, an
// armor wall, thorns, and the two relics whose resolution used to be
// seat-dependent (Gore-Cleaver cleave, Marrow-Snap execute).
const BOARDS: Record<string, Lineup> = {
  soloRat: board([{ defId: 'dire-rat' }]),
  triRat: board([{ defId: 'dire-rat' }, { defId: 'dire-rat' }, { defId: 'dire-rat' }]),
  buffedRat: board([{ defId: 'dire-rat', relicIds: ['rusted-nail'] }]),
  cleaver: board([
    { defId: 'dire-rat', relicIds: ['gore-cleaver'] },
    { defId: 'gnawer' },
    { defId: 'gnawer' },
  ]),
  executioner: board([{ defId: 'dire-rat', relicIds: ['marrow-snap'] }, { defId: 'gnawer' }]),
  wall: board([{ defId: 'ward-weaver', tier: 2 }, { defId: 'ward-weaver' }]),
  thorns: board([{ defId: 'steel-whisker' }, { defId: 'steel-whisker' }]),
  teamBuffed: board([{ defId: 'dire-rat' }, { defId: 'gnawer' }], { teamRelicIds: ['filth-totem'] }),
  // A summoner (Brood-Mother spawns on faint) with a DELIBERATELY tight combat
  // cap. This is what exercises the per-side cap fix: the shared-cap engine
  // would have let this board's cap leak onto its opponent's summons, so its
  // seat would change the OTHER board's outcome. With a per-side cap the
  // seat-swap invariant below must still hold.
  summonerTight: board([{ defId: 'brood-mother', tier: 2 }, { defId: 'gnawer' }], { combatCap: 3 }),
};
const NAMES = Object.keys(BOARDS);

const flip = (w: 'a' | 'b' | 'draw'): 'a' | 'b' | 'draw' =>
  w === 'a' ? 'b' : w === 'b' ? 'a' : 'draw';

describe('simulateDuel — determinism & structure', () => {
  it('is byte-identical across repeated runs', () => {
    const a = BOARDS.triRat;
    const b = BOARDS.cleaver;
    const r1 = simulateDuel(a, b);
    const r2 = simulateDuel(a, b);
    expect(JSON.stringify(r1.events)).toBe(JSON.stringify(r2.events));
    expect(r1.result).toEqual(r2.result);
  });

  it('is exactly one wave — no gauntlet escalation', () => {
    const { events } = simulateDuel(BOARDS.triRat, BOARDS.soloRat);
    expect(events.filter((e) => e.type === 'waveStart')).toHaveLength(1);
    expect(events[0].type).toBe('battleStart');
    expect(events.at(-1)?.type).toBe('battleEnd');
  });

  it('does not mutate its inputs', () => {
    const a = BOARDS.cleaver;
    const b = BOARDS.wall;
    const beforeA = JSON.stringify(a);
    const beforeB = JSON.stringify(b);
    simulateDuel(a, b);
    expect(JSON.stringify(a)).toBe(beforeA);
    expect(JSON.stringify(b)).toBe(beforeB);
  });
});

describe('simulateDuel — outcomes', () => {
  it('a bigger board beats a lone rat, and the loser has no survivors', () => {
    const { result } = simulateDuel(BOARDS.triRat, BOARDS.soloRat);
    expect(result.winner).toBe('a');
    expect(result.survivorsB).toHaveLength(0);
    expect(result.survivorsA.length).toBeGreaterThan(0);
    expect(result.healthA).toBeGreaterThan(result.healthB);
  });

  it('a relic makes an otherwise-even matchup win', () => {
    // dire-rat vs dire-rat is a mirror (draw); +2 attack breaks it.
    expect(simulateDuel(BOARDS.soloRat, BOARDS.soloRat).result.winner).toBe('draw');
    expect(simulateDuel(BOARDS.buffedRat, BOARDS.soloRat).result.winner).toBe('a');
  });
});

describe('simulateDuel — mirror symmetry (a true mirror always draws)', () => {
  it('every board mirrored against itself draws with equal survivors', () => {
    for (const name of NAMES) {
      const { result } = simulateDuel(BOARDS[name], BOARDS[name]);
      expect(result.winner, `${name} vs itself`).toBe('draw');
      expect(result.healthA, `${name} health symmetry`).toBe(result.healthB);
      expect(result.survivorsA.length).toBe(result.survivorsB.length);
    }
  });

  it('a Gore-Cleaver mirror still draws (the seat-fairness regression)', () => {
    // This is the exact bug the engine port fixed: cleaveOverkill used to fire
    // only for the horde seat, so two identical Gore-Cleaver boards would NOT
    // draw — the seat-A board cleaved and seat-B did not. Now mirrored.
    const { result } = simulateDuel(BOARDS.cleaver, BOARDS.cleaver);
    expect(result.winner).toBe('draw');
    expect(result.healthA).toBe(result.healthB);
  });
});

describe('simulateDuel — seat fairness (winner is a property of the boards)', () => {
  it('swapping seats mirrors the winner for every pairing', () => {
    // The definitive seat-fairness check. If any relic still resolved for only
    // one seat (the cleaveOverkill/Marrow-Snap bug), a pairing that includes
    // the cleaver or executioner board would break this — the winner would
    // depend on which seat it sat in, not on the matchup.
    for (let i = 0; i < NAMES.length; i++) {
      for (let j = 0; j < NAMES.length; j++) {
        const a = BOARDS[NAMES[i]];
        const b = BOARDS[NAMES[j]];
        const ab = simulateDuel(a, b).result;
        const ba = simulateDuel(b, a).result;
        expect(ba.winner, `${NAMES[i]} vs ${NAMES[j]}`).toBe(flip(ab.winner));
        // Health margins swap seats too.
        expect(ba.healthA).toBe(ab.healthB);
        expect(ba.healthB).toBe(ab.healthA);
      }
    }
  });
});

describe('engine port — gauntlet path unaffected', () => {
  it('simulate() still runs the full PvE gauntlet', () => {
    const { result } = simulate(
      board([{ defId: 'dire-rat', tier: 2 }, { defId: 'gnawer' }]),
      generateGauntlet('2026-07-03')
    );
    expect(result.wavesCleared).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeGreaterThanOrEqual(result.wavesCleared * 100);
  });
});
