/**
 * PvP unit tier matrix (issue #154) — RELIC-FREE first pass.
 *
 * Every unit/relic number in WRAD was tuned against the depth ladder: one
 * persistent horde run through 45 waves of enemies that scale into HP sponges
 * (`sim.ts`'s `scaleForWave`). The nightly PvP league is a different game — a
 * duel is ONE symmetric wave, no wave scaling, board-vs-board (`duel.ts`'s
 * `simulateDuel`, scored by `pvp.ts`'s `scoreRound`). That inverts the depth
 * meta: "health >> attack" was an artifact of the HP-sponge curve, and every
 * unit whose value comes from ACCUMULATING across 45 waves (Corpse-Glutton
 * eating faints, per-wave re-summoners) only gets one wave of payoff here. This
 * script measures units under the rules the league actually uses, so a PvP
 * rebalance argues from data instead of from the depth-tuned tier lists.
 *
 * Relics are deliberately OUT of scope for this pass (owner call, 2026-07-31):
 * pin down the bare-unit PvP order first, then layer relics on top in a
 * follow-up — the per-wave/per-battle relic distinction collapses in a
 * one-wave duel (Glass Shard == Tail-Charm now), so relics need their own look.
 *
 * Determinism: a duel has no RNG (the front clash is fully deterministic — see
 * `simulateDuel`'s doc), so unlike the depth scripts there is NO seed sampling
 * here. Each number below is exact, not a mean over seasons.
 *
 * Two lenses, both scored the way the league scores:
 *
 *  A. SPAM LADDER — the composition-matters check. Build a full board of 8
 *     copies of one unit (tier fixed, no relics) for every unit, then run the
 *     real `scoreRound` all-vs-all round robin over that field. A unit that
 *     goes undefeated here is a "just stack 8 of it" pick — the exact threat to
 *     the owner's "grind > composition, but composition must still matter"
 *     goal. A unit near the bottom is dead weight you'd never field in PvP.
 *     Cost is printed alongside so a dominant board that's also expensive
 *     (grind-justified) is distinguishable from a cheap degenerate one.
 *
 *  B. MARGINAL VALUE vs a STRONG reference — the "is this unit better or worse
 *     than a solid body in a real PvP slot" check. The reference is a full
 *     board of 8x Dire-Rat: a strong mid-ladder body whose only trait is
 *     PASSIVE armor (no triggered ability), so retuning any unit can't move the
 *     bar (change-invariant, same reason all-unit-value uses Dire-Rat as its
 *     control tank). For each unit we swap it into the best of the front/behind
 *     slot of that board and duel it against the untouched reference. Dire-Rat
 *     itself reads as the draw/zero-line; a unit ABOVE it wins the swap, a unit
 *     that drags the board LOSES it. (An earlier pass used an ability-less
 *     filler board as the control, but it was so weak that literally every unit
 *     beat it — no loss signal at all; the strong reference is the fix.)
 *
 *  A weak result here does NOT mean "delete the unit": a board that farms scrap
 *  well on the depth ladder but loses its nightly duels still earns via
 *  loss-consolation (`consolationScrap`), so PvE-strong / PvP-weak is a fine,
 *  intended place for a unit to sit — not every unit has to be a duel pick.
 *
 * Run from the repo root:  npm run pvp:matrix
 * (or from packages/core:  npx tsx scripts/pvp-unit-matrix.ts)
 */
import { simulateDuel } from '../src/duel';
import { scoreRound, type LeagueEntrant } from '../src/pvp';
import { UNIT_DEFS, type Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS } from '../src/sim';
import { MAX_TIER } from '../src/shop';

const CAP = BOARD_CAP; // 8 — the day-7 board a real PvP entrant fields
// A real entrant's board carries combatCap = board.length + COMBAT_CAP_BONUS
// (`lineupFromBuild` in shop.ts) = 14 for a full board — the summon headroom
// beyond the 8 fighting slots. Leaving it unset defaults to BOARD_CAP (8) and
// silently throttles every summoner (Rat-Piper, Brood-Mother), so match reality.
const COMBAT_CAP = CAP + COMBAT_CAP_BONUS;
const TANK = 'dire-rat'; // the strong, change-invariant reference body (lens B)

// The full roster minus summon-only bodies (cost 0 — pup/broodlings; never a
// legal board entry, `validateBoard` rejects them). Rotated-out units are kept
// in, same rationale as combo-matrix.ts: rotation flips season to season and a
// PvP outlier discovered now informs the next rotation call.
const CANDIDATE_IDS = Object.keys(UNIT_DEFS).filter((id) => UNIT_DEFS[id].cost > 0);

/** scrap to reach a tier: base cost x 3^(tier-1), same ladder as all-unit-value. */
function scrapCost(defId: string, tier: number): number {
  return UNIT_DEFS[defId].cost * Math.pow(3, tier - 1);
}

