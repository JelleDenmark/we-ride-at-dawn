import { describe, expect, it } from 'vitest';
import { simulate, type BattleEvent } from '../src/sim';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';
import { generateGauntlet } from '../src/gauntlet';
import { TEST_HORDE } from '../src/data/units';
import { fnv1a } from '../src/seed';

const dummy = (attack: number, health: number): UnitDef => ({
  id: 'dummy',
  name: 'Dummy',
  attack,
  health,
  cost: 0,
});

const gauntletOf = (...waves: UnitDef[][]): Gauntlet => ({
  date: 'test',
  seed: 0,
  waves: waves.map((units) => ({ units })),
});

const lineup = (...units: Lineup['units']): Lineup => ({ units });

const ofType = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe('unit abilities', () => {
  it('Plague-Bearer poisons the frontmost enemy at start of battle', () => {
    const { events } = simulate(lineup({ defId: 'plague-bearer' }), gauntletOf([dummy(0, 5)]));
    expect(ofType(events, 'poisonApplied').length).toBeGreaterThan(0);
    expect(ofType(events, 'poisonTick').length).toBeGreaterThan(0);
  });

  // Issue #111 rework: Gnawer's faint payout is no longer a flat literal —
  // the rat behind inherits Gnawer's OWN current attack (tier-scaled,
  // relic-buffed) plus a bonus for the wave it died on, capped at
  // `waveBonusCapMultiplier * ownAttack` (2x, per the def in units.ts).
  // `filler(n)` builds n zero-health "auto-clear" waves so a test can pin
  // down the EXACT wave Gnawer dies on: a 0-health enemy is already dead at
  // wave start (resolveDeaths runs before the tick loop), so the wave
  // clears for free with no damage dealt, letting the next wave's killer
  // enemy land on a precisely chosen wave number.
  const filler = (n: number): UnitDef[][] => Array.from({ length: n }, () => [dummy(0, 0)]);

  it('Gnawer bequeaths its own current attack (tier-scaled, relic-buffed), not a flat literal', () => {
    // t1 Gnawer with Rusted Nail (+2 attack): ownAttack = 3 + 2 = 5. Dies on
    // wave 1, so the wave bonus is min(1, cap=2*5=10) = 1. Inherited = 6.
    const { events } = simulate(
      lineup({ defId: 'gnawer', relicIds: ['rusted-nail'] }, { defId: 'gutter-runt' }),
      gauntletOf([dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(6);
    expect(buffs[0].newAttack).toBe(1 + 6);
    expect(buffs[0].health).toBe(0);
  });

  it('Gnawer\'s inherited attack scales with tier via tierAttackMultiplier', () => {
    // t2 Gnawer: ownAttack = 3 * 3 = 9. Dies wave 1: bonus = min(1, 2*9=18) = 1.
    // Inherited = 10.
    const { events } = simulate(
      lineup({ defId: 'gnawer', tier: 2 }, { defId: 'gutter-runt' }),
      gauntletOf([dummy(50, 9)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(10);
  });

  it('the wave-died-on bonus grows the later Gnawer falls', () => {
    // t1 Gnawer, ownAttack = 3, cap = 2*3 = 6 (not yet reached). 4 filler
    // waves auto-clear for free, so Gnawer dies exactly on wave 5:
    // bonus = min(5, 6) = 5, inherited = 3 + 5 = 8 — strictly more than the
    // wave-1 payout (4) a lone early death would grant.
    const { events } = simulate(
      lineup({ defId: 'gnawer' }, { defId: 'gutter-runt' }),
      gauntletOf(...filler(4), [dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(8);
    expect(buffs[0].newAttack).toBe(1 + 8);
  });

  it('the wave bonus is capped at waveBonusCapMultiplier * ownAttack, however late Gnawer falls', () => {
    // t1 Gnawer, ownAttack = 3, cap = 2*3 = 6. 9 filler waves auto-clear for
    // free so Gnawer dies exactly on wave 10 — well past the cap. Uncapped,
    // the bonus would be 10 (inherited 13); capped, it tops out at 6
    // (inherited 9).
    const { events } = simulate(
      lineup({ defId: 'gnawer' }, { defId: 'gutter-runt' }),
      gauntletOf(...filler(9), [dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(9);
    expect(buffs[0].attack).toBeLessThan(3 + 10);
  });

  it('Gnawer in the last slot has nobody behind it — the payout evaporates, no crash', () => {
    // Enemy health kept well above Gnawer's own attack (3) so only Gnawer
    // dies this tick — isolates the "no target" case from an incidental
    // double-kill.
    const { events, result } = simulate(
      lineup({ defId: 'gnawer' }),
      gauntletOf([dummy(50, 100)])
    );
    expect(ofType(events, 'buff').length).toBe(0);
    expect(ofType(events, 'death').length).toBe(1);
    expect(result.survivors.length).toBe(0);
  });

  it('Corpse-Glutton grows +1/+1 whenever an ally faints', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'corpse-glutton' }),
      gauntletOf([dummy(1, 50)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBeGreaterThanOrEqual(1);
    expect(buffs[0].newAttack).toBe(4);
    expect(buffs[0].newHealth).toBe(3);
  });

  it('t1 Bone-Priest revives the first fallen ally at 1 health', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'bone-priest', tier: 1 }),
      gauntletOf([dummy(2, 50)])
    );
    const revives = ofType(events, 'revive');
    expect(revives.length).toBe(1);
    expect(revives[0].unit.defId).toBe('dire-rat');
    expect(revives[0].unit.health).toBe(1);
  });

  it('t2 Bone-Priest revives the first fallen ally at 10 health', () => {
    // Warren-Warden at tier 2 has maxHealth 6*3=18, comfortably above the
    // t2 revive value of 10, so the result isn't accidentally cap-limited.
    const { events } = simulate(
      lineup({ defId: 'warren-warden', tier: 2 }, { defId: 'bone-priest', tier: 2 }),
      gauntletOf([dummy(50, 500)])
    );
    const revives = ofType(events, 'revive');
    expect(revives.length).toBe(1);
    expect(revives[0].unit.defId).toBe('warren-warden');
    expect(revives[0].unit.health).toBe(10);
  });

  it('t3 Bone-Priest revives the first fallen ally at 20 health', () => {
    // Warren-Warden at tier 3 has maxHealth 6*9=54, comfortably above the
    // t3 revive value of 20, so the result isn't accidentally cap-limited.
    const { events } = simulate(
      lineup({ defId: 'warren-warden', tier: 3 }, { defId: 'bone-priest', tier: 3 }),
      gauntletOf([dummy(50, 500)])
    );
    const revives = ofType(events, 'revive');
    expect(revives.length).toBe(1);
    expect(revives[0].unit.defId).toBe('warren-warden');
    expect(revives[0].unit.health).toBe(20);
  });

  it('t3 Bone-Priest revive is capped at the corpse\'s own maxHealth', () => {
    // Gutter-Runt is a 1-health t1 corpse; the 1/10/20 table must not
    // overheal it past its own ceiling just because the reviver is t3.
    // The dummy needs enough health to survive long enough for the tier-3
    // Bone-Priest (attack 9, health 36) to actually die and trigger revive.
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', tier: 1 }, { defId: 'bone-priest', tier: 3 }),
      gauntletOf([dummy(2, 500)])
    );
    const revives = ofType(events, 'revive');
    expect(revives.length).toBe(1);
    expect(revives[0].unit.defId).toBe('gutter-runt');
    expect(revives[0].unit.health).toBe(1);
  });

  it('a lone reviver cannot revive itself (no immortality exploit)', () => {
    // A fainting unit is queued into `fallen` before its own faint fires, so
    // reviving "the first corpse" used to resurrect the reviver itself,
    // forever — a lone Bone-Priest cleared all 45 waves unkillable.
    const { events, result } = simulate(
      lineup({ defId: 'bone-priest' }),
      gauntletOf([dummy(2, 50)])
    );
    expect(ofType(events, 'revive').length).toBe(0);
    expect(result.wavesCleared).toBe(0);
    expect(result.survivors.length).toBe(0);
  });

  it('Warren-Warden buffs every rat behind it at start of battle', () => {
    const { events } = simulate(
      lineup({ defId: 'warren-warden' }, { defId: 'gutter-runt' }, { defId: 'dire-rat' }),
      gauntletOf([dummy(0, 1)])
    );
    const clashIdx = events.findIndex((e) => e.type === 'clash');
    const buffs = ofType(events.slice(0, clashIdx), 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs.every((b) => b.attack === 1 && b.health === 1)).toBe(true);
  });

  it('Rat-Piper summons a Pup in front each wave', () => {
    const { events } = simulate(
      lineup({ defId: 'rat-piper' }),
      gauntletOf([dummy(0, 1)], [dummy(0, 1)])
    );
    const summons = ofType(events, 'summon');
    expect(summons.length).toBe(2);
    expect(summons.every((s) => s.unit.defId === 'pup')).toBe(true);
    expect(summons[0].index).toBe(0);
    expect(summons[1].index).toBe(1);
  });
});

describe('relics', () => {
  it('Rusted Nail adds +2 attack to the bearer', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', relicIds: ['rusted-nail'] }),
      gauntletOf([dummy(0, 1)])
    );
    const start = ofType(events, 'battleStart')[0];
    expect(start.horde[0].attack).toBe(3);
  });

  it('Glass Shard adds +3 to the first hit of each wave', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', relicIds: ['glass-shard'] }),
      gauntletOf([dummy(0, 10)], [dummy(0, 10)])
    );
    const hits = ofType(events, 'damage').filter((d) => d.amount > 0);
    // First hit of wave 1 is boosted (1 + 3), the rest are 1...
    expect(hits[0].amount).toBe(4);
    expect(hits[1].amount).toBe(1);
    // ...and it fires anew on the first hit of wave 2.
    expect(hits.filter((h) => h.amount === 4)).toHaveLength(2);
  });

  it('Weeping Boil damages all enemies when the bearer faints', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', relicIds: ['weeping-boil'] }),
      gauntletOf([dummy(1, 1), dummy(0, 2), dummy(0, 3)])
    );
    expect(ofType(events, 'relicProc').some((p) => p.relicId === 'weeping-boil')).toBe(true);
    expect(ofType(events, 'death').length).toBe(3);
  });

  it('Fat Tick grants +1/+2 and heals 1 at the start of each tick', () => {
    const { events, result } = simulate(
      lineup({ defId: 'corpse-glutton', relicIds: ['fat-tick'] }),
      gauntletOf([dummy(1, 12)])
    );
    expect(ofType(events, 'heal').length).toBeGreaterThan(0);
    expect(result.wavesCleared).toBe(1);
  });

  it('Tail-Charm saves the bearer from one lethal hit', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', relicIds: ['tail-charm'] }),
      gauntletOf([dummy(5, 100)])
    );
    const procs = ofType(events, 'relicProc').filter((p) => p.relicId === 'tail-charm');
    expect(procs.length).toBe(1);
    expect(ofType(events, 'clash').length).toBe(2);
    expect(ofType(events, 'death').length).toBe(1);
  });

  it('Gore-Cleaver carries overkill damage to the next enemy in line, once', () => {
    // Dire-Rat deals 4; front foe has 1 health, so 3 damage overkills onto
    // the next enemy (10 health), leaving it at 7 (10 - 3).
    const { events } = simulate(
      lineup({ defId: 'dire-rat', relicIds: ['gore-cleaver'] }),
      gauntletOf([dummy(0, 1), dummy(0, 10)])
    );
    const procs = ofType(events, 'relicProc').filter((p) => p.relicId === 'gore-cleaver');
    expect(procs.length).toBe(1);
    const damages = ofType(events, 'damage');
    // First hit fells the front foe (1 dmg absorbed, 3 overkill); the
    // carried damage event is the 3 onto the second enemy.
    const carried = damages.find((d) => d.amount === 3);
    expect(carried).toBeDefined();
    expect(carried?.remainingHealth).toBe(7);
  });

  it('Gore-Cleaver does not carry when there is no overkill', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat', relicIds: ['gore-cleaver'] }),
      gauntletOf([dummy(0, 100), dummy(0, 10)])
    );
    expect(ofType(events, 'relicProc').some((p) => p.relicId === 'gore-cleaver')).toBe(false);
  });

  it('Gore-Cleaver does not chain past the second enemy in a single clash', () => {
    // Massive overkill against a weak front foe with two more enemies behind
    // it: the carried hit lands once on enemies[1] and never chains onward
    // to enemies[2], even though it would also be lethal there.
    const { events } = simulate(
      lineup({ defId: 'dire-rat', relicIds: ['gore-cleaver'] }),
      gauntletOf([dummy(0, 1), dummy(0, 1), dummy(0, 1)])
    );
    expect(ofType(events, 'relicProc').filter((p) => p.relicId === 'gore-cleaver').length).toBe(1);
  });

  it('Marrow-Snap executes a foe left at or below the threshold instead of a sliver', () => {
    // Dire-Rat deals 4; foe has 5 max health, so the hit drives it from 5
    // (above the 50%-of-max line, 2.5) down to 1 (below it) — a clean
    // threshold crossing, so Marrow-Snap finishes it off.
    const { events } = simulate(
      lineup({ defId: 'dire-rat', relicIds: ['marrow-snap'] }),
      gauntletOf([dummy(0, 5)])
    );
    const procs = ofType(events, 'relicProc').filter((p) => p.relicId === 'marrow-snap');
    expect(procs.length).toBe(1);
    const foeId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
    // The regular 4-damage hit leaves the foe at 1 (dire-rat's own damageIn
    // from the foe's 0 attack is a separate event on a different target,
    // floored to 1 by the armor-floor rule — unrelated to this check); the
    // execute's 1-damage finishing blow then brings the foe to 0.
    const foeDamages = ofType(events, 'damage').filter((d) => d.targetId === foeId);
    expect(foeDamages.map((d) => d.amount)).toEqual([4, 1]);
    expect(foeDamages[foeDamages.length - 1].remainingHealth).toBe(0);
    expect(ofType(events, 'death').length).toBe(1);
  });

  it('Marrow-Snap does not proc above the threshold', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat', relicIds: ['marrow-snap'] }),
      gauntletOf([dummy(0, 100)])
    );
    expect(ofType(events, 'relicProc').some((p) => p.relicId === 'marrow-snap')).toBe(false);
  });

  it('Marrow-Snap does not proc when the hit already kills outright', () => {
    // A hit that already fells the foe is a normal kill, not an execute.
    const { events } = simulate(
      lineup({ defId: 'dire-rat', relicIds: ['marrow-snap'] }),
      gauntletOf([dummy(0, 3)])
    );
    expect(ofType(events, 'relicProc').some((p) => p.relicId === 'marrow-snap')).toBe(false);
    expect(ofType(events, 'death').length).toBe(1);
  });

  it('Marrow-Snap requires the crossing blow: poison-softened foes cannot be tap-executed', () => {
    // Crossing semantics (season-launch change): the executing hit itself
    // must drive the foe from above the 50% line to at/below it. Here a
    // 1-attack Gutter-Runt taps a 20-max-health foe while Plague-Bearer's
    // poison chips 1/tick behind the clash. Tick order is clash -> poison,
    // so the tick-by-tick health walk is 20|19|18, 18|17|16, ... and it is
    // the POISON tick that carries the foe across the 10.0 line (11 -> 10),
    // never the clash — so Marrow-Snap must never proc, and the foe dies
    // the slow way. This is the Blight-Witch-AoE-sets-up-free-executes
    // exploit shape, minimized.
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', relicIds: ['marrow-snap'] }, { defId: 'plague-bearer' }),
      gauntletOf([dummy(0, 20)])
    );
    expect(ofType(events, 'relicProc').some((p) => p.relicId === 'marrow-snap')).toBe(false);
    expect(ofType(events, 'death').length).toBe(1);
  });

  it('Marrow-Snap still fires when the clash itself does the crossing (no poison interference)', () => {
    // Same tap-fighter, no poison: the runt chips 20 -> 19 -> ... -> 11,
    // and the clash that takes 11 -> 10 crosses the 50% line itself, so the
    // execute fires and spares the last 10 ticks of chipping.
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', relicIds: ['marrow-snap'] }),
      gauntletOf([dummy(0, 20)])
    );
    expect(ofType(events, 'relicProc').filter((p) => p.relicId === 'marrow-snap').length).toBe(1);
  });

  it('Marrow-Snap zeroes overkill so it does not also feed a stacked Gore-Cleaver', () => {
    // Both relics on one rat: Marrow-Snap fires first (foe at 20% survives
    // to a sliver, then gets finished at exactly 0 overkill), so Gore-Cleaver
    // never sees positive overkill to carry — no double-dipping two relics
    // off one clash.
    const { events } = simulate(
      lineup({ defId: 'dire-rat', relicIds: ['marrow-snap', 'gore-cleaver'] }),
      gauntletOf([dummy(0, 5), dummy(0, 10)])
    );
    expect(ofType(events, 'relicProc').some((p) => p.relicId === 'marrow-snap')).toBe(true);
    expect(ofType(events, 'relicProc').some((p) => p.relicId === 'gore-cleaver')).toBe(false);
  });

  it('Filth Totem grants the whole horde +1 health, including summons', () => {
    const { events } = simulate(
      { units: [{ defId: 'rat-piper' }], teamRelicIds: ['filth-totem'] },
      gauntletOf([dummy(0, 1)])
    );
    const start = ofType(events, 'battleStart')[0];
    expect(start.horde[0].health).toBe(3);
    const summons = ofType(events, 'summon');
    expect(summons[0].unit.health).toBe(2);
  });

  it('The Forgotten Backpack grants the whole horde +2/+2, including summons', () => {
    const { events } = simulate(
      { units: [{ defId: 'rat-piper' }], teamRelicIds: ['forgotten-backpack'] },
      gauntletOf([dummy(0, 1)])
    );
    const start = ofType(events, 'battleStart')[0];
    expect(start.horde[0].attack).toBe(3);
    expect(start.horde[0].health).toBe(4);
    const summons = ofType(events, 'summon');
    expect(summons[0].unit.attack).toBe(3);
    expect(summons[0].unit.health).toBe(3);
  });

});

