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
