import { fnv1a } from './seed';
import { xorshift128 } from './prng';
import { UNIT_DEFS, type Lineup, type UnitDef, tierAttackMultiplier, tierHealthMultiplier } from './data/units';
import { RELIC_DEFS } from './data/relics';
import { BOARD_CAP, COMBAT_CAP_BONUS } from './sim';

export const DAILY_SCRAP = 24;
export const REROLL_COST = 2;
export const SHOP_UNIT_SLOTS = 4;
export const SHOP_RELIC_SLOTS = 2;
export const MAX_TIER = 3;
export const SEASON_DAYS = 7;
/** Bench slots: storage for rats outside the fighting horde (never enter
 * `simulate`). Small on purpose — it's for holding merge candidates and
 * counter-tech, not a second board. */
export const BENCH_SIZE = 3;

// Idle economy: the horde skirmishes hourly, earning SCRAP_PER_DEPTH per wave
// cleared. Interest (TFT-style, 5% of the bank, capped) is paid once per DAY
// at dawn, not per hour — the daily cadence + cap keep the bank from
// snowballing over the hundreds of hours in an expedition.
export const SCRAP_PER_DEPTH = 1;
export const INTEREST_RATE = 0.05;
export const INTEREST_CAP = 5;

export function interestFor(scrap: number): number {
  return Math.min(INTEREST_CAP, Math.floor(scrap * INTEREST_RATE));
}

/** Buildable board size grows over the expedition: 5,5,6,6,7,7,8 (day 1–7). */
export function boardCapForDay(day: number): number {
  return Math.min(BOARD_CAP, 4 + Math.ceil(day / 2));
}

/**
 * How many rats the horde may hold *in combat* on a given day: the buildable
 * board plus `COMBAT_CAP_BONUS` of summon headroom (7,7,8,8,9,9,10 on days
 * 1–7). Recruiting still stops at `boardCapForDay`; the extra slots exist only
 * so a summoner's pups aren't silently swallowed by a full warren.
 *
 * This is the pure, day-only calculation (no purchased slots) — kept for
 * callers that only have a day number. Builds that may have bought extra
 * board slots (see `SLOT_PRICES`/`buyBoardSlot`) must use `combatCapForBuild`
 * instead, since a purchased slot raises the recruitable board and combat
 * must always have room for every recruited rat plus the summon headroom.
 */
export function combatCapForDay(day: number): number {
  return boardCapForDay(day) + COMBAT_CAP_BONUS;
}

/**
 * Late-game scrap sink (issue #9): buy extra board slots beyond the day's
 * natural `boardCapForDay`, up to the hard `BOARD_CAP = 8` ceiling. Purchased
 * slots persist for the rest of the expedition (carried by `advanceAfterDawn`,
 * reset to 0 on a fresh season by `newBuild`) and stack additively on top of
 * whatever the day's own cap is: `effectiveBoardCap = min(BOARD_CAP,
 * boardCapForDay(day) + purchasedSlots)`.
 *
 * Prices are derived from `scripts/slot-value.ts`, which sims a strong,
 * actively-improving roster's average wave-depth at each purchasable-slot
 * count across a full 7-day expedition (bought day 1, held all week) and
 * converts the wave-depth delta into scrap via `SCRAP_PER_DEPTH` (1 scrap per
 * wave, per hourly ride, ×24 rides/day). Derived weekly scrap-equivalent
 * values came out at ~36 / ~20 / ~7 for the 1st/2nd/3rd slot (diminishing —
 * each slot buys less depth as the board nears the hard cap and overkill
 * damage stops being useful). Since even the most valuable (1st) slot's
 * entire week of value barely exceeds one day's scrap stipend
 * (`DAILY_SCRAP = 24`), pricing at raw value wouldn't trivialize the economy —
 * but a flat/declining ladder would make the *later* slots strictly worse
 * buys than the first, which reads as a bug rather than "rare late-game
 * luxury." So the ladder is rounded up and forced strictly increasing:
 * scarcer real estate near the hard cap costs more even though its raw
 * depth-payback is smaller — that premium is what makes it a genuine
 * end-of-run scrap sink rather than a rational early buy.
 */
