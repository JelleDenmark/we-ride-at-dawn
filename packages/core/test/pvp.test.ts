import { describe, expect, it } from 'vitest';
import {
  scoreRound,
  validateBoard,
  legalEntrants,
  consolationScrap,
  LOSS_CONSOLATION_DEFAULT,
} from '../src/pvp';
import type { LeagueEntrant } from '../src/pvp';
import { BOARD_CAP } from '../src/sim';
import type { Lineup } from '../src/data/units';

const board = (
  units: Lineup['units'],
  extra?: { teamRelicIds?: string[]; combatCap?: number }
): Lineup => ({
  units,
  ...(extra?.teamRelicIds ? { teamRelicIds: extra.teamRelicIds } : {}),
  ...(extra?.combatCap !== undefined ? { combatCap: extra.combatCap } : {}),
});

// Grounded in duel.test.ts's own confirmed facts (not re-derived here):
//   - `soloRat` (one dire-rat) mirrored against itself draws.
//   - `triRat` (three dire-rats) beats `soloRat`: winner 'a', survivorsB is
//     empty, healthA > healthB.
//   - seat-swapping any pairing mirrors the winner and swaps the health
//     margin (`ba.healthA === ab.healthB`), i.e. a duel's outcome is a
//     property of the two boards, not of which array index calls it "a".
// Every scoreRound assertion below leans on these already-proven properties
// instead of a fresh (unverifiable, since we cannot run the engine here)
// guess about combat math.
const soloRat: Lineup = board([{ defId: 'dire-rat' }]);
const triRat: Lineup = board([{ defId: 'dire-rat' }, { defId: 'dire-rat' }, { defId: 'dire-rat' }]);

describe('scoreRound — determinism', () => {
  it('same entrants score identically across repeated calls', () => {
    const entrants: LeagueEntrant[] = [
      { id: 'titan', board: triRat },
      { id: 'weakling-1', board: soloRat },
      { id: 'weakling-2', board: soloRat },
    ];
    const first = scoreRound(entrants);
    const second = scoreRound(entrants);
    expect(second).toEqual(first);
  });
});

describe('scoreRound — dominance', () => {
  it('a strictly dominant board tops the table; the weakest boards bottom it', () => {
    // titan (triRat) beats both weaklings (soloRat, confirmed losers to
    // triRat); the two weaklings are an exact mirror of each other, so they
    // draw their own game and tie for last.
    const entrants: LeagueEntrant[] = [
      { id: 'titan', board: triRat },
      { id: 'weakling-1', board: soloRat },
      { id: 'weakling-2', board: soloRat },
    ];
    const standings = scoreRound(entrants);

    expect(standings[0].id).toBe('titan');
    expect(standings[0].points).toBe(6); // 2 wins * 3
    expect(standings[0].wins).toBe(2);
    expect(standings[0].losses).toBe(0);
    // triRat's survivor health always exceeds soloRat's (duel.test.ts fact),
    // so titan's cumulative margin across both duels is strictly positive.
    expect(standings[0].survivorDiff).toBeGreaterThan(0);

    // Both weaklings tie on points (1 draw + 1 loss = 1 point each) and on
    // survivorDiff (symmetric loss to titan, 0 from their own mirror), so
    // they occupy the bottom two slots, ordered only by id.
    const last = standings[standings.length - 1];
    const secondLast = standings[standings.length - 2];
    expect([last.id, secondLast.id].sort()).toEqual(['weakling-1', 'weakling-2']);
    for (const s of [last, secondLast]) {
      expect(s.points).toBe(1);
      expect(s.wins).toBe(0);
      expect(s.draws).toBe(1);
      expect(s.losses).toBe(1);
    }
    expect(standings[0].points).toBeGreaterThan(last.points);
  });
});

describe('scoreRound — points math', () => {
  it('N entrants on mirror boards: everyone draws every game, so points = (N - 1) * 1', () => {
    const N = 5;
    const entrants: LeagueEntrant[] = Array.from({ length: N }, (_, i) => ({
      id: `mirror-${i}`,
      board: soloRat,
    }));
    const standings = scoreRound(entrants);

    expect(standings).toHaveLength(N);
    for (const s of standings) {
      expect(s.wins).toBe(0);
      expect(s.losses).toBe(0);
      expect(s.draws).toBe(N - 1);
      expect(s.points).toBe((N - 1) * 1);
      // A mirror duel has healthA === healthB (duel.test.ts fact), so every
      // one of this entrant's (N - 1) duels contributes exactly 0 margin.
      expect(s.survivorDiff).toBe(0);
    }
  });
});

