// Anti-cheat re-simulation sweep (issue #81). Supabase Edge Function.
//
// The gauntlet sim is fully deterministic from what the client now submits
// with every score: the best ride's snapshot (rideDate, day, lineup) plus
// rideHour (tucked into the lineup jsonb by leaderboard.ts). This function
// replays exactly that ride with @wrad/core's own simulate() — the same
// code the client ran, pre-bundled for Deno (see
// scripts/bundle-core-for-deno.mjs) — and shadow-flags each row's
// `verified` column: true (reproduced), false (claimed depth does not
// reproduce), or left null (legacy row with no snapshot — unverifiable, not
// guilty). Enforcement posture and timeOfDay trust model: README.md.
//
// Invoke manually or on a schedule, one season per call:
//   POST { "season": "dev-2026-07-20" }  (the exact season_id value, prefix included)
// Guarded by a shared secret (VERIFY_SCORES_SECRET env) so anon clients
// can't burn CPU or probe flags; deploy with --no-verify-jwt.
import { generateGauntlet, simulate, WAVE_COUNT } from './wrad-core.bundle.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('VERIFY_SCORES_SECRET') ?? '';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

interface ScoreRow {
  season_id: string;
  device_id: string;
  depth: number;
  day: number;
  lineup: {
    units?: unknown[];
    teamRelicIds?: string[];
    combatCap?: number;
    timeOfDay?: string;
    rideHour?: number;
    rideDate?: string;
  };
}

// Mirrors App.svelte's copenhagenSeconds/timeOfDayAt: noon Copenhagen is the
// Dawn-Runt/Dusk-Runt cutoff. Derived here from the claimed rideHour rather
// than trusting the client's timeOfDay string — see README.md for why that
// bounds (not eliminates, and doesn't need to eliminate) clock spoofing.
function timeOfDayAt(ms: number): 'beforeNoon' | 'afterNoon' {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen',
    hour12: false,
    hour: '2-digit',
  }).format(new Date(ms));
  return Number(parts) < 12 ? 'beforeNoon' : 'afterNoon';
}

/** Days from the season Monday to the ride date; day N rides on monday+(N-1). */
function dayForDate(seasonMonday: string, rideDate: string): number {
  const delta = Date.parse(`${rideDate}T12:00:00Z`) - Date.parse(`${seasonMonday}T12:00:00Z`);
  return Math.round(delta / DAY_MS) + 1;
}

type Outcome = 'verified' | 'flagged' | 'skipped_legacy';

function verifyRow(row: ScoreRow): Outcome {
  const { rideHour, rideDate, ...lineupRest } = row.lineup ?? {};
  // Pre-snapshot clients (or pre-rideHour ones) can't be replayed — leave
  // null. This cohort ages out as clients upgrade; it must never be flagged.
  if (typeof rideDate !== 'string' || typeof rideHour !== 'number') return 'skipped_legacy';

  // Structural sanity before spending sim time. Any impossibility here is a
  // fabricated payload, not a legacy quirk — flag it.
  const seasonMonday = row.season_id.replace(/^dev-/, '');
  const claimedDay = dayForDate(seasonMonday, rideDate);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(rideDate) ||
    !Number.isFinite(Date.parse(`${seasonMonday}T00:00:00Z`)) ||
    claimedDay !== row.day ||
    row.day < 1 ||
    row.day > 7 ||
    row.depth < 0 ||
    row.depth > WAVE_COUNT ||
    // rideHour must fall roughly on rideDate (±1 day absorbs the 06:00
    // Copenhagen ride-date rollover without replicating it exactly).
    Math.abs(rideHour * HOUR_MS - Date.parse(`${rideDate}T12:00:00Z`)) > DAY_MS
  ) {
    return 'flagged';
  }

  const lineup = { ...lineupRest, timeOfDay: timeOfDayAt(rideHour * HOUR_MS) };
  const { result } = simulate(lineup, generateGauntlet(rideDate, row.day));
  // >= not ===: underselling your own ride is not cheating, and it keeps a
  // benign claimed-less-than-achieved edge from ever flagging a legit player.
  return result.wavesCleared >= row.depth ? 'verified' : 'flagged';
}

async function patchRow(row: ScoreRow, verified: boolean): Promise<void> {
  const url =
    `${SUPABASE_URL}/rest/v1/scores` +
    `?season_id=eq.${encodeURIComponent(row.season_id)}&device_id=eq.${row.device_id}`;
  await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ verified }),
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  if (!SECRET || req.headers.get('authorization') !== `Bearer ${SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const { season, limit = 200 } = await req.json().catch(() => ({}));
  if (typeof season !== 'string' || season.length === 0) {
    return new Response('body must include "season" (exact season_id, prefix included)', {
      status: 400,
    });
  }

  const listUrl =
    `${SUPABASE_URL}/rest/v1/scores` +
    `?season_id=eq.${encodeURIComponent(season)}&verified=is.null` +
    `&select=season_id,device_id,depth,day,lineup&limit=${limit}`;
  const res = await fetch(listUrl, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) return new Response(`scores fetch failed: ${res.status}`, { status: 502 });
  const rows = (await res.json()) as ScoreRow[];

  const summary = { season, checked: rows.length, verified: 0, flagged: 0, skipped_legacy: 0 };
  const flaggedDevices: string[] = [];
  for (const row of rows) {
    let outcome: Outcome;
    try {
      outcome = verifyRow(row);
    } catch {
      // A sim crash on hostile input is a fabricated lineup, not our bug.
      outcome = 'flagged';
    }
    summary[outcome]++;
    if (outcome === 'flagged') flaggedDevices.push(row.device_id);
    if (outcome !== 'skipped_legacy') await patchRow(row, outcome === 'verified');
  }

  return new Response(JSON.stringify({ ...summary, flaggedDevices }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
