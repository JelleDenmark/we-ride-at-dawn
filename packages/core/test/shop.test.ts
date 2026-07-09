import { describe, expect, it } from 'vitest';
import {
  newBuild,
  buyUnit,
  buyRelic,
  hasValidRelicTarget,
  sellUnit,
  sellBenchUnit,
  rerollShop,
  autoRerollShop,
  isShopDead,
  toggleFreeze,
  moveUnit,
  benchUnit,
  deployUnit,
  swapWithBench,
  lineupFromBuild,
  advanceAfterDawn,
  boardCapForDay,
  combatCapForDay,
  combatCapForBuild,
  effectiveBoardCap,
  buyBoardSlot,
  nextSlotPrice,
  SLOT_PRICES,
  SEASON_DAYS,
  interestFor,
  weekdayFor,
  seasonIdFor,
  INTEREST_CAP,
  DAILY_SCRAP,
  REROLL_COST,
  BENCH_SIZE,
  type BuildState,
} from '../src/shop';
import { UNIT_DEFS } from '../src/data/units';
import { RELIC_DEFS } from '../src/data/relics';
import { simulate } from '../src/sim';
import { generateGauntlet, difficultyForDay } from '../src/gauntlet';
import { BOARD_CAP } from '../src/sim';

const unitSlot = (s: BuildState): number => s.shop.slots.findIndex((x) => x.kind === 'unit');
const relicSlot = (s: BuildState): number => s.shop.slots.findIndex((x) => x.kind === 'relic');
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error('expected action to succeed');
  return r as Extract<T, { ok: true }>;
};

