// Coverage for the five HELD boons added from the 2026-08-12 roster-
// dimensionality pass (docs/design/boons.md's Ideas section, issue #184):
// Rust, Barren, Antidote, Stripped, First Blood. All five resolve via
// `boonEffect` exactly like a shipping boon (HELD boons are finished, tested
// implementations that are merely not on the day's offer — see that
// function's doc comment) but are never drawn by `boonsFor`, so there is no
// `boonsFor`/`isBoonOffered` coverage needed here, unlike boons.test.ts.
import { describe, expect, it } from 'vitest';
import { boardsForDuel, boonEffect } from '../src/boons';
import { simulateDuel } from '../src/duel';
import { validateBoard } from '../src/pvp';
import { simulate, type BattleEvent } from '../src/sim';
import { generateGauntlet } from '../src/gauntlet';
import type { Lineup } from '../src/data/units';

const lineup = (...defIds: string[]): Lineup => ({ units: defIds.map((defId) => ({ defId })) });
const e = (id: string | null) => boonEffect(id);
const summonsOnSide = (events: BattleEvent[], side: 'horde' | 'gauntlet') =>
  events.filter((ev): ev is Extract<BattleEvent, { type: 'summon' }> => ev.type === 'summon' && ev.side === side)
    .length;

describe('rust', () => {
  it('flags the opponent board only, whole line', () => {
    const out = boardsForDuel(lineup('dire-rat'), e('rust'), lineup('dire-rat', 'dire-rat'), null);
    expect(out.b.boonArmorLoss).toBeGreaterThan(0);
    expect(out.a.boonArmorLoss).toBeUndefined();
  });

  it('weakens the whole opposing line, not just one rat', () => {
    const a = () => lineup('dire-rat');
    // Tier 3 so the armor (damageReduction scales per-tier) comfortably
    // outlasts a single tier-1 attacker either way — the point is the
    // SURVIVOR's remaining health, not who wins.
    const b = (): Lineup => ({ units: [{ defId: 'dire-rat', tier: 3 }] });
    const plain = simulateDuel(a(), b()).result;
    const rusted = simulateDuel(a(), b(), 'rust', null).result;
    // A's tier-1 dire-rat dies to B's tier-3 counter either way (in one
    // clash), so this is a clean single-tick comparison: B takes more
    // through its reduced armor, so it ends up worse off.
    expect(rusted.healthB).toBeLessThan(plain.healthB);
  });

  it('describes the change as a whole-line note, with no single rat to point at', () => {
    const notes = boardsForDuel(lineup('dire-rat'), e('rust'), lineup('dire-rat', 'dire-rat'), null, 'rust').notes;
    expect(notes).toEqual([{ by: 'a', boonId: 'rust', target: 'b', kind: 'lineArmor', amount: expect.any(Number) }]);
  });

  it('is refused on a submitted board', () => {
    expect(validateBoard({ units: [{ defId: 'dire-rat' }], boonArmorLoss: 99 }).ok).toBe(false);
  });
});

describe('barren', () => {
  it('cuts the opponent summon headroom without ever raising it', () => {
    const generous: Lineup = { units: [{ defId: 'rat-piper' }], combatCap: 20 };
    const out = boardsForDuel(lineup('dire-rat'), e('barren'), generous, null);
    expect(out.b.combatCap).toBeLessThan(20);
    expect(out.b.combatCap).toBeGreaterThanOrEqual(out.b.units.length);
  });

  it('leaves an already-tighter cap alone', () => {
    const tight: Lineup = { units: [{ defId: 'rat-piper' }], combatCap: 1 };
    const out = boardsForDuel(lineup('dire-rat'), e('barren'), tight, null);
    expect(out.b.combatCap).toBe(1);
  });

  it('starves a cascading summoner of headroom it would otherwise have', () => {
    const summoner = () => lineup('brood-mother', 'dire-rat', 'dire-rat');
    const foe = () => lineup('dire-rat', 'dire-rat', 'dire-rat', 'dire-rat');
    const plain = simulateDuel(summoner(), foe());
    const starved = simulateDuel(summoner(), foe(), null, 'barren');
    expect(summonsOnSide(starved.events, 'horde')).toBeLessThan(summonsOnSide(plain.events, 'horde'));
  });

  it('is not itself a boon leak — combatCap has always been a legitimate board field', () => {
    // Unlike every other boon grant, Barren reuses a field a client is
    // already allowed to submit (a build's own combatCapForBuild), so there
    // is no dedicated validateBoard door for it.
    expect(validateBoard({ units: [{ defId: 'dire-rat' }], combatCap: 3 }).ok).toBe(true);
  });
});

describe('antidote', () => {
  it('flags the picker board only', () => {
    const out = boardsForDuel(lineup('dire-rat'), e('antidote'), lineup('dire-rat'), null);
    expect(out.a.boonPoisonResist).toBeGreaterThan(0);
    expect(out.b.boonPoisonResist).toBeUndefined();
  });

  it('reduces poison damage taken from a poison-all caster', () => {
    const a = () => lineup('dire-rat', 'dire-rat');
    const poisoner = () => lineup('blight-witch', 'dire-rat');
    const plain = simulateDuel(a(), poisoner()).result;
    const dosed = simulateDuel(a(), poisoner(), 'antidote', null).result;
    expect(dosed.healthA).toBeGreaterThan(plain.healthA);
  });

  it('is refused on a submitted board', () => {
    expect(validateBoard({ units: [{ defId: 'dire-rat' }], boonPoisonResist: 99 }).ok).toBe(false);
  });
});

