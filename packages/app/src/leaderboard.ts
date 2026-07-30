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

/** True if this row belongs to the player on this device. Typed structurally
 * (just the device_id column) so the various board row shapes — e.g.
 * pvp-board.ts's `GhostRow`/`StandingRow` — can reuse this instead of
 * redefining the same one-liner. */
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

// NOTE: depth is no longer a ranked, in-app leaderboard — the nightly PvP
// league (pvp-board.ts) is the season score now. `scores` still stores each
// device's deepest ride for the personal "deepest ride this week" stat, the
// anti-cheat re-simulation plumbing (issue #81), and the nightly Discord
// "deepest ride" flex, so submitScore stays; the fetchTop/fetchRank ranked
// read path was deleted with the Boss Trial removal.
