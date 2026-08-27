import { describe, expect, it } from 'vitest';
import {
  newBuild,
  buyUnit,
  buyRelic,
  unequipRelic,
  hasValidRelicTarget,
  MAX_RELICS_PER_UNIT,
  RELIC_DEFS,
  type BuildState,
} from '../src';

/**
 * Per-carrier relic cap (#195) and single-relic sell (#194).
 *
 * These ship together on purpose — see `MAX_RELICS_PER_UNIT`'s doc comment in
 * shop.ts for why the cap exists at all (league standings were tracking relic
 * COUNT rather than board quality, and every simulated season ended with all
 * eight board slots at 4-5 relics).
 *
 * The cap has THREE enforcement points and a leak in any one of them defeats
 * the whole change, so each gets its own test below: the buy path, the
 * "can anything still take this?" UI gate, and — the easy one to miss — the
 * merge union, where three legally-capped rats pool their trinkets into one.
 */

const must = (r: ReturnType<typeof buyRelic>): BuildState => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.state;
};

/** Unit-scoped relic ids, in a stable order, for filling a rat to the cap. */
const unitRelicIds = Object.values(RELIC_DEFS)
  .filter((r) => r.scope === 'unit')
  .map((r) => r.id);

const withBoard = (board: BuildState['board'], relicId: string): BuildState => {
  const base = newBuild('2026-07-03');
  return {
    ...base,
    scrap: 999,
    board,
    shop: {
      ...base.shop,
      slots: [{ kind: 'relic' as const, relicId }, ...base.shop.slots.slice(1)],
    },
  };
};

