import { LOSS_CONSOLATION_DEFAULT, type Lineup, type RoundStanding } from '@wrad/core';
import { SUPABASE_URL, SUPABASE_ANON_KEY, deviceId } from './telemetry';
import { boardSeason, isMe, playerId } from './leaderboard';

// Client side of the nightly PvP league (see packages/core/src/pvp.ts for the
// scoring, packages/core/src/duel.ts for the fight). Two jobs:
//   1. SYNC the player's current board to `pvp_boards` so the nightly job can
//      fight it and other players can scout it (submitPvpBoard).
//   2. READ back the league: last night's standings (pvp_results) and the
//      ghosts to scout (pvp_boards).
// Mirrors leaderboard.ts's conventions exactly — same SUPABASE_URL/anon key,
// same `boardSeason()` dev-prefix isolation (dev boards never touch prod), same
// fire-and-forget-write / empty-array-on-failure-read posture. All writes go
// through the security-definer `submit_pvp_board` RPC.
//
// READS go through the `pvp_boards_public` / `pvp_results_public` views, NOT
// the base tables: those no longer grant anon select, because they served every
// player's raw `device_id` — which is also the unverified key the write RPCs
// accept. The views swap it for an opaque `player_id`. See
// supabase/migrations/2026-08-01-hide-device-id.sql for the full rationale and
// for why this is obscurity rather than a fix. `pvp_rounds` and `pvp_config`
// carry no device_id and are still read straight from the table.

const HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
};

/**
 * Upsert this device's CURRENT board into `pvp_boards` for the given season.
 * Last-write-wins (not monotonic like the depth board) — the player reworks
 * their horde freely through the day, and the nightly 22:00 job fights
 * whatever was synced last. Fire-and-forget: a failed sync just means the
 * server keeps the previous board; it never blocks or breaks play.
 *
 * Call this whenever the board changes (a buy/sell/merge/move), debounced by
 * the caller — there's no value in more than one sync per meaningful edit.
 */
export async function submitPvpBoard(args: {
  seasonId: string;
  name: string;
  board: Lineup;
}): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_pvp_board`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        p_season: boardSeason(args.seasonId),
        p_device: deviceId(),
        p_name: args.name,
        p_board: args.board,
      }),
      keepalive: true,
    });
  } catch {
    // Offline or server down — the local board is still authoritative and the
    // last successful sync stands in for tonight's duel.
  }
}

/**
 * Set (or clear) this device's boon pick for a ride-date (issue #184).
 *
 * Pass `null` to clear — not picking is a legal state that means no boon, and
 * a player who changes their mind back to nothing should be able to say so.
 *
 * Keyed on the RIDE-date (`currentRideDate`, the 06:00 rollover), never the
 * wall-clock date. Between 22:00 and 06:00 the round has already been scored
 * while the ride-date has not yet rolled, so a pick made in that window lands
 * on a round that is already closed — harmless, because the job reads picks
 * once at scoring time and never re-scores, but it is why the caller must pass
 * a ride-date rather than anything derived from the clock.
 *
 * Fire-and-forget, same posture as `submitPvpBoard`: a failed write leaves the
 * previous pick standing and never blocks play.
 *
 * Unlike the board, this does NOT go into `pvp_boards` — the pick is secret
 * until the round is scored, and that table is anon-readable. It has its own
 * table with no anon read at all.
 */
export async function submitPvpBoon(args: {
  seasonId: string;
  rideDate: string;
  boonId: string | null;
}): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_pvp_boon`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        p_season: boardSeason(args.seasonId),
        p_ride_date: args.rideDate,
        p_device: deviceId(),
        p_boon: args.boonId,
      }),
      keepalive: true,
    });
  } catch {
    // Offline or server down — the locally-held pick still shows in the UI and
    // the last successful write stands for tonight's round.
  }
}

/**
 * Read back THIS device's own pick for a ride-date. Returns null for no pick,
 * and also null on any failure — a read error is indistinguishable from "no
 * pick" to the caller by design, because both mean the same thing to the UI.
 *
 * Only needed when local state is gone (a reinstall, a cleared cache, a second
 * load of the same device). Nobody can read anyone else's pick: the RPC is
 * scoped to a single (season, ride_date, device) triple and returns a scalar,
 * so it cannot be walked to enumerate rivals.
 */
