import type { BuildState, Lineup, BattleResult } from '@wrad/core';
import { CHANNEL } from './env';

// Channel-namespaced so dev experiments never clobber prod state on the
// same origin.
const NS = CHANNEL === 'prod' ? 'wrad' : 'wrad-dev';

/** Builds saved before the bench feature shipped have no `bench` field —
 * default it to empty so upgrading players don't hit `undefined.length`.
 * Builds saved before buyable horde slots (issue #9) have no `purchasedSlots`
 * field — default it to 0, which is byte-identical to pre-feature behavior. */
function migrateBuild(build: BuildState): BuildState {
  const withBench = build.bench ? build : { ...build, bench: [] };
  return withBench.purchasedSlots === undefined
    ? { ...withBench, purchasedSlots: 0 }
    : withBench;
}

/** The horde currently being built for the next dawn (build.date = target ride date). */
export function savePending(build: BuildState): void {
  try {
    localStorage.setItem(`${NS}:pending`, JSON.stringify(build));
  } catch {
    // Storage full or unavailable — the build only lives for the session.
  }
}

export function loadPending(): BuildState | null {
  try {
    const raw = localStorage.getItem(`${NS}:pending`);
    return raw ? migrateBuild(JSON.parse(raw) as BuildState) : null;
  } catch {
    return null;
  }
}

export interface LastRide {
  date: string;
  day: number;
  lineup: Lineup;
  result: BattleResult;
}

/** The most recent horde that actually rode at dawn. */
export function saveLastRide(ride: LastRide): void {
  try {
    localStorage.setItem(`${NS}:lastride`, JSON.stringify(ride));
  } catch {
    // Non-fatal.
  }
}

export function loadLastRide(): LastRide | null {
  try {
    const raw = localStorage.getItem(`${NS}:lastride`);
    return raw ? (JSON.parse(raw) as LastRide) : null;
  } catch {
    return null;
  }
}

/** The last hour-bucket for which idle income was credited. */
export function saveLastIncomeHour(hour: number): void {
  try {
    localStorage.setItem(`${NS}:incomehour`, String(hour));
  } catch {
    // Non-fatal.
  }
}

