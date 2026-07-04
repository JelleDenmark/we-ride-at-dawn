import { fnv1a } from './seed';
import { xorshift128 } from './prng';
import { UNIT_DEFS, type Lineup } from './data/units';
import { RELIC_DEFS } from './data/relics';
import { BOARD_CAP } from './sim';

export const DAILY_SCRAP = 12;
export const REROLL_COST = 1;
export const SHOP_UNIT_SLOTS = 4;
export const SHOP_RELIC_SLOTS = 2;
export const MAX_TIER = 3;

export type ShopSlot =
  | { kind: 'unit'; defId: string }
  | { kind: 'relic'; relicId: string }
  | { kind: 'empty' };

export interface BoardUnit {
  defId: string;
  tier: number;
  relicIds: string[];
}

export interface BuildState {
  date: string;
  scrap: number;
  board: BoardUnit[];
  teamRelicIds: string[];
  shop: {
    slots: ShopSlot[];
    frozen: boolean[];
    rolls: number;
  };
}

export type ActionResult = { ok: true; state: BuildState } | { ok: false; reason: string };

const SHOP_UNIT_POOL = Object.values(UNIT_DEFS).filter((u) => u.id !== 'pup');
const SHOP_RELIC_POOL = Object.values(RELIC_DEFS);

/** Offerings are a pure function of (date, roll #) so rerolls are deterministic. */
export function rollOfferings(date: string, roll: number): ShopSlot[] {
  const rng = xorshift128(fnv1a(`${date}#shop#${roll}`));
  const slots: ShopSlot[] = [];
  for (let i = 0; i < SHOP_UNIT_SLOTS; i++) {
    slots.push({ kind: 'unit', defId: SHOP_UNIT_POOL[rng.int(SHOP_UNIT_POOL.length)].id });
  }
  for (let i = 0; i < SHOP_RELIC_SLOTS; i++) {
    slots.push({ kind: 'relic', relicId: SHOP_RELIC_POOL[rng.int(SHOP_RELIC_POOL.length)].id });
  }
  return slots;
}

export function newBuild(date: string): BuildState {
  const slots = rollOfferings(date, 0);
  return {
    date,
    scrap: DAILY_SCRAP,
    board: [],
    teamRelicIds: [],
    shop: { slots, frozen: slots.map(() => false), rolls: 0 },
  };
}

const clone = (state: BuildState): BuildState => JSON.parse(JSON.stringify(state));

const fail = (reason: string): ActionResult => ({ ok: false, reason });

/** Three copies of the same unit at the same tier merge into one, a tier up. */
function combineAll(state: BuildState): void {
  for (;;) {
    let merged = false;
    for (let i = 0; i < state.board.length; i++) {
      const u = state.board[i];
      if (u.tier >= MAX_TIER) continue;
      const matches = state.board
        .map((b, idx) => ({ b, idx }))
        .filter(({ b }) => b.defId === u.defId && b.tier === u.tier);
      if (matches.length < 3) continue;
      const [first, second, third] = matches;
      first.b.tier += 1;
      first.b.relicIds = [...first.b.relicIds, ...second.b.relicIds, ...third.b.relicIds];
      state.board.splice(third.idx, 1);
      state.board.splice(second.idx, 1);
      merged = true;
      break;
    }
    if (!merged) return;
  }
}

export function buyUnit(state: BuildState, slotIndex: number): ActionResult {
  const slot = state.shop.slots[slotIndex];
  if (!slot || slot.kind !== 'unit') return fail('nothing to recruit there');
  const def = UNIT_DEFS[slot.defId];
  if (state.scrap < def.cost) return fail('not enough scrap');
  const s = clone(state);
  s.scrap -= def.cost;
  s.board.push({ defId: def.id, tier: 1, relicIds: [] });
  combineAll(s);
  // The cap check runs *after* the combine: buying a third-of-a-kind onto a
  // full board is allowed, since the merge nets fewer units than we started.
  if (s.board.length > BOARD_CAP) return fail('the warren is full');
  s.shop.slots[slotIndex] = { kind: 'empty' };
  s.shop.frozen[slotIndex] = false;
  return { ok: true, state: s };
}

/** Would recruiting this slot succeed (afford + fits or completes a combine)? */
export function canRecruit(state: BuildState, slotIndex: number): boolean {
  return buyUnit(state, slotIndex).ok;
}

export function buyRelic(state: BuildState, slotIndex: number, targetIndex?: number): ActionResult {
  const slot = state.shop.slots[slotIndex];
  if (!slot || slot.kind !== 'relic') return fail('no relic there');
  const relic = RELIC_DEFS[slot.relicId];
  if (state.scrap < relic.cost) return fail('not enough scrap');
  if (relic.scope === 'unit' && (targetIndex === undefined || !state.board[targetIndex])) {
    return fail('pick a rat to carry it');
  }
  const s = clone(state);
  s.scrap -= relic.cost;
  if (relic.scope === 'team') s.teamRelicIds.push(relic.id);
  else s.board[targetIndex!].relicIds.push(relic.id);
  s.shop.slots[slotIndex] = { kind: 'empty' };
  s.shop.frozen[slotIndex] = false;
  return { ok: true, state: s };
}

export function sellUnit(state: BuildState, boardIndex: number): ActionResult {
  const unit = state.board[boardIndex];
  if (!unit) return fail('nothing to sell');
  const s = clone(state);
  s.board.splice(boardIndex, 1);
  s.scrap += sellRefund(unit);
  return { ok: true, state: s };
}

export function sellRefund(unit: BoardUnit): number {
  const cost = UNIT_DEFS[unit.defId].cost;
  return Math.max(1, Math.floor(cost / 2)) * unit.tier;
}

export function rerollShop(state: BuildState): ActionResult {
  if (state.scrap < REROLL_COST) return fail('not enough scrap to reroll');
  const s = clone(state);
  s.scrap -= REROLL_COST;
  s.shop.rolls += 1;
  const fresh = rollOfferings(s.date, s.shop.rolls);
  s.shop.slots = s.shop.slots.map((old, i) =>
    s.shop.frozen[i] && old.kind !== 'empty' ? old : fresh[i]
  );
  return { ok: true, state: s };
}

export function toggleFreeze(state: BuildState, slotIndex: number): ActionResult {
  const slot = state.shop.slots[slotIndex];
  if (!slot || slot.kind === 'empty') return fail('nothing to freeze');
  const s = clone(state);
  s.shop.frozen[slotIndex] = !s.shop.frozen[slotIndex];
  return { ok: true, state: s };
}

export function moveUnit(state: BuildState, from: number, to: number): ActionResult {
  if (!state.board[from] || to < 0 || to >= state.board.length) return fail('cannot move there');
  const s = clone(state);
  const [unit] = s.board.splice(from, 1);
  s.board.splice(to, 0, unit);
  return { ok: true, state: s };
}

export function lineupFromBuild(state: BuildState): Lineup {
  return {
    units: state.board.map((u) => ({ defId: u.defId, tier: u.tier, relicIds: u.relicIds })),
    teamRelicIds: state.teamRelicIds,
  };
}

export function unitStats(unit: BoardUnit): { attack: number; health: number } {
  const def = UNIT_DEFS[unit.defId];
  return { attack: def.attack * unit.tier, health: def.health * unit.tier };
}