describe('shop basics', () => {
  it('offerings are deterministic per date and roll', () => {
    expect(newBuild('2026-07-03')).toEqual(newBuild('2026-07-03'));
    expect(newBuild('2026-07-03').shop.slots).not.toEqual(newBuild('2026-07-04').shop.slots);
  });

  it('starts with the daily scrap budget and an empty board', () => {
    const s = newBuild('2026-07-03');
    expect(s.scrap).toBe(DAILY_SCRAP);
    expect(s.board).toEqual([]);
    expect(s.shop.slots).toHaveLength(6);
  });

  it('buying a unit costs scrap, fills the board, empties the slot', () => {
    const s = newBuild('2026-07-03');
    const i = unitSlot(s);
    const slot = s.shop.slots[i];
    const cost = slot.kind === 'unit' ? UNIT_DEFS[slot.defId].cost : 0;
    const after = must(buyUnit(s, i)).state;
    expect(after.scrap).toBe(DAILY_SCRAP - cost);
    expect(after.board).toHaveLength(1);
    expect(after.shop.slots[i]).toEqual({ kind: 'empty' });
  });

  it('rejects a buy without scrap or board space', () => {
    const s = newBuild('2026-07-03');
    const broke = { ...s, scrap: 0 };
    expect(buyUnit(broke, unitSlot(s)).ok).toBe(false);
    const full = {
      ...s,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
    };
    // A full board alone now overflows to the bench, so a real "no room"
    // rejection needs the bench full too.
    expect(buyUnit(full, unitSlot(s)).ok).toBe(true);
    const noRoom = {
      ...full,
      bench: [
        { defId: 'plague-bearer', tier: 1, relicIds: [] },
        { defId: 'warren-warden', tier: 1, relicIds: [] },
        { defId: 'gutter-runt', tier: 1, relicIds: [] },
      ],
    };
    expect(buyUnit(noRoom, unitSlot(s)).ok).toBe(false);
  });

  it('allows a buy from a full board when it completes a combine', () => {
    const base = newBuild('2026-07-03');
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: [] },
        { defId: 'gutter-runt', tier: 1, relicIds: [] },
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const res = buyUnit(s, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.board.length).toBe(4);
      expect(res.state.board.find((u) => u.defId === 'gutter-runt')?.tier).toBe(2);
    }
  });

  it('selling refunds half cost (min 1), scaled by tier', () => {
    const s = {
      ...newBuild('2026-07-03'),
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gutter-runt', tier: 2, relicIds: [] },
      ],
    };
    const afterDire = must(sellUnit(s, 0)).state;
    expect(afterDire.scrap).toBe(DAILY_SCRAP + 4);
    expect(afterDire.board).toHaveLength(1);
    const afterRunt = must(sellUnit(s, 1)).state;
    expect(afterRunt.scrap).toBe(DAILY_SCRAP + 2);
  });

  it('selling a unit with no relics only refunds the unit (unchanged behavior)', () => {
    const s = {
      ...newBuild('2026-07-03'),
      scrap: 20,
      board: [{ defId: 'dire-rat', tier: 1, relicIds: [] }],
    };
    const after = must(sellUnit(s, 0)).state;
    const direRatRefund = Math.max(1, Math.floor(UNIT_DEFS['dire-rat'].cost / 2));
    expect(after.scrap).toBe(20 + direRatRefund);
  });

  it('selling a unit refunds a single pinned relic at half cost, on top of sellRefund', () => {
    const nailCost = RELIC_DEFS['rusted-nail'].cost;
    const s = {
      ...newBuild('2026-07-03'),
      scrap: 20,
      board: [{ defId: 'dire-rat', tier: 1, relicIds: ['rusted-nail'] }],
    };
    const after = must(sellUnit(s, 0)).state;
    const direRatRefund = Math.max(1, Math.floor(UNIT_DEFS['dire-rat'].cost / 2));
    const nailRefund = Math.max(1, Math.floor(nailCost / 2));
    expect(after.board).toHaveLength(0);
    expect(after.scrap).toBe(20 + direRatRefund + nailRefund);
  });

  it('selling a unit carrying multiple relics refunds each of them at half cost', () => {
    const nailCost = RELIC_DEFS['rusted-nail'].cost;
    const charmCost = RELIC_DEFS['tail-charm'].cost;
    const s = {
      ...newBuild('2026-07-03'),
      scrap: 20,
      board: [{ defId: 'dire-rat', tier: 1, relicIds: ['rusted-nail', 'tail-charm'] }],
    };
    const after = must(sellUnit(s, 0)).state;
    const direRatRefund = Math.max(1, Math.floor(UNIT_DEFS['dire-rat'].cost / 2));
    const nailRefund = Math.max(1, Math.floor(nailCost / 2));
    const charmRefund = Math.max(1, Math.floor(charmCost / 2));
    expect(after.scrap).toBe(20 + direRatRefund + nailRefund + charmRefund);
  });

  it('selling a bench unit also refunds its pinned relics', () => {
    const nailCost = RELIC_DEFS['rusted-nail'].cost;
    const s = {
      ...newBuild('2026-07-03'),
      scrap: 20,
      bench: [{ defId: 'dire-rat', tier: 1, relicIds: ['rusted-nail'] }],
    };
    const after = must(sellBenchUnit(s, 0)).state;
    const direRatRefund = Math.max(1, Math.floor(UNIT_DEFS['dire-rat'].cost / 2));
    const nailRefund = Math.max(1, Math.floor(nailCost / 2));
    expect(after.bench).toHaveLength(0);
    expect(after.scrap).toBe(20 + direRatRefund + nailRefund);
  });

  it('reroll costs scrap and keeps frozen slots', () => {
    const s = newBuild('2026-07-03');
    const i = unitSlot(s);
    const frozen = must(toggleFreeze(s, i)).state;
    const rolled = must(rerollShop(frozen)).state;
    expect(rolled.scrap).toBe(DAILY_SCRAP - REROLL_COST);
    expect(rolled.shop.rolls).toBe(1);
    expect(rolled.shop.slots[i]).toEqual(s.shop.slots[i]);
    expect(rolled.shop.frozen[i]).toBe(true);
  });

  it('isShopDead detects when all slots are empty', () => {
    const s = newBuild('2026-07-03');
    expect(isShopDead(s)).toBe(false);
    // Empty all slots manually
    const allEmpty = {
      ...s,
      shop: {
        ...s.shop,
        slots: Array(6).fill({ kind: 'empty' as const }),
      },
    };
    expect(isShopDead(allEmpty)).toBe(true);
  });

  it('autoRerollShop fails if shop is not dead', () => {
    const s = newBuild('2026-07-03');
    expect(autoRerollShop(s).ok).toBe(false);
  });

  it('autoRerollShop rerolls for free when all slots are empty', () => {
    const base = newBuild('2026-07-03');
    const allEmpty = {
      ...base,
      scrap: 5,
      shop: {
        ...base.shop,
        slots: Array(6).fill({ kind: 'empty' as const }),
      },
    };
    const rolled = must(autoRerollShop(allEmpty)).state;
    // No scrap was deducted
    expect(rolled.scrap).toBe(5);
    // rolls counter DOES advance (it's just rollOfferings' seed, not a
    // player-facing count) so a subsequent manual reroll can't collide with
    // this roll number and hand back the same shop
    expect(rolled.shop.rolls).toBe(base.shop.rolls + 1);
    // But the slots should be refreshed (not all empty anymore)
    expect(rolled.shop.slots.some((slot) => slot.kind !== 'empty')).toBe(true);
  });

  it('a manual reroll after an auto-reroll does not repeat the same offerings', () => {
    const base = newBuild('2026-07-03');
    const allEmpty = {
      ...base,
      scrap: 10,
      shop: {
        ...base.shop,
        slots: Array(6).fill({ kind: 'empty' as const }),
      },
    };
    const afterAuto = must(autoRerollShop(allEmpty)).state;
    const afterManual = must(rerollShop(afterAuto)).state;
    expect(afterManual.shop.slots).not.toEqual(afterAuto.shop.slots);
  });

  it('repositioning reorders the board', () => {
    const s = {
      ...newBuild('2026-07-03'),
      board: [
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'dire-rat', tier: 1, relicIds: [] },
      ],
    };
    const moved = must(moveUnit(s, 1, 0)).state;
    expect(moved.board.map((u) => u.defId)).toEqual(['dire-rat', 'gnawer']);
  });
});

