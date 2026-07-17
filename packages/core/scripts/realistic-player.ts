/**
 * Realistic-player economy simulation (issue #121).
 *
 * Every other balance script tests kits in isolation (all-unit-value,
 * relic-value), against hand-picked ceiling lineups (balance, depth-scaling),
 * or with a deliberately myopic greedy spend proxy (snowball). None of them
 * answers "what does a player who plays WELL, through the real shop, actually
 * end up with — and how deep do they get?" This script does, by running the
 * real income -> spend -> ride loop (same heartbeat snowball.ts mirrors from
 * App.svelte) with a LOOKAHEAD spend policy that mechanically tries every
 * legal move and keeps the one the real simulator says is best.
 *
 * --- THE LOOKAHEAD POLICY --------------------------------------------------
 * At every spend opportunity (each hourly ride, plus dawn), the policy
 * enumerates every legal action via the REAL shop functions and scores each
 * resulting build with the REAL simulate() against the season's actual
 * gauntlet (deterministic since #41 — every ride of the week is the same
 * fight, so one sim call per candidate is an exact preview, not an estimate):
 *
 *   - buy each affordable shop unit, tried at EVERY board position
 *   - when the warren is full: sell the least-valuable board rat (found by
 *     simulating each rat's removal) and retry each blocked buy
 *   - buy each affordable relic, tried on EVERY eligible carrier
 *   - deploy each bench rat, tried at every insert position
 *   - buy the next board slot the moment the board is full and it's
 *     affordable (the deliberate "board-maxing investor" from snowball §6)
 *   - reroll (bounded per hour, never below a scrap floor) when nothing
 *     above improves the fight — which is exactly merge-fishing when the
 *     board is strong and a pair is waiting
 *
 * Acceptance, in priority order (all thresholds are policy knobs, see
 * consts): (1) any action that clears MORE WAVES; (2) any merge-completing
 * buy (a free tier-up is never wrong); (3) actions that add damage
 * (damageDealt tie-break — the continuous signal wavesCleared saturates on,
 * see all-unit-value §3), only while the bank stays above SPEND_FLOOR and
 * any board-slot reserve; (4) pair-forming buys (2nd copy of a >=4-cost
 * unit, board or bench) to set up merge-fishing; (5) reroll.
 * After any board change, a hill-climbing position pass tries every
 * single-unit move (all i -> j) until no move improves the fight.
 *
 * This is "mechanically try all combinations and positions" applied where
 * it's tractable: one action deep, every placement, real economy. It is
 * still not optimal play (no multi-buy planning, no freeze usage, no
 * deliberate counter-teching) — treat it as a STRONG-player floor, the
 * band between snowball's casual greedy and depth-scaling's ceiling.
 *
 * --- MONTE CARLO DIMENSION -------------------------------------------------
 * Everything inside one season is deterministic (shop rolls hash off the
 * date + roll #, the gauntlet off the season id), exactly like live play —
 * so the sampled dimension is the SEASON: many independent Monday-anchored
 * weeks, reported as distributions, not single runs.
 *
 * timeOfDay: rides use the hour's half-day (like App.svelte's timeOfDayAt);
 * candidate evaluation blends both halves when a Twilight-Runt is on the
 * board (its buff flips at noon) and skips the blend otherwise for speed.
 *
 * Run from the repo root: npm run balance:realistic
 * (or from packages/core:  npx tsx scripts/realistic-player.ts)
 */
import {
  newBuild,
  advanceAfterDawn,
  buyUnit,
  buyRelic,
  sellUnit,
  rerollShop,
  autoRerollShop,
  isShopDead,
  buyBoardSlot,
  deployUnit,
  moveUnit,
  effectiveBoardCap,
  nextSlotPrice,
  interestFor,
  lineupFromBuild,
  scrapForDepth,
  seasonIdFor,
  SEASON_DAYS,
  REROLL_COST,
  type BuildState,
} from '../src/shop';
import { simulate, BOARD_CAP } from '../src/sim';
import { generateGauntlet, type Gauntlet } from '../src/gauntlet';
import { UNIT_DEFS, type TimeOfDay } from '../src/data/units';
import { RELIC_DEFS } from '../src/data/relics';

