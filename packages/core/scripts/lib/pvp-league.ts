/**
 * Nightly PvP league runner — Supabase REST glue.
 *
 * The pure scoring (`scoreRound`/`legalEntrants`, ../../src/pvp.ts) is the
 * single source of truth the client and this job share. This module adds only
 * the I/O: read the season's synced boards, compute a round, write the
 * standings. It talks to PostgREST directly via `fetch` (no supabase-js), same
 * as the app client. Reads use the public anon key; writes to pvp_rounds /
 * pvp_results need the SERVICE-ROLE key (those tables have no anon write
 * policy) — passed in, never hardcoded.
 *
 * WRAD's league differs from the retired fork's round model: there is no
 * per-round submission window. The board in `pvp_boards` is ALWAYS the
 * player's current horde (synced live). So a "round" is simply one nightly
 * scoring of whatever is currently synced for the season — one round per
 * ride-date.
 */
import { legalEntrants, scoreRound, winPointsForDay, type Lineup } from '../../src/pvp';
import { weekdayFor } from '../../src/shop';

export const SUPABASE_URL = 'https://wvrllhiktnkvbpclmrpq.supabase.co';
// Public, publishable anon key — same as packages/app/src/telemetry.ts. Read-only.
export const SUPABASE_ANON_KEY = 'sb_publishable_6S2kGgYAI2gRLhfRxXBY3A_E_mIgpAi';

/** One synced board, as stored in pvp_boards. */
export interface BoardRow {
  device_id: string;
  name: string;
  board: Lineup;
}

/** One row to write to pvp_results (snake_case = the DB column names). */
export interface ResultRow {
  round_id: string;
  season_id: string;
  device_id: string;
  name: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  survivor_diff: number;
  /** The exact board this device fielded for the round — snapshotted here
   * because `pvp_boards` is live state and would drift the moment the player
   * edits their horde (see issue #158 / the migration's doc comment). Lets a
   * client re-run `simulateDuel` against this row's opponent later and get
   * back the byte-identical fight, with no separate event-log storage. */
  board: Lineup;
}

export interface RoundOutcome {
  resultRows: ResultRow[];
  /** How many boards were legal and actually scored. */
  scored: number;
  /** Boards dropped as illegal (won't be scored). */
  dropped: BoardRow[];
  /** True when fewer than 2 legal boards existed — nothing to score. */
  skipped: boolean;
}

/**
 * PURE: turn a season's synced boards into the round's result rows. No I/O, so
 * it's fully unit-testable and deterministic — the same boards always produce
 * the same standings (via `scoreRound`). The row order matches `scoreRound`'s
 * standings order (points desc, survivorDiff desc, id asc), so a consumer that
 * wants rank can read it off the array index.
 */
export function roundResultsFor(
  boards: BoardRow[],
  seasonId: string,
  roundId: string
): RoundOutcome {
  const nameById = new Map(boards.map((b) => [b.device_id, b.name]));
  // Snapshotted alongside points below — the whole reason this map exists is
  // that `boards` (pvp_boards, live) is the ONLY place the exact fielded
  // Lineup is available; a moment after this round is scored it may already
  // have changed.
  const boardById = new Map(boards.map((b) => [b.device_id, b.board]));
  const legal = legalEntrants(boards.map((b) => ({ id: b.device_id, board: b.board })));
  const legalIds = new Set(legal.map((e) => e.id));
  const dropped = boards.filter((b) => !legalIds.has(b.device_id));

  if (legal.length < 2) {
    return { resultRows: [], scored: legal.length, dropped, skipped: true };
  }

  // roundId is `${seasonId}#${rideDate}` (see this module's doc comment);
  // pull the ride-date back out to find which league day this round pays out
  // for. A malformed/test roundId with no rideDate falls through weekdayFor
  // to NaN, which winPointsForDay treats as the steady-state (day 3+) value.
  const rideDate = roundId.slice(roundId.indexOf('#') + 1);
  const winPoints = winPointsForDay(weekdayFor(rideDate));

  const resultRows = scoreRound(legal, winPoints).map((s) => ({
    round_id: roundId,
    season_id: seasonId,
    device_id: s.id,
    name: nameById.get(s.id) ?? 'Warlord',
    points: s.points,
    wins: s.wins,
    draws: s.draws,
    losses: s.losses,
    survivor_diff: s.survivorDiff,
    // legal.length >= 2 and boardById is built from the same `boards` legal
    // was derived from, so every legal id has a board — the `!` is safe.
    board: boardById.get(s.id)!,
  }));
  return { resultRows, scored: legal.length, dropped, skipped: false };
}

