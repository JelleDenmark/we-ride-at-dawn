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

/**
 * Daily Boss Trial (issue #107, Phase 1; fixed-hour + stored lineup per
 * issue #120) once-per-day gate. "Day" here reuses the exact same primitive
 * the rest of this file keys off — `build.day` (1..SEASON_DAYS, the ISO
 * weekday within the current season/week, see `BuildState.day` in
 * `shop.ts`) — per the RFC's explicit instruction not to invent a new
 * day/rollover primitive.
 *
 * Only the most recent fight is ever stored, but unlike `best`/`kills` its
 * `day` is part of the returned record (not just the match key): the caller
 * needs to tell "today's fight" apart from "the last one that happened,
 * possibly a day or more ago" to keep a replay watchable across a dawn
 * rollover (see App.svelte's "previous fight" display) rather than losing
 * it the moment the calendar day turns over. A season rollover still fully
 * closes it out — `seasonId` is matched exactly, same as `best`/`kills`.
 *
 * Since #120 the trial fights automatically at a fixed hour against
 * whatever's currently persisted, rather than on a player click, so the
 * exact `lineup` that fought must be stored alongside the score — issue
 * #118's replay re-derives the fight by re-simulating this stored lineup,
 * and (per commit 3ba9b2d) `timeOfDay` is load-bearing *inside* that lineup,
 * not a separate field.
 */
export interface BossTrialToday {
  day: number;
  damage: number;
  phases: number;
  lineup: Lineup;
}

/** Record a Boss Trial result for the given day — overwrites whatever was
 * previously stored (there is only ever one "most recent fight" per season). */
export function saveBossTrialToday(seasonId: string, day: number, result: Omit<BossTrialToday, 'day'>): void {
  try {
    localStorage.setItem(`${NS}:bosstrial`, JSON.stringify({ seasonId, day, ...result }));
  } catch {
    // Non-fatal — worst case the trial looks available again this session,
    // letting it re-resolve automatically (harmless: the server RPC is still
    // greatest()-monotonic, so a resubmit can't lower the stored score).
  }
}

/** The most recent Boss Trial result for this season, or null if none has
 * run yet — covers "no record at all", "a different season", and "a pre-#120
 * record with no stored lineup" identically (the last case self-heals: it
 * just re-resolves next time the fixed hour is checked). Deliberately does
 * NOT filter by `day` — the caller compares the returned `day` to the
 * current `build.day` itself, to distinguish "today's fight" (already
 * resolved) from "the previous fight" (still worth watching, but due to be
 * superseded at the next BOSS_TRIAL_HOUR). */
export function loadBossTrialToday(seasonId: string): BossTrialToday | null {
  try {
    const raw = localStorage.getItem(`${NS}:bosstrial`);
    if (!raw) return null;
    const v = JSON.parse(raw) as {
      seasonId: string;
      day: number;
      damage: number;
      phases: number;
      lineup?: Lineup;
    };
    if (v.seasonId !== seasonId || !v.lineup) return null;
    return { day: v.day, damage: v.damage, phases: v.phases, lineup: v.lineup };
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