const HOURS_PER_DAY = 24;
const TOTAL_HOURS = SEASON_DAYS * HOURS_PER_DAY; // 168

// --- policy knobs -----------------------------------------------------------
/** Damage-only ("tier 3" acceptance) spending and rerolls never take the bank
 * below this — the merge-fishing budget a strong player keeps in pocket. */
const SPEND_FLOOR = 12;
/** Rerolls per spend opportunity. Generous vs snowball's 2: fishing the shop
 * is most of what a strong player does with surplus scrap. */
const MAX_REROLLS_PER_HOUR = 6;
/** Hard bound on accepted actions per spend opportunity (safety valve — the
 * acceptance rules terminate on their own well before this). */
const MAX_ACTIONS_PER_HOUR = 14;
/** Pair-forming buys (rule 4) only bother with units worth merging. */
const PAIR_FORMING_MIN_COST = 4;
/** Position hill-climb passes after a board change. */
const MAX_POSITION_PASSES = 3;

// --- seeds ------------------------------------------------------------------
// Independent Monday-anchored seasons (each is a fully deterministic world:
// same shop rolls and gauntlet for every player in it, like live).
const SEED_DATES: string[] = [];
{
  const base = Date.parse('2026-07-06T12:00:00Z');
  for (let i = 0; i < 16; i++) {
    SEED_DATES.push(new Date(base + i * 7 * 86_400_000).toISOString().slice(0, 10));
  }
}

// --- evaluation -------------------------------------------------------------
let SIM_CALLS = 0;

const gauntletCache = new Map<string, Gauntlet>();
function gauntletFor(build: BuildState): Gauntlet {
  // Keyed by season AND day for future-proofing, though difficultyForDay is
  // currently a constant 1 so all seven entries of a week are identical.
  const key = `${seasonIdFor(build.date)}#${build.day}`;
  let g = gauntletCache.get(key);
  if (!g) {
    g = generateGauntlet(build.date, build.day);
    gauntletCache.set(key, g);
  }
  return g;
}

interface Eval {
  waves: number;
  /** waves + damage tie-break; strictly more damage always scores higher
   * within the same wave count, never across wave counts. */
  score: number;
}

function simOnce(build: BuildState, g: Gauntlet, timeOfDay?: TimeOfDay): Eval {
  SIM_CALLS++;
  const r = simulate({ ...lineupFromBuild(build), timeOfDay }, g).result;
  return { waves: r.wavesCleared, score: r.wavesCleared + r.damageDealt * 1e-9 };
}

function evalBuild(build: BuildState, g: Gauntlet): Eval {
  if (build.board.length === 0) return { waves: 0, score: 0 };
  // Twilight-Runt's teamBuffByTime is the only board effect that reads
  // Lineup.timeOfDay (dawn/dusk-runt are out of the shop pool and can't be
  // bought). Blend both halves when it's fielded; otherwise omit (a no-op).
  if (build.board.some((u) => u.defId === 'twilight-runt')) {
    const a = simOnce(build, g, 'beforeNoon');
    const b = simOnce(build, g, 'afterNoon');
    return { waves: (a.waves + b.waves) / 2, score: (a.score + b.score) / 2 };
  }
  return simOnce(build, g);
}

// --- the lookahead policy ----------------------------------------------------

interface Candidate {
  state: BuildState;
  e: Eval;
  /** Buy completed a 3-of-a-kind (free tier-up). */
  mergeCompleting: boolean;
  /** Buy formed a 2-of-a-kind worth fishing a 3rd copy for. */
  pairForming: boolean;
  scrapAfter: number;
}

function ownedCopies(state: BuildState, defId: string, tier: number): number {
  return [...state.board, ...state.bench].filter((u) => u.defId === defId && u.tier === tier).length;
}

