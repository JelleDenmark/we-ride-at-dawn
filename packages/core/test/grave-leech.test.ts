// Grave-Leech (issue #135): sustain — the first unit-side heal (Fat Tick's
// relic regen was the only heal in the game before this). A front tank that
// drains `amount * tier` back after each clash it SURVIVES, clamped at its
// own maxHealth inside the effect application (the ADR-0003 bound: no
// accumulation past its own ceiling, ever) and never firing at 0 or less
// health (a drain must not cheat the faint it already owes).
import { describe, expect, it } from 'vitest';
import { simulate, type BattleEvent } from '../src/sim';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';
import { UNIT_DEFS } from '../src/data/units';

const dummy = (attack: number, health: number): UnitDef => ({
  id: 'dummy', name: 'Dummy', attack, health, cost: 0,
});

const gauntletOf = (...waves: UnitDef[][]): Gauntlet => ({
  date: 'test',
  seed: 0,
  waves: waves.map((units) => ({ units })),
});

const lineup = (...units: Lineup['units']): Lineup => ({ units });

const ofType = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe('Grave-Leech (issue #135: lifedrain sustain)', () => {
  it('is wired as designed: afterAttack trigger, healSelf effect', () => {
    const def = UNIT_DEFS['grave-leech'];
    expect(def).toBeDefined();
    expect(def.ability?.trigger).toBe('afterAttack');
    expect(def.ability?.effect.kind).toBe('healSelf');
  });

  it('drains 1 back after each clash it survives (halved per the #147 sign-off)', () => {
    // Foe hits for 1, drain heals 1 — the Leech holds at full while it chews
    // through the wave. (Drain was 2 at launch; the #147 balance pass halved
    // it — at 2 it was the only exploit-stress flag in the roster.)
    const { events, result } = simulate(
      lineup({ defId: 'grave-leech' }),
      gauntletOf([dummy(1, 20)])
    );
    const heals = ofType(events, 'heal');
    expect(heals.length).toBeGreaterThan(0);
    expect(heals.every((h) => h.amount === 1)).toBe(true);
    expect(heals.every((h) => h.newHealth === UNIT_DEFS['grave-leech'].health)).toBe(true);
    expect(result.wavesCleared).toBe(1);
    expect(result.survivors[0].health).toBe(UNIT_DEFS['grave-leech'].health);
  });

  it('the drain clamps at maxHealth — a 1-damage scratch heals only 1 back at ★2', () => {
    // Tier-1 drain (1) can't exceed the minimum clash damage, so the clamp
    // is only observable from ★2 up: drain 2, scratch 1, heal must be 1.
    const { events } = simulate(
      lineup({ defId: 'grave-leech', tier: 2 }),
      gauntletOf([dummy(1, 20)])
    );
    const heals = ofType(events, 'heal');
    expect(heals.length).toBeGreaterThan(0);
    expect(heals.every((h) => h.amount === 1)).toBe(true); // never the full 2
  });

  it('a clash it did NOT survive pays nothing — the drain cannot cheat death', () => {
    // A 50-attack foe kills the Leech on the opening clash. afterAttack
    // still runs for the front unit, but healSelf at <= 0 health must be a
    // no-op — no heal event, no quiet resurrection ahead of resolveDeaths.
    const { events, result } = simulate(
      lineup({ defId: 'grave-leech' }),
      gauntletOf([dummy(50, 100)])
    );
    expect(ofType(events, 'heal').length).toBe(0);
    expect(ofType(events, 'death').length).toBe(1);
    expect(result.survivors.length).toBe(0);
    expect(result.wavesCleared).toBe(0);
  });

  it('scales LINEARLY with tier (1/2/3), never the exponential curve', () => {
    // ★2 Leech (9/18): a 6-attack foe bites for 6, the drain returns 2.
    const { events } = simulate(
      lineup({ defId: 'grave-leech', tier: 2 }),
      gauntletOf([dummy(6, 50)])
    );
    const heals = ofType(events, 'heal');
    expect(heals.length).toBeGreaterThan(0);
    expect(heals[0].amount).toBe(2);
  });

  it('holds a long grind far better than an unhealed body of the same size (the sustain identity)', () => {
    // Carried damage across waves is the game's real attrition (the front
    // rat keeps its wounds); drain converts clashes into staying power. The
    // control is Warren-Warden — the same 6-health frontline body (its
    // buffBehind has nobody to land on when fielded alone), which bleeds
    // out in the first wave of the same grind the Leech clears end to end.
    const grind = (): Gauntlet =>
      gauntletOf(...Array.from({ length: 20 }, () => [dummy(2, 6)]));
    const drained = simulate(lineup({ defId: 'grave-leech' }), grind());
    const control = simulate(lineup({ defId: 'warren-warden' }), grind());
    // Depth scaling (enemyAttackScale/enemyHealthScale) eventually outgrows
    // the tier-1 drain, so the Leech doesn't clear the whole grind — but it
    // still out-rides the unhealed body. The margin was ≥+3 waves at the
    // launch drain of 2; the #147 halving deliberately cut the sustain in
    // half, so the identity check is now a strict win, not a blowout.
    expect(control.result.wavesCleared).toBeLessThan(3);
    expect(drained.result.wavesCleared).toBeGreaterThan(control.result.wavesCleared);
  });
});
