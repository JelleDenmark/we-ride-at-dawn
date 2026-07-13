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

// Idle economy: the horde skirmishes hourly, earning scrap per wave cleared.
// Interest (TFT-style, 5% of the bank, capped) is paid once per DAY at dawn,
// not per hour — the daily cadence + cap keep the bank from snowballing over
// the hundreds of hours in an expedition.
export const SCRAP_PER_DEPTH = 1;
export const INTEREST_RATE = 0.05;
export const INTEREST_CAP = 5;

// Income decoupling (issue #90). Income used to be a flat `depth *
// SCRAP_PER_DEPTH` — every extra wave cleared paid the same, so ANY change
// that let players push deeper (roster acceleration #91, enemy softening #92)
// inflated the bank in lockstep, snowballing the economy #70 just tuned. So
// income is now DIMINISHING in depth: the first `SCRAP_FULL_DEPTH` waves pay
// full rate, and every wave beyond pays the reduced `SCRAP_DEEP_RATE`. This
// keeps the LEADERBOARD chase from snowballing the bank (a depth-30 run is
// still mostly paid at the 0.4 deep rate) while leaving score itself raw,
// undiminished depth — depth is the prestige metric.
//
// full=8 is a DELIBERATE mild surplus, not income-neutral: with #91's deeper
// median it lands week income ~1140 (~+12% over the pre-#90 ~1020 baseline,
// see snowball §5/§7). The neutral value was 7; Jesper chose 8 (2026-07-11) so
// a merge-fishing player has scrap to actually chase a T3 unit — a rewarding
// payoff — rather than banking an unspendable surplus against a too-tight
// economy. Income is NOT the real T3 gate (fishing RNG is), so this is a small
// generosity lever to validate with live feedback next season, not a fix.
export const SCRAP_FULL_DEPTH = 8;
export const SCRAP_DEEP_RATE = 0.4;

/**
 * Scrap earned for clearing `depth` waves in one ride — the single source of
 * truth for idle income (issue #90), so app, balance scripts, and any future
 * server re-sim agree. Diminishing past `SCRAP_FULL_DEPTH`; floored to keep
 * the economy integer (scrap is spent in whole units everywhere). NOTE: this
 * is INCOME only — leaderboard score / max-depth is still raw `depth`.
 */
export function scrapForDepth(depth: number): number {
  const full = Math.min(depth, SCRAP_FULL_DEPTH);
  const deep = Math.max(0, depth - SCRAP_FULL_DEPTH);
  return Math.floor(full * SCRAP_PER_DEPTH + deep * SCRAP_DEEP_RATE);
}

export function interestFor(scrap: number): number {
  return Math.min(INTEREST_CAP, Math.floor(scrap * INTEREST_RATE));
}

/** Starting/day-1 board size floor. The board opens at 5 seats on day 1 and
 * grows for free over the week (see `BOARD_GROWTH`). */
export const BOARD_FLOOR = 5;

/**
 * Free board growth by expedition day (issue #91). `BOARD_GROWTH[day-1]` is
 * the number of seats the horde gets for free on that day, no purchase
 * required: 5,6,6,7,7,7,7 — the 6th seat opens on day 2, the 7th by day 4,
 * then it holds.
 *
 * WHY THIS EXISTS / #70 TENSION: issue #70 froze the board at a flat 5 all
 * week and made every seat beyond it a steep buy (`SLOT_PRICES`). That made
 * the top slots feel "earned", but it was ALSO the single biggest throttle on
 * progression: the median player never expands past 5 units, so against a
 * season-fixed 45-wave gauntlet their depth goes flat after ~day 4 (measured:
 * snowball §7 plateaued at ~7.9 days 5-7). #91 restores free growth to 7 to
 * give the median horde room to actually get deeper day-to-day, while keeping
 * the 8th (final) seat purchase-only (`SLOT_PRICES[0]`) so #70's "earned top
 * slot" survives in spirit — it's now ONE deliberate late purchase, not three.
 * The curve is FRONT-LOADED (6th seat on day 2, not day 3): day 1 is a
 * build-only freeze, so day 2 is the first real grind day and the one players
 * quit on — opening a visible new seat there is the "don't give up day 2" hook.
 */
export const BOARD_GROWTH: readonly number[] = [5, 6, 6, 7, 7, 7, 7];

/** Buildable board size for a given expedition day (1..7): the free-growth
 * seats for that day (`BOARD_GROWTH`), before any purchased slots stack on
 * top (see `effectiveBoardCap`). Days outside 1..7 clamp to the ends. */
export function boardCapForDay(day: number): number {
  const idx = Math.min(BOARD_GROWTH.length, Math.max(1, day)) - 1;
  return BOARD_GROWTH[idx];
}

