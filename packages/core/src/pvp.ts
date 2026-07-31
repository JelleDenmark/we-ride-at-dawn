import { UNIT_DEFS, type Lineup } from './data/units';
import { RELIC_DEFS } from './data/relics';
import { BOARD_CAP } from './sim';
import { MAX_TIER } from './shop';
import { simulateDuel } from './duel';

/**
 * Nightly PvP league (the 20:00 board-vs-board fight — see `duel.ts`'s
 * `simulateDuel`). This module is the single source of truth for how a
 * round's standings are computed and what board a player is even allowed to
 * enter with, so the client and the nightly server job can't drift: both
 * call `scoreRound`/`validateBoard` against the same submitted boards and
 * get byte-identical output, the same anti-cheat story `simulateDuel`
 * already relies on.
 *
 * Unlike the flat-budget PvP prototype this was adapted from, WRAD's league
 * runs on the LIVE shop economy — a board's tiers, relics and unit mix are
 * whatever a player actually built that day. There is no separate PvP-only
 * roster or tier-1-only rule here: `validateBoard` enforces STRUCTURAL
 * legality only (real units, real relics, in-bounds tiers/counts), not an
 * economic ceiling. See its doc comment for why the scrap-cost check is
 * deliberately left as a TODO rather than guessed at here.
 */

/**
 * Flat scrap paid to a duel loser — the league's anti-snowball catch-up lever
 * (build order §6). Each LOSS in a round pays `payoutPerLoss` scrap, no matter
 * the survivor-margin of that loss: FLAT, not scaled by margin, because
 * scaling would reward sandbagging (throwing a duel harder to farm a bigger
 * payout). Wins and draws pay nothing here — a win is already rewarded by
 * league points (the season score); this is pure economy that keeps the player
 * falling behind funded enough to stay in the race. Returns a non-negative
 * integer (both inputs are floored and clamped at 0).
 *
 * `payoutPerLoss` is SERVER CONFIG (`pvp_config.loss_consolation`), read live
 * by the client — deliberately NOT a client constant — so the owner can retune
 * this lever mid-season without a client deploy (the amount is admitted
 * guesswork until a full week has run). `LOSS_CONSOLATION_DEFAULT` is only the
 * fallback the client uses when that config row can't be read.
 */
export const LOSS_CONSOLATION_DEFAULT = 6;

export function consolationScrap(losses: number, payoutPerLoss: number): number {
  const perLoss = Math.max(0, Math.floor(payoutPerLoss));
  const n = Math.max(0, Math.floor(losses));
  return perLoss * n;
}

/** One player's entry in a round: their id (device/player id) and the board
 * they're fielding. */
export interface LeagueEntrant {
  id: string;
  board: Lineup;
}

/**
 * One entrant's result for a scored round. `points` is the football-style
 * match score (see `scoreRound`); `survivorDiff` is the tiebreak.
 */
export interface RoundStanding {
  id: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  survivorDiff: number;
}

/**
 * Scores one PvP round: all-vs-all round robin, every entrant duels every
 * OTHER entrant exactly once via `simulateDuel` (a duel is already seat-
 * symmetric — see `duel.ts`'s seat-fairness note — so unlike the flat-budget
 * fork this was adapted from, WRAD does NOT also play the away leg; that
 * would just double-count a result `simulateDuel` guarantees is already
 * fair regardless of which side sat in seat A).
 *
 * Scoring is football-style match points — win 3, draw 1, loss 0, summed
 * across every duel a player plays — so the headline standing rewards
 * racking up wins over a whole round rather than one big stomp. The tiebreak
 * is survivor differential: for each of a player's duels, (their surviving
 * total health − their opponent's surviving total health), summed across the
 * round. Health margin (not survivor count) is used because it's the same
 * neutral-margin quantity `DuelResult.healthA`/`healthB` already exists for
 * (see duel.ts) and it rewards a dominant, not-just-barely win over a
 * narrow one, which points-alone can't distinguish.
 *
 * Determinism is the whole point (the nightly job and any client re-check
 * must agree byte-for-byte): entrants are iterated in the given array order,
 * every unordered pair {i, j} with i < j calls `simulateDuel(entrants[i],
 * entrants[j])` exactly ONCE, and both sides are credited from that single
 * result — never call `simulateDuel` twice for the same pair. Standings sort
 * by points desc, then survivorDiff desc, then id asc, so shuffling the
 * input entrant order can only ever change how exact ties are broken (id is
 * a total order), never who actually beat whom — see the order-independence
 * test in pvp.test.ts.
 */
