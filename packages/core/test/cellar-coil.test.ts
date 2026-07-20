// Cellar-Coil (issue #106) — "positional patience" (docs/design/future-minions.md
// concept 2). This is the ADR-0003 compounding-law canary the issue calls
// for: a permanent per-wave stat gain on a repeating trigger is exactly the
// shape that shipped as the Warren-Warden incident (a startOfBattle buff
// mistakenly re-firing every wave, taking a 6-attack rat to 241 attack and
// full-clearing the gauntlet). Cellar-Coil's `chargeWhileBenched` is only
// safe because `cellarCoilChargeCapForTier` is a hard, non-negotiable clamp
// — this suite asserts the plateau holds exactly at the cap over a
// synthetic 60-wave (> WAVE_COUNT's 45) gauntlet, never exceeding it.
import { describe, expect, it } from 'vitest';
import { simulate, type BattleEvent } from '../src/sim';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';
import { cellarCoilChargeCapForTier, UNIT_DEFS } from '../src/data/units';

const dummy = (attack: number, health: number): UnitDef => ({
  id: 'dummy', name: 'Dummy', attack, health, cost: 0,
});

const gauntletOf = (...waves: UnitDef[][]): Gauntlet => ({
  date: 'test',
  seed: 0,
  waves: waves.map((units) => ({ units })),
});

// A long, cheap-to-clear grinder: `waves` copies of a 0-attack, low-health
// dummy. 0 attack means the front tank never actually takes damage, so both
// the tank and the benched Cellar-Coil survive every single wave — the
// worst case for the cap, since the Coil never has to sit out a wave from
// the front dying. The grinder tank is gutter-runt, NOT dire-rat: dire-rat
// carries armor (`damageReduction`), and a 0-attack hit against an armored
// unit still lands for `MIN_ATTACK_DAMAGE` (the "a hit always lands for at
// least 1" floor in `applyDamage`), which would chip dire-rat to death over
// many ticks even though the enemy's nominal attack is 0 — an armor-floor
// quirk unrelated to what this canary is testing. gutter-runt has no armor,
// so a true 0-attack enemy deals it truly 0 damage, forever.
// Health is kept small (5, not 1000) so that even with the engine's
// per-wave-depth health scaling (`enemyHealthScale`), a 60-90 wave run still
// clears every wave well within `MAX_TICKS_PER_WAVE` — a too-tanky dummy
// would make deep waves exceed the tick cap and abort the whole synthetic
// gauntlet early, which is a MAX_TICKS_PER_WAVE test-rig artifact, not the
// compounding-law property this canary is actually after.
const grinder = (waves: number): Gauntlet => ({
  date: 'test',
  seed: 0,
  waves: Array.from({ length: waves }, () => ({ units: [dummy(0, 5)] })),
});

const lineup = (...units: Lineup['units']): Lineup => ({ units });

