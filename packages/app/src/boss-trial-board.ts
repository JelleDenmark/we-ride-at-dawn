/**
 * Daily Boss Trial leaderboard (issue #107, Phase 1 — "just a number on a
 * leaderboard", no rewards). This is a parallel board to `leaderboard.ts`'s
 * depth board, scoring `simulateBossTrial`'s `totalDamage` instead of
 * gauntlet depth. It deliberately mirrors that file's submit/fetch/rank
 * shape line-for-line — same Supabase RPC-upsert posture, same
 * `boardSeason()` dev-prefix isolation, same fire-and-forget submit — so the
 * two boards stay easy to reason about together. See `leaderboard.ts` for
 * the shared rationale (kept there, not duplicated here); `isMe`/
 * `boardSeason`/`defaultName` are reused directly from it rather than
 * redefined.
 */
import type { Lineup } from '@wrad/core';
import { SUPABASE_URL, SUPABASE_ANON_KEY, deviceId } from './telemetry';
import { boardSeason } from './leaderboard';

export interface BossTrialRow {
  name: string;
  damage: number;
  phases: number;
  day: number;
  device_id: string;
}

const HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
};

/**
 * Upsert this device's best Boss Trial damage via the security-definer RPC
 * (keeps the highest damage per device, mirrors `submitScore`). Fire-and-
 * forget: never blocks or breaks play.
 *
 * ANTI-CHEAT GAP (issue #107, "Anti-cheat note"): like the depth board (#81)
 * this score is entirely client-trusted — and *worse*, since depth is capped
 * at 45 (a sanity-checkable bound on a cheater) while cumulative Boss Trial
 * damage is uncapped, making it strictly easier to fake convincingly. Shipped
 * anyway per the RFC's explicit call ("ship it, flag it") — not solved here.
 */
export async function submitBossTrialScore(args: {
  seasonId: string;
  name: string;
  damage: number;
  phases: number;
  day: number;
  lineup: Lineup;
}): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_boss_trial`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        p_season: boardSeason(args.seasonId),
        p_device: deviceId(),
        p_name: args.name,
        p_damage: args.damage,
        p_phases: args.phases,
        p_day: args.day,
        p_lineup: args.lineup,
      }),
      keepalive: true,
    });
  } catch {
    // Offline or server down — the local daily-best (persistence.ts) is
    // still authoritative for gating today's trial.
  }
}

/** Top-N of a season's Boss Trial board, highest damage first, phases as the
 * tiebreak (mirrors `fetchTop`'s `depth.desc,kills.desc` shape). Empty array
 * on any failure. */
export async function fetchBossTrialTop(seasonId: string, limit = 20): Promise<BossTrialRow[]> {
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/boss_trial_scores?season_id=eq.${encodeURIComponent(boardSeason(seasonId))}` +
      `&order=damage.desc,phases.desc,updated_at.asc&limit=${limit}&select=name,damage,phases,day,device_id`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    return (await res.json()) as BossTrialRow[];
  } catch {
    return [];
  }
}

/**
 * This device's rank in a season's Boss Trial board (1-based). A rider
 * outranks you if they dealt strictly more damage, or tied on damage with
 * strictly more phases survived (mirrors the board's `damage.desc,
 * phases.desc` ordering, same shape as `fetchRank`). Returns null if
 * unranked or on failure.
 */
export async function fetchBossTrialRank(
  seasonId: string,
  damage: number,
  phases: number
): Promise<number | null> {
  if (damage <= 0) return null;
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/boss_trial_scores?season_id=eq.${encodeURIComponent(boardSeason(seasonId))}` +
      `&or=(damage.gt.${damage},and(damage.eq.${damage},phases.gt.${phases}))&select=device_id`;
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
