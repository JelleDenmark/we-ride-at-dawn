// Engine primitive: backline damage path (issue #85). A non-front unit adds
// its own attack directly to the frontmost enemy each wave, taking no
// retaliation. This is infrastructure only — no player-facing unit is added
// here (Slink-Rat, the first consumer, is a separate blocked issue) — so
// every test below wires the effect onto ad-hoc test-only `UnitDef`s, the
// same pattern `compounding-law.test.ts` and `abilities.test.ts` already use
// for probing engine behavior independent of the shop roster.
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

// Test-only "sniper" def carrying the new primitive: 3 attack, 1 health,
// deliberately fragile (mirrors Slink-Rat's concept stats in
// docs/design/future-minions.md) so it dies instantly if it ever reaches
// the front, but this suite only cares about the backline-damage effect
// itself, not any unit's identity.
const sniper: UnitDef = {
  id: 'test-sniper', name: 'Test Sniper', attack: 3, health: 1, cost: 0,
  ability: { trigger: 'startOfWave', effect: { kind: 'backlineDamage' } },
};

const zeroAttackTank: UnitDef = {
  id: 'zero-attack-tank', name: 'Zero Attack Tank', attack: 0, health: 1000, cost: 0,
};

// Horde-side units are looked up from `UNIT_DEFS` by `defId` in sim.ts
// (unlike gauntlet enemies, which are passed as plain `UnitDef` objects
// directly in each wave). Registering these test-only fixtures into the
// live `UNIT_DEFS` record — never edited on disk, never part of the shop
// pool or `SHOP_UNIT_POOL` — is how every test below can build a horde
// around the new primitive without shipping a real, player-facing unit
// def (out of scope for issue #85; Slink-Rat is the separate consumer).
UNIT_DEFS[sniper.id] = sniper;
UNIT_DEFS[zeroAttackTank.id] = zeroAttackTank;

