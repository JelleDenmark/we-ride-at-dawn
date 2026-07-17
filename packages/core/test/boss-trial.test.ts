import { describe, expect, it } from 'vitest';
import type { Lineup } from '../src/data/units';
import { simulate } from '../src/sim';
import {
  simulateBossTrial,
  buildBossTrialGauntlet,
  bossTrialPhaseAttack,
  BOSS_TRIAL_BASE_ATTACK,
  BOSS_TRIAL_ESCALATION,
  BOSS_TRIAL_MAX_PHASES,
} from '../src/boss-trial';

// Issue #107: the Boss Trial is a wrapper over `simulate` (phase = wave), so
// these tests pin the ENGINE properties that must hold regardless of the tuning
// constants — termination, monotonicity, weak-board floor, poison counting, and
// determinism. The exact score magnitudes are a balance knob (flagged for
// sign-off), so they are deliberately NOT asserted here.

const board = (order: string[], tier: number, relics: string[][] = []): Lineup => ({
  units: order.map((defId, i) => ({ defId, tier, relicIds: relics[i] ?? [] })),
});

const WEAK = board(['gutter-runt', 'gutter-runt'], 1);
const MID = board(['dire-rat', 'warren-warden', 'corpse-glutton', 'bone-priest'], 2);
const STRONG: Lineup = {
  units: ['dire-rat', 'ward-weaver', 'corpse-glutton', 'bone-priest', 'press-kin', 'md-rattyfock', 'dire-rat', 'gnawer'].map(
    (defId, i) => ({ defId, tier: 3, relicIds: [['gore-cleaver', 'rusted-nail', 'fat-tick', 'fat-tick', 'fat-tick', 'fat-tick', 'fat-tick', 'fat-tick'][i]] })
  ),
  teamRelicIds: ['filth-totem'],
};

describe('Boss Trial (issue #107)', () => {
  it('the phase-attack curve escalates ×1.5 per phase from the base', () => {
    expect(bossTrialPhaseAttack(0)).toBe(BOSS_TRIAL_BASE_ATTACK);
    expect(bossTrialPhaseAttack(1)).toBeCloseTo(BOSS_TRIAL_BASE_ATTACK * BOSS_TRIAL_ESCALATION);
    expect(bossTrialPhaseAttack(2)).toBeCloseTo(BOSS_TRIAL_BASE_ATTACK * BOSS_TRIAL_ESCALATION ** 2);
  });

  it('the synthetic gauntlet has exactly MAX_PHASES single-boss waves', () => {
    const g = buildBossTrialGauntlet();
    expect(g.waves).toHaveLength(BOSS_TRIAL_MAX_PHASES);
    expect(g.waves.every((w) => w.units.length === 1)).toBe(true);
    expect(g.waves.every((w) => w.units[0].attack >= 1 && w.units[0].health >= 1)).toBe(true);
  });

  it('ALWAYS terminates — no board reaches the phase cap (the escalating attack guarantees a wipe)', () => {
    // The critical acceptance criterion: the trial must end for every build,
    // however tanky/sustain-heavy. Hitting the cap would mean non-termination.
    for (const lineup of [WEAK, MID, STRONG]) {
      expect(simulateBossTrial(lineup).phasesSurvived).toBeLessThan(BOSS_TRIAL_MAX_PHASES);
    }
  });

  it('a Ward-Weaver board cannot stall the trial forever (RFC hard criterion)', () => {
    // The RFC calls out Ward-Weaver's block pool as the thing that, if it reset
    // per hit, would let the horde block every boss swing indefinitely. Under
    // phase = wave the pool resets per phase (not per hit), so even a stack of
    // t3 Ward-Weavers + Bone-Priest sustain still terminates well under the cap.
    const wardWall: Lineup = {
      units: ['ward-weaver', 'ward-weaver', 'bone-priest', 'dire-rat', 'dire-rat'].map((defId) => ({
        defId,
        tier: 3,
        relicIds: [],
      })),
    };
    const { phasesSurvived } = simulateBossTrial(wardWall);
    expect(phasesSurvived).toBeLessThan(BOSS_TRIAL_MAX_PHASES);
  });

  it('a near-empty weak board scores near zero and survives no phases', () => {
    const { totalDamage, phasesSurvived } = simulateBossTrial(WEAK);
    expect(phasesSurvived).toBe(0);
    expect(totalDamage).toBeLessThan(50);
  });

  it('score rises monotonically with board strength (weak < mid < strong)', () => {
    const weak = simulateBossTrial(WEAK).totalDamage;
    const mid = simulateBossTrial(MID).totalDamage;
    const strong = simulateBossTrial(STRONG).totalDamage;
    expect(weak).toBeLessThan(mid);
    expect(mid).toBeLessThan(strong);
  });

  it('poison COUNTS toward the score, and toward damageDealt too (issue #126)', () => {
    // simulateBossTrial sums `damage` + `poisonTick` events landed on the
    // boss; `simulate`'s own `result.damageDealt` (issue #126 fix) now counts
    // gauntlet-side poison too, via the exact same underlying event stream
    // (simulateBossTrial is a thin wrapper over one `simulate` call against
    // `buildBossTrialGauntlet()`) — so the two totals must agree exactly.
    // Before the #126 fix, damageDealt was clash-only and this board's poison
    // ticks made the trial's own total strictly higher; that gap is now closed.
    const poisonBoard: Lineup = {
      units: ['dire-rat', 'draughtsman-moe', 'bone-priest', 'ward-weaver'].map((defId) => ({
        defId,
        tier: 3,
        relicIds: [],
      })),
    };
    const { events, result } = simulate(poisonBoard, buildBossTrialGauntlet());
    const damageDealt = result.damageDealt;
    const totalDamage = simulateBossTrial(poisonBoard).totalDamage;
    expect(totalDamage).toBe(damageDealt);
    // Sanity check the equality above isn't vacuous: poison actually landed
    // on the boss in this run (Draughtsman Moe's poisonAllEnemies).
    const poisonOnBoss = events.filter((e) => e.type === 'poisonTick' && e.amount > 0).length;
    expect(poisonOnBoss).toBeGreaterThan(0);
  });

  it('is deterministic — same lineup yields the same score', () => {
    const a = simulateBossTrial(STRONG);
    const b = simulateBossTrial(STRONG);
    expect(a).toEqual(b);
  });
});