describe('relics in the shop', () => {
  it('unit relics need a target, team relics do not', () => {
    const s = {
      ...newBuild('2026-07-03'),
      board: [{ defId: 'dire-rat', tier: 1, relicIds: [] }],
      shop: {
        ...newBuild('2026-07-03').shop,
        slots: [
          { kind: 'relic' as const, relicId: 'rusted-nail' },
          { kind: 'relic' as const, relicId: 'filth-totem' },
          ...newBuild('2026-07-03').shop.slots.slice(2),
        ],
      },
    };
    expect(buyRelic(s, 0).ok).toBe(false);
    const pinned = must(buyRelic(s, 0, 0)).state;
    expect(pinned.board[0].relicIds).toEqual(['rusted-nail']);
    const team = must(buyRelic(s, 1)).state;
    expect(team.teamRelicIds).toEqual(['filth-totem']);
  });

  it('one of each: a rat cannot carry the same relic twice, nor the team', () => {
    const base = newBuild('2026-07-03');
    const s = {
      ...base,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
      ],
      teamRelicIds: ['filth-totem'],
      shop: {
        ...base.shop,
        slots: [
          { kind: 'relic' as const, relicId: 'rusted-nail' },
          { kind: 'relic' as const, relicId: 'filth-totem' },
          ...base.shop.slots.slice(2),
        ],
      },
    };
    // Duplicate on the same rat: rejected; a different rat: fine.
    expect(buyRelic(s, 0, 0).ok).toBe(false);
    expect(buyRelic(s, 0, 1).ok).toBe(true);
    // Duplicate team relic: rejected.
    expect(buyRelic(s, 1).ok).toBe(false);
  });

  it('hasValidRelicTarget (issue #25): false once every board rat already carries it, or the board is empty', () => {
    const base = newBuild('2026-07-03');
    // Empty board — nothing to pin to at all.
    expect(hasValidRelicTarget(base, 'rusted-nail')).toBe(false);
    // One rat, not carrying it yet — valid target.
    const oneBare = { ...base, board: [{ defId: 'dire-rat', tier: 1, relicIds: [] }] };
    expect(hasValidRelicTarget(oneBare, 'rusted-nail')).toBe(true);
    // Every rat already carries it — no valid target left.
    const allCarry = {
      ...base,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gnawer', tier: 1, relicIds: ['rusted-nail'] },
      ],
    };
    expect(hasValidRelicTarget(allCarry, 'rusted-nail')).toBe(false);
    // Mixed: one rat still lacks it — valid target remains.
    const mixed = {
      ...base,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
      ],
    };
    expect(hasValidRelicTarget(mixed, 'rusted-nail')).toBe(true);
  });

  it('an owned team relic leaves the shop and never re-rolls', () => {
    const base = newBuild('2026-07-03');
    let s = {
      ...base,
      scrap: 50,
      teamRelicIds: [] as string[],
      shop: {
        ...base.shop,
        // The same team relic offered in two stalls at once.
        slots: [
          { kind: 'relic' as const, relicId: 'filth-totem' },
          { kind: 'relic' as const, relicId: 'filth-totem' },
          ...base.shop.slots.slice(2),
        ],
      },
    };
    // Buying one clears the sibling stall offering the same team relic.
    s = must(buyRelic(s, 0)).state;
    expect(s.teamRelicIds).toEqual(['filth-totem']);
    expect(s.shop.slots[0]).toEqual({ kind: 'empty' });
    expect(s.shop.slots[1]).toEqual({ kind: 'empty' });
    // And it never returns on later rerolls.
    for (let n = 0; n < 12; n++) {
      s = must(rerollShop({ ...s, scrap: 50 })).state;
      const stillThere = s.shop.slots.some((sl) => sl.kind === 'relic' && sl.relicId === 'filth-totem');
      expect(stillThere).toBe(false);
    }
  });
});

describe('combining', () => {
  it('three of a kind merge into one unit a tier up, keeping relics', () => {
    const base = newBuild('2026-07-03');
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gutter-runt', tier: 1, relicIds: ['tail-charm'] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const after = must(buyUnit(s, 0)).state;
    expect(after.board).toHaveLength(2);
    const merged = after.board.find((u) => u.defId === 'gutter-runt')!;
    expect(merged.tier).toBe(2);
    expect(merged.relicIds.sort()).toEqual(['rusted-nail', 'tail-charm']);
  });

  it('merging collapses duplicate relics across the three copies', () => {
    const base = newBuild('2026-07-03');
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail', 'tail-charm'] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const after = must(buyUnit(s, 0)).state;
    const merged = after.board.find((u) => u.defId === 'gutter-runt')!;
    expect(merged.relicIds.sort()).toEqual(['rusted-nail', 'tail-charm']);
  });

  it('refunds half the relic cost when a duplicate relic is discarded on merge', () => {
    const base = newBuild('2026-07-03');
    const nailCost = RELIC_DEFS['rusted-nail'].cost;
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const after = must(buyUnit(s, 0)).state;
    const merged = after.board.find((u) => u.defId === 'gutter-runt')!;
    expect(merged.relicIds).toEqual(['rusted-nail']);
    // Started with 20 scrap, spent gutter-runt's cost buying the third copy,
    // then refunded one duplicate Rusted Nail at half cost.
    const gutterRuntCost = UNIT_DEFS['gutter-runt'].cost;
    const nailRefund = Math.max(1, Math.floor(nailCost / 2));
    expect(after.scrap).toBe(20 - gutterRuntCost + nailRefund);
  });

  it('refunds twice (at half each) when all three merging copies share the same relic', () => {
    const base = newBuild('2026-07-03');
    const nailCost = RELIC_DEFS['rusted-nail'].cost;
    // combineAll only fires from buyUnit/deployUnit. Two copies sit on the
    // board and the third sits on the bench; deploying the bench copy onto
    // the board completes the trio without a fresh (relic-less) shop unit
    // diluting the shared relic.
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
      ],
      bench: [{ defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] }],
    };
    const after = must(deployUnit(s, 0)).state;
    const merged = after.board.find((u) => u.defId === 'gutter-runt')!;
    expect(merged.relicIds).toEqual(['rusted-nail']);
    const nailRefund = Math.max(1, Math.floor(nailCost / 2));
    expect(after.scrap).toBe(20 + 2 * nailRefund);
  });

  it('does not refund a relic carried by only one of the three copies', () => {
    const base = newBuild('2026-07-03');
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gutter-runt', tier: 1, relicIds: [] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const after = must(buyUnit(s, 0)).state;
    const merged = after.board.find((u) => u.defId === 'gutter-runt')!;
    expect(merged.relicIds).toEqual(['rusted-nail']);
    const gutterRuntCost = UNIT_DEFS['gutter-runt'].cost;
    expect(after.scrap).toBe(20 - gutterRuntCost);
  });

  it('a unit carrying two relics where only one is shared refunds just that one', () => {
    const base = newBuild('2026-07-03');
    const nailCost = RELIC_DEFS['rusted-nail'].cost;
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail', 'tail-charm'] },
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const after = must(buyUnit(s, 0)).state;
    const merged = after.board.find((u) => u.defId === 'gutter-runt')!;
    expect(merged.relicIds.sort()).toEqual(['rusted-nail', 'tail-charm']);
    const gutterRuntCost = UNIT_DEFS['gutter-runt'].cost;
    const nailRefund = Math.max(1, Math.floor(nailCost / 2));
    expect(after.scrap).toBe(20 - gutterRuntCost + nailRefund);
  });
});

