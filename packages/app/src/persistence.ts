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

/** Best depth reached this season (headline leaderboard score), plus the
 * hour bucket of the ride that set it (for anti-cheat re-simulation).
 * NOT YET IMPLEMENTED — see issue #81: there is currently no server-side
 * re-simulation, so submitted scores are entirely client-trusted. This
 * field is captured now so that work is a client-side no-op when it lands. */
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

/**
 * Daily Boss Trial (issue #107, Phase 1; fixed-hour + stored lineup per
 * issue #120) once-per-day gate. "Day" here reuses the exact same primitive
 * the rest of this file keys off — `build.day` (1..SEASON_DAYS, the ISO
 * weekday within the current season/week, see `BuildState.day` in
 * `shop.ts`) — per the RFC's explicit instruction not to invent a new
 * day/rollover primitive. Paired with `seasonId` (as `best`/`kills` above
 * already are) so a stored record only ever matches one exact calendar day
 * within one exact season; a season rollover *or* a day rollover both
 * naturally fail the match below and re-open the trial — no separate reset
 * step is needed the way `seasonBest`/`seasonKills` need one on season
 * change (they're scoped to the season only, not the day).
 *
 * Since #120 the trial fights automatically at a fixed hour against
 * whatever's currently persisted, rather than on a player click, so the
 * exact `lineup` that fought must be stored alongside the score — issue
 * #118's replay re-derives the fight by re-simulating this stored lineup,
 * and (per commit 3ba9b2d) `timeOfDay` is load-bearing *inside* that lineup,
 * not a separate field.
 */
export interface BossTrialToday {
  damage: number;
  phases: number;
  lineup: Lineup;
}

/** Record today's Boss Trial result — the one-shot-per-day gate flips to
 * "used" until `seasonId`/`day` next changes. */
export function saveBossTrialToday(seasonId: string, day: number, result: BossTrialToday): void {
  try {
    localStorage.setItem(`${NS}:bosstrial`, JSON.stringify({ seasonId, day, ...result }));
  } catch {
    // Non-fatal — worst case the trial looks available again this session,
    // letting it re-resolve automatically (harmless: the server RPC is still
    // greatest()-monotonic, so a resubmit can't lower the stored score).
  }
}

/** Today's stored Boss Trial result, or null if today's trial hasn't been
 * run yet — covers "no record at all", "a different season", "a different
 * day", and "a pre-#120 record with no stored lineup" identically, since all
 * of those mean the trial is available (the last case self-heals: it just
 * re-resolves next time the fixed hour is checked). */
export function loadBossTrialToday(seasonId: string, day: number): BossTrialToday | null {
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
    if (v.seasonId !== seasonId || v.day !== day || !v.lineup) return null;
    return { damage: v.damage, phases: v.phases, lineup: v.lineup };
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