/** All placements of the just-bought unit (buyUnit appends to the board end
 * when there's room): the raw state plus every moveUnit of the last rat. When
 * the buy merged or landed on the bench there's nothing to re-place. */
function placementVariants(before: BuildState, after: BuildState): BuildState[] {
  if (after.board.length !== before.board.length + 1) return [after];
  const from = after.board.length - 1;
  const variants: BuildState[] = [after];
  for (let to = 0; to < from; to++) {
    const r = moveUnit(after, from, to);
    if (r.ok) variants.push(r.state);
  }
  return variants;
}

function bestVariant(variants: BuildState[], g: Gauntlet): { state: BuildState; e: Eval } {
  let best = { state: variants[0], e: evalBuild(variants[0], g) };
  for (let i = 1; i < variants.length; i++) {
    const e = evalBuild(variants[i], g);
    if (e.score > best.e.score) best = { state: variants[i], e };
  }
  return best;
}

/** Hill-climb the board order: try every single-unit move, apply the best
 * strict improvement, repeat until stable (bounded). */
function optimizePositions(state: BuildState, g: Gauntlet): BuildState {
  let s = state;
  for (let pass = 0; pass < MAX_POSITION_PASSES; pass++) {
    const base = evalBuild(s, g);
    let best: { state: BuildState; e: Eval } | null = null;
    for (let from = 0; from < s.board.length; from++) {
      for (let to = 0; to < s.board.length; to++) {
        if (from === to) continue;
        const r = moveUnit(s, from, to);
        if (!r.ok) continue;
        const e = evalBuild(r.state, g);
        if (e.score > (best?.e.score ?? base.score)) best = { state: r.state, e };
      }
    }
    if (!best) return s;
    s = best.state;
  }
  return s;
}

/** The board rat whose removal costs the least (by sim), for sell-to-upgrade
 * when the warren is full. Returns its index and the post-sale state. */
function leastValuableSale(state: BuildState, g: Gauntlet): { state: BuildState; e: Eval } | null {
  let best: { state: BuildState; e: Eval } | null = null;
  for (let b = 0; b < state.board.length; b++) {
    const r = sellUnit(state, b);
    if (!r.ok) continue;
    const e = evalBuild(r.state, g);
    if (!best || e.score > best.e.score) best = { state: r.state, e };
  }
  return best;
}

interface SpendStats {
  rerolls: number;
  actions: number;
}