describe('stripped', () => {
  it('flags the opponent front rat and nobody else', () => {
    const out = boardsForDuel(lineup('dire-rat'), e('stripped'), lineup('dire-rat', 'dire-rat'), null);
    expect(out.b.units[0].boonRelicsStripped).toBe(true);
    expect(out.b.units[1].boonRelicsStripped).toBeUndefined();
    // Never the picker's own line.
    expect(out.a.units[0].boonRelicsStripped).toBeUndefined();
  });

  it('spends the first-hit relic bonus for nothing — Glass Shard never fires', () => {
    const a = () => lineup('dire-rat', 'dire-rat');
    const b: Lineup = { units: [{ defId: 'dire-rat', relicIds: ['glass-shard'] }] };
    const plain = simulateDuel(a(), b).result;
    // 'stripped' is an OPPONENT effect: A picks it and it reaches across to
    // strip B's front, same "picker never touches their own line" shape as
    // drag/buried/silence/blunt.
    const stripped = simulateDuel(a(), b, 'stripped', null).result;
    // With the relic gone, B's front deals less on the opening hit, so A
    // comes out ahead.
    expect(stripped.healthA).toBeGreaterThan(plain.healthA);
  });

  it('removes Weeping Boil too — the opposite of Silence, which leaves relics alone', () => {
    const a = () => lineup('dire-rat', 'dire-rat', 'dire-rat');
    const withBoil: Lineup = { units: [{ defId: 'dire-rat', relicIds: ['weeping-boil'] }] };
    const plain = simulateDuel(a(), withBoil).result;
    const stripped = simulateDuel(a(), withBoil, 'stripped', null).result;
    // Without the boil's death-nova landing on A, A comes out healthier.
    expect(stripped.healthA).toBeGreaterThan(plain.healthA);
  });

  it('leaves team relics untouched', () => {
    const b: Lineup = { units: [{ defId: 'dire-rat' }], teamRelicIds: ['filth-totem'] };
    const out = boardsForDuel(lineup('dire-rat'), e('stripped'), b, null);
    expect(out.b.teamRelicIds).toEqual(['filth-totem']);
  });

  it('is refused on a submitted board', () => {
    const forged: Lineup = { units: [{ defId: 'dire-rat', boonRelicsStripped: true }] };
    expect(validateBoard(forged).ok).toBe(false);
  });
});

describe('first-blood', () => {
  it('flags the picker board only', () => {
    const out = boardsForDuel(lineup('mbp-rat'), e('first-blood'), lineup('mbp-rat'), null);
    expect(out.a.boonFirstBlood).toBe(true);
    expect(out.b.boonFirstBlood).toBeUndefined();
  });

  it('strikes before the return: a mutual kill becomes a lone survivor', () => {
    // Two 1-health rats: the simultaneous clash is normally a mutual kill.
    const plain = simulateDuel(lineup('mbp-rat'), lineup('mbp-rat')).result;
    expect(plain.winner).toBe('draw');
    expect(plain.survivorsA).toHaveLength(0);

    const firstBlood = simulateDuel(lineup('mbp-rat'), lineup('mbp-rat'), 'first-blood', null).result;
    expect(firstBlood.winner).toBe('a');
    expect(firstBlood.survivorsA).toHaveLength(1);
    expect(firstBlood.survivorsB).toHaveLength(0);
  });

  it('both sides picking it cancels out — an identical mirror still draws', () => {
    const plain = simulateDuel(lineup('mbp-rat'), lineup('mbp-rat'));
    const both = simulateDuel(lineup('mbp-rat'), lineup('mbp-rat'), 'first-blood', 'first-blood');
    expect(both.result.winner).toBe('draw');
    expect(both).toEqual(plain);
  });

  it('does nothing when the opening blow is not lethal', () => {
    // Both dire-rats survive their armor-reduced first hit, so there is
    // nothing for priority to change: front still swings, foe still swings
    // back, in the same order as the untouched simultaneous path.
    const plain = simulateDuel(lineup('dire-rat'), lineup('dire-rat')).result;
    const firstBlood = simulateDuel(lineup('dire-rat'), lineup('dire-rat'), 'first-blood', null).result;
    expect(firstBlood.healthA).toBe(plain.healthA);
    expect(firstBlood.healthB).toBe(plain.healthB);
  });

  it('is refused on a submitted board', () => {
    const forged: Lineup = { units: [{ defId: 'dire-rat' }], boonFirstBlood: true };
    expect(validateBoard(forged).ok).toBe(false);
  });
});

describe('first-blood — compounding-law canary (ADR-0007)', () => {
  it('never reaches the 45-wave gauntlet, where the law would bite', () => {
    // Bounded on BOTH `ticks === 1` AND `currentWave === 1` — `ticks` alone
    // resets every wave, so without the wave gate this would re-fire on
    // every wave's opening tick across all 45, not once per battle. Real
    // wave-1 enemies are not one-shot by a single MBP Rat swing, so a leaked
    // flag changes nothing even on the one wave it's live for.
    const g = generateGauntlet('2026-08-12');
    const board = () => lineup('mbp-rat', 'dire-rat');
    const plain = simulate(board(), g);
    const withFlag = simulate({ units: board().units, boonFirstBlood: true }, g);
    expect(withFlag.result.wavesCleared).toBe(plain.result.wavesCleared);
    expect(withFlag.result.score).toBe(plain.result.score);
    expect(withFlag.result.damageDealt).toBe(plain.result.damageDealt);
  });
});
