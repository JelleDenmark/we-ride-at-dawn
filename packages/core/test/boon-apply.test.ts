import { describe, expect, it } from 'vitest';
import { boardsForDuel, boonEffect, DECOY_DEF_ID } from '../src/boons';
import { simulateDuel } from '../src/duel';
import { validateBoard } from '../src/pvp';
import { BOARD_CAP } from '../src/sim';
import type { Lineup } from '../src/data/units';

const lineup = (...defIds: string[]): Lineup => ({ units: defIds.map((defId) => ({ defId })) });
const ids = (l: Lineup) => l.units.map((u) => u.defId);
const e = (id: string | null) => boonEffect(id);

describe('boardsForDuel — positional transforms', () => {
  it('drags the opponent hindmost rat to their front', () => {
    const a = lineup('dire-rat', 'press-kin', 'mbp-rat');
    const out = boardsForDuel(lineup('dire-rat'), e('drag'), a, null);
    expect(ids(out.b)).toEqual(['mbp-rat', 'dire-rat', 'press-kin']);
    // Never the picker's own line.
    expect(ids(out.a)).toEqual(['dire-rat']);
  });

  it('buries the opponent leading rat at their back', () => {
    const a = lineup('dire-rat', 'press-kin', 'mbp-rat');
    const out = boardsForDuel(lineup('dire-rat'), e('buried'), a, null);
    expect(ids(out.b)).toEqual(['press-kin', 'mbp-rat', 'dire-rat']);
  });

  it('leaves a one-rat line alone rather than reordering nothing', () => {
    const out = boardsForDuel(lineup('dire-rat'), e('drag'), lineup('press-kin'), null);
    expect(ids(out.b)).toEqual(['press-kin']);
  });

  it('never mutates the boards it was handed', () => {
    // scoreRound reuses one board object across every duel of a round-robin,
    // so an in-place write would leak a boon into the next fight.
    const a = lineup('dire-rat', 'mbp-rat');
    const b = lineup('dire-rat', 'press-kin');
    const beforeA = JSON.stringify(a);
    const beforeB = JSON.stringify(b);
    boardsForDuel(a, e('drag'), b, e('bulwark'));
    expect(JSON.stringify(a)).toBe(beforeA);
    expect(JSON.stringify(b)).toBe(beforeB);
  });
});

describe('boardsForDuel — rule 2 ordering (buffs first, displacement last)', () => {
  it('lets a drag displace a buffed rat without erasing the buff', () => {
    const a = lineup('dire-rat', 'press-kin', 'mbp-rat');
    // A buffs its own front; B drags A's hindmost to A's front.
    const out = boardsForDuel(a, e('bulwark'), lineup('dire-rat'), e('drag'));
    // The dragged rat now leads...
    expect(ids(out.a)).toEqual(['mbp-rat', 'dire-rat', 'press-kin']);
    // ...and the buff travelled with the rat it was put on, not with the slot.
    const buffed = out.a.units.filter((u) => (u.boonHealth ?? 0) > 0);
    expect(buffed).toHaveLength(1);
    expect(buffed[0].defId).toBe('dire-rat');
    expect(out.a.units[1].defId).toBe('dire-rat');
  });

  it('applies a decoy before the opponent drag reads the line', () => {
    // The decoy shifts the whole line back one, so the drag still pulls the
    // hindmost rat — but it now arrives in front of the decoy, not behind it.
    const a = lineup('dire-rat', 'mbp-rat');
    const out = boardsForDuel(a, e('a-body-first'), lineup('dire-rat'), e('drag'));
    expect(ids(out.a)).toEqual(['mbp-rat', DECOY_DEF_ID, 'dire-rat']);
  });
});

describe('boardsForDuel — stat grants', () => {
  it('puts bulwark health on the front rat only', () => {
    const out = boardsForDuel(lineup('dire-rat', 'press-kin'), e('bulwark'), lineup('dire-rat'), null);
    expect(out.a.units[0].boonHealth).toBeGreaterThan(0);
    expect(out.a.units[1].boonHealth).toBeUndefined();
  });

  it('puts rearguard attack on the hindmost rat only', () => {
    const out = boardsForDuel(lineup('dire-rat', 'mbp-rat'), e('rearguard'), lineup('dire-rat'), null);
    expect(out.a.units[0].boonAttack).toBeUndefined();
    expect(out.a.units[1].boonAttack).toBeGreaterThan(0);
  });

  it('saps the opponent hindmost rat with a NEGATIVE grant', () => {
    const out = boardsForDuel(lineup('dire-rat'), e('blunt'), lineup('dire-rat', 'mbp-rat'), null);
    expect(out.b.units[1].boonAttack).toBeLessThan(0);
  });
});