function spendLookahead(build: BuildState, g: Gauntlet, stats: SpendStats): BuildState {
  let s = build;
  let rerolls = 0;
  let boardChanged = false;

  for (let actions = 0; actions < MAX_ACTIONS_PER_HOUR; ) {
    // Board slot: rule-based, not eval-based (the purchase alone never moves
    // a sim — its value is the unit that fills it later). Same "deliberate
    // investor" stance as snowball's board-maxing player: buy the moment the
    // board is full at its cap and the price is in the bank.
    const cap = effectiveBoardCap(s);
    const savingForSlot = s.board.length >= cap && cap < BOARD_CAP;
    const reserve = savingForSlot ? (nextSlotPrice(s) ?? 0) : 0;
    if (savingForSlot) {
      const r = buyBoardSlot(s);
      if (r.ok) {
        s = r.state;
        actions++;
        stats.actions++;
        continue;
      }
    }

    const base = evalBuild(s, g);
    const candidates: Candidate[] = [];
    const push = (state: BuildState, e: Eval, flags?: Partial<Candidate>) =>
      candidates.push({ state, e, mergeCompleting: false, pairForming: false, scrapAfter: state.scrap, ...flags });

    // Cache the cheapest sell-to-make-room state; only compute if needed.
    let saleBase: { state: BuildState; e: Eval } | null | undefined;

    for (let i = 0; i < s.shop.slots.length; i++) {
      const slot = s.shop.slots[i];
      if (slot.kind === 'unit') {
        const def = UNIT_DEFS[slot.defId];
        if (def.cost > s.scrap) continue;
        const mergeCompleting = ownedCopies(s, slot.defId, 1) >= 2;
        const pairForming = !mergeCompleting && def.cost >= PAIR_FORMING_MIN_COST && ownedCopies(s, slot.defId, 1) === 1;
        const r = buyUnit(s, i);
        if (r.ok) {
          const v = bestVariant(placementVariants(s, r.state), g);
          push(v.state, v.e, { mergeCompleting, pairForming });
        } else if (s.board.length >= cap && !mergeCompleting) {
          // Warren full: try the buy again after selling the least-valuable
          // rat (a real player's late-week upgrade move).
          if (saleBase === undefined) saleBase = leastValuableSale(s, g);
          if (saleBase) {
            const r2 = buyUnit(saleBase.state, i);
            if (r2.ok) {
              const v = bestVariant(placementVariants(saleBase.state, r2.state), g);
              push(v.state, v.e);
            }
          }
        }
      } else if (slot.kind === 'relic') {
        const relic = RELIC_DEFS[slot.relicId];
        if (relic.cost > s.scrap) continue;
        if (relic.scope === 'team') {
          const r = buyRelic(s, i);
          if (r.ok) push(r.state, evalBuild(r.state, g));
        } else {
          for (let t = 0; t < s.board.length; t++) {
            if (s.board[t].relicIds.includes(relic.id)) continue;
            const r = buyRelic(s, i, t);
            if (r.ok) push(r.state, evalBuild(r.state, g));
          }
        }
      }
    }

    // Deploy bench rats (every insert position).
    for (let b = 0; b < s.bench.length; b++) {
      for (let pos = 0; pos <= s.board.length; pos++) {
        const r = deployUnit(s, b, pos);
        if (!r.ok) break; // warren full — no position will fit either
        push(r.state, evalBuild(r.state, g));
      }
    }

    // Acceptance rules, in priority order (see header).
    const affordableWithFloor = (c: Candidate) =>
      c.scrapAfter >= Math.max(SPEND_FLOOR, reserve) || c.e.waves > base.waves;
    const byScore = (a: Candidate, b: Candidate) => b.e.score - a.e.score;
    const pick =
      candidates.filter((c) => c.e.waves > base.waves).sort(byScore)[0] ??
      candidates.filter((c) => c.mergeCompleting).sort(byScore)[0] ??
      candidates.filter((c) => c.e.score > base.score && affordableWithFloor(c)).sort(byScore)[0] ??
      candidates.filter((c) => c.pairForming && affordableWithFloor(c)).sort(byScore)[0];

    if (pick) {
      boardChanged = true;
      s = pick.state;
      actions++;
      stats.actions++;
      continue;
    }

    // Nothing improves the fight: fish. Free refresh first if the shop's
    // rat stalls are all bought out, then paid rerolls down to the floor.
    if (isShopDead(s)) {
      const r = autoRerollShop(s);
      if (r.ok) {
        s = r.state;
        continue;
      }
    }
    // Rerolls respect the board-slot reserve too: without this, six
    // rerolls/hour quietly drain the bank to SPEND_FLOOR forever and the
    // "deliberate investor" never actually reaches a slot price (the exact
    // starvation trap snowball.ts's step 2.5 comment describes for relics).
    if (rerolls < MAX_REROLLS_PER_HOUR && s.scrap - REROLL_COST >= Math.max(SPEND_FLOOR - 2, reserve)) {
      const r = rerollShop(s);
      if (r.ok) {
        s = r.state;
        rerolls++;
        stats.rerolls++;
        continue;
      }
    }
    break;
  }

  return boardChanged ? optimizePositions(s, g) : s;
}

// --- the greedy baseline (compact port of snowball.ts's spendGreedily with
// --- expandBoard=true, so both players are "deliberate investors" and the
// --- only difference is HOW they pick purchases) ------------------------------
const ABILITY_BONUS = 2.5;
const GREEDY_MAX_REROLLS = 2;

function greedyUnitValue(defId: string): number {
  const def = UNIT_DEFS[defId];
  return (def.attack + def.health + (def.ability ? ABILITY_BONUS : 0)) / def.cost;
}