describe('expedition', () => {
  it('carries the horde and relics into the next day, with a fresh shop and scrap', () => {
    const day1 = {
      ...newBuild('2026-07-04', 1),
      scrap: 3,
      board: [
        { defId: 'gnawer', tier: 2, relicIds: ['rusted-nail'] },
        { defId: 'dire-rat', tier: 1, relicIds: [] },
      ],
      teamRelicIds: ['filth-totem'],
    };
    const day2 = advanceAfterDawn(day1, '2026-07-05');
    expect(day2.day).toBe(2);
    expect(day2.date).toBe('2026-07-05');
    expect(day2.board).toEqual(day1.board);
    expect(day2.board).not.toBe(day1.board);
    expect(day2.teamRelicIds).toEqual(['filth-totem']);
    // Accumulated idle scrap carries across days.
    expect(day2.scrap).toBe(3);
  });

  it('ends the expedition after the final day and starts fresh', () => {
    const lastDay = {
      ...newBuild('2026-07-10', SEASON_DAYS),
      board: [{ defId: 'dire-rat', tier: 3, relicIds: [] }],
      teamRelicIds: ['filth-totem'],
    };
    const next = advanceAfterDawn(lastDay, '2026-07-11');
    expect(next.day).toBe(1);
    expect(next.board).toEqual([]);
    expect(next.teamRelicIds).toEqual([]);
  });

  it('board cap grows across the expedition and never exceeds the hard cap', () => {
    const caps = [1, 2, 3, 4, 5, 6, 7].map(boardCapForDay);
    expect(caps).toEqual([5, 5, 6, 6, 7, 7, 8]);
    expect(boardCapForDay(99)).toBe(8);
  });

  it('lets the board grow past 5 on later days', () => {
    const base = newBuild('2026-07-04', 6);
    const s = {
      ...base,
      scrap: 99,
      // Six distinct rats (no three-of-a-kind, so no merge on the next buy).
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
        { defId: 'plague-bearer', tier: 1, relicIds: [] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'warren-warden' }, ...base.shop.slots.slice(1)],
      },
    };
    const res = buyUnit(s, 0);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.board.length).toBe(7);
  });
});

describe('synchronized seasons', () => {
  const addDays = (date: string, n: number) =>
    new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  it('seasonId is always the Monday of that date’s week', () => {
    for (let i = 0; i < 21; i++) {
      const d = addDays('2026-07-01', i);
      expect(weekdayFor(seasonIdFor(d))).toBe(1);
    }
  });

  it('a Mon–Sun run shares one season; the next Monday starts a new one', () => {
    const monday = seasonIdFor('2026-07-01');
    expect(weekdayFor(monday)).toBe(1);
    const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    expect(new Set(week.map(seasonIdFor)).size).toBe(1);
    expect(week.map(weekdayFor)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(seasonIdFor(addDays(monday, 7))).not.toBe(monday);
  });

  it('newBuild tags the build with the right season', () => {
    const b = newBuild('2026-07-01', 3);
    expect(b.seasonId).toBe(seasonIdFor('2026-07-01'));
  });
});

describe('idle economy', () => {
  it('interest is 5% floored and capped, never on a tiny bank', () => {
    expect(interestFor(0)).toBe(0);
    expect(interestFor(19)).toBe(0);
    expect(interestFor(20)).toBe(1);
    expect(interestFor(74)).toBe(3);
    expect(interestFor(100)).toBe(INTEREST_CAP);
    expect(interestFor(9999)).toBe(INTEREST_CAP);
  });
});

describe('difficulty escalation', () => {
  it('difficulty no longer scales by expedition day — it is a constant 1', () => {
    const spend = (day: number) =>
      generateGauntlet('2026-07-04', day).waves.reduce(
        (s, w) => s + w.units.reduce((a, u) => a + u.cost, 0),
        0
      );
    expect(difficultyForDay(1)).toBe(1);
    expect(difficultyForDay(7)).toBe(1);
    // Same date, no day-scaling left: spend is now day-invariant (waves
    // still escalate by wave INDEX within a gauntlet, just not by day).
    expect(spend(7)).toBe(spend(1));
  });

  it('keeps the same theme regardless of day', () => {
    expect(generateGauntlet('2026-07-04', 7).theme).toEqual(generateGauntlet('2026-07-04', 1).theme);
  });
});

describe('tiers in battle', () => {
  const gauntlet = {
    date: 'test',
    seed: 0,
    theme: { primary: 'swarm' as const, secondary: 'brute' as const, pivotWave: 4 },
    waves: [{ units: [{ id: 'd', name: 'D', attack: 1, health: 50, cost: 0 }] }],
  };

  it('tier multiplies stats and ability magnitude', () => {
    const { events } = simulate(
      { units: [{ defId: 'gnawer', tier: 2 }, { defId: 'gutter-runt' }] },
      gauntlet
    );
    const start = events.find((e) => e.type === 'battleStart')!;
    expect(start.type === 'battleStart' && start.horde[0].attack).toBe(6);
    expect(start.type === 'battleStart' && start.horde[0].tier).toBe(2);
    const buffEvent = events.find((e) => e.type === 'buff')!;
    expect(buffEvent.type === 'buff' && buffEvent.attack).toBe(4);
  });

  it('lineupFromBuild carries tiers and relics into the sim input', () => {
    const s = {
      ...newBuild('2026-07-03'),
      board: [{ defId: 'gnawer', tier: 2, relicIds: ['rusted-nail'] }],
      teamRelicIds: ['filth-totem'],
    };
    expect(lineupFromBuild(s)).toEqual({
      units: [{ defId: 'gnawer', tier: 2, relicIds: ['rusted-nail'] }],
      teamRelicIds: ['filth-totem'],
      combatCap: combatCapForDay(s.day),
    });
  });

  it('bench units never enter the fighting lineup, even if benched units outnumber the board', () => {
    const s = {
      ...newBuild('2026-07-03'),
      board: [{ defId: 'gnawer', tier: 1, relicIds: [] }],
      bench: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 2, relicIds: [] },
      ],
    };
    // The core invariant the whole bench feature depends on: simulate() only
    // ever sees board units. lineupFromBuild is the only bridge from
    // BuildState to Lineup, so asserting its output ignores bench is
    // equivalent to asserting simulate() never sees benched rats.
    expect(lineupFromBuild(s).units).toEqual([{ defId: 'gnawer', tier: 1, relicIds: [] }]);
    expect(lineupFromBuild(s).units.some((u) => u.defId === 'dire-rat' || u.defId === 'rat-piper')).toBe(
      false
    );
  });
});