export function scoreRound(entrants: LeagueEntrant[]): RoundStanding[] {
  const n = entrants.length;
  const points = new Array<number>(n).fill(0);
  const wins = new Array<number>(n).fill(0);
  const draws = new Array<number>(n).fill(0);
  const losses = new Array<number>(n).fill(0);
  const survivorDiff = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const { result } = simulateDuel(entrants[i].board, entrants[j].board);
      const diff = result.healthA - result.healthB;
      survivorDiff[i] += diff;
      survivorDiff[j] -= diff;
      if (result.winner === 'a') {
        points[i] += 3;
        wins[i]++;
        losses[j]++;
      } else if (result.winner === 'b') {
        points[j] += 3;
        wins[j]++;
        losses[i]++;
      } else {
        points[i] += 1;
        points[j] += 1;
        draws[i]++;
        draws[j]++;
      }
    }
  }

  const order = entrants.map((_, i) => i);
  order.sort((a, b) => {
    if (points[b] !== points[a]) return points[b] - points[a];
    if (survivorDiff[b] !== survivorDiff[a]) return survivorDiff[b] - survivorDiff[a];
    // Final tiebreak on id keeps sort() stable/deterministic regardless of
    // engine — points and survivorDiff alone can genuinely tie (e.g. a
    // full-round mirror match, see the equal-points test).
    const idA = entrants[a].id;
    const idB = entrants[b].id;
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });

  return order.map((i) => ({
    id: entrants[i].id,
    points: points[i],
    wins: wins[i],
    draws: draws[i],
    losses: losses[i],
    survivorDiff: survivorDiff[i],
  }));
}

/**
 * Is this a STRUCTURALLY legal PvP board? This is a cheap bound, not a
 * proof — it only checks shape (unit/relic ids are real, counts and tiers
 * are in range, no duplicate relic slots), the same category of check
 * `validateBoard`'s namesake enforces in the flat-budget PvP fork this was
 * adapted from. It deliberately does NOT re-derive whether the board is
 * something the player could actually have afforded to build (total scrap
 * spent across every unit's tier-ups and every relic purchase, against
 * `DAILY_SCRAP`/`SEASON_DAYS` accumulated income) — that ceiling depends on
 * the player's whole economy history, not just the board snapshot, and
 * guessing at its shape here risks shipping a wrong, silently-too-strict (or
 * too-loose) gate. TODO(pvp-economy): once the league's server-authoritative
 * submission path exists, validate submitted boards against the player's
 * actual recorded scrap spend server-side, not by re-deriving a ceiling from
 * the board alone.
 *
 * Rejects, in order (first failure wins — see `RoundStanding`'s note on
 * determinism, same principle: a fixed check order keeps the reason
 * reproducible):
 *   - more than `BOARD_CAP` units;
 *   - a unit `defId` not in `UNIT_DEFS`, or one with `cost === 0` (a
 *     summon-only body like `pup` — never a legal shop purchase, so never a
 *     legal PvP entrant);
 *   - a unit `tier` (default 1) outside `1..MAX_TIER` or non-integer;
 *   - a unit relic id that doesn't exist, isn't `scope: 'unit'`, or is
 *     repeated on the same carrier (only one copy of a given relic can ever
 *     be equipped to one unit);
 *   - a team relic id that doesn't exist, isn't `scope: 'team'`, or is
 *     repeated in `teamRelicIds`.
 */
export function validateBoard(board: Lineup): { ok: true } | { ok: false; reason: string } {
  const units = board.units ?? [];
  if (units.length > BOARD_CAP) {
    return { ok: false, reason: `too many units (${units.length} > ${BOARD_CAP})` };
  }

  for (const u of units) {
    const def = UNIT_DEFS[u.defId];
    if (!def) return { ok: false, reason: `unknown unit "${u.defId}"` };
    if (!(def.cost > 0)) {
      return { ok: false, reason: `unit "${u.defId}" is summon-only (cost 0), not a legal board entry` };
    }

    const tier = u.tier ?? 1;
    if (!Number.isInteger(tier) || tier < 1 || tier > MAX_TIER) {
      return { ok: false, reason: `unit "${u.defId}" has invalid tier ${tier}` };
    }

    const relicIds = u.relicIds ?? [];
    const seenUnitRelics = new Set<string>();
    for (const relicId of relicIds) {
      const relic = RELIC_DEFS[relicId];
      if (!relic) return { ok: false, reason: `unknown relic "${relicId}" on unit "${u.defId}"` };
      if (relic.scope !== 'unit') {
        return { ok: false, reason: `relic "${relicId}" is not a unit relic (equipped on "${u.defId}")` };
      }
      if (seenUnitRelics.has(relicId)) {
        return { ok: false, reason: `unit "${u.defId}" carries relic "${relicId}" more than once` };
      }
      seenUnitRelics.add(relicId);
    }
  }

  const teamRelicIds = board.teamRelicIds ?? [];
  const seenTeamRelics = new Set<string>();
  for (const relicId of teamRelicIds) {
    const relic = RELIC_DEFS[relicId];
    if (!relic) return { ok: false, reason: `unknown team relic "${relicId}"` };
    if (relic.scope !== 'team') return { ok: false, reason: `relic "${relicId}" is not a team relic` };
    if (seenTeamRelics.has(relicId)) {
      return { ok: false, reason: `duplicate team relic "${relicId}"` };
    }
    seenTeamRelics.add(relicId);
  }

  return { ok: true };
}

/**
 * Filters a round's entrants down to those with a structurally legal board,
 * per `validateBoard`. Illegal boards are simply dropped from the round —
 * same "can't be scored, so don't enter it" shape as the fork's
 * `legalEntrants`, just without that version's dropped-entrant reporting
 * (the nightly job logs rejections upstream of this call; this function's
 * only contract is which entrants survive to `scoreRound`). Order of the
 * surviving entrants is preserved from the input, which matters for
 * `scoreRound`'s determinism contract above.
 */
export function legalEntrants(entrants: LeagueEntrant[]): LeagueEntrant[] {
  return entrants.filter((e) => validateBoard(e.board).ok);
}