export function loadLastIncomeHour(): number | null {
  try {
    const raw = localStorage.getItem(`${NS}:incomehour`);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

/** The player's chosen leaderboard name (device-scoped, renameable). Not
 * channel-namespaced: a player is the same warlord on prod and dev. */
export function savePlayerName(name: string): void {
  try {
    localStorage.setItem('wrad:name', name);
  } catch {
    // Non-fatal — falls back to a fresh themed default next load.
  }
}

export function loadPlayerName(): string | null {
  try {
    return localStorage.getItem('wrad:name');
  } catch {
    return null;
  }
}

/** Everything needed to reproduce the season-best ride deterministically:
 * simulate(lineup + timeOfDay-from-hour, generateGauntlet(date, day)) ==
 * the claimed depth. Captured at the moment the best is set, because the
 * live build keeps mutating afterwards (sells, merges, day advances) — a
 * submit-time lineup is NOT the lineup that rode (issue #81). */
export interface BestRideSnapshot {
  date: string;
  day: number;
  lineup: Lineup;
}

/** Best depth reached this season (headline leaderboard score), plus the
 * hour bucket of the ride that set it and the exact ride snapshot — the
 * inputs the server-side anti-cheat re-simulation (issue #81) replays. */
export function saveSeasonBest(
  seasonId: string,
  best: number,
  hour?: number,
  snapshot?: BestRideSnapshot
): void {
  try {
    localStorage.setItem(`${NS}:best`, JSON.stringify({ seasonId, best, hour, snapshot }));
  } catch {
    // Non-fatal.
  }
}

export function loadSeasonBest(seasonId: string): {
  best: number;
  hour?: number;
  snapshot?: BestRideSnapshot;
} {
  try {
    const raw = localStorage.getItem(`${NS}:best`);
    if (!raw) return { best: 0 };
    const v = JSON.parse(raw) as {
      seasonId: string;
      best: number;
      hour?: number;
      snapshot?: BestRideSnapshot;
    };
    return v.seasonId === seasonId ? { best: v.best, hour: v.hour, snapshot: v.snapshot } : { best: 0 };
  } catch {
    return { best: 0 };
  }
}

/** Cumulative enemies defeated this season — sums across every completed
 * ride (mirrors seasonBest's reset-per-season lifecycle, but only ever
 * climbs within a season instead of tracking a max). Leaderboard tiebreak. */
export function saveSeasonKills(seasonId: string, total: number): void {
  try {
    localStorage.setItem(`${NS}:kills`, JSON.stringify({ seasonId, total }));
  } catch {
    // Non-fatal.
  }
}

export function loadSeasonKills(seasonId: string): number {
  try {
    const raw = localStorage.getItem(`${NS}:kills`);
    if (!raw) return 0;
    const v = JSON.parse(raw) as { seasonId: string; total: number };
    return v.seasonId === seasonId ? v.total : 0;
  } catch {
    return 0;
  }
}

/** The `round_id` of the last PvP round whose loss-consolation scrap has
 * already been credited to this device, so a payout is banked exactly once no
 * matter how often the league refresh runs. Keyed by season (a new week starts
 * fresh); returns '' when nothing has been credited for this season yet. */
export function saveConsolationCredited(seasonId: string, roundId: string): void {
  try {
    localStorage.setItem(`${NS}:pvp-consolation`, JSON.stringify({ seasonId, roundId }));
  } catch {
    // Non-fatal — worst case the same round pays out again on a later load;
    // acceptable for a small catch-up lever, and self-limited to one round.
  }
}

export function loadConsolationCredited(seasonId: string): string {
  try {
    const raw = localStorage.getItem(`${NS}:pvp-consolation`);
    if (!raw) return '';
    const v = JSON.parse(raw) as { seasonId: string; roundId: string };
    return v.seasonId === seasonId ? v.roundId : '';
  } catch {
    return '';
  }
}

/** This device's daily boon pick (issue #184), keyed by season AND ride-date
 * so yesterday's choice can never leak into today's round. Returns null when
 * nothing has been picked for that day.
 *
 * The server copy in `pvp_boon_picks` is authoritative, not this — a
 * localStorage write can fail silently (the seasonBest/rideLog desync, #180),
 * and a reinstall or cleared cache loses it entirely. This is the fast local
 * read; `fetchMyPvpBoon` is the reconciliation path. */
export function saveBoonPick(seasonId: string, rideDate: string, boonId: string | null): void {
  try {
    localStorage.setItem(`${NS}:pvp-boon`, JSON.stringify({ seasonId, rideDate, boonId }));
  } catch {
    // Non-fatal — the pick still went to the server, and the next league
    // refresh reads it back.
  }
}

export function loadBoonPick(seasonId: string, rideDate: string): string | null {
  try {
    const raw = localStorage.getItem(`${NS}:pvp-boon`);
    if (!raw) return null;
    const v = JSON.parse(raw) as { seasonId: string; rideDate: string; boonId: string | null };
    return v.seasonId === seasonId && v.rideDate === rideDate ? (v.boonId ?? null) : null;
  } catch {
    return null;
  }
}

export interface RideLogEntry {
  /** Absolute hour bucket (Date.now() / 3_600_000, floored). */
  hour: number;
  depth: number;
  scrap: number;
  survivors: number;
  enemiesDefeated: number;
}

export const RIDE_LOG_MAX = 24;

/** Completed hourly rides, newest first, capped at RIDE_LOG_MAX. Scoped by
 * season so the log resets when a new season starts (including mid-season
 * re-issues like the 2026-07-13.2 restart token). */
export function saveRideLog(seasonId: string, log: RideLogEntry[]): void {
  try {
    localStorage.setItem(`${NS}:ridelog`, JSON.stringify({ seasonId, log: log.slice(0, RIDE_LOG_MAX) }));
  } catch {
    // Non-fatal.
  }
}

export function loadRideLog(seasonId: string): RideLogEntry[] {
  try {
    const raw = localStorage.getItem(`${NS}:ridelog`);
    if (!raw) return [];
    const v = JSON.parse(raw) as { seasonId: string; log: RideLogEntry[] };
    return v.seasonId === seasonId ? v.log : [];
  } catch {
    return [];
  }
}

/** Whether the player has dismissed the PWA install nudge (PWA-SCOPE.md
 * Phase 2) — shown once after the first good ride (`seasonBest > 0`),
 * suppressed permanently once dismissed or once installed. Channel-
 * namespaced like everything else here, even though installing is a
 * browser/OS-level action, so a dev-channel dismissal never silently
 * suppresses the prod nudge (they're different origins-paths, same
 * localStorage origin). */
export function loadInstallNudgeDismissed(): boolean {
  try {
    return localStorage.getItem(`${NS}:installdismissed`) === '1';
  } catch {
    return false;
  }
}

export function saveInstallNudgeDismissed(): void {
  try {
    localStorage.setItem(`${NS}:installdismissed`, '1');
  } catch {
    // Non-fatal — worst case the nudge reappears next session.
  }
}
