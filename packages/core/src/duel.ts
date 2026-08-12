import type { Lineup } from './data/units';
import { simulateCore, type BattleEvent, type UnitView } from './sim';
import { boardsForDuel, boonEffect, type BoonNote } from './boons';

/**
 * Outcome of a single symmetric board-vs-board duel — the PvP league's core
 * unit of play (the nightly 22:00 fight).
 *
 * A duel is ONE wave: side A's board fought to the death against side B's,
 * both instantiated with full tiers, per-unit relics and team relics and no
 * wave scaling (see `simulateCore`'s `duel` mode). Because the front clash is
 * simultaneous and both sides run through the identical engine, the matchup
 * is mechanically symmetric — a true mirror (A === B) resolves to `draw`.
 * That symmetry is only sound because the seat-fairness fixes landed with the
 * engine port (Marrow-Snap execute and Gore-Cleaver cleave now fire in both
 * directions); without them a relic on one seat would break the mirror.
 */
export interface DuelResult {
  winner: 'a' | 'b' | 'draw';
  /**
   * What each side's daily boon did to the boards before the fight started
   * (issue #184) — empty when neither side picked one.
   *
   * Pre-sim transforms emit no `BattleEvent`s, deliberately, so the replay has
   * nothing in the log to explain why a rat moved or went quiet. These are the
   * transform's own account of itself, for the replay to play as a scripted
   * pre-battle beat before the log begins.
   */
  boonNotes: BoonNote[];
  survivorsA: UnitView[];
  survivorsB: UnitView[];
  /** Total remaining health of each side's survivors — the stalemate margin,
   * and the "survivor differential" the league uses as its scoring tiebreak. */
  healthA: number;
  healthB: number;
  /** Damage side A dealt to side B (clash + poison). The core does not track
   * the symmetric B-damage; use survivor health as the neutral margin. */
  damageA: number;
  /** Opponent (side B) units side A felled. */
  defeatedB: number;
}

/**
 * Resolve a PvP duel between two player boards. Deterministic: the same
 * `(a, b)` always yields a byte-identical event log and result, so the client
 * and the nightly server job can independently re-simulate and agree (the
 * anti-cheat story). The returned `BattleEvent[]` is the standard log the
 * Pixi replay renders, unchanged.
 *
 * Winner rules:
 * - exactly one side wiped        -> the survivor wins;
 * - both wiped (simultaneous)     -> `draw`;
 * - both still standing at the stalemate guard -> higher surviving health
 *   wins, then higher surviving attack, else `draw`.
 *
 * Seat note: `simulateCore` runs side A as the "horde" and side B as the
 * "enemy". The engine is symmetric across that split for all shipped content,
 * so `winner` is a property of the two boards, not of which one was passed
 * first — the seat-swap test in duel.test.ts guards exactly that.
 */
export function simulateDuel(
  a: Lineup,
  b: Lineup,
  boonA: string | null = null,
  boonB: string | null = null
): { events: BattleEvent[]; result: DuelResult } {
  // Daily boons (issue #184). Default null on both, so every existing caller,
  // golden log and determinism hash is byte-identical to before boons existed
  // — a duel with no picks resolves exactly as it always did.
  //
  // Taking ids rather than effects is deliberate: the replay reads `boon_id`
  // straight off a stored result row and hands it here unchanged, so the
  // client re-runs the identical fight the nightly job scored. An unknown id
  // resolves to no boon rather than throwing, which keeps a round scored under
  // a newer pool replayable by an older client.
  const boards = boardsForDuel(a, boonEffect(boonA), b, boonEffect(boonB), boonA, boonB);
  const { events, result, enemySurvivors } = simulateCore(boards.a, {
    kind: 'duel',
    opponent: boards.b,
  });
  const survivorsA = result.survivors;
  const survivorsB = enemySurvivors;
  const healthA = survivorsA.reduce((s, u) => s + u.health, 0);
  const healthB = survivorsB.reduce((s, u) => s + u.health, 0);

  const aAlive = survivorsA.length > 0;
  const bAlive = survivorsB.length > 0;
  let winner: 'a' | 'b' | 'draw';
  if (aAlive && !bAlive) winner = 'a';
  else if (bAlive && !aAlive) winner = 'b';
  else if (!aAlive && !bAlive) winner = 'draw';
  else {
    // Both boards still standing when the stalemate guard tripped: decide by
    // margin so the ladder still moves. Health, then attack, then a true draw.
    if (healthA > healthB) winner = 'a';
    else if (healthB > healthA) winner = 'b';
    else {
      const atkA = survivorsA.reduce((s, u) => s + u.attack, 0);
      const atkB = survivorsB.reduce((s, u) => s + u.attack, 0);
      winner = atkA > atkB ? 'a' : atkB > atkA ? 'b' : 'draw';
    }
  }

  return {
    events,
    result: {
      winner,
      boonNotes: boards.notes,
      survivorsA,
      survivorsB,
      healthA,
      healthB,
      damageA: result.damageDealt,
      defeatedB: result.enemiesDefeated,
    },
  };
}
