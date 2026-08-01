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
import { legalEntrants, scoreRound, type Lineup } from '../../src/pvp';

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

  const resultRows = scoreRound(legal).map((s) => ({
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

/** Every board currently synced for a season (anon read). */
export async function fetchBoards(seasonId: string): Promise<BoardRow[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/pvp_boards?season_id=eq.${encodeURIComponent(seasonId)}` +
    `&select=device_id,name,board`;
  const res = await fetch(url, { headers: anonHeaders() });
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
 */
export async function runNightlyRound(
  seasonId: string,
  roundId: string,
  now: Date,
  key: string | undefined
): Promise<RoundOutcome> {
  const boards = await fetchBoards(seasonId);
  const outcome = roundResultsFor(boards, seasonId, roundId);
  if (key && !outcome.skipped) {
    const ts = now.toISOString();
    await upsertClosedRound(
      { round_id: roundId, season_id: seasonId, opens_at: ts, closes_at: ts },
      key
    );
    await writeResults(outcome.resultRows, key);
  }
  return outcome;
}