describe('time-of-day abilities (issue #12: Dawn-Runt/Dusk-Runt)', () => {
  it('Dawn-Runt grants +2 attack to the whole horde before noon', () => {
    const { events } = simulate(
      { units: [{ defId: 'dawn-runt' }, { defId: 'gutter-runt' }], timeOfDay: 'beforeNoon' },
      gauntletOf([dummy(0, 100)])
    );
    const buffs = ofType(events, 'buff');
    // Whole team, including the caster itself — unlike buffBehind.
    expect(buffs.length).toBe(2);
    expect(buffs.every((b) => b.attack === 2 && b.health === 0)).toBe(true);
  });

  it('Dawn-Runt does not fire after noon', () => {
    const { events } = simulate(
      { units: [{ defId: 'dawn-runt' }, { defId: 'gutter-runt' }], timeOfDay: 'afterNoon' },
      gauntletOf([dummy(0, 100)])
    );
    expect(ofType(events, 'buff')).toHaveLength(0);
  });

  it('Dusk-Runt grants +2 health to the whole horde after noon', () => {
    const { events } = simulate(
      { units: [{ defId: 'dusk-runt' }, { defId: 'gutter-runt' }], timeOfDay: 'afterNoon' },
      gauntletOf([dummy(0, 100)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs.every((b) => b.attack === 0 && b.health === 2)).toBe(true);
  });

  it('Dusk-Runt does not fire before noon', () => {
    const { events } = simulate(
      { units: [{ defId: 'dusk-runt' }, { defId: 'gutter-runt' }], timeOfDay: 'beforeNoon' },
      gauntletOf([dummy(0, 100)])
    );
    expect(ofType(events, 'buff')).toHaveLength(0);
  });

  it('a lineup with no timeOfDay set fires neither Dawn-Runt nor Dusk-Runt (pre-#12 lineups are unaffected)', () => {
    const { events } = simulate(
      { units: [{ defId: 'dawn-runt' }, { defId: 'dusk-runt' }] },
      gauntletOf([dummy(0, 100)])
    );
    expect(ofType(events, 'buff')).toHaveLength(0);
  });

  it('fires once per battle, not once per wave (compounding-law check)', () => {
    const { events } = simulate(
      { units: [{ defId: 'dawn-runt' }, { defId: 'gutter-runt' }], timeOfDay: 'beforeNoon' },
      gauntletOf([dummy(0, 1)], [dummy(0, 1)], [dummy(0, 1)])
    );
    expect(ofType(events, 'buff')).toHaveLength(2); // once per horde unit, not once per wave
  });
});

describe('wave carry-over', () => {
  it('survivors keep their damage between waves', () => {
    const { result } = simulate(
      lineup({ defId: 'dire-rat' }),
      gauntletOf([dummy(1, 1)], [dummy(1, 1)])
    );
    expect(result.wavesCleared).toBe(2);
    expect(result.survivors[0].health).toBe(3);
  });
});

describe('revive cannot loop', () => {
  const grinder = () => gauntletOf(...Array.from({ length: 45 }, () => [dummy(2, 6)]));

  it('two Bone-Priests cannot raise each other forever', () => {
    // 12 scrap of tier-1 priests used to full-clear all 45 waves with ~12k
    // revives: each raised the other's corpse, which died and was raised again.
    const { events, result } = simulate(
      lineup({ defId: 'bone-priest' }, { defId: 'bone-priest' }),
      grinder()
    );
    expect(result.wavesCleared).toBeLessThan(3);
    expect(ofType(events, 'revive').length).toBeLessThanOrEqual(2);
  });

  it('a corpse is raised at most once per battle', () => {
    const { events } = simulate(
      lineup({ defId: 'bone-priest' }, { defId: 'bone-priest' }, { defId: 'bone-priest' }),
      grinder()
    );
    const raised = ofType(events, 'revive').map((e) => e.unit.instanceId);
    expect(new Set(raised).size).toBe(raised.length);
  });

  it('a lone Bone-Priest still never raises itself', () => {
    const { events } = simulate(lineup({ defId: 'bone-priest' }), grinder());
    expect(ofType(events, 'revive')).toHaveLength(0);
  });

  it('one priest still raises a fallen ally — the ability is not dead', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'bone-priest' }),
      grinder()
    );
    expect(ofType(events, 'revive')).toHaveLength(1);
  });
});