const ofType = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe('Cellar-Coil (issue #106): chargeWhileBenched', () => {
  it('banks +attack only on waves it survives while NOT front', () => {
    // Cellar-Coil sits behind dire-rat (front, tanks the clash). A single
    // wave should grant exactly attackPerWave(1) * tier(1) = 1 attack.
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'cellar-coil' }),
      gauntletOf([dummy(0, 1000)])
    );
    const buffs = ofType(events, 'buff');
    // Only the Cellar-Coil's own charge buff should appear — dire-rat has no
    // ability, so no other 'buff' events exist this wave.
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(1);
    expect(buffs[0].health).toBe(0);
  });

  it('does not charge at all when it is the lone unit at front', () => {
    const { events } = simulate(
      lineup({ defId: 'cellar-coil' }),
      gauntletOf([dummy(0, 1000)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(0);
  });

  it('stops charging the wave it rotates up to front', () => {
    // gutter-runt (1 health, no armor) dies outright to a 1000-attack enemy
    // in wave 1, so Cellar-Coil rotates to front for wave 2. Wave 2's enemy
    // has 0 attack so we can observe whether the wave-2 buff still fires now
    // that Cellar-Coil is front (it should not).
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'cellar-coil' }),
      gauntletOf([dummy(1000, 1)], [dummy(0, 1000)])
    );
    // gutter-runt dies wave 1 (dummy has 1000 attack, gutter-runt's health is
    // small); Cellar-Coil rotates to index 0 for wave 2 and should get no
    // charge buff that wave.
    const waveStarts = ofType(events, 'waveStart');
    expect(waveStarts.length).toBe(2);
    const wave2Start = events.indexOf(waveStarts[1]);
    const buffsAfterWave2 = ofType(events, 'buff').filter((b) => events.indexOf(b) > wave2Start);
    expect(buffsAfterWave2.length).toBe(0);
  });

  it('plateaus at exactly the tier-1 cap over a synthetic 60-wave gauntlet, never exceeding it', () => {
    const cap = cellarCoilChargeCapForTier(1);
    const { events, result } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'cellar-coil' }),
      grinder(60)
    );
    // Both units should survive all 60 waves (0-attack enemies).
    expect(result.wavesCleared).toBe(60);
    const buffs = ofType(events, 'buff');
    // Total banked attack across every buff event must equal the cap exactly.
    const totalBanked = buffs.reduce((s, b) => s + b.attack, 0);
    expect(totalBanked).toBe(cap);
    // The running total must never exceed the cap at any point either.
    let running = 0;
    for (const b of buffs) {
      running += b.attack;
      expect(running).toBeLessThanOrEqual(cap);
    }
    // It should take exactly `cap` waves (1 attack/wave at tier 1) to fill,
    // then go silent for the remaining waves — the "no-op forever after"
    // hard stop, not an error.
    expect(buffs.length).toBe(cap);
  });

  it('plateaus at exactly the tier-2 and tier-3 caps too (linear per-wave grant, not exponential)', () => {
    for (const tier of [2, 3] as const) {
      const cap = cellarCoilChargeCapForTier(tier);
      const { events, result } = simulate(
        lineup({ defId: 'gutter-runt' }, { defId: 'cellar-coil', tier }),
        grinder(60)
      );
      expect(result.wavesCleared).toBe(60);
      const buffs = ofType(events, 'buff').filter((b) => b.health === 0 && b.attack > 0);
      const totalBanked = buffs.reduce((s, b) => s + b.attack, 0);
      expect(totalBanked).toBe(cap);
      // Linear grant per wave (attackPerWave * tier): tier 2 -> 2/wave,
      // tier 3 -> 3/wave. Every individual grant before the cap truncates it
      // should equal that per-wave amount.
      const perWave = tier; // attackPerWave (1) * tier
      const fullGrants = buffs.filter((b) => b.attack === perWave);
      expect(fullGrants.length).toBe(Math.floor(cap / perWave));
    }
  });

  it('multiple Cellar-Coils each cap independently (no shared pool)', () => {
    const cap = cellarCoilChargeCapForTier(1);
    const { events, result } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'cellar-coil' }, { defId: 'cellar-coil' }),
      grinder(60)
    );
    expect(result.wavesCleared).toBe(60);
    const buffs = ofType(events, 'buff');
    // Two independent Coils, each capped at `cap` -> total banked = 2 * cap.
    expect(buffs.reduce((s, b) => s + b.attack, 0)).toBe(2 * cap);
  });

  it('the cap survives across the whole synthetic gauntlet, not just one battle/wave window', () => {
    // Run well past WAVE_COUNT (45) — 90 waves — and confirm the plateau
    // still holds exactly at the cap with no further growth in the back
    // half of the run.
    const cap = cellarCoilChargeCapForTier(1);
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'cellar-coil' }),
      grinder(90)
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.reduce((s, b) => s + b.attack, 0)).toBe(cap);
    expect(buffs.length).toBe(cap);
  });

  it('cellar-coil unit def exists, is capped by cellarCoilChargeCapForTier, and grants no health', () => {
    const def = UNIT_DEFS['cellar-coil'];
    expect(def).toBeDefined();
    expect(def.ability?.trigger).toBe('startOfWave');
    expect(def.ability?.condition?.notFront).toBe(true);
    expect(def.ability?.effect.kind).toBe('chargeWhileBenched');
    expect(cellarCoilChargeCapForTier(1)).toBe(6);
    expect(cellarCoilChargeCapForTier(2)).toBe(12);
    expect(cellarCoilChargeCapForTier(3)).toBe(18);
  });
});