export const SLOT_PRICES: readonly number[] = [36, 40, 44];

/** How many rats the board may hold given the day's natural cap plus any
 * board slots this build has purchased, hard-capped at `BOARD_CAP`. */
export function effectiveBoardCap(state: Pick<BuildState, 'day' | 'purchasedSlots'>): number {
  return Math.min(BOARD_CAP, boardCapForDay(state.day) + (state.purchasedSlots ?? 0));
}

/**
 * Combat headroom for a specific build: the build's *effective* (possibly
 * purchase-expanded) board cap plus `COMBAT_CAP_BONUS` summon headroom. Always
 * at least as large as the recruited board, so buying slots can never starve
 * a summoner — the purchased headroom and the summon headroom stack rather
 * than compete.
 */
export function combatCapForBuild(state: Pick<BuildState, 'day' | 'purchasedSlots'>): number {
  return effectiveBoardCap(state) + COMBAT_CAP_BONUS;
}

/** Scrap cost of the next board slot this build could buy, or `undefined` if
 * it's already at (or the natural cap already reached) `BOARD_CAP`. */
export function nextSlotPrice(state: Pick<BuildState, 'day' | 'purchasedSlots'>): number | undefined {
  if (effectiveBoardCap(state) >= BOARD_CAP) return undefined;
  return SLOT_PRICES[state.purchasedSlots ?? 0];
}

// Synchronized seasons: a week runs Monday→Sunday, so the expedition day
// (1–7) is the ISO weekday of the ride-date, and the season id is the
// Monday that starts that week. Everyone shares the same clock.
export function weekdayFor(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  return d === 0 ? 7 : d; // 1=Mon … 7=Sun
}

