import { describe, expect, it } from 'vitest';
import {
  newBuild,
  buyUnit,
  buyRelic,
  sellUnit,
  rerollShop,
  toggleFreeze,
  moveUnit,
  lineupFromBuild,
  advanceAfterDawn,
  boardCapForDay,
  SEASON_DAYS,
  DAILY_SCRAP,
  REROLL_COST,
  type BuildState,
} from '../src/shop';
import { UNIT_DEFS } from '../src/data/units';
import { simulate } from '../src/sim';
import { generateGauntlet, difficultyForDay } from '../src/gauntlet';

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
    expect(buyUnit(full, unitSlot(s)).ok).toBe(false);
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
    expect(afterDire.scrap).toBe(DAILY_SCRAP + 2);
    expect(afterDire.board).toHaveLength(1);
    const afterRunt = must(sellUnit(s, 1)).state;
    expect(afterRunt.scrap).toBe(DAILY_SCRAP + 2);
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
    expect(day2.scrap).toBe(DAILY_SCRAP);
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

describe('difficulty escalation', () => {
  it('later expedition days field costlier gauntlets from the same date', () => {
    const spend = (day: number) =>
      generateGauntlet('2026-07-04', day).waves.reduce(
        (s, w) => s + w.units.reduce((a, u) => a + u.cost, 0),
        0
      );
    expect(difficultyForDay(1)).toBe(1);
    expect(difficultyForDay(7)).toBeGreaterThan(1);
    expect(spend(7)).toBeGreaterThan(spend(1));
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
    });
  });
});
