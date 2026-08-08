/**
 * #165 follow-up probe: does the proposed "Grown Past Use" Trial anomaly let
 * a comp ever hold TWO separate tier-3 copies of the SAME unit?
 *
 * Grown Past Use (posted to #165, not shipped — no AnomalyDef or shop.ts hook
 * exists yet) excludes a defId from the shop's unit pool for the rest of the
 * week the instant any copy of it reaches MAX_TIER on board or bench, live
 * re-derived every roll — same mechanism as the existing owned-team-relic
 * filter in `rollOfferings`. `original` and `press-kin-core`
 * (anomaly-guardrail.ts / maxed-board-guardrail.ts) each fixture a maxed
 * board carrying two separate 3-star copies of one defId (dire-rat,
 * md-rattyfock) — 18 base copies total, 9 per copy. The issue thread flagged
 * this as open: "does the anomaly need its own probe script to confirm."
 *
 * This isn't shipped code. It re-implements just Grown Past Use's exclusion
 * rule as a wrapper around a real BuildState, using the REAL `buyUnit`
 * (so the actual auto-merge/`combineAll` timing decides things, not a
 * hand-argued estimate) and the REAL `toggleFreeze` semantics (a frozen slot
 * survives a reroll untouched, even one the live pool filter would now
 * reject). `rollOfferings`/`rerollShop`/`advanceAfterDawn` are re-derived
 * locally only because none of them take an exclusion-set parameter today.
 *
 * Two passes:
 *   1) STRUCTURAL CEILING — unlimited scrap/rerolls, one best-case hoarder,
 *      single day (a day boundary always resets frozen slots and re-rolls
 *      from scratch, so nothing carries past it once excluded). Answers
 *      "what's the most copies of one defId obtainable, ever, full stop."
 *   2) REALISTIC ECONOMY — the same hoarder policy but paying real
 *      DAILY_SCRAP / REROLL_COST across a full SEASON_DAYS week, Monte
 *      Carlo'd over many seeded weeks. Answers "how close does an actual
 *      player who tunnel-visions on this one unit get."
 *
 * Run: npx tsx scripts/grown-past-use-reachability-probe.ts   (from packages/core)
 */
import { fnv1a } from '../src/seed';
import { xorshift128 } from '../src/prng';
import {
  newBuild,
  advanceAfterDawn,
  buyUnit,
  toggleFreeze,
  shopUnitPoolForDay,
  SHOP_UNIT_SLOTS,
  SEASON_DAYS,
  REROLL_COST,
  MAX_TIER,
  type BuildState,
  type ShopSlot,
} from '../src/shop';

const TARGET_COMPS: Record<string, string> = {
  original: 'dire-rat',
  'press-kin-core': 'md-rattyfock',
};
const COPIES_PER_TIER3 = MAX_TIER * MAX_TIER; // 3 tier-1 -> 1 tier-2, 3 tier-2 -> 1 tier-3: 9
const COPIES_NEEDED_FOR_TWO = COPIES_PER_TIER3 * 2; // 18

/** Same derivation `rollOfferings` uses, minus relic slots (never touched by
 * this probe) and with the hypothetical live exclusion filter applied to the
 * unit pool before sampling — the exact spot `ownedTeamRelics` already
 * filters `SHOP_RELIC_POOL` in the real function. */
function rollUnitsExcluding(date: string, roll: number, day: number, excluded: ReadonlySet<string>): ShopSlot[] {
  const rng = xorshift128(fnv1a(`${date}#shop#${roll}`));
  const pool = shopUnitPoolForDay(day).filter((u) => !excluded.has(u.id));
  const slots: ShopSlot[] = [];
  for (let i = 0; i < SHOP_UNIT_SLOTS; i++) {
    slots.push({ kind: 'unit', defId: pool[rng.int(pool.length)].id });
  }
  return slots;
}

function excludedDefIds(state: BuildState): Set<string> {
  return new Set(
    [...state.board, ...state.bench].filter((u) => u.tier >= MAX_TIER).map((u) => u.defId)
  );
}

/** Real `rerollShop`, minus scrap deduction (pass 1 wants unlimited rerolls
 * to isolate the structural question from the economy question) and with
 * the exclusion-aware roll swapped in. Frozen slots pass through untouched,
 * identical to the real function — that's what lets a pre-frozen copy
 * survive past the moment its defId gets excluded. */
function rerollFree(state: BuildState, excluded: ReadonlySet<string>): BuildState {
  const s: BuildState = JSON.parse(JSON.stringify(state));
  s.shop.rolls += 1;
  const fresh = rollUnitsExcluding(s.date, s.shop.rolls, s.day, excluded);
  s.shop.slots = s.shop.slots.map((old, i) => (s.shop.frozen[i] && old.kind !== 'empty' ? old : fresh[i]));
  return s;
}