export async function fetchMyPvpBoon(seasonId: string, rideDate: string): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_pvp_boon`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        p_season: boardSeason(seasonId),
        p_ride_date: rideDate,
        p_device: deviceId(),
      }),
    });
    if (!res.ok) return null;
    const value = (await res.json()) as string | null;
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  }
}

/** One row of a single night's league standings, as written by the nightly job. */
export interface StandingRow extends RoundStanding {
  name: string;
  round_id: string;
  player_id: string;
  /** The exact board this device fielded for the round (issue #158) — lets a
   * client replay any matchup via `simulateDuel(rowA.board, rowB.board)`,
   * deterministic and byte-identical to the fight that actually happened.
   * `null` for rounds scored before the snapshot column existed — those just
   * can't be replayed. */
  board: Lineup | null;
  /**
   * The boon this player fielded that night, or `null` for no pick — and also
   * `null` for every round scored before boons existed (issue #184).
   *
   * This is where a pick becomes public. Picks are unreadable while the round
   * is live, by design, and surface here once it has been scored and nothing
   * can be countered any more. The duel replay reads it to show what each side
   * brought; treat a null as "rode without one", which is a legal state rather
   * than missing data.
   */
  boon_id: string | null;
}

/** One closed round for a season, for the "which night" picker. */
export interface RoundInfo {
  round_id: string;
  closes_at: string;
}

/**
 * Every CLOSED round for this season, most recent first — the list the
 * "Nights" picker browses. Empty on any failure (never throws).
 */
export async function fetchRounds(seasonId: string): Promise<RoundInfo[]> {
  const season = boardSeason(seasonId);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pvp_rounds` +
        `?season_id=eq.${encodeURIComponent(season)}&status=eq.closed` +
        `&select=round_id,closes_at&order=closes_at.desc`,
      { headers: HEADERS }
    );
    if (!res.ok) return [];
    return (await res.json()) as RoundInfo[];
  } catch {
    return [];
  }
}

/** Raw `pvp_results` rows for one round_id, mapped to `StandingRow`. Not
 * exported — both `fetchLatestStandings` and `fetchStandingsForRound` funnel
 * through this so the row-shape mapping lives in exactly one place. */
async function fetchRoundRows(roundId: string): Promise<StandingRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pvp_results_public` +
      `?round_id=eq.${encodeURIComponent(roundId)}` +
      `&select=round_id,player_id,name,points,wins,draws,losses,survivor_diff,board,boon_id` +
      `&order=points.desc,survivor_diff.desc,name.asc`,
    { headers: HEADERS }
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{
    round_id: string;
    player_id: string;
    name: string;
    points: number;
    wins: number;
    draws: number;
    losses: number;
    survivor_diff: number;
    board: Lineup | null;
    boon_id: string | null;
  }>;
  // Warm the digest before handing rows to callers that use `isMe` — it's
  // synchronous and this is the last await before they get the data.
  await playerId();
  return rows.map((r) => ({
    round_id: r.round_id,
    player_id: r.player_id,
    name: r.name,
    points: r.points,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    // The DB column is snake_case; RoundStanding is camelCase.
    survivorDiff: r.survivor_diff,
    id: r.player_id,
    board: r.board,
    // Null for a player who rode without one, and for every round scored
    // before the column existed — the replay treats both the same way.
    boon_id: r.boon_id ?? null,
  }));
}

/**
 * The most recent scored round's standings, points-desc. Empty array on any
 * failure (never throws — the caller renders "no duel yet"). We fetch the
 * latest `round_id` for the season first, then its rows, so a mid-scoring
 * round (partial rows) never renders as a final table.
 */
export async function fetchLatestStandings(seasonId: string): Promise<StandingRow[]> {
  try {
    const rounds = await fetchRounds(seasonId);
    if (rounds.length === 0) return [];
    return await fetchRoundRows(rounds[0].round_id);
  } catch {
    return [];
  }
}

/**
 * One specific past round's standings, for the "Nights" picker. Same shape
 * and tiebreak ordering as `fetchLatestStandings`, just for an arbitrary
 * already-closed `round_id` instead of always the newest.
 */
export async function fetchStandingsForRound(roundId: string): Promise<StandingRow[]> {
  try {
    return await fetchRoundRows(roundId);
  } catch {
    return [];
  }
}

/** One entrant's SEASON-TOTAL standing — summed across every scored round. */
export interface SeasonStandingRow {
  player_id: string;
  name: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  survivorDiff: number;
}

/**
 * Season-long standings: every `pvp_results_public` row for the season, summed
 * by `player_id`. No schema change needed — `pvp_results` already carries
 * `season_id` on every row, so this is a client-side aggregation of the same
 * per-round rows `fetchStandingsForRound` reads individually.
 *
 * Tiebreak mirrors `scoreRound`'s round-level rationale (see pvp.ts): points
 * desc, then summed survivor_diff desc. The final tiebreak is name asc rather
 * than id — unlike a single round, a season total has no meaningful "which
 * simulateDuel ran first" order to break ties on, so name is the only stable,
 * human-legible tiebreak available here.
 */
export async function fetchSeasonStandings(seasonId: string): Promise<SeasonStandingRow[]> {
  const season = boardSeason(seasonId);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pvp_results_public` +
        `?season_id=eq.${encodeURIComponent(season)}` +
        `&select=player_id,name,points,wins,draws,losses,survivor_diff,updated_at` +
        `&order=updated_at.asc`,
      { headers: HEADERS }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      player_id: string;
      name: string;
      points: number;
      wins: number;
      draws: number;
      losses: number;
      survivor_diff: number;
      updated_at: string;
    }>;

    await playerId();

    // Ordered updated_at asc, so the last row seen per player is also the
    // most recent — used to keep the player's CURRENT name on the total even
    // if they renamed mid-season.
    const totals = new Map<string, SeasonStandingRow>();
    for (const r of rows) {
      const prev = totals.get(r.player_id);
      if (prev) {
        prev.name = r.name;
        prev.points += r.points;
        prev.wins += r.wins;
        prev.draws += r.draws;
        prev.losses += r.losses;
        prev.survivorDiff += r.survivor_diff;
      } else {
        totals.set(r.player_id, {
          player_id: r.player_id,
          name: r.name,
          points: r.points,
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
          survivorDiff: r.survivor_diff,
        });
      }
    }

    return [...totals.values()].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.survivorDiff !== a.survivorDiff) return b.survivorDiff - a.survivorDiff;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  } catch {
    return [];
  }
}

