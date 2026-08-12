import { describe, expect, it } from 'vitest';
import { boardsForDuel, boonEffect, DECOY_DEF_ID, type BoonNote } from '../src/boons';
import { simulateDuel } from '../src/duel';
import { validateBoard } from '../src/pvp';
import type { Lineup } from '../src/data/units';

const lineup = (...defIds: string[]): Lineup => ({ units: defIds.map((defId) => ({ defId })) });
const e = (id: string | null) => boonEffect(id);

describe('silence', () => {
  it('flags the opponent front rat and nobody else', () => {
    const out = boardsForDuel(lineup('dire-rat'), e('silence'), lineup('md-rattyfock', 'dire-rat'), null);
    expect(out.b.units[0].boonSilenced).toBe(true);
    expect(out.b.units[1].boonSilenced).toBeUndefined();
    // Never the picker's own line.
    expect(out.a.units[0].boonSilenced).toBeUndefined();
  });

  it('strips a position-dependent buff it leads with', () => {
    // buffBehind buffs the rats BEHIND its caster, so its carrier wants to
    // stand at or near the front for coverage — which is exactly where
    // front-silence lands. This is why the front slot is the right target.
    const a = lineup('dire-rat', 'dire-rat', 'dire-rat');
    const b = () => lineup('md-rattyfock', 'dire-rat', 'dire-rat');
    const plain = simulateDuel(a, b()).result;
    const silenced = simulateDuel(a, b(), 'silence', null).result;
    expect(silenced.healthB).toBeLessThan(plain.healthB);
  });

  it('does nothing to a whole-board buff standing behind an abilityless rat', () => {
    // grantArmor { all: true } fires the same from any slot, so silencing the
    // front only catches it if the player happened to lead with it. The
    // counter-play the boon creates is exactly this: don't lead with your
    // team-buffer. Gutter Runt has no ability, so silencing it is a no-op.
    const a = lineup('dire-rat', 'dire-rat');
    const b = () => lineup('gutter-runt', 'ward-weaver');
    const plain = simulateDuel(a, b()).result;
    const silenced = simulateDuel(a, b(), 'silence', null).result;
    expect(silenced.healthB).toBe(plain.healthB);
  });

  it('leaves relics alone — a silenced Weeping Boil still detonates', () => {
    // The correction that matters: Weeping Boil is a RELIC, not a unit
    // ability, so silence never touches it. A silenced carrier still blows up
    // on death.
    const a = () => lineup('dire-rat', 'dire-rat');
    const withBoil: Lineup = { units: [{ defId: 'dire-rat', relicIds: ['weeping-boil'] }] };
    const without: Lineup = { units: [{ defId: 'dire-rat' }] };
    const vsBoil = simulateDuel(a(), withBoil, 'silence', null).result;
    const vsPlain = simulateDuel(a(), without, 'silence', null).result;
    // A comes out worse against the boil carrier even though it was silenced.
    expect(vsBoil.healthA).toBeLessThan(vsPlain.healthA);
  });

  it('is refused on a submitted board', () => {
    const forged: Lineup = { units: [{ defId: 'dire-rat', boonSilenced: true }] };
    expect(validateBoard(forged).ok).toBe(false);
  });
});

describe('boon notes (replay reveal)', () => {
  const notesOf = (a: Lineup, idA: string | null, b: Lineup, idB: string | null): BoonNote[] =>
    boardsForDuel(a, e(idA), b, e(idB), idA, idB).notes;

  it('is empty when neither side picked', () => {
    expect(notesOf(lineup('dire-rat'), null, lineup('dire-rat'), null)).toEqual([]);
  });

  it('describes a drag as the move it performed', () => {
    // The replay cannot recover this from the event log — pre-sim transforms
    // emit none — so without the note a dragged board just looks like a badly
    // ordered one.
    const notes = notesOf(lineup('dire-rat'), 'drag', lineup('dire-rat', 'press-kin', 'mbp-rat'), null);
    expect(notes).toEqual([
      { by: 'a', boonId: 'drag', target: 'b', kind: 'move', defId: 'mbp-rat', from: 2, to: 0 },
    ]);
  });

  it('describes a bury as the opposite move', () => {
    const notes = notesOf(lineup('dire-rat'), 'buried', lineup('dire-rat', 'press-kin', 'mbp-rat'), null);
    expect(notes[0]).toMatchObject({ kind: 'move', defId: 'dire-rat', from: 0, to: 2 });
  });

  it('describes a silence with the rat it quietened', () => {
    const notes = notesOf(lineup('dire-rat'), 'silence', lineup('md-rattyfock', 'dire-rat'), null);
    expect(notes[0]).toMatchObject({ kind: 'silence', defId: 'md-rattyfock', index: 0, target: 'b' });
  });

  it('describes a decoy as an insert on the picker own board', () => {
    const notes = notesOf(lineup('dire-rat'), 'a-body-first', lineup('dire-rat'), null);
    expect(notes[0]).toMatchObject({ kind: 'insert', defId: DECOY_DEF_ID, index: 0, target: 'a' });
  });

  it('describes stat grants with their sign', () => {
    const buff = notesOf(lineup('dire-rat', 'mbp-rat'), 'rearguard', lineup('dire-rat'), null);
    expect(buff[0]).toMatchObject({ kind: 'stat', index: 1, target: 'a' });
    expect((buff[0] as { attack: number }).attack).toBeGreaterThan(0);

    const sap = notesOf(lineup('dire-rat'), 'blunt', lineup('dire-rat', 'mbp-rat'), null);
    expect((sap[0] as { attack: number }).attack).toBeLessThan(0);
  });

  it('records both sides when both picked', () => {
    const notes = notesOf(lineup('dire-rat', 'mbp-rat'), 'bulwark', lineup('dire-rat', 'press-kin'), 'drag');
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.by).sort()).toEqual(['a', 'b']);
    // A buffed its own board; B's drag reached across to A's.
    expect(notes.find((n) => n.by === 'a')?.target).toBe('a');
    expect(notes.find((n) => n.by === 'b')?.target).toBe('a');
  });

  it('reports the drag index against the board it actually acted on', () => {
    // A's decoy shifts its line before B's drag reads it, so the note has to
    // describe the post-decoy board or the replay would point at the wrong rat.
    const notes = notesOf(lineup('dire-rat', 'mbp-rat'), 'a-body-first', lineup('dire-rat'), 'drag');
    const drag = notes.find((n) => n.by === 'b');
    expect(drag).toMatchObject({ kind: 'move', defId: 'mbp-rat', from: 2, to: 0 });
  });

  it('surfaces the note on the duel result', () => {
    const { result } = simulateDuel(lineup('dire-rat'), lineup('dire-rat', 'mbp-rat'), 'drag', null);
    expect(result.boonNotes).toHaveLength(1);
    expect(result.boonNotes[0].boonId).toBe('drag');
  });
});