/** A full board of 8 copies of one unit, at `tier`, no relics. */
function homogeneous(defId: string, tier: number): Lineup {
  return {
    units: Array.from({ length: CAP }, () => ({ defId, tier, relicIds: [] })),
    teamRelicIds: [],
    combatCap: COMBAT_CAP,
  };
}

/** The strong reference board: 8x Dire-Rat (see header, lens B). */
function reference(tier: number): Lineup {
  return {
    units: Array.from({ length: CAP }, () => ({ defId: TANK, tier, relicIds: [] })),
    teamRelicIds: [],
    combatCap: COMBAT_CAP,
  };
}

/** Reference with one Dire-Rat slot swapped for the candidate, in the given slot. */
function swapIn(defId: string, tier: number, pos: 'front' | 'behind'): Lineup {
  const order = pos === 'front' ? [defId] : [TANK, defId];
  while (order.length < CAP) order.push(TANK);
  return { units: order.map((id) => ({ defId: id, tier, relicIds: [] })), teamRelicIds: [], combatCap: COMBAT_CAP };
}

const nameOf = (id: string) => UNIT_DEFS[id].name;

console.log('=== PvP UNIT MATRIX (issue #154) — relic-free first pass ===');
console.log(
  `${CANDIDATE_IDS.length} units, board of ${CAP}, tiers 1..${MAX_TIER}. ` +
    `Deterministic duels (no sampling). Scored by scoreRound (win 3 / draw 1 / loss 0).\n`
);

for (let tier = 1; tier <= MAX_TIER; tier++) {
  // ---- Lens A: spam ladder -------------------------------------------------
  const entrants: LeagueEntrant[] = CANDIDATE_IDS.map((id) => ({ id, board: homogeneous(id, tier) }));
  const standings = scoreRound(entrants);
  const maxPts = (CANDIDATE_IDS.length - 1) * 3; // beat every other board

  console.log(`\n############ TIER ${tier} ############`);
  console.log(`--- A. SPAM LADDER: 8x one unit, all-vs-all (max points = ${maxPts}) ---`);
  console.log('rank unit             cost  pts   W- D- L   survDiff');
  standings.forEach((s, i) => {
    const sd = (s.survivorDiff >= 0 ? '+' : '') + s.survivorDiff;
    const undefeated = s.losses === 0 ? '  <= undefeated' : '';
    console.log(
      `${String(i + 1).padStart(3)}  ${nameOf(s.id).padEnd(16)} ${String(scrapCost(s.id, tier)).padStart(4)}  ` +
        `${String(s.points).padStart(3)}  ${String(s.wins).padStart(2)}-${String(s.draws).padStart(2)}-${String(s.losses).padStart(2)}  ` +
        `${sd.padStart(8)}${undefeated}`
    );
  });

  // ---- Lens B: marginal value vs a strong reference ------------------------
  const ref = reference(tier);
  interface MarginRow {
    id: string;
    outcome: 'WIN' | 'draw' | 'LOSS';
    diff: number;
    pos: 'front' | 'behind';
  }
  const margins: MarginRow[] = CANDIDATE_IDS.map((id) => {
    let best: MarginRow | null = null;
    for (const pos of ['front', 'behind'] as const) {
      const { result } = simulateDuel(swapIn(id, tier, pos), ref);
      const outcome = result.winner === 'a' ? 'WIN' : result.winner === 'b' ? 'LOSS' : 'draw';
      const diff = result.healthA - result.healthB;
      // Keep the better placement: a win beats a draw beats a loss, then by margin.
      const rank = (o: MarginRow['outcome']) => (o === 'WIN' ? 2 : o === 'draw' ? 1 : 0);
      const row: MarginRow = { id, outcome, diff, pos };
      if (!best || rank(outcome) > rank(best.outcome) || (rank(outcome) === rank(best.outcome) && diff > best.diff)) {
        best = row;
      }
    }
    return best!;
  });
  margins.sort((a, b) => b.diff - a.diff);

  console.log(`\n--- B. MARGINAL vs strong reference [8x ${TANK}] (swap one slot -> unit; best of front/behind; ${TANK} = zero-line) ---`);
  console.log('unit             result  survDiff  slot');
  for (const m of margins) {
    const sd = (m.diff >= 0 ? '+' : '') + m.diff;
    console.log(`${nameOf(m.id).padEnd(16)} ${m.outcome.padEnd(6)}  ${sd.padStart(7)}  ${m.pos}`);
  }
}

console.log(
  `\n(No relics, no summon-only bodies, no cost normalization — equal slots & tier. ` +
    `The RANKING is the signal, not absolute survDiff. Follow-ups: relic layer, ` +
    `and a mixed-board combo matrix (the all-vs-all here is homogeneous spam only).)`
);
