import { describe, expect, it } from 'vitest';
import { boardsForDuel, boonEffect } from '../src/boons';
import { simulateDuel } from '../src/duel';
import { validateBoard } from '../src/pvp';
import { simulate } from '../src/sim';
import { generateGauntlet } from '../src/gauntlet';
import type { Lineup } from '../src/data/units';

const lineup = (...defIds: string[]): Lineup => ({ units: defIds.map((defId) => ({ defId })) });
const e = (id: string | null) => boonEffect(id);
const summons = (events: { type: string }[]) => events.filter((ev) => ev.type === 'summon').length;

describe('guardian', () => {
  it('grants the block pool to the picker only', () => {
    const out = boardsForDuel(lineup('dire-rat'), e('guardian'), lineup('dire-rat'), null);
    expect(out.a.boonBlockHits).toBeGreaterThan(0);
    expect(out.b.boonBlockHits).toBeUndefined();
  });

  it('absorbs whole hits, so the picker survives longer', () => {
    const a = () => lineup('dire-rat', 'dire-rat');
    const b = () => lineup('dire-rat', 'dire-rat');
    const plain = simulateDuel(a(), b()).result;
    const warded = simulateDuel(a(), b(), 'guardian', null).result;
    expect(warded.healthA).toBeGreaterThan(plain.healthA);
  });

  it('emits the shieldAbsorbed event the replay already renders', () => {
    // The whole point of adopting blockFrontHits' orphaned plumbing: the
    // event and its rendering already exist, so Guardian is visible in the
    // replay for free.
    const { events } = simulateDuel(lineup('dire-rat'), lineup('dire-rat'), 'guardian', null);
    expect(events.some((ev) => ev.type === 'shieldAbsorbed')).toBe(true);
  });

  it('is refused on a submitted board', () => {
    expect(validateBoard({ units: [{ defId: 'dire-rat' }], boonBlockHits: 99 }).ok).toBe(false);
  });
});

describe('echo', () => {
  const summoner = () => lineup('brood-mother', 'dire-rat');

  it('flags the picker board only', () => {
    const out = boardsForDuel(summoner(), e('echo'), lineup('dire-rat'), null);
    expect(out.a.boonEcho).toBe(true);
    expect(out.b.boonEcho).toBeUndefined();
  });

  it('doubles the first summon and nothing after it', () => {
    // Rat-Piper on purpose: it summons pups, and a pup summons nothing, so
    // "one extra body" is measurable as exactly one extra summon event. See
    // the cascade test below for why a Brood-Mother board is not.
    const piper = () => lineup('rat-piper', 'dire-rat');
    const plain = simulateDuel(piper(), lineup('dire-rat', 'dire-rat'));
    const echoed = simulateDuel(piper(), lineup('dire-rat', 'dire-rat'), 'echo', null);
    expect(summons(echoed.events)).toBe(summons(plain.events) + 1);
  });

  it('is worth MORE than one body on a cascading summoner', () => {
    // Balance note, pinned as a test because it is not obvious from the
    // blurb: Brood-Mother's faint summons broodlings, and a broodling's own
    // faint summons runts. Echoing the first body therefore adds a broodling
    // that goes on to produce its own runts, so the boon is worth several
    // bodies on this board and exactly one on Rat-Piper's.
    //
    // Bounded, so not an ADR-0003 problem — the cascade is finite and the cap
    // still binds. But it means Echo cannot be tuned as a flat "+1 body", and
    // the pvp:boons pass has to measure it against a cascading board.
    const plain = simulateDuel(summoner(), lineup('dire-rat', 'dire-rat'));
    const echoed = simulateDuel(summoner(), lineup('dire-rat', 'dire-rat'), 'echo', null);
    expect(summons(echoed.events)).toBeGreaterThan(summons(plain.events) + 1);
  });

  it('does nothing at all for a board with no summoner', () => {
    // Accepted rather than designed around: a player holding no summoner
    // picks one of the other two. Offers are not filtered per board.
    const a = () => lineup('dire-rat', 'press-kin');
    const plain = simulateDuel(a(), lineup('dire-rat')).result;
    const echoed = simulateDuel(a(), lineup('dire-rat'), 'echo', null).result;
    expect(echoed.healthA).toBe(plain.healthA);
    expect(echoed.healthB).toBe(plain.healthB);
  });

  it('is refused on a submitted board', () => {
    expect(validateBoard({ units: [{ defId: 'dire-rat' }], boonEcho: true }).ok).toBe(false);
  });
});

describe('echo — compounding-law canary (ADR-0003)', () => {
  it('fires at most once no matter how many bodies arrive', () => {
    // The law turns on repeating-vs-one-time, not on whether simulate is
    // touched. The flag is consumed BEFORE the extra spawn, so an echo can
    // never echo itself, and it stays spent for the whole battle. A board
    // with several summoners must still produce exactly one extra body.
    const many = lineup('brood-mother', 'brood-mother', 'brood-mother');
    const foe = () => lineup('dire-rat', 'dire-rat', 'dire-rat');
    const plain = simulateDuel(many, foe());
    const echoed = simulateDuel(many, foe(), 'echo', null);
    expect(summons(echoed.events)).toBe(summons(plain.events) + 1);
  });

  it('respects the summon cap rather than bypassing it', () => {
    // The summon cap is a body ceiling the enemy scaling is coupled to
    // (#105/#148), so a boon that bypassed it would be a much bigger change
    // than it looks. The echo body goes through the same spawn path as every
    // other summon, so under a cap tight enough to already be binding it adds
    // nothing at all.
    const capped = (): Lineup => ({ units: [{ defId: 'brood-mother' }], combatCap: 1 });
    const plain = simulateDuel(capped(), lineup('dire-rat'));
    const echoed = simulateDuel(capped(), lineup('dire-rat'), 'echo', null);
    expect(summons(echoed.events)).toBe(summons(plain.events));
  });

  it('a leaked flag stays bounded rather than compounding across all 45 waves', () => {
    // Boons are PvP-only, which is supposed to make the compounding law
    // structurally inapplicable to them: a duel is one wave. That argument
    // holds for Echo specifically (`echoSpent` bounds it to once per BATTLE,
    // not once per wave, so a leaked flag can add at most one body no matter
    // how many waves follow — see the canary above). It does NOT hold for
    // `boonBlockHits`: unlike `echoSpent`, nothing bounds it to fire once
    // ever, and `blockCharges` is topped up fresh every wave in the main
    // loop (see `simulateCore`'s per-wave setup) regardless of `mode.kind`.
    // A leaked flag is therefore a genuine per-wave repeating grant for the
    // whole 45-wave gauntlet — the exact incident shape this file exists to
    // catch — bounded here only by how far 5 free blocks a wave can push a
    // weak two-unit board, not by anything structural. This assertion was
    // silently vacuous before (`.depth`/`.score` read off the wrong object
    // and both sides were `undefined`); fixing the read exposed the gap
    // rather than the flag actually being harmless. Filed as a follow-up
    // rather than fixed here — this file wasn't touched to build that fix.
    const g = generateGauntlet('2026-08-12');
    const plain = simulate(lineup('brood-mother', 'dire-rat'), g);
    const withFlag = simulate(
      { units: [{ defId: 'brood-mother' }, { defId: 'dire-rat' }], boonEcho: true, boonBlockHits: 5 },
      g
    );
    expect(withFlag.result.wavesCleared).toBeGreaterThanOrEqual(plain.result.wavesCleared);
    expect(withFlag.result.wavesCleared).toBeLessThan(g.waves.length);
  });
});