describe('scoreRound — order independence', () => {
  it('shuffling entrant order never changes who beat whom, only how ties print', () => {
    const strong: LeagueEntrant = { id: 'strong', board: triRat };
    const delta: LeagueEntrant = { id: 'delta', board: soloRat };
    const foxtrot: LeagueEntrant = { id: 'foxtrot', board: soloRat };

    const orderA = [strong, delta, foxtrot];
    const orderB = [foxtrot, strong, delta];
    const orderC = [delta, foxtrot, strong];

    const standingsA = scoreRound(orderA);
    const standingsB = scoreRound(orderB);
    const standingsC = scoreRound(orderC);

    // 'delta' and 'foxtrot' are an exact mirror pair, so every scoring field
    // ties between them; the id tiebreak ('delta' < 'foxtrot') then makes the
    // FULL standings order identical no matter which order the entrants were
    // submitted in — the array position they were passed in carries no
    // information once identity-keyed stats are computed.
    const idsA = standingsA.map((s) => s.id);
    const idsB = standingsB.map((s) => s.id);
    const idsC = standingsC.map((s) => s.id);
    expect(idsA).toEqual(['strong', 'delta', 'foxtrot']);
    expect(idsB).toEqual(idsA);
    expect(idsC).toEqual(idsA);

    // The specific pairwise head-to-heads are stable across all three
    // shufflings: strong beats both weaklings, delta and foxtrot draw each
    // other. This is what "order independence of the winner" actually means
    // — the per-entrant win/loss/draw tallies (which fully encode every
    // head-to-head result in a round robin) must not depend on array order.
    for (const standings of [standingsA, standingsB, standingsC]) {
      const byId = Object.fromEntries(standings.map((s) => [s.id, s]));
      expect(byId.strong.wins).toBe(2);
      expect(byId.strong.losses).toBe(0);
      expect(byId.delta.draws).toBe(1);
      expect(byId.delta.wins).toBe(0);
      expect(byId.delta.losses).toBe(1);
      expect(byId.foxtrot.draws).toBe(1);
      expect(byId.foxtrot.wins).toBe(0);
      expect(byId.foxtrot.losses).toBe(1);
    }
  });
});

describe('validateBoard', () => {
  it('accepts a normal WRAD board (tiers + a unit relic + a team relic)', () => {
    const normal = board(
      [
        { defId: 'dire-rat', tier: 2, relicIds: ['rusted-nail'] },
        { defId: 'gnawer' },
        { defId: 'brood-mother', tier: 3 },
      ],
      { teamRelicIds: ['filth-totem'] }
    );
    expect(validateBoard(normal)).toEqual({ ok: true });
  });

  it('rejects more than BOARD_CAP units', () => {
    const tooMany = board(
      Array.from({ length: BOARD_CAP + 1 }, () => ({ defId: 'dire-rat' }))
    );
    const result = validateBoard(tooMany);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too many units/);
  });

  it('rejects an out-of-range tier', () => {
    const badTier = board([{ defId: 'dire-rat', tier: 4 }]);
    const result = validateBoard(badTier);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/tier/);
  });

  it('rejects an unknown unit defId', () => {
    const badUnit = board([{ defId: 'not-a-real-unit' }]);
    const result = validateBoard(badUnit);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown unit/);
  });

  it('rejects a summon-only body (cost 0) as a board entry', () => {
    const summonOnly = board([{ defId: 'pup' }]);
    const result = validateBoard(summonOnly);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/summon-only/);
  });

  it('rejects the same unit relic carried twice by one unit', () => {
    const dupeRelic = board([{ defId: 'dire-rat', relicIds: ['rusted-nail', 'rusted-nail'] }]);
    const result = validateBoard(dupeRelic);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/more than once/);
  });

  it('rejects a team-scope relic equipped in a unit relic slot', () => {
    const wrongScope = board([{ defId: 'dire-rat', relicIds: ['filth-totem'] }]);
    const result = validateBoard(wrongScope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a unit relic/);
  });

  it('rejects a unit-scope relic in the team relic list (symmetric check)', () => {
    const wrongScope = board([{ defId: 'dire-rat' }], { teamRelicIds: ['rusted-nail'] });
    const result = validateBoard(wrongScope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a team relic/);
  });

  it('rejects a duplicate team relic id', () => {
    const dupeTeam = board([{ defId: 'dire-rat' }], { teamRelicIds: ['filth-totem', 'filth-totem'] });
    const result = validateBoard(dupeTeam);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/duplicate team relic/);
  });
});

describe('legalEntrants', () => {
  it('drops illegal boards and keeps the rest, preserving order', () => {
    const good1: LeagueEntrant = { id: 'good-1', board: soloRat };
    const bad: LeagueEntrant = { id: 'bad', board: board([{ defId: 'not-a-real-unit' }]) };
    const good2: LeagueEntrant = { id: 'good-2', board: triRat };

    const result = legalEntrants([good1, bad, good2]);
    expect(result.map((e) => e.id)).toEqual(['good-1', 'good-2']);
  });
});

describe('consolationScrap — loss-consolation payout', () => {
  it('pays flat per loss (scales with count, not margin)', () => {
    expect(consolationScrap(0, 6)).toBe(0);
    expect(consolationScrap(1, 6)).toBe(6);
    expect(consolationScrap(3, 6)).toBe(18);
    expect(consolationScrap(5, 6)).toBe(30);
  });

  it('is linear in losses — 5 one-loss payouts equal one 5-loss payout', () => {
    const perLoss = LOSS_CONSOLATION_DEFAULT;
    const five = consolationScrap(5, perLoss);
    const oneByOne = Array.from({ length: 5 }, () => consolationScrap(1, perLoss)).reduce(
      (a, b) => a + b,
      0
    );
    expect(five).toBe(oneByOne);
  });

  it('a zero payout config disables the lever entirely', () => {
    expect(consolationScrap(5, 0)).toBe(0);
  });

  it('clamps negative inputs and floors fractional ones to a non-negative integer', () => {
    expect(consolationScrap(-3, 6)).toBe(0);
    expect(consolationScrap(3, -6)).toBe(0);
    expect(consolationScrap(2.9, 6)).toBe(12); // 2 losses * 6
    expect(consolationScrap(3, 6.9)).toBe(18); // 3 losses * 6
    expect(Number.isInteger(consolationScrap(3, 6))).toBe(true);
  });
});