describe('per-unit relic cap (#195)', () => {
  it('there are enough unit relics for the cap to actually bind', () => {
    // Guards against a vacuous suite: if the relic pool ever shrank below the
    // cap, every test here would pass without exercising anything.
    expect(unitRelicIds.length).toBeGreaterThan(MAX_RELICS_PER_UNIT);
  });

  it('buyRelic refuses a rat already at the cap, but allows one below it', () => {
    const atCap = unitRelicIds.slice(0, MAX_RELICS_PER_UNIT);
    const spare = unitRelicIds[MAX_RELICS_PER_UNIT];
    const s = withBoard(
      [
        { defId: 'dire-rat', tier: 1, relicIds: [...atCap] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      spare
    );
    const full = buyRelic(s, 0, 0);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toContain(String(MAX_RELICS_PER_UNIT));
    // The same relic on a rat with room is fine — the cap is per carrier, not
    // per board.
    expect(buyRelic(s, 0, 1).ok).toBe(true);
  });

  it('the duplicate rule still wins over the cap message for a rat with room', () => {
    // Ordering matters for the error a player sees: a rat holding one relic
    // and re-offered that same relic should be told it's a duplicate, not that
    // it is full (it isn't).
    const s = withBoard(
      [{ defId: 'dire-rat', tier: 1, relicIds: [unitRelicIds[0]] }],
      unitRelicIds[0]
    );
    const r = buyRelic(s, 0, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('already carries one');
  });

  it('hasValidRelicTarget goes false once every rat is full', () => {
    // The UI gate. Without this, the shop arms "pick a rat to carry it" and
    // then rejects every choice — the soft-lock this helper exists to prevent.
    const atCap = unitRelicIds.slice(0, MAX_RELICS_PER_UNIT);
    const spare = unitRelicIds[MAX_RELICS_PER_UNIT];
    const full = withBoard(
      [
        { defId: 'dire-rat', tier: 1, relicIds: [...atCap] },
        { defId: 'bone-priest', tier: 1, relicIds: [...atCap] },
      ],
      spare
    );
    expect(hasValidRelicTarget(full, spare)).toBe(false);

    const roomy = withBoard(
      [
        { defId: 'dire-rat', tier: 1, relicIds: [...atCap] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      spare
    );
    expect(hasValidRelicTarget(roomy, spare)).toBe(true);
  });

  it('merging capped rats clamps the union and refunds the overflow', () => {
    // The back door: rats each legally at the cap pool their trinkets on merge.
    // Un-clamped, the ★2 walks out holding all of them.
    //
    // Driven through `buyUnit` rather than the merge helper directly —
    // `combineAll` is module-private, and going through the real purchase path
    // is what a player actually does anyway (place the third copy, merge
    // resolves automatically).
    const a = unitRelicIds.slice(0, MAX_RELICS_PER_UNIT);
    const b = unitRelicIds.slice(MAX_RELICS_PER_UNIT, MAX_RELICS_PER_UNIT * 2);
    const distinct = new Set([...a, ...b]).size;
    expect(distinct).toBeGreaterThan(MAX_RELICS_PER_UNIT); // the clamp must bind

    const base = newBuild('2026-07-03');
    const s: BuildState = {
      ...base,
      scrap: 999,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [...a] },
        { defId: 'dire-rat', tier: 1, relicIds: [...b] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'dire-rat' }, ...base.shop.slots.slice(1)],
      },
    };
    const out = buyUnit(s, 0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    // Three ★1 dire-rats became one ★2.
    expect(out.state.board).toHaveLength(1);
    expect(out.state.board[0].tier).toBe(2);
    expect(out.state.board[0].relicIds.length).toBeLessThanOrEqual(MAX_RELICS_PER_UNIT);

    // Overflow refunded, never silently destroyed. Measured against the SAME
    // merge with bare rats, so the only difference between the two runs is the
    // discarded relics — that delta is the refund.
    const bare: BuildState = {
      ...s,
      board: s.board.map((u) => ({ ...u, relicIds: [] })),
    };
    const bareOut = buyUnit(bare, 0);
    expect(bareOut.ok).toBe(true);
    if (!bareOut.ok) return;
    const dropped = distinct - MAX_RELICS_PER_UNIT;
    const expectedRefund = [...a, ...b]
      .slice(MAX_RELICS_PER_UNIT)
      .slice(0, dropped)
      .reduce((sum, id) => sum + Math.max(1, Math.floor(RELIC_DEFS[id].cost / 2)), 0);
    expect(out.state.scrap - bareOut.state.scrap).toBe(expectedRefund);
  });
});

describe('sell a single relic (#194)', () => {
  it('removes just that relic, keeps the rat, and refunds scrap', () => {
    const [first, second] = unitRelicIds;
    const base = newBuild('2026-07-03');
    const s: BuildState = {
      ...base,
      scrap: 0,
      board: [{ defId: 'dire-rat', tier: 2, relicIds: [first, second] }],
    };
    const out = unequipRelic(s, 0, first);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.board).toHaveLength(1);
    expect(out.state.board[0].tier).toBe(2); // the rat itself is untouched
    expect(out.state.board[0].relicIds).toEqual([second]);
    expect(out.state.scrap).toBeGreaterThan(0);
  });

  it('frees a slot so a capped rat can take something else', () => {
    // The whole point of pairing #194 with #195: without this, a second pin
    // made on day 2 is locked in for the rest of the week.
    const atCap = unitRelicIds.slice(0, MAX_RELICS_PER_UNIT);
    const spare = unitRelicIds[MAX_RELICS_PER_UNIT];
    const s = withBoard([{ defId: 'dire-rat', tier: 1, relicIds: [...atCap] }], spare);
    expect(buyRelic(s, 0, 0).ok).toBe(false);

    const freed = unequipRelic(s, 0, atCap[0]);
    expect(freed.ok).toBe(true);
    if (!freed.ok) return;
    expect(buyRelic(freed.state, 0, 0).ok).toBe(true);
  });

  it('rejects an empty slot and a relic the rat is not carrying', () => {
    const base = newBuild('2026-07-03');
    const s: BuildState = {
      ...base,
      board: [{ defId: 'dire-rat', tier: 1, relicIds: [unitRelicIds[0]] }],
    };
    expect(unequipRelic(s, 5, unitRelicIds[0]).ok).toBe(false);
    expect(unequipRelic(s, 0, unitRelicIds[1]).ok).toBe(false);
  });

  it('does not mutate the state it was given', () => {
    // Every other action in shop.ts clones; a leak here would corrupt undo
    // and the lookahead policy in balance:realistic alike.
    const base = newBuild('2026-07-03');
    const s: BuildState = {
      ...base,
      board: [{ defId: 'dire-rat', tier: 1, relicIds: [unitRelicIds[0]] }],
    };
    unequipRelic(s, 0, unitRelicIds[0]);
    expect(s.board[0].relicIds).toEqual([unitRelicIds[0]]);
  });
});