describe('a-body-first', () => {
  it('inserts the decoy at the front and buys it a combat-cap slot', () => {
    // Without the cap bump the boon is dead weight on a full board, which is
    // most boards by midweek.
    const a: Lineup = { units: [{ defId: 'dire-rat' }], combatCap: 3 };
    const out = boardsForDuel(a, e('a-body-first'), lineup('dire-rat'), null);
    expect(out.a.units[0].defId).toBe(DECOY_DEF_ID);
    expect(out.a.combatCap).toBe(4);
  });

  it('bumps from BOARD_CAP when the board declares no cap', () => {
    const out = boardsForDuel(lineup('dire-rat'), e('a-body-first'), lineup('dire-rat'), null);
    expect(out.a.combatCap).toBe(BOARD_CAP + 1);
  });

  it('spends the enemy first-hit relic bonus on the decoy', () => {
    // firstAttackDone is per-unit, and both bonusOf and ignoresArmorOf read
    // it, so Glass Shard's opener lands on a 1-health body instead of on
    // anything that matters. This is the whole point of the boon.
    const a = lineup('dire-rat', 'dire-rat');
    const b: Lineup = { units: [{ defId: 'dire-rat', relicIds: ['glass-shard'] }] };
    const plain = simulateDuel(a, b).result;
    const decoyed = simulateDuel(a, b, 'a-body-first', null).result;
    expect(decoyed.healthA).toBeGreaterThan(plain.healthA);
  });
});

describe('drag vs the backline-damage path', () => {
  // Measured on the DEFENDER's surviving health, not on damageA: damage is
  // capped by what the other side actually has, so any board A wipes reports
  // the same total whether MBP Rat contributed or not. B is deliberately
  // deep enough to survive, which is the only way the backline contribution
  // shows up at all.
  const tankyB = () => lineup('dire-rat', 'dire-rat', 'dire-rat', 'dire-rat');

  it('suppresses a dragged backline attacker', () => {
    // backlineDamage breaks at index 0, and fires at startOfWave — inside the
    // sim, so after every pre-sim transform. Dragging MBP Rat to the front
    // therefore removes its ability outright and exposes a 1-health body.
    const a = lineup('dire-rat', 'mbp-rat');
    const plain = simulateDuel(a, tankyB()).result;
    const dragged = simulateDuel(a, tankyB(), null, 'drag').result;
    expect(dragged.healthB).toBeGreaterThan(plain.healthB);
  });

  it('feeds rearguard into the backline damage it is meant to reach', () => {
    // The grant has to land on attackBuffs, not just attack: backlineDamage
    // reads the former and never the latter, so a raw attack write would
    // leave this assertion flat.
    const a = lineup('dire-rat', 'mbp-rat');
    const plain = simulateDuel(a, tankyB()).result;
    const buffed = simulateDuel(a, tankyB(), 'rearguard', null).result;
    expect(buffed.healthB).toBeLessThan(plain.healthB);
  });
});

describe('boon safety', () => {
  it('resolves an unknown or absent pick to no boon', () => {
    // Keeps a round scored under a newer pool replayable by an older client.
    expect(boonEffect(null)).toBeNull();
    expect(boonEffect('not-a-boon')).toBeNull();
    const a = lineup('dire-rat', 'mbp-rat');
    expect(ids(boardsForDuel(a, e('not-a-boon'), a, null).a)).toEqual(ids(a));
  });

  it('leaves a boonless duel byte-identical to a pre-boon one', () => {
    const a = lineup('dire-rat', 'mbp-rat');
    const b = lineup('press-kin', 'dire-rat');
    expect(simulateDuel(a, b, null, null)).toEqual(simulateDuel(a, b));
  });

  it('refuses a submitted board carrying a boon stat grant', () => {
    // The fields live on LineupUnit for the sim's benefit; without this a
    // client could sync boonHealth 999 into pvp_boards and field it nightly.
    const forged: Lineup = { units: [{ defId: 'dire-rat', boonHealth: 999 }] };
    expect(validateBoard(forged).ok).toBe(false);
    const forgedAtk: Lineup = { units: [{ defId: 'dire-rat', boonAttack: 99 }] };
    expect(validateBoard(forgedAtk).ok).toBe(false);
    expect(validateBoard(lineup('dire-rat')).ok).toBe(true);
  });

  it('refuses the decoy body as a submitted board entry', () => {
    expect(validateBoard(lineup(DECOY_DEF_ID)).ok).toBe(false);
  });
});