describe('startOfBattle fires once per unit, startOfWave every wave', () => {
  const grinder = (n: number) => gauntletOf(...Array.from({ length: n }, () => [dummy(0, 1)]));

  it('Warren-Warden buffs the horde once, not once per wave', () => {
    // The compounding bug: 4 tier-3 Wardens re-buffing every wave carried a
    // 6-attack rat to 241 and full-cleared the 45-wave gauntlet.
    const { events } = simulate(
      lineup({ defId: 'warren-warden' }, { defId: 'gutter-runt' }),
      grinder(10)
    );
    expect(ofType(events, 'buff')).toHaveLength(1);
  });

  it('Rat-Piper still pipes in a pup every wave', () => {
    const { events } = simulate(lineup({ defId: 'rat-piper' }), grinder(5));
    expect(ofType(events, 'summon').length).toBeGreaterThan(1);
  });

  it('Plague-Bearer still re-poisons each wave (poison clears at waveClear)', () => {
    const { events } = simulate(lineup({ defId: 'plague-bearer' }), grinder(4));
    expect(ofType(events, 'poisonApplied').length).toBeGreaterThan(1);
  });

  it("enemies re-instantiate each wave, so their startOfBattle still fires every wave", () => {
    const summoner: UnitDef = {
      id: 'summoner', name: 'Summoner', attack: 0, health: 1, cost: 0,
      ability: { trigger: 'startOfBattle', effect: { kind: 'summon', unitId: 'pup', count: 1 } },
    };
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }),
      gauntletOf([summoner], [summoner], [summoner])
    );
    expect(ofType(events, 'summon').filter((e) => e.side === 'gauntlet')).toHaveLength(3);
  });
});