/** Real `rerollShop`, paying REROLL_COST, exclusion-aware roll swapped in. */
function rerollPaid(state: BuildState, excluded: ReadonlySet<string>): { ok: boolean; state: BuildState } {
  if (state.scrap < REROLL_COST) return { ok: false, state };
  const s: BuildState = JSON.parse(JSON.stringify(state));
  s.scrap -= REROLL_COST;
  s.shop.rolls += 1;
  const fresh = rollUnitsExcluding(s.date, s.shop.rolls, s.day, excluded);
  s.shop.slots = s.shop.slots.map((old, i) => (s.shop.frozen[i] && old.kind !== 'empty' ? old : fresh[i]));
  return { ok: true, state: s };
}

function copiesOwned(state: BuildState, defId: string): number {
  // Counts BASE copies via tier: a tier-2 represents 3, a tier-3 represents 9.
  return [...state.board, ...state.bench]
    .filter((u) => u.defId === defId)
    .reduce((n, u) => n + Math.pow(MAX_TIER, u.tier - 1), 0);
}

function tier3Count(state: BuildState, defId: string): number {
  return [...state.board, ...state.bench].filter((u) => u.defId === defId && u.tier >= MAX_TIER).length;
}

// --- Pass 1: structural ceiling ---------------------------------------------
//
// Hoarder policy: on every unit slot that shows the target defId, freeze it
// UNLESS 3 target slots are already frozen (leaving one slot free to keep
// buying/cycling — SHOP_UNIT_SLOTS=4 total). Once the shop has no unfrozen
// slot left showing the target and nothing else useful to do, spend a free
// reroll on the cycling slot. This is the "hold back the max possible,
// convert the rest" strategy #165's thread describes structurally: 9 copies
// bought normally trigger the first tier-3 (which excludes the defId from
// all FUTURE rolls), and up to SHOP_UNIT_SLOTS-1 pre-frozen copies survive
// that exclusion because frozen slots never re-roll.
function structuralCeiling(defId: string, maxIterations = 200_000): { copies: number; tier3s: number; iterations: number } {
  let state = newBuild('2026-08-10', 1);
  state.scrap = Number.MAX_SAFE_INTEGER / 2; // unlimited: isolate the slot-count question from the economy question
  state.shop.slots = rollUnitsExcluding(state.date, 0, state.day, new Set());
  state.shop.frozen = state.shop.slots.map(() => false);

  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const excluded = excludedDefIds(state);
    const frozenTargetCount = state.shop.slots.filter((s, i) => state.shop.frozen[i] && s.kind === 'unit' && s.defId === defId).length;

    let acted = false;
    for (let i = 0; i < state.shop.slots.length; i++) {
      const slot = state.shop.slots[i];
      if (slot.kind !== 'unit' || slot.defId !== defId) continue;
      if (state.shop.frozen[i]) {
        // Already banked — buy it now only once nothing can ever be excluded
        // further to gain from holding it (i.e. once the defId is already
        // excluded, there's no reason left to wait).
        if (excluded.has(defId)) {
          const r = buyUnit(state, i);
          if (r.ok) { state = r.state; acted = true; }
        }
        continue;
      }
      if (frozenTargetCount < SHOP_UNIT_SLOTS - 1) {
        const r = toggleFreeze(state, i);
        if (r.ok) { state = r.state; acted = true; }
      } else {
        const r = buyUnit(state, i);
        if (r.ok) { state = r.state; acted = true; }
      }
    }
    if (acted) continue;

    // Nothing to do with what's showing — reroll the unfrozen slots for free
    // (pass 1 is scrap-unlimited by construction) to keep looking for the
    // target, unless it's fully excluded AND every frozen copy is banked.
    const anyFrozenUnbought = state.shop.slots.some((s, i) => state.shop.frozen[i] && s.kind === 'unit' && s.defId === defId);
    if (excluded.has(defId) && !anyFrozenUnbought) break; // nothing left this defId can ever give us
    state = rerollFree(state, excluded);
  }

  return { copies: copiesOwned(state, defId), tier3s: tier3Count(state, defId), iterations };
}