describe('bench', () => {
  it('newBuild starts with an empty bench', () => {
    expect(newBuild('2026-07-03').bench).toEqual([]);
  });

  it('buying overflows to the bench once the board is at its day cap', () => {
    const base = newBuild('2026-07-04', 1); // boardCapForDay(1) = 5
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'plague-bearer' }, ...base.shop.slots.slice(1)],
      },
    };
    const res = buyUnit(s, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.board).toHaveLength(5);
      expect(res.state.bench).toHaveLength(1);
      expect(res.state.bench[0].defId).toBe('plague-bearer');
    }
  });

  it('fails when both the board and the bench are full and no merge completes', () => {
    const base = newBuild('2026-07-04', 1);
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      bench: [
        { defId: 'plague-bearer', tier: 1, relicIds: [] },
        { defId: 'warren-warden', tier: 1, relicIds: [] },
        { defId: 'gutter-runt', tier: 1, relicIds: [] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'dire-rat' }, ...base.shop.slots.slice(1)],
      },
    };
    const res = buyUnit(s, 0);
    expect(res.ok).toBe(false);
    // Place-then-merge-then-check: the fresh copy overflows onto the full
    // bench, nothing merges, so the post-combine bench-cap guardrail rejects it.
    if (!res.ok) expect(res.reason).toMatch(/bench is full/);
    // And the rejected buy leaves scrap and state untouched (the clone is
    // discarded on fail — over-placement never leaks).
    expect(buyUnit(s, 0).ok).toBe(false);
    expect(s.scrap).toBe(20);
    expect(s.board).toHaveLength(5);
    expect(s.bench).toHaveLength(3);
  });

  it('a 3rd copy merges across board+bench: 2 on bench + buy 1 (board full) lands on the bench', () => {
    const base = newBuild('2026-07-04', 1); // boardCapForDay(1) = 5, keep it full
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      bench: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gutter-runt', tier: 1, relicIds: ['tail-charm'] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const res = buyUnit(s, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // The board is full, so the bought copy overflows to the bench —
      // none of the three gutter-runt copies was ever on the board, so the
      // merged unit lands on the bench, not the board.
      expect(res.state.board).toEqual(s.board);
      expect(res.state.bench).toHaveLength(1);
      const merged = res.state.bench[0];
      expect(merged.defId).toBe('gutter-runt');
      expect(merged.tier).toBe(2);
      expect(merged.relicIds.sort()).toEqual(['rusted-nail', 'tail-charm']);
    }
  });

  it('buys the 3rd copy for a trio even when board AND bench are full (2 on bench)', () => {
    // The player report: board full and bench full, with two copies of X on
    // the bench. Buying the third X from the shop must complete the merge
    // WITHOUT forcing a manual bench-sell first.
    const base = newBuild('2026-07-04', 1); // boardCapForDay(1) = 5
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      // Bench full (BENCH_SIZE = 3): two merge candidates + one bystander.
      bench: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gutter-runt', tier: 1, relicIds: ['tail-charm'] },
        { defId: 'plague-bearer', tier: 1, relicIds: [] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const gutterRuntCost = UNIT_DEFS['gutter-runt'].cost;
    const res = buyUnit(s, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Board untouched; bench shrank from 3 to 2 (the trio collapsed to one).
      expect(res.state.board).toEqual(s.board);
      expect(res.state.board.length).toBeLessThanOrEqual(boardCapForDay(1));
      expect(res.state.bench).toHaveLength(2);
      expect(res.state.bench.length).toBeLessThanOrEqual(BENCH_SIZE);
      const merged = res.state.bench.find((u) => u.defId === 'gutter-runt')!;
      expect(merged.tier).toBe(2);
      expect(merged.relicIds.sort()).toEqual(['rusted-nail', 'tail-charm']);
      expect(res.state.bench.some((u) => u.defId === 'plague-bearer')).toBe(true);
      // Scrap was spent on the third copy.
      expect(res.state.scrap).toBe(20 - gutterRuntCost);
      // The slot emptied.
      expect(res.state.shop.slots[0]).toEqual({ kind: 'empty' });
    }
    // The original state is never mutated by the (successful) buy.
    expect(s.scrap).toBe(20);
    expect(s.bench).toHaveLength(3);
  });

  it('buys the 3rd copy for a trio even when board AND bench are full (2 on board)', () => {
    // Variant: the two existing copies fight on the board while the bench is
    // full of bystanders. The merged tier-2 lands on the board (scanned first).
    const base = newBuild('2026-07-04', 1); // boardCapForDay(1) = 5
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gutter-runt', tier: 1, relicIds: ['tail-charm'] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      bench: [
        { defId: 'plague-bearer', tier: 1, relicIds: [] },
        { defId: 'warren-warden', tier: 1, relicIds: [] },
        { defId: 'dire-rat', tier: 1, relicIds: [] },
      ],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const gutterRuntCost = UNIT_DEFS['gutter-runt'].cost;
    const res = buyUnit(s, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Board shrank from 5 to 4 (trio collapsed), bench untouched.
      expect(res.state.board).toHaveLength(4);
      expect(res.state.board.length).toBeLessThanOrEqual(boardCapForDay(1));
      expect(res.state.bench).toEqual(s.bench);
      expect(res.state.bench.length).toBeLessThanOrEqual(BENCH_SIZE);
      const merged = res.state.board.find((u) => u.defId === 'gutter-runt')!;
      expect(merged.tier).toBe(2);
      expect(merged.relicIds.sort()).toEqual(['rusted-nail', 'tail-charm']);
      expect(res.state.scrap).toBe(20 - gutterRuntCost);
    }
  });

  it('a merge spanning board+bench lands on the board (board scanned first)', () => {
    const base = newBuild('2026-07-03');
    const s = {
      ...base,
      scrap: 20,
      board: [{ defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] }],
      bench: [{ defId: 'gutter-runt', tier: 1, relicIds: ['tail-charm'] }],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const res = buyUnit(s, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.bench).toEqual([]);
      expect(res.state.board).toHaveLength(1);
      expect(res.state.board[0].tier).toBe(2);
      expect(res.state.board[0].relicIds.sort()).toEqual(['rusted-nail', 'tail-charm']);
    }
  });

  it('benchUnit moves a board unit to the bench, respecting the bench cap', () => {
    const base = newBuild('2026-07-03');
    const s = {
      ...base,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
      ],
      bench: [
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
    };
    expect(benchUnit(s, 0).ok).toBe(false); // bench already at BENCH_SIZE
    const room = { ...s, bench: s.bench.slice(0, BENCH_SIZE - 1) };
    const res = benchUnit(room, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.board.map((u) => u.defId)).toEqual(['gnawer']);
      expect(res.state.bench.map((u) => u.defId)).toEqual(['rat-piper', 'brood-mother', 'dire-rat']);
    }
    expect(benchUnit(s, 99).ok).toBe(false); // nothing there
  });

  it('deployUnit moves a bench unit onto the board, respecting the day cap', () => {
    const base = newBuild('2026-07-04', 1); // boardCapForDay(1) = 5
    const full = {
      ...base,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      bench: [{ defId: 'plague-bearer', tier: 1, relicIds: [] }],
    };
    expect(deployUnit(full, 0).ok).toBe(false); // board is at its day cap

    const withRoom = { ...full, board: full.board.slice(0, 3) };
    const res = deployUnit(withRoom, 0, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.bench).toEqual([]);
      expect(res.state.board[0].defId).toBe('plague-bearer');
      expect(res.state.board).toHaveLength(4);
    }
    expect(deployUnit(withRoom, 99).ok).toBe(false); // nothing on the bench there
  });

  it('deploying a bench unit that completes a trio merges immediately', () => {
    const base = newBuild('2026-07-03');
    const s = {
      ...base,
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'gutter-runt', tier: 1, relicIds: [] },
      ],
      bench: [{ defId: 'gutter-runt', tier: 1, relicIds: ['tail-charm'] }],
    };
    const res = deployUnit(s, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.bench).toEqual([]);
      expect(res.state.board).toHaveLength(1);
      expect(res.state.board[0].tier).toBe(2);
      expect(res.state.board[0].relicIds.sort()).toEqual(['rusted-nail', 'tail-charm']);
    }
  });

  it('sellBenchUnit refunds half cost (scaled by tier) and removes the unit', () => {
    const s = {
      ...newBuild('2026-07-03'),
      bench: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gutter-runt', tier: 2, relicIds: [] },
      ],
    };
    const afterDire = sellBenchUnit(s, 0);
    expect(afterDire.ok).toBe(true);
    if (afterDire.ok) {
      expect(afterDire.state.scrap).toBe(DAILY_SCRAP + 4);
      expect(afterDire.state.bench).toHaveLength(1);
    }
    const afterRunt = sellBenchUnit(s, 1);
    expect(afterRunt.ok).toBe(true);
    if (afterRunt.ok) expect(afterRunt.state.scrap).toBe(DAILY_SCRAP + 2);
    expect(sellBenchUnit(s, 99).ok).toBe(false);
  });

  it('advanceAfterDawn carries the bench to the next day (deep-copied)', () => {
    const day1 = {
      ...newBuild('2026-07-04', 1),
      bench: [{ defId: 'gnawer', tier: 2, relicIds: ['rusted-nail'] }],
    };
    const day2 = advanceAfterDawn(day1, '2026-07-05');
    expect(day2.bench).toEqual(day1.bench);
    expect(day2.bench).not.toBe(day1.bench);
    expect(day2.bench[0]).not.toBe(day1.bench[0]);
  });

  it('a new expedition (after the final day) starts with an empty bench', () => {
    const lastDay = {
      ...newBuild('2026-07-10', SEASON_DAYS),
      bench: [{ defId: 'dire-rat', tier: 1, relicIds: [] }],
    };
    const next = advanceAfterDawn(lastDay, '2026-07-11');
    expect(next.bench).toEqual([]);
  });

  it('when the bench is empty, combineAll behaves exactly like the old board-only combine', () => {
    const base = newBuild('2026-07-03');
    const s = {
      ...base,
      scrap: 20,
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: ['rusted-nail'] },
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gutter-runt', tier: 1, relicIds: ['tail-charm'] },
      ],
      bench: [] as BuildState['bench'],
      shop: {
        ...base.shop,
        slots: [{ kind: 'unit' as const, defId: 'gutter-runt' }, ...base.shop.slots.slice(1)],
      },
    };
    const after = buyUnit(s, 0);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.state.board).toHaveLength(2);
      expect(after.state.bench).toEqual([]);
      const merged = after.state.board.find((u) => u.defId === 'gutter-runt')!;
      expect(merged.tier).toBe(2);
      expect(merged.relicIds.sort()).toEqual(['rusted-nail', 'tail-charm']);
    }
  });
});