function spendGreedy(build: BuildState): BuildState {
  let s = build;
  let rerolls = 0;
  for (;;) {
    const unitSlots = s.shop.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x): x is { slot: { kind: 'unit'; defId: string }; i: number } => x.slot.kind === 'unit');

    const mergeBuy = unitSlots.find(
      ({ slot }) => UNIT_DEFS[slot.defId].cost <= s.scrap && ownedCopies(s, slot.defId, 1) >= 2
    );
    if (mergeBuy) {
      const r = buyUnit(s, mergeBuy.i);
      if (r.ok) {
        s = r.state;
        continue;
      }
    }

    const affordable = unitSlots.filter(({ slot }) => UNIT_DEFS[slot.defId].cost <= s.scrap);
    if (affordable.length > 0) {
      const best = affordable.reduce((a, b) =>
        greedyUnitValue(b.slot.defId) > greedyUnitValue(a.slot.defId) ? b : a
      );
      if (greedyUnitValue(best.slot.defId) >= 0.9) {
        const r = buyUnit(s, best.i);
        if (r.ok) {
          s = r.state;
          continue;
        }
      }
    }

    const cap = effectiveBoardCap(s);
    if (s.board.length >= cap && cap < BOARD_CAP) {
      const r = buyBoardSlot(s);
      if (r.ok) {
        s = r.state;
        continue;
      }
      break; // hold scrap for the slot (see snowball.ts step 2.5)
    }

    const relicBuy = s.shop.slots
      .map((slot, i) => ({ slot, i }))
      .find(({ slot }) => {
        if (slot.kind !== 'relic') return false;
        const relic = RELIC_DEFS[slot.relicId];
        if (relic.cost > s.scrap) return false;
        if (relic.scope === 'team') return !s.teamRelicIds.includes(relic.id);
        return s.board.some((u) => !u.relicIds.includes(relic.id));
      });
    if (relicBuy && relicBuy.slot.kind === 'relic') {
      const relic = RELIC_DEFS[relicBuy.slot.relicId];
      const target = relic.scope === 'unit' ? s.board.findIndex((u) => !u.relicIds.includes(relic.id)) : undefined;
      const r = buyRelic(s, relicBuy.i, target);
      if (r.ok) {
        s = r.state;
        continue;
      }
    }

    if (rerolls < GREEDY_MAX_REROLLS && s.scrap > 1) {
      const r = rerollShop(s);
      if (r.ok) {
        s = r.state;
        rerolls++;
        continue;
      }
    }
    break;
  }
  return s;
}

// --- the week loop (App.svelte's idle heartbeat, same shape as snowball.ts) ---

interface HourSample {
  hour: number;
  day: number;
  depth: number;
}

interface SeedRun {
  seed: string;
  samples: HourSample[];
  final: BuildState;
  maxDepth: number;
  stats: SpendStats;
}

function addDay(date: string, n = 1): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

type Policy = (build: BuildState, g: Gauntlet, stats: SpendStats) => BuildState;