/**
 * Buy extra board seats beyond the day's free-growth cap (`BOARD_GROWTH`), up
 * to the hard `BOARD_CAP = 8` ceiling. Purchased slots persist for the rest of
 * the expedition (carried by `advanceAfterDawn`, reset to 0 on a fresh season
 * by `newBuild`) and stack additively ON TOP of free growth:
 * `effectiveBoardCap = min(BOARD_CAP, boardCapForDay(day) + purchasedSlots)`.
 *
 * HISTORY / #70 → #91: issue #70 removed all free growth (flat 5 all week) and
 * made SLOT_PRICES = [60,120,220] the only path from 5 to 8. That over-gated
 * progression (see `BOARD_GROWTH`), so #91 restored free growth to 7. With
 * free growth back, the price index (`SLOT_PRICES[purchasedSlots]`) now buys:
 *   - for the PATIENT player (free growth already gave them 7 by day 5): a
 *     single purchase to reach the 8th and final seat, at SLOT_PRICES[0] = 60
 *     — a steep-but-reachable "earned top slot" (60 > 2× the DAILY_SCRAP
 *     stipend), preserving #70's intent for that last seat;
 *   - for the IMPATIENT player who wants seats ahead of free growth (e.g. an
 *     8-wide board on day 1-2 before growth catches up): the full 60/120/220
 *     ladder for those 2-3 early seats — a genuine multi-day sink, a deliberate
 *     "pay to rush" premium over just waiting for the free seats.
 * `scripts/slot-value.ts` models each seat's weekly scrap-equivalent value.
 */
export const SLOT_PRICES: readonly number[] = [60, 120, 220];

/** How many rats the board may hold given the day's natural cap plus any
 * board slots this build has purchased, hard-capped at `BOARD_CAP`. */
export function effectiveBoardCap(state: Pick<BuildState, 'day' | 'purchasedSlots'>): number {
  return Math.min(BOARD_CAP, boardCapForDay(state.day) + (state.purchasedSlots ?? 0));
}

/**
 * Combat headroom for a specific build (issue #69): however many rats are
 * actually deployed on the board right now, plus `COMBAT_CAP_BONUS` summon
 * headroom. Deliberately dynamic rather than board-cap-derived — a summoner
 * always gets exactly 2 extra slots over whatever's really fielded, so it's
 * always useful (a thin board still gets headroom) but never a runaway
 * ceiling (a full board doesn't bank extra slots beyond +2 just because the
 * day's board cap or purchased slots are large). Recruiting itself is
 * unaffected — that's still gated by `effectiveBoardCap`.
 */
export function combatCapForBuild(state: Pick<BuildState, 'board'>): number {
  return state.board.length + COMBAT_CAP_BONUS;
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

// 'warren-warden' is excluded seasonally, not permanently: MD Rattyfock
// (issue #23) is a same-stats reskin of it, added as a tribute to last
// season's winner, and having both in rotation at once is redundant. Its
// UNIT_DEFS entry stays intact (existing tests/golden logs/replays still
// reference it directly) — only its presence in the purchasable pool is
// gone. A future season could drop this filter to bring it back.
const SHOP_UNIT_POOL = Object.values(UNIT_DEFS).filter(
  (u) => u.id !== 'pup' && u.id !== 'warren-warden'
);
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
 * Units still locked on `day` but arriving later this week, soonest first —
 * lets the app tell players new rats are coming instead of them only
 * noticing once the pool quietly grows (there was no such signal until this
 * was added; players had no way to know day-gated units existed at all).
 * Pure function of `day`, same shape as `shopUnitPoolForDay`.
 */
export function upcomingUnlocks(day: number): UnitDef[] {
  return SHOP_UNIT_POOL.filter((u) => u.unlockDay !== undefined && u.unlockDay > day).sort(
    (a, b) => (a.unlockDay ?? 0) - (b.unlockDay ?? 0)
  );
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
 * Refund for a single relic lost outside of a direct sale (a merge-dedup
 * discard, or a relic pinned to a unit that's sold): half its cost, rounded
 * down, floored at 1 — matching the unit sell rate so neither path lets a
 * player launder power for free.
 */
function relicRefund(relicId: string): number {
  const cost = RELIC_DEFS[relicId]?.cost;
  return cost === undefined ? 0 : Math.max(1, Math.floor(cost / 2));
}

/**
 * Three copies of the same unit at the same tier merge into one, a tier up.
 * Merges resolve across board *and* bench (the whole point of the bench —
 * it relieves merge-3 frustration by letting stray copies wait there). A
 * match is scanned board-first, then bench, so the merged unit lands on the
 * board if any of the three copies was already fighting; otherwise it lands
 * on the bench. When the bench is empty this is byte-identical to the old
 * board-only combine.
 */
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