describe('swapping bench and board', () => {
  it('exchanges the two units, leaving counts unchanged', () => {
    const s = {
      ...newBuild('2026-07-03'),
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 2, relicIds: ['rusted-nail'] },
      ],
      bench: [{ defId: 'rat-piper', tier: 1, relicIds: [] }],
    };
    const res = swapWithBench(s, 1, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.board.map((u) => u.defId)).toEqual(['dire-rat', 'rat-piper']);
      expect(res.state.bench.map((u) => u.defId)).toEqual(['gnawer']);
      expect(res.state.bench[0].tier).toBe(2);
      expect(res.state.bench[0].relicIds).toEqual(['rusted-nail']);
      expect(res.state.board).toHaveLength(2);
      expect(res.state.bench).toHaveLength(1);
    }
  });

  it('rejects invalid board or bench indices', () => {
    const s = {
      ...newBuild('2026-07-03'),
      board: [{ defId: 'dire-rat', tier: 1, relicIds: [] }],
      bench: [{ defId: 'gnawer', tier: 1, relicIds: [] }],
    };
    expect(swapWithBench(s, 99, 0).ok).toBe(false);
    expect(swapWithBench(s, 0, 99).ok).toBe(false);
    expect(swapWithBench(s, -1, 0).ok).toBe(false);
  });

  it('works when both the board and the bench are at capacity', () => {
    const base = newBuild('2026-07-04', 1); // boardCapForDay(1) = 5
    const s = {
      ...base,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      bench: [
        { defId: 'plague-bearer', tier: 1, relicIds: [] },
        { defId: 'warren-warden', tier: 1, relicIds: [] },
        { defId: 'gutter-runt', tier: 1, relicIds: [] },
      ],
    };
    const res = swapWithBench(s, 2, 1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.board).toHaveLength(5);
      expect(res.state.bench).toHaveLength(3);
      expect(res.state.board[2].defId).toBe('warren-warden');
      expect(res.state.bench[1].defId).toBe('rat-piper');
    }
  });

  it('a swap alone cannot complete a merge (the combined multiset is unchanged)', () => {
    const s = {
      ...newBuild('2026-07-03'),
      board: [
        { defId: 'gutter-runt', tier: 1, relicIds: [] },
        { defId: 'gutter-runt', tier: 1, relicIds: [] },
        { defId: 'dire-rat', tier: 1, relicIds: [] },
      ],
      bench: [{ defId: 'gutter-runt', tier: 1, relicIds: [] }],
    };
    // Swapping the dire-rat for the bench gutter-runt would put all three
    // gutter-runts on the board — combineAll (run defensively) must merge
    // them, proving the post-swap combineAll pass is live, not a no-op.
    const res = swapWithBench(s, 2, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const merged = res.state.board.find((u) => u.defId === 'gutter-runt');
      expect(merged?.tier).toBe(2);
      expect(res.state.bench.map((u) => u.defId)).toEqual(['dire-rat']);
    }
  });
});

