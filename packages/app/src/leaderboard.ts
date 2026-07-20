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
  /** Cumulative season enemies-defeated total — tiebreak below depth. */
  kills: number;
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
  /** Hour bucket of the ride that set this best — would let a P4 anti-cheat
   * pass re-simulate the exact gauntlet. Tucked into the lineup jsonb.
   * NOT YET IMPLEMENTED — see issue #81: no server-side re-simulation exists
   * yet, so submitted scores (this one included) are currently client-trusted. */
  rideHour?: number;
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
        p_lineup: { ...args.lineup, rideHour: args.rideHour },
        p_kills: args.kills,
      }),
      keepalive: true,
    });
  } catch {
    // Offline or server down — the local season-best is still authoritative.
  }
}

/** Top-N of a season, deepest first, kills as the tiebreak. Empty array on any failure. */
export async function fetchTop(seasonId: string, limit = 20): Promise<BoardRow[]> {
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/scores?season_id=eq.${encodeURIComponent(boardSeason(seasonId))}` +
      `&order=depth.desc,kills.desc,updated_at.asc&limit=${limit}&select=name,depth,day,device_id,kills`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    return (await res.json()) as BoardRow[];
  } catch {
    return [];
  }
}

/**
 * This device's rank in a season (1-based). A rider outranks you if they're
 * strictly deeper, or tied on depth with strictly more kills (mirrors the
 * board's depth.desc,kills.desc ordering). Returns null if unranked or on failure.
 */
export async function fetchRank(seasonId: string, depth: number, kills: number): Promise<number | null> {
  if (depth <= 0) return null;
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/scores?season_id=eq.${encodeURIComponent(boardSeason(seasonId))}` +
      `&or=(depth.gt.${depth},and(depth.eq.${depth},kills.gt.${kills}))&select=device_id`;
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