// --- Pass 2: realistic economy ----------------------------------------------
//
// The freeze-3-and-cycle trick from pass 1 is only worth its scrap cost in
// the last few copies before a trigger — freezing a slot for most of a week
// just starves a 24-scrap/day budget of buys for no benefit. A realistic
// player 100% committed to one defId instead buys it on sight and only
// rerolls when it isn't shown, spending every scrap the week grants on
// nothing else. Paid REROLL_COST, real SEASON_DAYS week (day rollover wipes
// the shop and re-rolls from scratch, so nothing here carries a freeze
// across days regardless of policy).
function realisticWeek(defId: string, startDate: string): { copies: number; tier3s: number; scrapSpent: number } {
  let state = newBuild(startDate, 1);
  state.shop.slots = rollUnitsExcluding(state.date, 0, state.day, new Set());
  let scrapSpent = 0;

  for (let day = 1; day <= SEASON_DAYS; day++) {
    if (day > 1) {
      const nextDate = new Date(Date.parse(`${state.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      state = advanceAfterDawn(state, nextDate);
      const excluded = excludedDefIds(state);
      state.shop.slots = rollUnitsExcluding(state.date, 0, state.day, excluded);
    }
    if (excludedDefIds(state).has(defId)) continue; // spent for the rest of the week, nothing to chase today

    for (let step = 0; step < 200; step++) {
      const excluded = excludedDefIds(state);
      if (excluded.has(defId)) break; // this day's copy just triggered the exclusion — nothing more to buy today

      const idx = state.shop.slots.findIndex((s) => s.kind === 'unit' && s.defId === defId);
      if (idx >= 0) {
        const before = state.scrap;
        const r = buyUnit(state, idx);
        if (r.ok) { scrapSpent += before - r.state.scrap; state = r.state; continue; }
      }
      const r = rerollPaid(state, excluded);
      if (!r.ok) break; // out of scrap for the day
      scrapSpent += REROLL_COST;
      state = r.state;
    }
  }

  return { copies: copiesOwned(state, defId), tier3s: tier3Count(state, defId), scrapSpent };
}

// --- run ----------------------------------------------------------------------

console.log('=== #165 Grown Past Use: can a comp ever hold TWO tier-3 copies of one unit? ===\n');
console.log(`MAX_TIER=${MAX_TIER}, SHOP_UNIT_SLOTS=${SHOP_UNIT_SLOTS} -> ${COPIES_PER_TIER3} base copies per tier-3, ${COPIES_NEEDED_FOR_TWO} needed for two\n`);

console.log('--- 1) STRUCTURAL CEILING (unlimited scrap/rerolls, single best day) ---\n');
for (const [comp, defId] of Object.entries(TARGET_COMPS)) {
  const r = structuralCeiling(defId);
  const reachable = r.copies >= COPIES_NEEDED_FOR_TWO;
  console.log(
    `${comp.padEnd(15)} defId=${defId.padEnd(14)} max copies ever obtainable: ${String(r.copies).padStart(2)} ` +
      `(${r.tier3s}x tier-3) in ${r.iterations} iterations -- needs ${COPIES_NEEDED_FOR_TWO} for two tier-3s: ` +
      `${reachable ? 'REACHABLE' : 'UNREACHABLE'}`
  );
}
console.log(
  `\nPredicted ceiling by construction: ${COPIES_PER_TIER3} (to trigger the first tier-3) + ` +
    `${SHOP_UNIT_SLOTS - 1} (max other slots frozen before the trigger) = ${COPIES_PER_TIER3 + SHOP_UNIT_SLOTS - 1}. ` +
    `A day boundary always re-rolls every slot from scratch and drops all freezes, so nothing above this is ` +
    `reachable in a later day either -- once excluded, a defId never appears again for the rest of the week.`
);

console.log('\n--- 2) REALISTIC ECONOMY (real DAILY_SCRAP/REROLL_COST, full week, 40 seeded seasons) ---\n');
const START = '2026-07-06';
const SEASONS = 40;
for (const [comp, defId] of Object.entries(TARGET_COMPS)) {
  const results = Array.from({ length: SEASONS }, (_, i) => {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10);
    return realisticWeek(defId, date);
  });
  const copies = results.map((r) => r.copies);
  const avg = copies.reduce((a, b) => a + b, 0) / copies.length;
  const max = Math.max(...copies);
  const reachedAny = results.filter((r) => r.copies >= COPIES_NEEDED_FOR_TWO).length;
  console.log(
    `${comp.padEnd(15)} defId=${defId.padEnd(14)} avg copies ${avg.toFixed(1)}, max ${max}/${SEASONS} seasons -- ` +
      `${reachedAny}/${SEASONS} seasons reached ${COPIES_NEEDED_FOR_TWO}+ (two tier-3s), spending every scrap on this one unit`
  );
}

console.log(
  '\nConclusion: if a comp needs two tier-3 copies of the SAME defId (original/press-kin-core\'s shape), ' +
    'Grown Past Use as specified in #165 makes it structurally unreachable through the real shop -- the ' +
    `${SHOP_UNIT_SLOTS}-slot shop can bank at most ${SHOP_UNIT_SLOTS - 1} pre-frozen copies past the exclusion trigger, ` +
    `well short of the ${COPIES_PER_TIER3} more base copies a second tier-3 needs. This isn't a tuning question -- ` +
    'raising the slot count or the freeze limit would be a different, much larger change to the shop, not a ' +
    'Grown Past Use numbers pass. Either the anomaly needs an explicit carve-out (e.g. exclude only once a SECOND ' +
    'copy hits tier-3, or only once total copies exceed some threshold well past 9), or the guardrail comps that ' +
    'assume dual tier-3 stacking need a documented exception for anomaly weeks.'
);