/** One opponent's synced board, for scouting. */
export interface GhostRow {
  player_id: string;
  name: string;
  board: Lineup;
  updated_at: string;
}

/**
 * Every OTHER player's currently-synced board this season — the ghosts to
 * scout. Excludes this device (you don't scout yourself). Empty on failure.
 * Note the design decision: scouting shows last night's fielded ghost, so the
 * caller may prefer to pair this with the standings snapshot rather than the
 * live board; this fetch returns the live `pvp_boards` row, which IS "last
 * synced" and updates only when an opponent edits — good enough until a
 * dedicated per-round board snapshot exists.
 */
export async function fetchGhosts(seasonId: string): Promise<GhostRow[]> {
  const season = boardSeason(seasonId);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pvp_boards_public` +
        `?season_id=eq.${encodeURIComponent(season)}` +
        `&select=player_id,name,board,updated_at`,
      { headers: HEADERS }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as GhostRow[];
    // `isMe` is synchronous — resolve the digest before filtering, or a cold
    // cache would leave the player scouting their own board.
    await playerId();
    return rows.filter((r) => !isMe(r));
  } catch {
    return [];
  }
}

/** Live league tuning read from `pvp_config`. */
export interface LeagueConfig {
  /** Flat scrap paid per duel LOST (the anti-snowball lever — see
   * `consolationScrap` in @wrad/core). Server-configured so it's tunable
   * mid-season without a client deploy. */
  lossConsolation: number;
}

/**
 * Read the server-side league config. Any failure (offline, missing row,
 * malformed value) falls back to the shipped defaults rather than throwing —
 * the lever degrades to its default, it never breaks the league read. NOT
 * dev-prefixed: `pvp_config` is one channel-agnostic knob for dev and prod.
 */
export async function fetchLeagueConfig(): Promise<LeagueConfig> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pvp_config?key=eq.loss_consolation&select=value`,
      { headers: HEADERS }
    );
    if (!res.ok) return { lossConsolation: LOSS_CONSOLATION_DEFAULT };
    const rows = (await res.json()) as { value: unknown }[];
    const raw = rows[0]?.value;
    const v = typeof raw === 'number' ? raw : Number(raw);
    return {
      lossConsolation:
        Number.isFinite(v) && v >= 0 ? Math.floor(v) : LOSS_CONSOLATION_DEFAULT,
    };
  } catch {
    return { lossConsolation: LOSS_CONSOLATION_DEFAULT };
  }
}
