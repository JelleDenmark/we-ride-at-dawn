/**
 * Daily Boss Trial (issue #107) — a Gem-TD-style raw-damage check that runs the
 * player's LIVE current horde against a single escalating boss and scores the
 * total damage dealt. It exists to differentiate top boards after they've maxed
 * the 45-wave depth ladder (a maxed t3 board already tops ~43/45), where depth
 * saturates but damage output does not.
 *
 * ## Why this is a thin wrapper over `simulate`, not a new battle loop
 *
 * The RFC's first instinct was to feed synthetic waves through the wave loop
 * "unmodified", but an audit found the naive wave = one-hit mapping breaks in
 * several ways (Ward-Weaver's block pool regenerates every hit → the trial
 * never terminates; Rat-Piper re-summons every hit → the horde never depletes;
 * poison re-applies every hit), and more fundamentally an unbounded-HP boss
 * means a wave never CLEARS, so the attack never escalates. The resolution
 * (signed off by Jesper, 2026-07-16) is the **phase = wave** model:
 *
 *   - Each "phase" IS one synthetic wave: a fresh boss instance the horde must
 *     kill to advance. Killing it escalates the next boss's attack by ×1.5.
 *   - Because a phase is a real wave, EVERY per-wave semantic the engine
 *     already has is inherited for free and correctly: Ward-Weaver's block pool
 *     and the #116 poison-all cap reset per phase (not per hit), `startOfWave`
 *     summons/poison fire once per phase, `startOfBattle` buffs fire once ever.
 *     Zero changes to `sim.ts` — the trial cannot drift from real combat.
 *   - Termination is guaranteed: boss attack grows as 1.5^phase, so no build,
 *     however tanky/sustain-heavy, survives past a few dozen phases.
 *
 * ## The one wrinkle: enemy per-wave scaling
 *
 * `simulate` multiplies every gauntlet enemy's stats by `enemyAttackScale(w)` /
 * `enemyHealthScale(w)` (the normal depth curve). We do NOT want that curve on
 * top of our own ×1.5 escalation, so the gauntlet builder pre-divides each
 * boss's stats by those exact (pure, exported) functions — after the sim scales
 * them back, the boss lands on precisely the attack/HP this file intends. This
 * keeps all the tuning in ONE place (the constants below) and needs no sim flag.
 *
 * ## Scoring
 *
 * Score = total damage dealt to the boss across the whole trial, summed from
 * the `damage` + `poisonTick` battle events (so poison COUNTS — unlike the
 * balance scripts' `damageDealt`, which ignores it; a poison build genuinely
 * "hits harder" and should score for it). Tiebreak = phases survived, mirroring
 * the depth board's `depth.desc, kills.desc` shape (`leaderboard.ts`).
 */
import type { Gauntlet } from './gauntlet';
import type { Lineup, UnitDef } from './data/units';
import type { BattleEvent } from './sim';
import { simulate, enemyAttackScale, enemyHealthScale } from './sim';

/**
 * Tuning knobs — ALL subject to a balance pass before ship (issue #107's
 * acceptance criteria note "exact numbers subject to a balance pass"). Kept as
 * named exports so the balance probe and any future re-tune touch one place.
 */
export const BOSS_TRIAL_BASE_ATTACK = 6;
export const BOSS_TRIAL_HP = 120;
export const BOSS_TRIAL_ESCALATION = 1.5;
/**
 * Hard ceiling on phases. Purely a safety bound so the synthetic gauntlet is
 * finite; 1.5^phase attack wipes any real board long before this (by ~phase 20
 * the boss hits for thousands), so reaching it would signal a bug, not a build.
 */
export const BOSS_TRIAL_MAX_PHASES = 60;

/** The boss's intended attack at a given 0-based phase (before sim scaling). */
export function bossTrialPhaseAttack(phase: number): number {
  return BOSS_TRIAL_BASE_ATTACK * Math.pow(BOSS_TRIAL_ESCALATION, phase);
}

/**
 * Build the synthetic gauntlet: one boss per phase, its stats pre-divided by
 * the sim's per-wave scaling so the boss lands on `bossTrialPhaseAttack(phase)`
 * attack and `BOSS_TRIAL_HP` health after the sim scales them back. Stats are
 * floored at 1 (deep phases divide the compensated value below 1, but those
 * phases are unreachable in practice — see BOSS_TRIAL_MAX_PHASES).
 */
export function buildBossTrialGauntlet(): Gauntlet {
  const waves = Array.from({ length: BOSS_TRIAL_MAX_PHASES }, (_, phase) => {
    const boss: UnitDef = {
      id: 'boss-trial',
      name: 'The Gauntlet Boss',
      attack: Math.max(1, Math.round(bossTrialPhaseAttack(phase) / enemyAttackScale(phase))),
      health: Math.max(1, Math.round(BOSS_TRIAL_HP / enemyHealthScale(phase))),
      cost: 0,
    };
    return { units: [boss] };
  });
  return { date: 'boss-trial', seed: 0, waves };
}

export interface BossTrialResult {
  /** Total damage dealt to the boss over the whole trial — the leaderboard score. */
  totalDamage: number;
  /** Phases fully cleared (bosses killed) — the score tiebreak. */
  phasesSurvived: number;
}

/**
 * Run the player's live horde through the Boss Trial and return the score.
 * `lineup` is the exact board they're playing (tier, relics, timeOfDay all
 * carried through `simulate` unchanged) — no snapshot/lock-in, per the RFC.
 */
export function simulateBossTrial(lineup: Lineup): BossTrialResult {
  const { events, result } = simulate(lineup, buildBossTrialGauntlet());

  // Every enemy in the trial is a boss; collect their instance ids from the
  // per-phase waveStart events, then sum all damage (clash + poison) landed on
  // them. Filtering by id excludes the horde's own damage events.
  const bossIds = new Set<number>();
  for (const e of events) {
    if (e.type === 'waveStart') for (const en of e.enemies) bossIds.add(en.instanceId);
  }
  let totalDamage = 0;
  for (const e of events) {
    if ((e.type === 'damage' || e.type === 'poisonTick') && bossIds.has(e.targetId)) {
      totalDamage += e.amount;
    }
  }

  return { totalDamage, phasesSurvived: result.wavesCleared };
}

/**
 * Re-derive the raw battle events for a Boss Trial fight without the score
 * bookkeeping (issue #118's "watch the trial" replay). Since #120 the trial
 * fights automatically against whatever's persisted at the fixed hour and
 * only `{damage, phases, lineup}` is stored — no event stream — so watching
 * it back means re-running the SAME deterministic fight: same fixed
 * gauntlet, no date seed, so calling this with the exact `lineup` that was
 * stored (per commit 3ba9b2d, `timeOfDay` lives INSIDE that lineup, not a
 * separate field — an untimed or re-derived-from-"now" lineup reproduces a
 * DIFFERENT fight than the one that was scored) reproduces the identical
 * event stream byte-for-byte, the same guarantee `simulateBossTrial`'s own
 * "is deterministic" test pins for the score.
 */
export function simulateBossTrialReplay(lineup: Lineup): BattleEvent[] {
  return simulate(lineup, buildBossTrialGauntlet()).events;
}
