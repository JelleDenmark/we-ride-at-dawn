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
export const BENCH_SIZE = 5;

// Idle economy: the horde skirmishes hourly, earning scrap per wave cleared.
export const SCRAP_PER_DEPTH = 1;

// Income decoupling (issue #90). Income used to be a flat `depth *
// SCRAP_PER_DEPTH` — every extra wave cleared paid the same, so ANY change
// that let players push deeper (roster acceleration #91, enemy softening #92)
// inflated the bank in lockstep, snowballing the economy #70 just tuned. So
// income is now DIMINISHING in depth, in three tiers: full rate through
// `SCRAP_FULL_DEPTH`, then `SCRAP_DEEP_RATE` through `SCRAP_MID_DEPTH`, then
// `SCRAP_FAR_RATE` beyond. This keeps the LEADERBOARD chase from snowballing
// the bank while leaving score itself raw, undiminished depth — depth is the
// prestige metric.
//
// full=8 is a DELIBERATE mild surplus, not income-neutral: with #91's deeper
// median it lands week income ~1140 (~+12% over the pre-#90 ~1020 baseline,
// see snowball §5/§7). The neutral value was 7; Jesper chose 8 (2026-07-11) so
// a merge-fishing player has scrap to actually chase a T3 unit — a rewarding
// payoff — rather than banking an unspendable surplus against a too-tight
// economy. Income is NOT the real T3 gate (fishing RNG is), so this is a small
// generosity lever to validate with live feedback next season, not a fix.
//
// deep=0.5 (was 0.4, 2026-07-14): the flooring at 0.4 created a 3-depth dead
// zone (e.g. depth 8/9/10 all paid identically) that read as "no reward for
// progressing." 0.5 halves the worst-case dead zone to 2 depths — feel over
// precision, per Jesper. This alone would also push a typical week's income
// to ~1332 (+17% over the 1140 baseline) for players who mostly live in the
// 8-16 band, which was accepted as a deliberate tradeoff for the improved
// feel. To keep that from ALSO inflating the elite/leaderboard tail (depth
// 20-43 runs), `SCRAP_FAR_RATE`=0.34 kicks in past `SCRAP_MID_DEPTH`=16 and
// pulls deep-run income back to within ~1 scrap of the old flat-0.4 curve
// (e.g. depth 43: 22 old vs 21 new) — so the generosity lands on the typical
// player's mid-game, not on runaway leaderboard-depth income.
export const SCRAP_FULL_DEPTH = 8;
export const SCRAP_DEEP_RATE = 0.5;
export const SCRAP_MID_DEPTH = 16;
export const SCRAP_FAR_RATE = 0.34;

/**
 * Scrap earned for clearing `depth` waves in one ride — the single source of
 * truth for idle income (issue #90), so app, balance scripts, and any future
 * server re-sim agree. Diminishing past `SCRAP_FULL_DEPTH`; floored to keep
 * the economy integer (scrap is spent in whole units everywhere). NOTE: this
 * is INCOME only — leaderboard score / max-depth is still raw `depth`.
 */
