import type { Lineup } from '@wrad/core';
import { SUPABASE_URL, SUPABASE_ANON_KEY, deviceId } from './telemetry';
import { CHANNEL } from './env';

// Dev builds ride a parallel, prefixed season so testing (and dev-toolbar
// inflated depths) never touch the public prod board. The UI still shows the
// real week date; only the stored/queried key differs.
// Exported so other boards (e.g. boss-trial-board.ts) share the exact same
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

export interface BoardRow {
  name: string;
  depth: number;
  day: number;
  device_id: string;
  /** Cumulative season enemies-defeated total — now the THIRD tiebreak,
   * below boss_damage (issue #132). */
  kills: number;
  /** Best Boss Trial damage this season (0 if never attempted) — the second
   * sort key, so it breaks depth ties on the saturated top band (#132). */
  boss_damage: number;
  /** False when the player has a depth score but never ran a Boss Trial —
   * the UI shows "—" rather than a shaming 0. */
  boss_attempted: boolean;
}

/** True if this row belongs to the player on this device. Typed structurally
 * (just the device_id column) rather than `BoardRow` so other boards with
 * different score columns — e.g. boss-trial-board.ts's `BossTrialRow` — can
 * reuse this instead of redefining the same one-liner. */
export function isMe(row: { device_id: string }): boolean {
  return row.device_id === deviceId();
}

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

// The combined board (issue #132): the depth `scores` table left-joined to
// Boss Trial damage, ordered depth → boss_damage → kills. Reads come from
// the `combined_board` view (RLS-respecting via security_invoker); writes
// still go to the two underlying tables through their own RPCs, unchanged.
const COMBINED_ORDER = 'depth.desc,boss_damage.desc,kills.desc,updated_at.asc';

/** Top-N of a season on the combined board: depth first, best Boss Trial
 * damage breaks depth ties, kills breaks damage ties. Empty array on any failure. */
export async function fetchTop(seasonId: string, limit = 20): Promise<BoardRow[]> {
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/combined_board?season_id=eq.${encodeURIComponent(boardSeason(seasonId))}` +
      `&order=${COMBINED_ORDER}&limit=${limit}` +
      `&select=name,depth,day,device_id,kills,boss_damage,boss_attempted`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    return (await res.json()) as BoardRow[];
  } catch {
    return [];
  }
}

/**
 * This device's rank on the combined board (1-based). A rider outranks you if
 * they're strictly deeper, OR tied on depth with more boss damage, OR tied on
 * both with more kills — mirrors COMBINED_ORDER's three levels exactly.
 * Returns null if unranked or on failure.
 */
export async function fetchRank(
  seasonId: string,
  depth: number,
  bossDamage: number,
  kills: number
): Promise<number | null> {
  if (depth <= 0) return null;
  try {
    const outrank =
      `or=(depth.gt.${depth},` +
      `and(depth.eq.${depth},boss_damage.gt.${bossDamage}),` +
      `and(depth.eq.${depth},boss_damage.eq.${bossDamage},kills.gt.${kills}))`;
    const url =
      `${SUPABASE_URL}/rest/v1/combined_board?season_id=eq.${encodeURIComponent(boardSeason(seasonId))}` +
      `&${outrank}&select=device_id`;
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