function anonHeaders(): Record<string, string> {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
}
function serviceHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/**
 * Every board currently synced for a season.
 *
 * SERVICE-ROLE read, not anon. This used to use the anon key so `--dry` worked
 * without secrets, but anon's select on `pvp_boards` was revoked when the table
 * stopped publishing `device_id` (supabase/migrations/2026-08-01-hide-device-id.sql)
 * — that column is the unverified key the write RPCs accept. The job can't move
 * to the `pvp_boards_public` view either: it writes `pvp_results` rows keyed on
 * the real `device_id`, so it needs the column the view hides.
 *
 * The cost is that a keyless `--dry` can no longer read. That's called out
 * explicitly below rather than surfacing as a bare 403.
 */
/**
 * Has this round already been scored and closed? Read-only, anon-readable
 * (pvp_rounds grants anon select). Used to make the nightly job idempotent —
 * two triggers landing for the same round_id (a backup schedule entry, a
 * stray manual dispatch) must not re-score or double-post to Discord; only
 * the first to close the round should count.
 */
export async function roundAlreadyClosed(roundId: string): Promise<boolean> {
  const url =
    `${SUPABASE_URL}/rest/v1/pvp_rounds?round_id=eq.${encodeURIComponent(roundId)}` +
    `&status=eq.closed&select=round_id`;
  const res = await fetch(url, { headers: anonHeaders() });
  if (!res.ok) throw new Error(`pvp_rounds check failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

export async function fetchBoards(seasonId: string, key: string | undefined): Promise<BoardRow[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/pvp_boards?season_id=eq.${encodeURIComponent(seasonId)}` +
    `&select=device_id,name,board`;
  const res = await fetch(url, { headers: key ? serviceHeaders(key) : anonHeaders() });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `pvp_boards read denied (${res.status}). Reading boards needs SUPABASE_SERVICE_ROLE_KEY — ` +
        `anon lost select on this table when device_id was hidden. ` +
        `Re-run with the key set, even for --dry.`
    );
  }
  if (!res.ok) throw new Error(`pvp_boards fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as BoardRow[];
}

/** Upsert the round's lifecycle row (service-role). We write it straight to
 * `closed` — WRAD has no submission window, so a round is scored the moment it
 * exists. */
export async function upsertClosedRound(
  row: { round_id: string; season_id: string; opens_at: string; closes_at: string },
  key: string
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pvp_rounds?on_conflict=round_id`, {
    method: 'POST',
    headers: serviceHeaders(key, {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify({ ...row, status: 'closed' }),
  });
  if (!res.ok) throw new Error(`pvp_rounds upsert failed: ${res.status} ${await res.text()}`);
}

/** Upsert the round's standings (service-role). */
export async function writeResults(rows: ResultRow[], key: string): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pvp_results?on_conflict=round_id,device_id`, {
    method: 'POST',
    headers: serviceHeaders(key, {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`pvp_results write failed: ${res.status} ${await res.text()}`);
}

/**
 * Run one nightly round for a season: fetch synced boards, score, and — only
 * when a service-role `key` is given — persist the round + standings. With
 * `key` undefined it's a pure preview (fetch + compute, write nothing) for a
 * `--dry` run.
 *
 * READ and WRITE keys are now separate. Boards stopped being anon-readable when
 * device_id was hidden (see `fetchBoards`), so a `--dry` preview still needs a
 * service-role key to fetch — but must not write. `readKey` defaults to
 * `writeKey` so a normal run is unchanged; `--dry` passes the key as `readKey`
 * only, which is what keeps "preview" meaning "writes nothing" rather than
 * "scores an empty league".
 */
export async function runNightlyRound(
  seasonId: string,
  roundId: string,
  now: Date,
  writeKey: string | undefined,
  readKey: string | undefined = writeKey
): Promise<RoundOutcome> {
  const boards = await fetchBoards(seasonId, readKey);
  const outcome = roundResultsFor(boards, seasonId, roundId);
  if (writeKey && !outcome.skipped) {
    const ts = now.toISOString();
    await upsertClosedRound(
      { round_id: roundId, season_id: seasonId, opens_at: ts, closes_at: ts },
      writeKey
    );
    await writeResults(outcome.resultRows, writeKey);
  }
  return outcome;
}