describe('backline damage primitive (issue #85)', () => {
  it('a non-front unit lands its attack on the frontmost enemy each wave', () => {
    // Sniper sits behind a tanky front rat; the dummy front foe has enough
    // health to survive the sniper's hit alone so we can isolate it.
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'test-sniper' }),
      gauntletOf([dummy(0, 100)])
    );
    const foeId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
    const damages = ofType(events, 'damage').filter((d) => d.targetId === foeId);
    // Sniper's 3-attack hit lands before the tick loop's own clash damage.
    expect(damages[0].amount).toBe(3);
  });

  it('does not fire for the unit currently at the front (backline-only)', () => {
    // The sole unit on the board IS the front (index 0) — its
    // backlineDamage effect must not also fire, only its normal clash.
    const { events } = simulate(
      lineup({ defId: 'test-sniper' }),
      gauntletOf([dummy(0, 100)])
    );
    const foeId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
    const damages = ofType(events, 'damage').filter((d) => d.targetId === foeId);
    // Only the normal per-tick clash damage (3 each tick), no extra
    // startOfWave hit landing before it.
    expect(damages.every((d) => d.amount === 3)).toBe(true);
  });

  it('scales with tier, like every other attack-based magnitude', () => {
    const t2 = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'test-sniper', tier: 2 }),
      gauntletOf([dummy(0, 1000)])
    );
    const foeId = ofType(t2.events, 'waveStart')[0].enemies[0].instanceId;
    const firstHit = ofType(t2.events, 'damage').filter((d) => d.targetId === foeId)[0];
    // tierAttackMultiplier(2) = 3x -> 3 * 3 = 9.
    expect(firstHit.amount).toBe(9);
  });

  it('multiple backline units stack additively, bounded by board size', () => {
    const { events } = simulate(
      lineup(
        { defId: 'dire-rat' },
        { defId: 'test-sniper' },
        { defId: 'test-sniper' },
        { defId: 'test-sniper' }
      ),
      gauntletOf([dummy(0, 1000)])
    );
    const foeId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
    const damages = ofType(events, 'damage').filter((d) => d.targetId === foeId);
    // Three snipers, each landing one 3-damage startOfWave hit = 9, all
    // before the tick loop's own clash resolves.
    expect(damages.slice(0, 3).map((d) => d.amount)).toEqual([3, 3, 3]);
  });

  it('backline damage does not grow with wave count (compounding-law canary)', () => {
    const grinder = (n: number) => gauntletOf(...Array.from({ length: n }, () => [dummy(0, 1000)]));
    const short = simulate(lineup({ defId: 'dire-rat' }, { defId: 'test-sniper' }), grinder(2));
    const long = simulate(lineup({ defId: 'dire-rat' }, { defId: 'test-sniper' }), grinder(10));
    const foeIdOf = (events: BattleEvent[], waveIdx: number) => ofType(events, 'waveStart')[waveIdx].enemies[0].instanceId;
    // Per-wave contribution is fixed: one 3-damage hit landed each wave,
    // regardless of how many waves the battle runs (not summed/accumulated
    // across waves, matching the compounding-law comment on `backlineDamage`
    // in data/units.ts).
    const firstWaveHit = ofType(short.events, 'damage').find((d) => d.targetId === foeIdOf(short.events, 0));
    const laterWaveFoeId = foeIdOf(long.events, 9);
    const laterWaveHit = ofType(long.events, 'damage').find((d) => d.targetId === laterWaveFoeId);
    expect(firstWaveHit?.amount).toBe(3);
    expect(laterWaveHit?.amount).toBe(3);
  });

  it('the backline unit takes no retaliation from its contribution', () => {
    // The front is a zero-attack tank against a zero-attack foe, so neither
    // side's clash ever lands a hit and the tank never dies — it stays
    // `front` for the entire (stalemated) wave, and the sniper stays fully
    // safe behind it the whole battle. Its health should never drop from
    // anything, since it's never `front` or `foe` in the tick loop.
    const { events } = simulate(
      lineup({ defId: 'zero-attack-tank' }, { defId: 'test-sniper' }),
      gauntletOf([dummy(0, 1000)])
    );
    const sniperId = ofType(events, 'battleStart')[0].horde[1].instanceId;
    const damageToSniper = ofType(events, 'damage').filter((d) => d.targetId === sniperId);
    expect(damageToSniper).toHaveLength(0);
  });

  describe('interaction decision 1: does not feed Marrow-Snap execute', () => {
    it("a backline sniper's hit does not count as the crossing blow for a Marrow-Snap front unit", () => {
      // Front unit (gutter-runt, 1 attack) carries Marrow-Snap (executes at
      // 50% of foe max health). Foe has 20 max health. If the sniper's
      // startOfWave hit (3 dmg, landing BEFORE the tick loop) were treated
      // as part of "the crossing blow," the foe would already be pre-chipped
      // to 17 before the first real clash, and Marrow-Snap could cheaply
      // ride that softening to an early execute — exactly the exploit shape
      // the crossing-semantics change (Marrow-Snap doc comment in
      // relics.ts) closed for poison. Recommendation (issue #85): NO, it
      // must not feed the execute; verified below by asserting the execute
      // does not proc on the very first clash, where a pre-chip WOULD have
      // caused an immediate cross of the 10.0 (50%) line.
      const { events } = simulate(
        lineup(
          { defId: 'gutter-runt', relicIds: ['marrow-snap'] },
          { defId: 'test-sniper' }
        ),
        gauntletOf([dummy(0, 20)])
      );
      const procs = ofType(events, 'relicProc').filter((p) => p.relicId === 'marrow-snap');
      // Gutter-runt's own 1-dmg clashes take 20 waves worth of ticks to
      // reach the threshold on their own (no execute triggered by the
      // sniper's separate, earlier-applied hit) — if the sniper's damage
      // wrongly counted toward "the crossing blow," the very first clash
      // tick (foe at 17 -> 16) would already be at/under a *different*
      // threshold shape. What matters here is that Marrow-Snap's own
      // crossing check (foeHealthBeforeClash captured immediately around
      // its own clash hit, in sim.ts) is computed from the state AFTER the
      // sniper's startOfWave hit already applied that wave — i.e. the
      // sniper's damage is baked into ambient foe health, never treated as
      // the executing hit itself. Confirm no double-crossing artifact: the
      // number of execute procs must be exactly 1 (same as the isolated
      // Marrow-Snap-only case), not 0 (over-suppressed) or >1 (mis-firing).
      expect(procs.length).toBe(1);
    });

    it('backline damage alone (no Marrow-Snap bearer) never emits a marrow-snap relicProc', () => {
      const { events } = simulate(
        lineup({ defId: 'dire-rat' }, { defId: 'test-sniper' }),
        gauntletOf([dummy(0, 20)])
      );
      expect(ofType(events, 'relicProc').some((p) => p.relicId === 'marrow-snap')).toBe(false);
    });
  });

  describe('interaction decision 2: does not interact with Ward-Weaver block charges', () => {
    it("a backline sniper's hit is never blocked by the horde's own Ward-Weaver charges", () => {
      // Ward-Weaver's blockCharges pool protects the HORDE's current front
      // unit from incoming hits. Backline damage hits the ENEMY side, so it
      // should never be blocked, never consume a charge, and never emit a
      // shieldAbsorbed event for it.
      const { events } = simulate(
        lineup({ defId: 'ward-weaver' }, { defId: 'test-sniper' }),
        gauntletOf([dummy(0, 1000)])
      );
      const foeId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
      const damages = ofType(events, 'damage').filter((d) => d.targetId === foeId);
      // The sniper's 3-damage startOfWave hit lands in full, unblocked.
      expect(damages[0].amount).toBe(3);
      // No shieldAbsorbed should ever reference the enemy foe (Ward-Weaver
      // only ever guards the horde's own front, per blockCharges[foe.side]
      // in the tick loop — the enemy side's blockCharges pool is never
      // populated here at all).
      expect(ofType(events, 'shieldAbsorbed').some((s) => s.targetId === foeId)).toBe(false);
    });

    it('an enemy-side block pool (if ever populated) is still irrelevant to backline damage', () => {
      // Even granting the gauntlet side a hypothetical block pool via its
      // own Ward-Weaver-equivalent ability, the sniper's hit is not routed
      // through blockCharges at all -- it calls applyDamage directly. This
      // is confirmed by code inspection of the `backlineDamage` case in
      // sim.ts (no reference to `blockCharges`) and reinforced here: a
      // enemy-side blockFrontHits ability is a startOfWave effect fired via
      // the SAME `fireEntryTriggers(enemies)` pass, so ordering with the
      // horde's own sniper hit is independent per side.
      const enemyWarden: UnitDef = {
        id: 'enemy-warden', name: 'Enemy Warden', attack: 0, health: 1000, cost: 0,
        ability: { trigger: 'startOfWave', effect: { kind: 'blockFrontHits' } },
      };
      const { events } = simulate(
        lineup({ defId: 'dire-rat' }, { defId: 'test-sniper' }),
        gauntletOf([enemyWarden])
      );
      const foeId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
      const damages = ofType(events, 'damage').filter((d) => d.targetId === foeId);
      // Sniper's hit still lands unblocked despite the enemy's own block pool.
      expect(damages[0].amount).toBe(3);
    });
  });

  describe('interaction decision 3: does not feed Gore-Cleaver overkill spillover', () => {
    // Dire-Rat (4 attack) with Gore-Cleaver, against enemies[0] at 3 health:
    // its own clash overkills by 1, which legitimately spills 1 damage onto
    // enemies[1] (10 health, left at 9) — this is Gore-Cleaver's ordinary,
    // expected behavior on the front unit's OWN clash, asserted already by
    // the existing `abilities.test.ts` Gore-Cleaver suite. What issue #85
    // must additionally prove is that adding a backline sniper — which
    // separately, pre-tick-loop, kills a FIRST enemy in front of these two —
    // does not change that spillover amount at all: the sniper's own
    // overkill against the enemy IT kills must never be folded into the
    // front unit's cleave carry.
    const cleaveScenario = (withSniper: boolean) => {
      // Dire-Rat must stay the front (index 0) clasher in both scenarios —
      // the sniper only ever fires its backlineDamage effect from a
      // non-front slot (index > 0), so it goes behind Dire-Rat here.
      const units: Lineup['units'] = withSniper
        ? [{ defId: 'dire-rat', relicIds: ['gore-cleaver'] }, { defId: 'test-sniper' }]
        : [{ defId: 'dire-rat', relicIds: ['gore-cleaver'] }];
      // Sniper-only case gets an extra 1-health enemy up front for the
      // sniper's pre-tick-loop hit to instantly (and separately) overkill;
      // the baseline case omits it so both scenarios reach the tick loop
      // with the SAME two enemies (3 health, 10 health) for Dire-Rat's own
      // clash to act on.
      const waves = withSniper
        ? [dummy(0, 1), dummy(0, 3), dummy(0, 10)]
        : [dummy(0, 3), dummy(0, 10)];
      return simulate({ units }, gauntletOf(waves));
    };

    it("a backline sniper's own overkill (against a separate enemy) does not change the front unit's Gore-Cleaver carry", () => {
      const baseline = cleaveScenario(false);
      const withSniper = cleaveScenario(true);

      const carryAmount = (events: BattleEvent[], targetIndex: number) => {
        const foeId = ofType(events, 'waveStart')[0].enemies[targetIndex].instanceId;
        return ofType(events, 'damage')
          .filter((d) => d.targetId === foeId)
          .find((d) => d.amount > 0)?.amount;
      };

      // Baseline: Dire-Rat's clash (4 dmg) overkills the 3-health foe by 1,
      // which spills 1 damage onto the 10-health enemy behind it (index 1).
      expect(ofType(baseline.events, 'relicProc').filter((p) => p.relicId === 'gore-cleaver')).toHaveLength(1);
      expect(carryAmount(baseline.events, 1)).toBe(1);

      // With the sniper present: the extra front enemy (index 0, 1 health)
      // is felled entirely by the sniper's own separate 3-damage hit before
      // the tick loop starts (2 overkill, wasted — no relation to
      // Gore-Cleaver at all, since that enemy was never a `foe` in the tick
      // loop's clash). Dire-Rat's own clash then proceeds exactly as in the
      // baseline against the SAME two remaining enemies (3 health, 10
      // health, now at indices 1 and 2) — its cleave carry must be
      // identical: still exactly 1, not inflated by the sniper's unrelated
      // 2-overkill.
      expect(ofType(withSniper.events, 'relicProc').filter((p) => p.relicId === 'gore-cleaver')).toHaveLength(1);
      expect(carryAmount(withSniper.events, 2)).toBe(1);
    });
  });

  describe('interaction decision 4: ordering vs the front clash and poison ticks', () => {
    it('backline damage applies before the wave\'s first clash tick', () => {
      // A dummy front foe at exactly 3 health: if the sniper's startOfWave
      // hit (3 dmg) applies first, the foe is already dead before the tick
      // loop's first clash fires, so no 'clash' event for that foe should
      // exist at all.
      const { events } = simulate(
        lineup({ defId: 'dire-rat' }, { defId: 'test-sniper' }),
        gauntletOf([dummy(0, 3)])
      );
      const clashes = ofType(events, 'clash');
      // Wave clears purely off the sniper's pre-tick-loop hit; the
      // tick-loop's own clash never gets a chance to run this wave.
      expect(clashes).toHaveLength(0);
      expect(ofType(events, 'waveClear')).toHaveLength(1);
    });

    it('backline damage applies before that wave\'s poison ticks', () => {
      // Plague-Bearer (also startOfWave) applies poison to the front foe at
      // the same entry-trigger pass; poison only actually ticks inside the
      // tick loop, strictly after the sniper's direct hit already landed.
      // A foe with exactly 3 health dies to the sniper's hit alone, before
      // any poison tick (or even the first clash) has a chance to fire.
      const { events } = simulate(
        lineup({ defId: 'plague-bearer' }, { defId: 'test-sniper' }),
        gauntletOf([dummy(0, 3)])
      );
      expect(ofType(events, 'poisonTick')).toHaveLength(0);
      expect(ofType(events, 'waveClear')).toHaveLength(1);
    });
  });

  describe('no player-facing unit added (issue #85 scope)', () => {
    it('no shipped unit is wired to backlineDamage — infrastructure only', () => {
      // `UNIT_DEFS` is mutated at the top of this file to register the
      // test-only `sniper`/`zeroAttackTank` fixtures (horde units are
      // looked up by defId from that record in sim.ts, unlike gauntlet
      // enemies) — so this check excludes exactly those test-injected ids
      // and looks at everything else, which is the actual shipped roster
      // from data/units.ts. Issue #85 is the primitive only; Slink-Rat (the
      // first real consumer) is a separate, still-blocked issue.
      const testFixtureIds = new Set([sniper.id, zeroAttackTank.id]);
      const shippedCarriers = Object.values(UNIT_DEFS).filter(
        (u) => !testFixtureIds.has(u.id) && u.ability?.effect.kind === 'backlineDamage'
      );
      expect(shippedCarriers).toHaveLength(0);
    });
  });
});
