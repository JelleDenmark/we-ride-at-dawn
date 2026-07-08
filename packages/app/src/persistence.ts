import type { BuildState, Lineup, BattleResult } from '@wrad/core';
import { CHANNEL } from './env';

// Channel-namespaced so dev experiments never clobber prod state on the
// same origin.
const NS = CHANNEL === 'prod' ? 'wrad' : 'wrad-dev';

/** Builds saved before the bench feature shipped have no `bench` field —
 * default it to empty so upgrading players don't hit `undefined.length`. */
function migrateBuild(build: BuildState): BuildState {
  return build.bench ? build : { ...build, bench: [] };
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

/** Best depth reached this season (headline leaderboard score), plus the
 * hour bucket of the ride that set it (for anti-cheat re-simulation). */
export function saveSeasonBest(seasonId: string, best: number, hour?: number): void {
  try {
    localStorage.setItem(`${NS}:best`, JSON.stringify({ seasonId, best, hour }));
  } catch {
    // Non-fatal.
  }
}

export function loadSeasonBest(seasonId: string): { best: number; hour?: number } {
  try {
    const raw = localStorage.getItem(`${NS}:best`);
    if (!raw) return { best: 0 };
    const v = JSON.parse(raw) as { seasonId: string; best: number; hour?: number };
    return v.seasonId === seasonId ? { best: v.best, hour: v.hour } : { best: 0 };
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

export interface RideLogEntry {
  /** Absolute hour bucket (Date.now() / 3_600_000, floored). */
  hour: number;
  depth: number;
  scrap: number;
  survivors: number;
  enemiesDefeated: number;
}

export const RIDE_LOG_MAX = 24;

/** Completed hourly rides, newest first, capped at RIDE_LOG_MAX. */
export function saveRideLog(log: RideLogEntry[]): void {
  try {
    localStorage.setItem(`${NS}:ridelog`, JSON.stringify(log.slice(0, RIDE_LOG_MAX)));
  } catch {
    // Non-fatal.
  }
}

export function loadRideLog(): RideLogEntry[] {
  try {
    const raw = localStorage.getItem(`${NS}:ridelog`);
    return raw ? (JSON.parse(raw) as RideLogEntry[]) : [];
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