function runWeek(startDate: string, policy: Policy): SeedRun {
  const stats: SpendStats = { rerolls: 0, actions: 0 };
  let build = newBuild(startDate, 1);
  build = policy(build, gauntletFor(build), stats);

  const samples: HourSample[] = [];
  let maxDepth = 0;
  for (let h = 0; h < TOTAL_HOURS; h++) {
    const g = gauntletFor(build);
    const timeOfDay: TimeOfDay = h % HOURS_PER_DAY < 12 ? 'beforeNoon' : 'afterNoon';
    const depth =
      build.board.length > 0
        ? simulate({ ...lineupFromBuild(build), timeOfDay }, g).result.wavesCleared
        : 0;
    maxDepth = Math.max(maxDepth, depth);
    build = { ...build, scrap: build.scrap + scrapForDepth(depth) };
    samples.push({ hour: h, day: build.day, depth });
    build = policy(build, g, stats);

    if ((h + 1) % HOURS_PER_DAY === 0 && h + 1 < TOTAL_HOURS) {
      const dawnInterest = interestFor(build.scrap);
      build = advanceAfterDawn(build, addDay(build.date, build.day));
      if (dawnInterest > 0) build = { ...build, scrap: build.scrap + dawnInterest };
      build = policy(build, gauntletFor(build), stats);
    }
  }
  return { seed: startDate, samples, final: build, maxDepth, stats };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function dayAvgDepth(samples: HourSample[], day: number): number {
  const inDay = samples.filter((s) => s.day === day);
  return avg(inDay.map((s) => s.depth));
}

// --- run ----------------------------------------------------------------------

const t0 = performance.now();
console.log('=== REALISTIC-PLAYER ECONOMY SIM (issue #121) ===');
console.log(`${SEED_DATES.length} independent seasons: ${SEED_DATES[0]} .. ${SEED_DATES[SEED_DATES.length - 1]}\n`);

const greedyRuns = SEED_DATES.map((d) => runWeek(d, (b) => spendGreedy(b)));
const smartRuns = SEED_DATES.map((d) => runWeek(d, spendLookahead));

// 1) Depth curve: greedy proxy vs lookahead player.
console.log('--- 1) DEPTH PER DAY: greedy proxy vs lookahead player ---\n');
console.log('day   greedy avg [min..max]     lookahead avg [min..max]    gap');
for (let day = 1; day <= SEASON_DAYS; day++) {
  const gDepths = greedyRuns.map((r) => dayAvgDepth(r.samples, day));
  const sDepths = smartRuns.map((r) => dayAvgDepth(r.samples, day));
  console.log(
    `${day}     ${avg(gDepths).toFixed(2).padStart(5)} [${Math.min(...gDepths).toFixed(1)}..${Math.max(...gDepths).toFixed(1)}]` +
      `          ${avg(sDepths).toFixed(2).padStart(5)} [${Math.min(...sDepths).toFixed(1)}..${Math.max(...sDepths).toFixed(1)}]` +
      `        +${(avg(sDepths) - avg(gDepths)).toFixed(2)}`
  );
}
const gMax = avg(greedyRuns.map((r) => r.maxDepth));
const sMax = avg(smartRuns.map((r) => r.maxDepth));
console.log(`\nmax depth over the week (leaderboard proxy): greedy ${gMax.toFixed(1)} vs lookahead ${sMax.toFixed(1)}`);
console.log(
  `lookahead spend activity: avg ${avg(smartRuns.map((r) => r.stats.actions)).toFixed(0)} actions, ` +
    `${avg(smartRuns.map((r) => r.stats.rerolls)).toFixed(0)} paid rerolls per week`
);

// 2) What the lookahead player actually ends the week with.
console.log('\n--- 2) FINAL-BOARD CENSUS (lookahead player, end of day 7) ---\n');
interface Census {
  seeds: number;
  copies: number;
  tierSum: number;
  bestTier: number;
}
const census = new Map<string, Census>();
for (const r of smartRuns) {
  const byDef = new Map<string, { copies: number; bestTier: number }>();
  for (const u of r.final.board) {
    const cur = byDef.get(u.defId) ?? { copies: 0, bestTier: 0 };
    byDef.set(u.defId, { copies: cur.copies + 1, bestTier: Math.max(cur.bestTier, u.tier) });
  }
  for (const [defId, d] of byDef) {
    const c = census.get(defId) ?? { seeds: 0, copies: 0, tierSum: 0, bestTier: 0 };
    census.set(defId, {
      seeds: c.seeds + 1,
      copies: c.copies + d.copies,
      tierSum: c.tierSum + d.bestTier,
      bestTier: Math.max(c.bestTier, d.bestTier),
    });
  }
}
console.log('unit              on final board   avg copies   avg best tier   max tier');
for (const [defId, c] of [...census.entries()].sort((a, b) => b[1].seeds - a[1].seeds)) {
  console.log(
    `${defId.padEnd(16)}  ${String(c.seeds).padStart(2)}/${SEED_DATES.length} seeds` +
      `        ${(c.copies / c.seeds).toFixed(1).padStart(4)}         ${(c.tierSum / c.seeds).toFixed(1).padStart(4)}            ${c.bestTier}`
  );
}
const teamRelicCounts = new Map<string, number>();
const unitRelicCounts = new Map<string, number>();
for (const r of smartRuns) {
  for (const id of r.final.teamRelicIds) teamRelicCounts.set(id, (teamRelicCounts.get(id) ?? 0) + 1);
  for (const u of r.final.board) for (const id of u.relicIds) unitRelicCounts.set(id, (unitRelicCounts.get(id) ?? 0) + 1);
}
console.log('\nrelics on final builds (team: seeds holding it / unit: total copies pinned):');
for (const [id, n] of [...teamRelicCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${RELIC_DEFS[id].name.padEnd(24)} team   ${n}/${SEED_DATES.length} seeds`);
}
for (const [id, n] of [...unitRelicCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${RELIC_DEFS[id].name.padEnd(24)} unit   ${n} pinned copies across all seeds`);
}

// 3) Audit flags from the 2026-07-16 roster audit (issue #121): does the
//    realistic path confirm or soften the isolated-swap reads?
console.log('\n--- 3) AUDIT FLAGS ---\n');
for (const defId of ['pack-caller', 'corpse-glutton', 'gnawer']) {
  const withU = smartRuns.filter((r) => r.final.board.some((u) => u.defId === defId));
  const without = smartRuns.filter((r) => !r.final.board.some((u) => u.defId === defId));
  const d7 = (runs: SeedRun[]) => (runs.length > 0 ? avg(runs.map((r) => dayAvgDepth(r.samples, 7))).toFixed(2) : ' n/a');
  console.log(
    `${defId.padEnd(15)} on ${String(withU.length).padStart(2)}/${SEED_DATES.length} final boards; ` +
      `day-7 depth with ${d7(withU)} vs without ${d7(without)}` +
      ` (correlational — the shop offered different weeks different rosters)`
  );
}
const pairCounts = new Map<string, number>();
for (const r of smartRuns) {
  const defs = [...new Set(r.final.board.map((u) => u.defId))].sort();
  for (let i = 0; i < defs.length; i++)
    for (let j = i + 1; j < defs.length; j++) {
      const key = `${defs[i]} + ${defs[j]}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
}
console.log('\nmost-kept final-board pairs (what realistic play converges on):');
for (const [pair, n] of [...pairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${pair.padEnd(34)} ${n}/${SEED_DATES.length} seeds`);
}
console.log('\n(for CAUSAL pair synergy — every combination at every position — run npm run balance:combos)');

// 4) Per-seed detail for spot-checking.
console.log('\n--- 4) PER-SEED FINAL BOARDS (lookahead) ---\n');
for (const r of smartRuns) {
  const board = r.final.board.map((u) => `${u.defId}:t${u.tier}${u.relicIds.length ? `+${u.relicIds.length}r` : ''}`).join(' ');
  console.log(
    `${r.seed}  d7 ${dayAvgDepth(r.samples, 7).toFixed(1).padStart(4)}  max ${String(r.maxDepth).padStart(2)}  ` +
      `slots+${r.final.purchasedSlots}  [${board}]`
  );
}

console.log(
  `\n(${SIM_CALLS.toLocaleString()} sim calls in ${((performance.now() - t0) / 1000).toFixed(1)}s; ` +
    `policy knobs: SPEND_FLOOR=${SPEND_FLOOR}, rerolls<=${MAX_REROLLS_PER_HOUR}/hr)`
);
console.log('Not modeled: shop freezes, bench pulls (benchUnit), multi-action planning, counter-teching.');
console.log('Tier-3 chasing in particular is absent: each of the ~6 extra copies toward a t3 is not a');
console.log('strict single-action improvement, so 1-step lookahead never starts down that road — the');
console.log('t2-everything + relic-blanket boards below are what play WITHOUT t3 fishing converges on.');
console.log('Treat the lookahead curve as a strong-player floor between snowball (casual) and depth-scaling (ceiling).');