describe('buyable horde slots (issue #9)', () => {
  it('newBuild starts with zero purchased slots', () => {
    expect(newBuild('2026-07-04', 1).purchasedSlots).toBe(0);
  });

  it('effectiveBoardCap is the day cap when nothing has been purchased', () => {
    for (let day = 1; day <= 7; day++) {
      expect(effectiveBoardCap({ day, purchasedSlots: 0 })).toBe(boardCapForDay(day));
    }
  });

  it('effectiveBoardCap adds purchased slots on top of the day cap, hard-capped at BOARD_CAP', () => {
    expect(effectiveBoardCap({ day: 1, purchasedSlots: 1 })).toBe(boardCapForDay(1) + 1);
    expect(effectiveBoardCap({ day: 1, purchasedSlots: 3 })).toBe(BOARD_CAP); // 5 + 3 = 8
    expect(effectiveBoardCap({ day: 1, purchasedSlots: 99 })).toBe(BOARD_CAP); // clamped
    expect(effectiveBoardCap({ day: 7, purchasedSlots: 1 })).toBe(BOARD_CAP); // already 8 naturally
  });

  it('buyBoardSlot charges the ladder price in order and increments purchasedSlots', () => {
    let s = { ...newBuild('2026-07-04', 1), scrap: 200 };
    for (let i = 0; i < SLOT_PRICES.length; i++) {
      const price = SLOT_PRICES[i];
      const before = s.scrap;
      const res = buyBoardSlot(s);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.state.scrap).toBe(before - price);
        expect(res.state.purchasedSlots).toBe(i + 1);
        s = res.state;
      }
    }
    // BOARD_CAP reached (5 natural + 3 purchased = 8) — no more slots to buy.
    expect(effectiveBoardCap(s)).toBe(BOARD_CAP);
    expect(buyBoardSlot(s).ok).toBe(false);
    expect(nextSlotPrice(s)).toBeUndefined();
  });

  it('the price ladder is strictly increasing', () => {
    for (let i = 1; i < SLOT_PRICES.length; i++) expect(SLOT_PRICES[i]).toBeGreaterThan(SLOT_PRICES[i - 1]);
  });

  it('rejects buying a slot without enough scrap', () => {
    const s = { ...newBuild('2026-07-04', 1), scrap: SLOT_PRICES[0] - 1 };
    const res = buyBoardSlot(s);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not enough scrap/);
  });

  it('rejects buying once the day already reached BOARD_CAP naturally (day 7)', () => {
    const s = { ...newBuild('2026-07-10', SEASON_DAYS), scrap: 999 };
    expect(boardCapForDay(SEASON_DAYS)).toBe(BOARD_CAP);
    const res = buyBoardSlot(s);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/hard cap/);
  });

  it('nextSlotPrice reports the upcoming price, then undefined once maxed', () => {
    let s = { ...newBuild('2026-07-04', 1), scrap: 200 };
    expect(nextSlotPrice(s)).toBe(SLOT_PRICES[0]);
    for (const price of SLOT_PRICES) {
      expect(nextSlotPrice(s)).toBe(price);
      s = (buyBoardSlot(s) as { ok: true; state: BuildState }).state;
    }
    expect(nextSlotPrice(s)).toBeUndefined();
  });

  it('a purchased slot raises the recruitable board beyond the day cap', () => {
    const base = newBuild('2026-07-04', 1); // boardCapForDay(1) = 5
    let s = { ...base, scrap: 200 };
    s = (buyBoardSlot(s) as { ok: true; state: BuildState }).state; // purchasedSlots = 1, cap = 6
    s = {
      ...s,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      shop: {
        ...s.shop,
        slots: [{ kind: 'unit' as const, defId: 'plague-bearer' }, ...s.shop.slots.slice(1)],
      },
    };
    // Without the purchased slot this would overflow to the bench (see the
    // "buying overflows to the bench" test) — with it, the 6th rat fits on
    // the board itself.
    const res = buyUnit(s, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.board).toHaveLength(6);
      expect(res.state.bench).toHaveLength(0);
    }
  });

  it('deployUnit respects the purchased-slot-expanded cap too', () => {
    const base = newBuild('2026-07-04', 1); // boardCapForDay(1) = 5
    let s = { ...base, scrap: 200 };
    s = (buyBoardSlot(s) as { ok: true; state: BuildState }).state; // cap = 6
    s = {
      ...s,
      board: [
        { defId: 'dire-rat', tier: 1, relicIds: [] },
        { defId: 'gnawer', tier: 1, relicIds: [] },
        { defId: 'rat-piper', tier: 1, relicIds: [] },
        { defId: 'brood-mother', tier: 1, relicIds: [] },
        { defId: 'bone-priest', tier: 1, relicIds: [] },
      ],
      bench: [{ defId: 'plague-bearer', tier: 1, relicIds: [] }],
    };
    // Board is at the *natural* day cap (5) but under the purchase-expanded
    // cap (6), so deploying from the bench should now succeed.
    const res = deployUnit(s, 0);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.board).toHaveLength(6);
  });

  it('purchasedSlots carries forward across days within the same expedition', () => {
    let s = { ...newBuild('2026-07-04', 1), scrap: 200 };
    s = (buyBoardSlot(s) as { ok: true; state: BuildState }).state;
    expect(s.purchasedSlots).toBe(1);
    const day2 = advanceAfterDawn(s, '2026-07-05');
    expect(day2.purchasedSlots).toBe(1);
    expect(effectiveBoardCap(day2)).toBe(boardCapForDay(2) + 1);
  });

  it('purchasedSlots resets when a new expedition (season) begins', () => {
    let s = { ...newBuild('2026-07-10', SEASON_DAYS - 1), scrap: 200 };
    s = (buyBoardSlot(s) as { ok: true; state: BuildState }).state;
    const lastDay = advanceAfterDawn(s, '2026-07-11'); // still within the season
    expect(lastDay.purchasedSlots).toBe(1);
    const nextSeason = advanceAfterDawn({ ...lastDay, day: SEASON_DAYS }, '2026-07-12');
    expect(nextSeason.purchasedSlots).toBe(0);
  });

  it('combatCapForBuild always has room for the effective board cap plus summon headroom', () => {
    for (let day = 1; day <= 7; day++) {
      for (let purchasedSlots = 0; purchasedSlots <= SLOT_PRICES.length; purchasedSlots++) {
        const build = { day, purchasedSlots };
        expect(combatCapForBuild(build)).toBe(effectiveBoardCap(build) + 2);
        expect(combatCapForBuild(build)).toBeGreaterThanOrEqual(effectiveBoardCap(build));
      }
    }
  });

  it('lineupFromBuild uses combatCapForBuild, not the plain day-based combatCapForDay, once slots are purchased', () => {
    let s = { ...newBuild('2026-07-04', 1), scrap: 200 };
    s = (buyBoardSlot(s) as { ok: true; state: BuildState }).state; // cap now 6, day cap still 5
    const lineup = lineupFromBuild(s);
    expect(lineup.combatCap).toBe(combatCapForBuild(s));
    expect(lineup.combatCap).toBeGreaterThan(combatCapForDay(s.day));
  });

  it('at zero purchased slots, combatCapForBuild matches the pre-existing combatCapForDay (no regression)', () => {
    for (let day = 1; day <= 7; day++) {
      expect(combatCapForBuild({ day, purchasedSlots: 0 })).toBe(combatCapForDay(day));
    }
  });
});