export function scrapForDepth(depth: number): number {
  const full = Math.min(depth, SCRAP_FULL_DEPTH);
  const mid = Math.max(0, Math.min(depth, SCRAP_MID_DEPTH) - SCRAP_FULL_DEPTH);
  const far = Math.max(0, depth - SCRAP_MID_DEPTH);
  return Math.floor(full * SCRAP_PER_DEPTH + mid * SCRAP_DEEP_RATE + far * SCRAP_FAR_RATE);
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
//
// `date.slice(0, 10)` keeps this reading only the YYYY-MM-DD prefix: a season
// id may carry a re-issue suffix (see SEASON_REISSUES), and weekdayFor must
// still resolve it to the real weekday. Ride-dates are already bare 10-char
// dates, so the slice is a no-op for them.
export function weekdayFor(date: string): number {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  return d === 0 ? 7 : d; // 1=Mon … 7=Sun
}

// Mid-season re-issues: when a live season has to be restarted in place — e.g.
// the 2026-07-13 cross-platform seed divergence, where iOS and Android hashed
// different ride-date strings into different shops/gauntlets — we bump its id
// to a new token instead of wiping the leaderboard DB by hand. A reissued id:
//   (a) sorts lexicographically AFTER the original (a suffix on the same
//       prefix always does), so every client's stored build resets via the
//       App's `build.seasonId < season` dawn-rollover check;
//   (b) is a brand-new leaderboard key, so the board starts empty and the old
//       rows are simply orphaned under the old id (no deletion needed);
//   (c) fails the local season-best/kills equality check (both are keyed by
//       the season id string), so those reset too;
//   (d) reseeds the week's gauntlet.
// The token keeps the natural Monday date as its first 10 chars, so weekdayFor
// and the UI's "Week of" label still read the true date. It still sorts before
// the next natural Monday (the day-of-month digit dominates), so next week
// rolls over normally.
const SEASON_REISSUES: Record<string, string> = {
  '2026-07-13': '2026-07-13.2',
};

export function seasonIdFor(date: string): string {
  const monday = new Date(`${date}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (weekdayFor(date) - 1));
  const id = monday.toISOString().slice(0, 10);
  return SEASON_REISSUES[id] ?? id;
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

// Season-3 reskin rotation (issue #115). The prestige tribute swaps every
// season, so the reskin exclusions flip with it:
//   - 'blight-witch' is excluded now: Draughtsman Moe (season-3 tribute to
//     RatMoe) is a same-kit reskin of it, and having both in rotation is
//     redundant (no-redundant-kits rule).
//   - 'md-rattyfock' is excluded, and 'warren-warden' is BROUGHT BACK: last
//     season Rattyfock reskinned Warren-Warden, but with Rattyfock retired the
//     pair is no longer redundant, so Warren-Warden returns to the pool.
// Every excluded def stays intact in UNIT_DEFS (tests/golden logs/replays
// reference them directly) — only presence in the purchasable pool changes.
//
// 'dawn-runt'/'dusk-runt' are excluded the same way (issue #109), but for a
// different reason: they're being REPLACED by the Twilight fusion unit, not
// aged out mid-week, so `retireDay` (a pure function of day, still mid-week
// live) is the wrong tool — a half-day-gated unit already read as "a
// schedule tax, not a decision" (a player who only rides evenings never
// bought Dawn-Runt), and the fusion issue's design post-mortem lands on a
// flat pool cut instead. Ship this at a season boundary only, so no
// mid-expedition owner is stranded. Their UNIT_DEFS entries stay intact
// (golden logs) — only the purchasable pool changes.
const SHOP_UNIT_POOL = Object.values(UNIT_DEFS).filter(
  (u) =>
    // Internal summon-only bodies (pup, and issue #105's brood-broodling /
    // brood-runt cascade) are all cost-0 and must never be shop-rollable or
    // browsable — excluding by cost covers every current and future one
    // without an ever-growing id blocklist.
    u.cost > 0 &&
    u.id !== 'blight-witch' &&
    u.id !== 'md-rattyfock' &&
    u.id !== 'dawn-runt' &&
    u.id !== 'dusk-runt'
);
const SHOP_RELIC_POOL = Object.values(RELIC_DEFS);

/**
 * Day-gated shop pool (issue #12: Dawn-Runt/Dusk-Runt originally; now also
 * issue #108's `retireDay`), same mechanism as `boardCapForDay` — a pure
 * function of the day number, no new per-account state. Units with no
 * `unlockDay`/`retireDay` are available every day, exactly as before either
 * feature existed. A unit is in the pool for `unlockDay <= day < retireDay`
 * (both bounds optional/inclusive-exclusive as written). Preserves
 * `SHOP_UNIT_POOL`'s insertion order, so for any day before the earliest
 * `unlockDay` and before the earliest `retireDay` in play, this filters down
 * to byte-identical output to the old unconditional pool — existing golden
 * shop rolls for those days are unaffected.
 *
 * Exported (issue #136) so the compendium can list exactly the rats a
 * player can actually obtain this week — same day gate, same permanent
 * pool exclusions (pup/blight-witch/md-rattyfock/dawn-runt/dusk-runt) — no
 * second filter to keep in sync.
 */
export function shopUnitPoolForDay(day: number): UnitDef[] {
  return SHOP_UNIT_POOL.filter(
    (u) =>
      (u.unlockDay === undefined || day >= u.unlockDay) &&
      (u.retireDay === undefined || day < u.retireDay)
  );
}

/**
 * Every rat obtainable in the shop on ANY day this season (issue #136
 * follow-up) — the compendium's "will I ever see this" filter, as opposed to
 * `shopUnitPoolForDay`'s "right now." A not-yet-unlocked rat still counts
 * (it unlocks later this week); a rat whose `retireDay` has already passed
 * for every day 1..SEASON_DAYS (e.g. `retireDay: 1`), or one excluded from
 * `SHOP_UNIT_POOL` entirely (replaced units — Pup, Blight-Witch, ...),
 * never does. Union over the season, same underlying rule, no second filter
 * to keep in sync.
 */
export function seasonUnitPool(): UnitDef[] {
  const seen = new Set<string>();
  const result: UnitDef[] = [];
  for (let day = 1; day <= SEASON_DAYS; day++) {
    for (const u of shopUnitPoolForDay(day)) {
      if (!seen.has(u.id)) {
        seen.add(u.id);
        result.push(u);
      }
    }
  }
  return result;
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
 * Units still in the pool on `day` but leaving later this week, soonest
 * first (issue #108) — mirrors `upcomingUnlocks` so the app can show a
 * "leaving soon" hint before a unit quietly vanishes from the rolls. Pure
 * function of `day`, same shape as `upcomingUnlocks`/`shopUnitPoolForDay`.
 */
export function upcomingRetirements(day: number): UnitDef[] {
  return SHOP_UNIT_POOL.filter((u) => u.retireDay !== undefined && u.retireDay > day).sort(
    (a, b) => (a.retireDay ?? 0) - (b.retireDay ?? 0)
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
  s.scrap += sellRefund(unit, state.day);
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
  s.scrap += sellRefund(unit, state.day);
  for (const relicId of unit.relicIds) s.scrap += relicRefund(relicId);
  return { ok: true, state: s };
}

/**
 * Half the unit's base cost, scaled by `tier²` (issue #21). Reaching tier N
 * via merges costs `N²` base copies (3 tier-k copies merge into 1 tier-(k+1),
 * so a tier-3 unit represents 9 base copies), so a linear-in-tier refund
 * significantly undervalued merged units relative to the scrap actually
 * spent building them. Quadratic scaling matches that merge-cost economics.
 *
 * SEVERANCE (issue #108): once a unit's `retireDay` has passed — it needs
 * `day` for that, hence this function's second parameter — the quadratic
 * discount is replaced by a par buyback: `cost * 3^(tier-1)`, exactly the
 * scrap spent reaching that tier (1/3/9 base copies per tier, same curve as
 * `tierAttackMultiplier`). This is deliberately PAR, never above: a naive
 * `cost * tier²` would pay 4x cost for a tier-2 that only cost 3x to build —
 * a repeatable scrap printer via buy-3 -> merge -> sell (the compounding-law
 * risk this feature is guarded against, see compounding-law.test.ts's
 * canary). Non-retired units are completely untouched by this — same
 * `Math.max(1, floor(cost/2)) * tier²` as before, byte-identical.
 */
export function sellRefund(unit: BoardUnit, day: number): number {
  const def = UNIT_DEFS[unit.defId];
  if (def.retireDay !== undefined && day >= def.retireDay) {
    return def.cost * Math.pow(3, unit.tier - 1);
  }
  return Math.max(1, Math.floor(def.cost / 2)) * unit.tier * unit.tier;
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

/** Whether the shop has no rats left to buy — every unit stall has been
 * bought out. Relic stalls are ignored: a player who's cleared all the rats
 * has spent the shop's main purpose, so we refresh even if unaffordable /
 * unwanted relics still linger (the screenshot dead-end where 0-scrap players
 * stared at 4 empty rat stalls + 2 stuck relics). A freshly rolled shop always
 * carries units again, so this can never re-fire on its own output — no free
 * reroll loop. Freezing a relic still keeps it across the reroll (see
 * autoRerollShop), so nothing worth saving is lost. */
export function isShopDead(state: BuildState): boolean {
  return !state.shop.slots.some((slot) => slot.kind === 'unit');
}

/** Auto-reroll the shop for free when every rat stall is bought out. This does
 * NOT consume scrap — the only thing that distinguishes this from `rerollShop`.
 * `shop.rolls` is purely an internal seed counter for `rollOfferings` (never
 * shown to the player or used for cost scaling), so it must still advance
 * here — otherwise the next manual reroll would reuse the same roll number
 * and hand back an identical shop, silently wasting the player's scrap.
 * Non-empty frozen stalls (incl. relics) are preserved, same as rerollShop. */
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
