import { LOSS_CONSOLATION_DEFAULT, type Lineup, type RoundStanding } from '@wrad/core';
import { SUPABASE_URL, SUPABASE_ANON_KEY, deviceId } from './telemetry';
import { boardSeason, isMe } from './leaderboard';

// Client side of the nightly PvP league (see packages/core/src/pvp.ts for the
// scoring, packages/core/src/duel.ts for the fight). Two jobs:
//   1. SYNC the player's current board to `pvp_boards` so the nightly job can
//      fight it and other players can scout it (submitPvpBoard).
//   2. READ back the league: last night's standings (pvp_results) and the
//      ghosts to scout (pvp_boards).
// Mirrors leaderboard.ts's conventions exactly — same SUPABASE_URL/anon key,
// same `boardSeason()` dev-prefix isolation (dev boards never touch prod), same
// fire-and-forget-write / empty-array-on-failure-read posture. All writes go
// through the security-definer `submit_pvp_board` RPC; reads are plain
// PostgREST GETs against the public-read tables.

const HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
};

/**
 * Upsert this device's CURRENT board into `pvp_boards` for the given season.
 * Last-write-wins (not monotonic like the depth board) — the player reworks
 * their horde freely through the day, and the nightly 20:00 job fights
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

/** One row of a single night's league standings, as written by the nightly job. */
export interface StandingRow extends RoundStanding {
  name: string;
  round_id: string;
  device_id: string;
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
    `${SUPABASE_URL}/rest/v1/pvp_results` +
      `?round_id=eq.${encodeURIComponent(roundId)}` +
      `&select=round_id,device_id,name,points,wins,draws,losses,survivor_diff` +
      `&order=points.desc,survivor_diff.desc,name.asc`,
    { headers: HEADERS }
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{
    round_id: string;
    device_id: string;
    name: string;
    points: number;
    wins: number;
    draws: number;
    losses: number;
    survivor_diff: number;
  }>;
  return rows.map((r) => ({
    round_id: r.round_id,
    device_id: r.device_id,
    name: r.name,
    points: r.points,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    // The DB column is snake_case; RoundStanding is camelCase.
    survivorDiff: r.survivor_diff,
    id: r.device_id,
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
  device_id: string;
  name: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  survivorDiff: number;
}

/**
 * Season-long standings: every `pvp_results` row for the season, summed by
 * `device_id`. No schema change needed — `pvp_results` already carries
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
      `${SUPABASE_URL}/rest/v1/pvp_results` +
        `?season_id=eq.${encodeURIComponent(season)}` +
        `&select=device_id,name,points,wins,draws,losses,survivor_diff,updated_at` +
        `&order=updated_at.asc`,
      { headers: HEADERS }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      device_id: string;
      name: string;
      points: number;
      wins: number;
      draws: number;
      losses: number;
      survivor_diff: number;
      updated_at: string;
    }>;

    // Ordered updated_at asc, so the last row seen per device is also the
    // most recent — used to keep the player's CURRENT name on the total even
    // if they renamed mid-season.
    const totals = new Map<string, SeasonStandingRow>();
    for (const r of rows) {
      const prev = totals.get(r.device_id);
      if (prev) {
        prev.name = r.name;
        prev.points += r.points;
        prev.wins += r.wins;
        prev.draws += r.draws;
        prev.losses += r.losses;
        prev.survivorDiff += r.survivor_diff;
      } else {
        totals.set(r.device_id, {
          device_id: r.device_id,
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
  device_id: string;
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
      `${SUPABASE_URL}/rest/v1/pvp_boards` +
        `?season_id=eq.${encodeURIComponent(season)}` +
        `&select=device_id,name,board,updated_at`,
      { headers: HEADERS }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as GhostRow[];
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
