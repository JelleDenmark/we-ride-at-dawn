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
import { isBoonOffered } from '../../src/boons';

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
  /**
   * The boon this device fielded, or null for no pick (issue #184).
   *
   * This column IS the reveal. Picks are secret while the round is live —
   * `pvp_boon_picks` has no anon read at all — and become public here, in a
   * row anyone can select, once the round is scored and nothing can be
   * countered any more. Snapshotting it beside `board` for the same reason
   * `board` is snapshotted: a pick can change the moment the round closes, so
   * the only trustworthy record of what was actually fielded is the one taken
   * at scoring time.
   *
   * Already validated when it lands here — an off-menu pick is nulled by
   * `roundResultsFor`, never stored.
   */
  boon_id: string | null;
}

/** One row of pvp_boon_picks. Service-role only; anon cannot read this table. */
export interface BoonPickRow {
  device_id: string;
  boon_id: string;
}

export interface RoundOutcome {
  resultRows: ResultRow[];
  /** How many boards were legal and actually scored. */
  scored: number;
  /** Boards dropped as illegal (won't be scored). */
  dropped: BoardRow[];
  /** True when fewer than 2 legal boards existed — nothing to score. */
  skipped: boolean;
  /**
   * Picks refused because the boon wasn't on that ride-date's derived menu.
   * The player still rides, just without a boon — an off-menu pick is dropped,
   * never a reason to drop the board.
   *
   * Surfaced rather than swallowed because this is the ONLY signal that
   * something is wrong: a legitimate client cannot produce one (it offers what
   * `boonsFor` derives), so a non-empty list means either a tampered client or
   * — far more likely — a client running a different pool than the job, which
   * is exactly what appending to `BOON_DEFS` mid-week would cause.
   */
  rejectedPicks: { device_id: string; boon_id: string }[];
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
  roundId: string,
  picks: BoonPickRow[] = []
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
    return { resultRows: [], scored: legal.length, dropped, skipped: true, rejectedPicks: [] };
  }

  // roundId is `${seasonId}#${rideDate}` (see this module's doc comment);
  // pull the ride-date back out to find which league day this round pays out
  // for. A malformed/test roundId with no rideDate falls through weekdayFor
  // to NaN, which winPointsForDay treats as the steady-state (day 3+) value.
  const rideDate = roundId.slice(roundId.indexOf('#') + 1);
  const winPoints = winPointsForDay(weekdayFor(rideDate));

  // The one server-side authority in the boon path (issue #184). Everything
  // else about a board is client-trusted by design, but the day's menu is a
  // pure function of the ride-date, so the job can re-derive it and refuse a
  // pick that was never offered. Re-deriving is sound HERE and only here: it
  // asks about the round being scored, which is the current day. Do not reuse
  // this against a historical date — appending to `BOON_DEFS` re-maps past
  // days' menus, which is why a scored round's picks live in its snapshot
  // rather than being re-derived on read.
  const rejectedPicks: { device_id: string; boon_id: string }[] = [];
  const boonById = new Map<string, string>();
  for (const p of picks) {
    // A pick from someone whose board isn't in the round is not a rejection,
    // just irrelevant — they picked and then didn't field a legal board.
    if (!legalIds.has(p.device_id)) continue;
    if (isBoonOffered(rideDate, p.boon_id)) boonById.set(p.device_id, p.boon_id);
    else rejectedPicks.push({ device_id: p.device_id, boon_id: p.boon_id });
  }

  // Hand the validated picks to the scorer so the duels actually fight with
  // them. `legal` came from `legalEntrants`, which preserves input order and
  // carries no boon, so re-attach by id rather than by position.
  const legalWithBoons = legal.map((e) => ({ ...e, boon: boonById.get(e.id) ?? null }));

  const resultRows = scoreRound(legalWithBoons, winPoints).map((s) => ({
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
    // Explicit null rather than an absent key: these rows go to PostgREST as
    // one bulk insert, and a heterogeneous key set across rows is exactly how
    // a bulk insert starts silently dropping columns.
    boon_id: boonById.get(s.id) ?? null,
  }));
  return { resultRows, scored: legal.length, dropped, skipped: false, rejectedPicks };
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

/**
 * Every boon pick submitted for one ride-date (issue #184).
 *
 * SERVICE-ROLE ONLY, and unlike `fetchBoards` this is not a historical
 * accident that could be relaxed — `pvp_boon_picks` deliberately has no anon
 * grant and no read policy, because a readable pick would turn the daily
 * choice into a counter-picking race. There is no anon fallback to offer.
 *
 * Returns empty without a key rather than throwing, so a keyless `--dry`
 * degrades to "preview with no boons" instead of failing outright. That is a
 * softer posture than `fetchBoards` takes, and deliberately so: without boards
 * there is no round at all, whereas without picks there is still a scoreable
 * round — every entrant simply rides without a boon, which is a legal state.
 */
export async function fetchBoonPicks(
  seasonId: string,
  rideDate: string,
  key: string | undefined
): Promise<BoonPickRow[]> {
  if (!key) return [];
  const url =
    `${SUPABASE_URL}/rest/v1/pvp_boon_picks?season_id=eq.${encodeURIComponent(seasonId)}` +
    `&ride_date=eq.${encodeURIComponent(rideDate)}&select=device_id,boon_id`;
  const res = await fetch(url, { headers: serviceHeaders(key) });
  if (!res.ok) throw new Error(`pvp_boon_picks fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as BoonPickRow[];
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
  // Same ride-date extraction `roundResultsFor` documents; done here too
  // because the picks query is keyed on it.
  const rideDate = roundId.slice(roundId.indexOf('#') + 1);
  const picks = await fetchBoonPicks(seasonId, rideDate, readKey);
  const outcome = roundResultsFor(boards, seasonId, roundId, picks);
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
