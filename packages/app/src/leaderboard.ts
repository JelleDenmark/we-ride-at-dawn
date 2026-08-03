import type { Lineup } from '@wrad/core';
import { SUPABASE_URL, SUPABASE_ANON_KEY, deviceId } from './telemetry';
import { CHANNEL } from './env';

// Dev builds ride a parallel, prefixed season so testing (and dev-toolbar
// inflated depths) never touch the public prod board. The UI still shows the
// real week date; only the stored/queried key differs.
// Exported so other boards (e.g. pvp-board.ts) share the exact same
// dev-prefix isolation instead of re-deriving it.
export function boardSeason(seasonId: string): string {
  return CHANNEL === 'dev' ? `dev-${seasonId}` : seasonId;
}

// One shared themed default so a fresh player always has a name to ride
// under; they can rename it. Collisions are harmless (device id is the key).
const TITLE_ADJ = [
  'Gutter',
  'Sump',
  'Midden',
  'Drain',
  'Warren',
  'Blight',
  'Rot',
  'Grime',
  'Cinder',
  'Mange',
];
const TITLE_NOUN = ['Warlord', 'Baron', 'Reeve', 'Marshal', 'Tyrant', 'Chief', 'Fang', 'Boss'];

export function defaultName(): string {
  const a = TITLE_ADJ[Math.floor(Math.random() * TITLE_ADJ.length)];
  const n = TITLE_NOUN[Math.floor(Math.random() * TITLE_NOUN.length)];
  return `${a}-${n}`;
}

// The board tables no longer publish `device_id` (see
// supabase/migrations/2026-08-01-hide-device-id.sql). Reads go through the
// `*_public` views, which serve an opaque `player_id` instead:
//
//     player_id = sha256('wrad:' || device_id)
//
// The device id is still what WRITES are keyed on — it just isn't handed to
// every other client any more, because the write RPCs accept it as a parameter
// without proving ownership.
//
// This digest MUST stay byte-identical to the view's. If they drift, `isMe()`
// silently stops matching and every player sees themselves as a stranger — no
// error, just a board with no "· you" on it.
const PLAYER_ID_SALT = 'wrad:';

let cachedPlayerId: string | null = null;
let playerIdInFlight: Promise<string> | null = null;

/**
 * This device's opaque public id, memoised. Async because WebCrypto is; the
 * fetch paths in pvp-board.ts await it before mapping rows, which is what lets
 * `isMe` stay synchronous for template use.
 *
 * Never throws. `crypto.subtle` needs a secure context — always true for the
 * deployed site and for localhost, but if it is ever missing this resolves to
 * an empty string, which cannot collide with a 64-char hex digest. The failure
 * mode is "nothing is highlighted as yours", not a crash.
 */
export function playerId(): Promise<string> {
  if (playerIdInFlight) return playerIdInFlight;
  playerIdInFlight = (async () => {
    try {
      const bytes = new TextEncoder().encode(`${PLAYER_ID_SALT}${deviceId().toLowerCase()}`);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      cachedPlayerId = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      cachedPlayerId = '';
    }
    return cachedPlayerId;
  })();
  return playerIdInFlight;
}

/** True if this row belongs to the player on this device. Typed structurally
 * (just the player_id column) so the various board row shapes — e.g.
 * pvp-board.ts's `GhostRow`/`StandingRow` — can reuse this instead of
 * redefining the same one-liner.
 *
 * Synchronous, so it works in templates and `Array.find`. Returns false until
 * `playerId()` has resolved; every caller reaches it via a fetch that already
 * awaited that, so in practice the cache is always warm by then. */
export function isMe(row: { player_id: string }): boolean {
  return cachedPlayerId !== null && cachedPlayerId !== '' && row.player_id === cachedPlayerId;
}

// Warm the digest at module load so the cache is populated well before the
// first network read resolves.
void playerId();

const HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
};

/**
 * Upsert this device's season-best via the security-definer RPC (keeps the
 * deepest depth per device). Fire-and-forget: never blocks or breaks play.
 */
export async function submitScore(args: {
  seasonId: string;
  name: string;
  depth: number;
  day: number;
  lineup: Lineup;
  /** Hour bucket of the ride that set this best — drives the server-side
   * anti-cheat re-simulation's timeOfDay derivation (issue #81, the
   * verify-scores edge function). Tucked into the lineup jsonb. */
  rideHour?: number;
  /** Ride date of the best ride (from the same snapshot as `lineup`/`day`) —
   * the gauntlet seed the server replays. Absent on legacy saves that predate
   * snapshotting; the server leaves those unverified rather than flagging. */
  rideDate?: string;
  /** Cumulative season enemies-defeated total (tiebreak). Monotonic — the
   * RPC stores greatest(existing, new) so a stale resubmit never lowers it. */
  kills: number;
}): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_score`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        p_season: boardSeason(args.seasonId),
        p_device: deviceId(),
        p_name: args.name,
        p_depth: args.depth,
        p_day: args.day,
        p_lineup: { ...args.lineup, rideHour: args.rideHour, rideDate: args.rideDate },
        p_kills: args.kills,
      }),
      keepalive: true,
    });
  } catch {
    // Offline or server down — the local season-best is still authoritative.
  }
}

// The depth board (issue #171): restored as a secondary "Depth" tab
// alongside the PvP league standings, so the game has a live-updating social
// signal between nightly duels. Reads go through `scores_public` (see
// supabase/migrations/2026-08-03-add-scores-public.sql), NOT `scores`
// directly — same player_id-over-device_id posture as pvp-board.ts.
const DEPTH_ORDER = 'depth.desc,kills.desc,updated_at.asc';

export interface BoardRow {
  player_id: string;
  name: string;
  depth: number;
  day: number;
  /** Cumulative season enemies-defeated total — the depth tiebreak. */
  kills: number;
}

/** Top-N of a season by depth, kills breaking depth ties. Empty array on any failure. */
export async function fetchTop(seasonId: string, limit = 20): Promise<BoardRow[]> {
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/scores_public?season_id=eq.${encodeURIComponent(boardSeason(seasonId))}` +
      `&order=${DEPTH_ORDER}&limit=${limit}` +
      `&select=player_id,name,depth,day,kills`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const rows = (await res.json()) as BoardRow[];
    // Warm the digest before handing rows to callers that use `isMe`.
    await playerId();
    return rows;
  } catch {
    return [];
  }
}

/**
 * This device's rank on the depth board (1-based). A rider outranks you if
 * they're strictly deeper, OR tied on depth with more kills — mirrors
 * DEPTH_ORDER's two levels. Returns null if unranked or on failure.
 */
export async function fetchRank(
  seasonId: string,
  depth: number,
  kills: number
): Promise<number | null> {
  if (depth <= 0) return null;
  try {
    const outrank = `or=(depth.gt.${depth},and(depth.eq.${depth},kills.gt.${kills}))`;
    const url =
      `${SUPABASE_URL}/rest/v1/scores_public?season_id=eq.${encodeURIComponent(boardSeason(seasonId))}` +
      `&${outrank}&select=player_id`;
    const res = await fetch(url, {
      headers: { ...HEADERS, Prefer: 'count=exact' },
    });
    if (!res.ok) return null;
    const range = res.headers.get('content-range'); // e.g. "0-24/25"
    const total = range ? Number(range.split('/')[1]) : NaN;
    return Number.isFinite(total) ? total + 1 : null;
  } catch {
    return null;
  }
}
