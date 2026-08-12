import { describe, expect, it } from 'vitest';
import { roundResultsFor, type BoardRow } from '../scripts/lib/pvp-league';
import type { Lineup } from '../src/data/units';
import { boonsFor, BOON_DEFS, BOON_FIRST_DATE } from '../src/boons';

const b = (device_id: string, name: string, units: Lineup['units']): BoardRow => ({
  device_id,
  name,
  board: { units },
});

const soloRat: Lineup['units'] = [{ defId: 'dire-rat' }];
const triRat: Lineup['units'] = [{ defId: 'dire-rat' }, { defId: 'dire-rat' }, { defId: 'dire-rat' }];

describe('roundResultsFor (pure nightly transform)', () => {
  it('produces one result row per legal board, in standings order', () => {
    const boards = [
      b('dev-titan', 'Titan', triRat),
      b('dev-weak-1', 'Weakling One', soloRat),
      b('dev-weak-2', 'Weakling Two', soloRat),
    ];
    const { resultRows, scored, skipped } = roundResultsFor(boards, '2026-08-03', '2026-08-03#2026-08-05');
    expect(skipped).toBe(false);
    expect(scored).toBe(3);
    expect(resultRows).toHaveLength(3);

    // Ordered by standings: the triRat titan tops it.
    expect(resultRows[0].device_id).toBe('dev-titan');
    expect(resultRows[0].points).toBe(6); // 2 wins
    // Names are carried from the board rows, not lost.
    expect(resultRows[0].name).toBe('Titan');
    // Every row is stamped with the round + season for the DB.
    for (const r of resultRows) {
      expect(r.round_id).toBe('2026-08-03#2026-08-05');
      expect(r.season_id).toBe('2026-08-03');
    }
  });

  it('pays the discounted win value on league day 1-2, full value from day 3', () => {
    const boards = [b('a', 'A', triRat), b('c', 'C', soloRat)];
    // 2026-08-03 is a Monday (day 1); 2026-08-05 is a Wednesday (day 3).
    const day1 = roundResultsFor(boards, '2026-08-03', '2026-08-03#2026-08-03');
    const day3 = roundResultsFor(boards, '2026-08-03', '2026-08-03#2026-08-05');
    expect(day1.resultRows.find((r) => r.device_id === 'a')!.points).toBe(2);
    expect(day3.resultRows.find((r) => r.device_id === 'a')!.points).toBe(3);
  });

  it('maps survivorDiff -> survivor_diff (camel to snake) intact', () => {
    const boards = [b('a', 'A', triRat), b('c', 'C', soloRat)];
    const { resultRows } = roundResultsFor(boards, 's', 'r');
    const titan = resultRows.find((r) => r.device_id === 'a')!;
    // triRat beats soloRat with survivors to spare, so its margin is positive.
    expect(titan.survivor_diff).toBeGreaterThan(0);
    // Zero-sum: the two boards' margins cancel.
    const sum = resultRows.reduce((s, r) => s + r.survivor_diff, 0);
    expect(sum).toBe(0);
  });

  it('drops an illegal board and scores the rest', () => {
    const boards = [
      b('good-1', 'Good One', soloRat),
      b('bad', 'Cheater', [{ defId: 'not-a-real-unit' }]),
      b('good-2', 'Good Two', triRat),
    ];
    const { resultRows, scored, dropped } = roundResultsFor(boards, 's', 'r');
    expect(dropped.map((d) => d.device_id)).toEqual(['bad']);
    expect(scored).toBe(2);
    expect(resultRows.map((r) => r.device_id).sort()).toEqual(['good-1', 'good-2']);
  });

  it('skips (writes nothing) when fewer than 2 legal boards exist', () => {
    const lone = roundResultsFor([b('only', 'Lonely', soloRat)], 's', 'r');
    expect(lone.skipped).toBe(true);
    expect(lone.resultRows).toEqual([]);

    const oneLegal = roundResultsFor(
      [b('ok', 'OK', soloRat), b('bad', 'Bad', [{ defId: 'nope' }])],
      's',
      'r'
    );
    expect(oneLegal.skipped).toBe(true);
    expect(oneLegal.scored).toBe(1);
  });

  it('is deterministic — same boards, identical rows twice', () => {
    const boards = [b('a', 'A', triRat), b('b2', 'B', soloRat), b('c', 'C', soloRat)];
    expect(roundResultsFor(boards, 's', 'r')).toEqual(roundResultsFor(boards, 's', 'r'));
  });

  it('snapshots each device\'s exact fielded board onto its result row (issue #158)', () => {
    const boards = [b('a', 'A', triRat), b('c', 'C', soloRat)];
    const { resultRows } = roundResultsFor(boards, 's', 'r');
    const titan = resultRows.find((r) => r.device_id === 'a')!;
    const weakling = resultRows.find((r) => r.device_id === 'c')!;
    expect(titan.board).toEqual({ units: triRat });
    expect(weakling.board).toEqual({ units: soloRat });
  });
});