describe('damage reduction (armor)', () => {
  const armored = (damageReduction: number): UnitDef => ({
    id: 'armored', name: 'Armored', attack: 1, health: 100, cost: 0, damageReduction,
  });
  // `poisonFrontEnemy`'s magnitude now comes from `poisonStacksForTier`
  // (issue #62), not the effect's own `stacks` field, so this test-only
  // unit's `stacks` value is a placeholder — enemies are always tier 1
  // (see `instantiate(d, 'gauntlet', ...)` in sim.ts), so the actual
  // applied amount is `poisonStacksForTier(1)` = 1 regardless of what's
  // passed here.
  const poisoner: UnitDef = {
    id: 'poisoner', name: 'Poisoner', attack: 0, health: 100, cost: 0,
    ability: { trigger: 'startOfBattle', effect: { kind: 'poisonFrontEnemy', stacks: 1 } },
  };

  it('subtracts armor from each incoming attack', () => {
    // Dire-Rat blunts 2 of every blow: a 3-attack foe lands 1.
    const { events } = simulate(lineup({ defId: 'dire-rat' }), gauntletOf([dummy(3, 100)]));
    const onRat = ofType(events, 'damage').filter((e) => e.targetId === 1);
    expect(onRat.length).toBeGreaterThan(0);
    expect(onRat.every((e) => e.amount === 1)).toBe(true);
  });

  it('a hit always lands for at least 1, however thick the hide', () => {
    // Armor 10 vs Gnawer's 3 attack would be -7; the floor keeps armor from
    // ever producing an unkillable unit. (The armored one is the foe here, so
    // we read the damage dealt *to* instanceId 2.)
    const { events } = simulate(lineup({ defId: 'gnawer' }), gauntletOf([armored(10)]));
    const onFoe = ofType(events, 'damage').filter((e) => e.targetId === 2);
    expect(onFoe.length).toBeGreaterThan(0);
    expect(onFoe.every((e) => e.amount === 1)).toBe(true);
  });

  it('scales with tier, like every other magnitude', () => {
    // Tier-2 Dire-Rat: armor 4. A 5-attack foe lands 1.
    const { events } = simulate(
      lineup({ defId: 'dire-rat', tier: 2 }),
      gauntletOf([dummy(5, 100)])
    );
    const onRat = ofType(events, 'damage').filter((e) => e.targetId === 1);
    expect(onRat.every((e) => e.amount === 1)).toBe(true);
  });

  it('poison bypasses armor — the hide does not stop rot', () => {
    const { events } = simulate(lineup({ defId: 'dire-rat' }), gauntletOf([poisoner]));
    const ticks = ofType(events, 'poisonTick').filter((e) => e.targetId === 1);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((e) => e.amount === 1)).toBe(true);
  });
});

describe('combat cap headroom for summons', () => {
  const fullBoard = (): Lineup['units'] => [
    { defId: 'rat-piper' },
    ...Array.from({ length: 7 }, () => ({ defId: 'gutter-runt' })),
  ];

  it('a full warren starves a summoner when combat has no headroom', () => {
    const { events } = simulate({ units: fullBoard() }, gauntletOf([dummy(0, 100)]));
    expect(ofType(events, 'summon')).toHaveLength(0);
  });

  it('combatCap gives the pups somewhere to land', () => {
    const { events } = simulate({ units: fullBoard(), combatCap: 10 }, gauntletOf([dummy(0, 100)]));
    expect(ofType(events, 'summon')).toHaveLength(1);
  });
});

describe('golden log regression', () => {
  it('the full showcase battle produces the pinned event-log hash', () => {
    const { events } = simulate(TEST_HORDE, generateGauntlet('2026-01-01'));
    expect(fnv1a(JSON.stringify(events))).toMatchInlineSnapshot(`981937699`);
  });
});
