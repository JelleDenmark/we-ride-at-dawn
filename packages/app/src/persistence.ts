import type { BuildState, Lineup, BattleResult } from '@wrad/core';
import { CHANNEL } from './env';

// Channel-namespaced so dev experiments never clobber prod state on the
// same origin.
const NS = CHANNEL === 'prod' ? 'wrad' : 'wrad-dev';

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
    return raw ? (JSON.parse(raw) as BuildState) : null;
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

/** Best depth reached this season (headline leaderboard score). */
export function saveSeasonBest(seasonId: string, best: number): void {
  try {
    localStorage.setItem(`${NS}:best`, JSON.stringify({ seasonId, best }));
  } catch {
    // Non-fatal.
  }
}

export function loadSeasonBest(seasonId: string): number {
  try {
    const raw = localStorage.getItem(`${NS}:best`);
    if (!raw) return 0;
    const v = JSON.parse(raw) as { seasonId: string; best: number };
    return v.seasonId === seasonId ? v.best : 0;
  } catch {
    return 0;
  }
}