export function seasonIdFor(date: string): string {
  const monday = new Date(`${date}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (weekdayFor(date) - 1));
  return monday.toISOString().slice(0, 10);
}

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
  /** Monday of the week this build belongs to (synchronized season id). */
  seasonId: string;
  /** Expedition day, 1..SEASON_DAYS (= ISO weekday of `date`). */
  day: number;
  scrap: number;
  board: BoardUnit[];
  /** Rats held out of the fight — never enter `simulate`. See BENCH_SIZE. */
  bench: BoardUnit[];
  teamRelicIds: string[];
  /** Extra board slots bought this expedition beyond the day's natural
   * `boardCapForDay` (see `SLOT_PRICES`/`buyBoardSlot`). 0..SLOT_PRICES.length,
   * carried across days by `advanceAfterDawn`, reset by `newBuild`. */
  purchasedSlots: number;
  shop: {
    slots: ShopSlot[];
    frozen: boolean[];
    rolls: number;
  };
}

export type ActionResult = { ok: true; state: BuildState } | { ok: false; reason: string };

const SHOP_UNIT_POOL = Object.values(UNIT_DEFS).filter((u) => u.id !== 'pup');
const SHOP_RELIC_POOL = Object.values(RELIC_DEFS);

/**
 * Day-gated shop pool (issue #12: Dawn-Runt/Dusk-Runt), same mechanism as
 * `boardCapForDay` — a pure function of the day number, no new per-account
 * state. Units with no `unlockDay` are available from day 1, exactly as
 * before this feature existed. Preserves `SHOP_UNIT_POOL`'s insertion order,
 * so for any day before the earliest `unlockDay` in play, this filters down
 * to byte-identical output to the old unconditional pool — existing golden
 * shop rolls for those days are unaffected.
 */
function shopUnitPoolForDay(day: number): UnitDef[] {
  return SHOP_UNIT_POOL.filter((u) => u.unlockDay === undefined || day >= u.unlockDay);
}

/**
 * Offerings are deterministic for a given (date, roll #, owned team relics,
 * day). A team relic the horde already carries can never be bought again, so
 * it's filtered out of the pool rather than rolled as a dead, unbuyable
 * stall. `day` defaults to 1 (the pre-#12 pool, minus Dawn-Runt/Dusk-Runt),
 * so callers that omit every optional argument (and the golden path) are
 * byte-identical to before.
 */
export function rollOfferings(
  date: string,
  roll: number,
  ownedTeamRelics: readonly string[] = [],
  day = 1
): ShopSlot[] {
  const rng = xorshift128(fnv1a(`${date}#shop#${roll}`));
  const unitPool = shopUnitPoolForDay(day);
  const relicPool = SHOP_RELIC_POOL.filter(
    (r) => !(r.scope === 'team' && ownedTeamRelics.includes(r.id))
  );
  const slots: ShopSlot[] = [];
  for (let i = 0; i < SHOP_UNIT_SLOTS; i++) {
    slots.push({ kind: 'unit', defId: unitPool[rng.int(unitPool.length)].id });
  }
  for (let i = 0; i < SHOP_RELIC_SLOTS; i++) {
    slots.push({ kind: 'relic', relicId: relicPool[rng.int(relicPool.length)].id });
  }
  return slots;
}

export function newBuild(date: string, day = 1, ownedTeamRelics: readonly string[] = []): BuildState {
  const slots = rollOfferings(date, 0, ownedTeamRelics, day);
  return {
    date,
    seasonId: seasonIdFor(date),
    day,
    scrap: DAILY_SCRAP,
    board: [],
    bench: [],
    teamRelicIds: [],
    purchasedSlots: 0,
    shop: { slots, frozen: slots.map(() => false), rolls: 0 },
  };
}

/**
 * The build for the dawn after `build` rode. Within a 7-day expedition the
 * horde (roster, tiers, relics) carries forward with a fresh shop and scrap
 * stipend; after the final day the expedition ends and a fresh one begins.
 */
export function advanceAfterDawn(build: BuildState, nextDate: string): BuildState {
  if (build.day >= SEASON_DAYS) return newBuild(nextDate, 1);
  const next = newBuild(nextDate, build.day + 1, build.teamRelicIds);
  next.board = build.board.map((u) => ({ ...u, relicIds: [...u.relicIds] }));
  next.bench = (build.bench ?? []).map((u) => ({ ...u, relicIds: [...u.relicIds] }));
  next.teamRelicIds = [...build.teamRelicIds];
  // Purchased board slots are an expedition-scoped upgrade, same lifetime as
  // the roster/relics they were bought to support — reset by newBuild only
  // when the season itself ends (the `build.day >= SEASON_DAYS` branch above).
  next.purchasedSlots = build.purchasedSlots ?? 0;
  // Scrap is accumulated idle income — it carries across days, not reset.
  next.scrap = build.scrap;
  return next;
}

const clone = (state: BuildState): BuildState => JSON.parse(JSON.stringify(state));

const fail = (reason: string): ActionResult => ({ ok: false, reason });

/**
 * Three copies of the same unit at the same tier merge into one, a tier up.
 * Merges resolve across board *and* bench (the whole point of the bench —
 * it relieves merge-3 frustration by letting stray copies wait there). A
 * match is scanned board-first, then bench, so the merged unit lands on the
 * board if any of the three copies was already fighting; otherwise it lands
 * on the bench. When the bench is empty this is byte-identical to the old
 * board-only combine.
 */
/**
 * Refund for a single relic lost outside of a direct sale (a merge-dedup
 * discard, or a relic pinned to a unit that's sold): half its cost, rounded
 * down, floored at 1 — matching the unit sell rate so neither path lets a
 * player launder power for free.
 */
function relicRefund(relicId: string): number {
  const cost = RELIC_DEFS[relicId]?.cost;
  return cost === undefined ? 0 : Math.max(1, Math.floor(cost / 2));
}

function combineAll(state: BuildState): void {
  for (;;) {
    // Tag each unit with its pool so the earliest match (board scanned
    // before bench) decides where the merged unit lands.
    type Tagged = { u: BoardUnit; pool: 'board' | 'bench'; idx: number };
    const pooled: Tagged[] = [
      ...state.board.map((u, idx): Tagged => ({ u, pool: 'board', idx })),
      ...state.bench.map((u, idx): Tagged => ({ u, pool: 'bench', idx })),
    ];
    let merged = false;
    for (const candidate of pooled) {
      if (candidate.u.tier >= MAX_TIER) continue;
      const matches = pooled.filter(
        ({ u }) => u.defId === candidate.u.defId && u.tier === candidate.u.tier
      );
      if (matches.length < 3) continue;
      const [first, second, third] = matches;
      first.u.tier += 1;
      // Merged veterans pool their trinkets, but the one-of-each rule holds:
      // duplicates across the three copies collapse into a single relic. A
      // relic carried by more than one copy would otherwise be silently
      // destroyed for free, so each discarded duplicate is refunded at half
      // its cost (matching the unit sell rate — a full refund let you buy
      // power for free early on).
      const allRelics = [...first.u.relicIds, ...second.u.relicIds, ...third.u.relicIds];
      const counts = new Map<string, number>();
      for (const id of allRelics) counts.set(id, (counts.get(id) ?? 0) + 1);
      let refund = 0;
      for (const [id, count] of counts) {
        if (count > 1) refund += (count - 1) * relicRefund(id);
      }
      state.scrap += refund;
      first.u.relicIds = [...new Set(allRelics)];
      // Remove the other two copies from whichever pool they occupy, higher
      // index first so splicing one doesn't shift the other's index.
      for (const rest of [second, third].sort((a, b) => b.idx - a.idx)) {
        (rest.pool === 'board' ? state.board : state.bench).splice(rest.idx, 1);
      }
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
  const cap = effectiveBoardCap(s);
  const fresh: BoardUnit = { defId: def.id, tier: 1, relicIds: [] };
  // Place-then-merge-then-check: put the fresh copy down first so combineAll
  // gets a chance to resolve a completing trio (which nets fewer units and
  // frees the space it just took). Board is preferred since it's what fights;
  // otherwise the copy goes on the bench UNCONDITIONALLY — even when the bench
  // is already full — as a temporary overflow. If nothing merges, the
  // post-combine cap checks below reject the buy and the clone `s` (with its
  // scrap already spent) is discarded, so the caller's state is untouched.
  if (s.board.length < cap) s.board.push(fresh);
  else s.bench.push(fresh);
  s.scrap -= def.cost;
  combineAll(s);
  // The real guardrails: run *after* the combine so a third-of-a-kind bought
  // onto a full board/bench is allowed (a completing merge shrank the pool),
  // while a buy that merged nothing and left the overflow in place is rejected.
  if (s.board.length > cap) return fail('the warren is full');
  if (s.bench.length > BENCH_SIZE) return fail('the bench is full');
  s.shop.slots[slotIndex] = { kind: 'empty' };
  s.shop.frozen[slotIndex] = false;
  return { ok: true, state: s };
}

/** Would recruiting this slot succeed (afford + fits or completes a combine)? */
export function canRecruit(state: BuildState, slotIndex: number): boolean {
  return buyUnit(state, slotIndex).ok;
}

/**
 * Whether at least one board rat could still receive this unit-scoped relic
 * (i.e. lacks it already). Team-scoped relics aren't pinned to a rat, so this
 * only makes sense for `scope: 'unit'` relics — used to gate the buy button
 * (and avoid arming "pick a rat to carry it") before every possible target
 * would be rejected by `buyRelic`'s per-rat 'that rat already carries one'
 * check. Also covers the degenerate case of an empty board (nothing to pin
 * to at all), which would otherwise soft-lock the same way.
 */
export function hasValidRelicTarget(state: BuildState, relicId: string): boolean {
  return state.board.some((u) => !u.relicIds.includes(relicId));
}

export function buyRelic(state: BuildState, slotIndex: number, targetIndex?: number): ActionResult {
  const slot = state.shop.slots[slotIndex];
  if (!slot || slot.kind !== 'relic') return fail('no relic there');
  const relic = RELIC_DEFS[slot.relicId];
  if (state.scrap < relic.cost) return fail('not enough scrap');
  if (relic.scope === 'unit' && (targetIndex === undefined || !state.board[targetIndex])) {
    return fail('pick a rat to carry it');
  }
  // One of each trinket per carrier: duplicate stacking is either degenerate
  // (Rusted Nail forever) or a silent no-op (a second Tail-Charm), so both
  // are rejected outright rather than sold as traps.
  if (relic.scope === 'unit' && state.board[targetIndex!].relicIds.includes(relic.id)) {
    return fail('that rat already carries one');
  }
  if (relic.scope === 'team' && state.teamRelicIds.includes(relic.id)) {
    return fail('the horde already carries one');
  }
  const s = clone(state);
  s.scrap -= relic.cost;
  if (relic.scope === 'team') s.teamRelicIds.push(relic.id);
  else s.board[targetIndex!].relicIds.push(relic.id);
  s.shop.slots[slotIndex] = { kind: 'empty' };
  s.shop.frozen[slotIndex] = false;
  // A team relic can only be held once, so clear any *other* stall in the
  // current shop still offering it — it just became unbuyable. (Future rolls
  // already exclude it via rollOfferings.)
  if (relic.scope === 'team') {
    for (let i = 0; i < s.shop.slots.length; i++) {
      const other = s.shop.slots[i];
      if (other.kind === 'relic' && other.relicId === relic.id) {
        s.shop.slots[i] = { kind: 'empty' };
        s.shop.frozen[i] = false;
      }
    }
  }
  return { ok: true, state: s };
}

export function sellUnit(state: BuildState, boardIndex: number): ActionResult {
  const unit = state.board[boardIndex];
  if (!unit) return fail('nothing to sell');
  const s = clone(state);
  s.board.splice(boardIndex, 1);
  s.scrap += sellRefund(unit);
  // Any relics pinned to the sold unit would otherwise vanish for free —
  // refund each at the same half-cost rate as the merge-dedup discard path.
  for (const relicId of unit.relicIds) s.scrap += relicRefund(relicId);
  return { ok: true, state: s };
}

export function sellBenchUnit(state: BuildState, benchIndex: number): ActionResult {
  const unit = state.bench[benchIndex];
  if (!unit) return fail('nothing to sell');
  const s = clone(state);
  s.bench.splice(benchIndex, 1);
  s.scrap += sellRefund(unit);
  for (const relicId of unit.relicIds) s.scrap += relicRefund(relicId);
  return { ok: true, state: s };
}

/**
 * Half the unit's base cost, scaled by `tier²` (issue #21). Reaching tier N
 * via merges costs `N²` base copies (3 tier-k copies merge into 1 tier-(k+1),
 * so a tier-3 unit represents 9 base copies), so a linear-in-tier refund
 * significantly undervalued merged units relative to the scrap actually
 * spent building them. Quadratic scaling matches that merge-cost economics.
 */
export function sellRefund(unit: BoardUnit): number {
  const cost = UNIT_DEFS[unit.defId].cost;
  return Math.max(1, Math.floor(cost / 2)) * unit.tier * unit.tier;
}

export function rerollShop(state: BuildState): ActionResult {
  if (state.scrap < REROLL_COST) return fail('not enough scrap to reroll');
  const s = clone(state);
  s.scrap -= REROLL_COST;
  s.shop.rolls += 1;
  const fresh = rollOfferings(s.date, s.shop.rolls, s.teamRelicIds, s.day);
  s.shop.slots = s.shop.slots.map((old, i) =>
    s.shop.frozen[i] && old.kind !== 'empty' ? old : fresh[i]
  );
  return { ok: true, state: s };
}

/** Check if all shop slots are empty (every stall has been bought). */
export function isShopDead(state: BuildState): boolean {
  return state.shop.slots.every((slot) => slot.kind === 'empty');
}

/** Auto-reroll the shop for free when all stalls are bought. This does NOT
 * consume scrap — the only thing that distinguishes this from `rerollShop`.
 * `shop.rolls` is purely an internal seed counter for `rollOfferings` (never
 * shown to the player or used for cost scaling), so it must still advance
 * here — otherwise the next manual reroll would reuse the same roll number
 * and hand back an identical shop, silently wasting the player's scrap. */
export function autoRerollShop(state: BuildState): ActionResult {
  if (!isShopDead(state)) return { ok: false, reason: 'shop is not dead' };
  const s = clone(state);
  s.shop.rolls += 1;
  const fresh = rollOfferings(s.date, s.shop.rolls, s.teamRelicIds, s.day);
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

/** Pull a board unit out of the fight and onto the bench — e.g. to hold a
 * counter-tech rat you don't want fighting right now, or to park a copy
 * while hunting the 3rd for a merge. */
export function benchUnit(state: BuildState, boardIndex: number): ActionResult {
  const unit = state.board[boardIndex];
  if (!unit) return fail('nothing to bench');
  if (state.bench.length >= BENCH_SIZE) return fail('the bench is full');
  const s = clone(state);
  const [moved] = s.board.splice(boardIndex, 1);
  s.bench.push(moved);
  return { ok: true, state: s };
}

/** Send a bench unit into the fight. Inserts at `toBoardIndex` if given
 * (front-of-board conventions match `moveUnit`), else appends to the back.
 * Runs `combineAll` afterward since deploying can complete a trio that spans
 * board+bench. */
export function deployUnit(state: BuildState, benchIndex: number, toBoardIndex?: number): ActionResult {
  const unit = state.bench[benchIndex];
  if (!unit) return fail('nothing to deploy');
  if (state.board.length >= effectiveBoardCap(state)) return fail('the warren is full');
  const s = clone(state);
  const [moved] = s.bench.splice(benchIndex, 1);
  const insertAt =
    toBoardIndex === undefined || toBoardIndex < 0 || toBoardIndex > s.board.length
      ? s.board.length
      : toBoardIndex;
  s.board.splice(insertAt, 0, moved);
  combineAll(s);
  return { ok: true, state: s };
}

/** Swap a board rat for a bench rat directly — no sale needed even when both
 * are full, since the counts on each side are unchanged. Runs `combineAll`
 * afterward defensively for consistency/idempotency, though a pure swap
 * can't complete a trio (the combined multiset is unchanged). */
export function swapWithBench(state: BuildState, boardIndex: number, benchIndex: number): ActionResult {
  if (!state.board[boardIndex]) return fail('no rat there to swap out');
  if (!state.bench[benchIndex]) return fail('no rat there to swap in');
  const s = clone(state);
  const boardUnit = s.board[boardIndex];
  const benchUnit = s.bench[benchIndex];
  s.board[boardIndex] = benchUnit;
  s.bench[benchIndex] = boardUnit;
  combineAll(s);
  return { ok: true, state: s };
}

export function lineupFromBuild(state: BuildState): Lineup {
  return {
    units: state.board.map((u) => ({ defId: u.defId, tier: u.tier, relicIds: u.relicIds })),
    teamRelicIds: state.teamRelicIds,
    combatCap: combatCapForBuild(state),
  };
}

/**
 * Buy the next board slot beyond the day's natural cap (see `SLOT_PRICES`).
 * Fails once the build's effective board cap already reached `BOARD_CAP` —
 * either because all purchasable slots are bought, or because the day's own
 * `boardCapForDay` growth reached the hard cap on its own (day 7).
 */
export function buyBoardSlot(state: BuildState): ActionResult {
  if (effectiveBoardCap(state) >= BOARD_CAP) return fail('the warren is already at its hard cap');
  const price = SLOT_PRICES[state.purchasedSlots ?? 0];
  if (price === undefined) return fail('no more slots to buy');
  if (state.scrap < price) return fail('not enough scrap');
  const s = clone(state);
  s.scrap -= price;
  s.purchasedSlots = (s.purchasedSlots ?? 0) + 1;
  return { ok: true, state: s };
}

export function unitStats(unit: BoardUnit): { attack: number; health: number } {
  const def = UNIT_DEFS[unit.defId];
  return {
    attack: def.attack * tierAttackMultiplier(unit.tier),
    health: def.health * tierHealthMultiplier(unit.tier),
  };
}