describe('roundResultsFor — boon picks (issue #184)', () => {
  // Boons are dormant until BOON_FIRST_DATE, so a round dated before it offers
  // nothing and every pick is off-menu. Anchoring on the constant rather than a
  // literal keeps these valid when the launch switch moves.
  const liveDate = BOON_FIRST_DATE;
  const liveRound = `2099-01-01#${liveDate}`;
  const offered = () => boonsFor(liveDate).map((x) => x.id);
  const boards = () => [b('dev-titan', 'Titan', triRat), b('dev-weak', 'Weakling', soloRat)];

  it('nulls boon_id on every row when nobody picked', () => {
    const { resultRows, rejectedPicks } = roundResultsFor(boards(), '2099-01-01', liveRound);
    expect(resultRows).toHaveLength(2);
    for (const r of resultRows) expect(r.boon_id).toBeNull();
    expect(rejectedPicks).toEqual([]);
  });

  it('snapshots an on-menu pick onto the picker row only', () => {
    const pick = offered()[0];
    const { resultRows, rejectedPicks } = roundResultsFor(boards(), '2099-01-01', liveRound, [
      { device_id: 'dev-titan', boon_id: pick },
    ]);
    expect(rejectedPicks).toEqual([]);
    const byId = new Map(resultRows.map((r) => [r.device_id, r.boon_id]));
    expect(byId.get('dev-titan')).toBe(pick);
    // Not picking is a legal state and must stay null, never a default.
    expect(byId.get('dev-weak')).toBeNull();
  });

  it('refuses a real boon that was not on that day menu', () => {
    // The one server-side authority in the boon path: the menu is a pure
    // function of the ride-date, so a pick that was never offered is refused
    // no matter what the client claims.
    const notOffered = Object.keys(BOON_DEFS).filter((id) => !offered().includes(id));
    expect(notOffered.length).toBeGreaterThan(0);
    const { resultRows, rejectedPicks } = roundResultsFor(boards(), '2099-01-01', liveRound, [
      { device_id: 'dev-titan', boon_id: notOffered[0] },
    ]);
    expect(rejectedPicks).toEqual([{ device_id: 'dev-titan', boon_id: notOffered[0] }]);
    // Refused, not punished — the board still rides, just without a boon.
    expect(resultRows).toHaveLength(2);
    for (const r of resultRows) expect(r.boon_id).toBeNull();
  });

  it('refuses an id that is not a boon at all', () => {
    const { rejectedPicks } = roundResultsFor(boards(), '2099-01-01', liveRound, [
      { device_id: 'dev-titan', boon_id: 'not-a-boon' },
    ]);
    expect(rejectedPicks).toHaveLength(1);
  });

  it('ignores a pick from a device that fielded no legal board', () => {
    // Picked, then never fielded anything scoreable. Irrelevant, not a
    // rejection — flagging it would cry wolf every time someone opens the app
    // and never builds.
    const { rejectedPicks, resultRows } = roundResultsFor(boards(), '2099-01-01', liveRound, [
      { device_id: 'dev-ghost', boon_id: offered()[0] },
    ]);
    expect(rejectedPicks).toEqual([]);
    for (const r of resultRows) expect(r.boon_id).toBeNull();
  });

  it('refuses every pick on a round dated before boons exist', () => {
    // Guards the dormancy: while BOON_FIRST_DATE is in the future, no round
    // can honour a pick even if one somehow reaches the table.
    const { rejectedPicks } = roundResultsFor(boards(), '2026-08-03', '2026-08-03#2026-08-05', [
      { device_id: 'dev-titan', boon_id: Object.keys(BOON_DEFS)[0] },
    ]);
    expect(rejectedPicks).toHaveLength(1);
  });
});
