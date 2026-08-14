// Issue #188: `simulateDuel`'s doc comment promises the winner is "a property
// of the two boards, not of which one was passed first" — and `scoreRound`
// (pvp.ts) relies on exactly that guarantee to skip playing the away leg.
// The small hand-picked fixtures in duel.test.ts (1-3 units, few/no relics)
// never caught a real asymmetry; it took an 8x-tier-3, full-relic, real-board
// pull to surface it. Two independent engine bugs, both in sim.ts, both fixed
// alongside this test:
//
//   1. `fireEntryTriggers(horde)` ran to full completion before
//      `fireEntryTriggers(enemies)` even started, so a horde cross-side
//      startOfWave hit (Blight-Witch's poisonAllEnemies, MBP-Rat's
//      backlineDamage) landed on an enemy that hadn't yet received its OWN
//      startOfWave armor/buffs (Ward-Weaver's grantArmor), while the same hit
//      run the other direction always landed on an already-armored horde.
//   2. `resolveDeaths` scanned `[horde, enemies]` and drained one whole
//      side's dead queue — including the cross-side `onFaintDamageAll` relic
//      splash (Weeping Boil) — before even looking at the other side's
//      simultaneous (same-tick) deaths.
//
// Both gave whichever board sat in seat A (horde) a small but real, and
// non-mirror-symmetric, first-mover edge. Minimal repros below are the
// bisected output of a realistic-board fuzzer (see the mirror-symmetry test
// at the bottom) that found real winner flips and margin drift on ~10-13% of
// random 8x-tier-3 pairings before the fix, and 0/2000+ after.
import { describe, expect, it } from 'vitest';
import { simulateDuel } from '../src/duel';
import { UNIT_DEFS, type Lineup } from '../src/data/units';
import { RELIC_DEFS } from '../src/data/relics';
import { xorshift128 } from '../src/prng';

const board = (units: Lineup['units'], teamRelicIds?: string[]): Lineup => ({
  units,
  ...(teamRelicIds ? { teamRelicIds } : {}),
});

describe('simulateDuel — seat fairness regressions (issue #188)', () => {
  it('bug 1 repro: a cross-side startOfWave hit no longer beats the target\'s own startOfWave armor to the punch', () => {
    // Ward-Weaver (grantArmor, self) + Warren-Warden (buffBehind, self) +
    // MBP-Rat (backlineDamage, cross-side) — no relics needed. Before the
    // fix, mirroring this board against itself did not draw: whichever copy
    // was seat A got its MBP-Rat hit in before the seat-B copy's own
    // Ward-Weaver had granted its armor.
    const b = board([
      { defId: 'ward-weaver', tier: 3 },
      { defId: 'warren-warden', tier: 3 },
      { defId: 'mbp-rat', tier: 3 },
    ]);
    const { result } = simulateDuel(b, b);
    expect(result.winner).toBe('draw');
    expect(result.healthA).toBe(result.healthB);
  });

  it('bug 2 repro: a simultaneous cross-side faint splash (Weeping Boil) no longer beats the other side\'s own faint splash to the punch', () => {
    // Warren-Warden + Gnawer (faint: bequeathAttack, self) + a Weeping-Boil
    // Brood-Mother (faint: summon, self + onFaintDamageAll, cross-side).
    // Before the fix, mirroring this board against itself did not draw:
    // seat A's simultaneous-death splash always resolved before seat B's.
    const b = board([
      { defId: 'warren-warden', tier: 3 },
      { defId: 'gnawer', tier: 3 },
      { defId: 'brood-mother', tier: 3, relicIds: ['weeping-boil'] },
    ]);
    const { result } = simulateDuel(b, b);
    expect(result.winner).toBe('draw');
    expect(result.healthA).toBe(result.healthB);
  });
});

describe('simulateDuel — seat fairness on realistic boards (issue #188)', () => {
  const unitIds = Object.keys(UNIT_DEFS).filter((id) => (UNIT_DEFS[id].cost ?? 0) > 0);
  const unitRelicIds = Object.keys(RELIC_DEFS).filter((r) => RELIC_DEFS[r].scope === 'unit');
  const teamRelicIds = Object.keys(RELIC_DEFS).filter((r) => RELIC_DEFS[r].scope === 'team');

  // 8x tier-3, 0-2 unit relics each, 1-2 team relics — matches the live
  // pvp_boards_public shape (full tiers, full relics, team relics like
  // Filth Totem + Forgotten Backpack) that duel.test.ts's small fixtures
  // never exercised.
  function randomBoard(rng: ReturnType<typeof xorshift128>): Lineup {
    const units = Array.from({ length: 8 }, () => {
      const defId = unitIds[rng.int(unitIds.length)];
      const relicCount = rng.int(3);
      const relicIds = Array.from({ length: relicCount }, () => unitRelicIds[rng.int(unitRelicIds.length)]);
      return { defId, tier: 3, relicIds };
    });
    const teamCount = 1 + rng.int(2);
    const picked = new Set<string>();
    while (picked.size < teamCount) picked.add(teamRelicIds[rng.int(teamRelicIds.length)]);
    return { units, teamRelicIds: [...picked] };
  }

  const flip = (w: 'a' | 'b' | 'draw'): 'a' | 'b' | 'draw' => (w === 'a' ? 'b' : w === 'b' ? 'a' : 'draw');

  it('every board mirrored against itself draws with equal survivor health', () => {
    const rng = xorshift128(4242);
    for (let i = 0; i < 150; i++) {
      const b = randomBoard(rng);
      const { result } = simulateDuel(b, b);
      expect(result.winner, `mirror #${i}: ${JSON.stringify(b)}`).toBe('draw');
      expect(result.healthA, `mirror #${i} health symmetry`).toBe(result.healthB);
    }
  });

  it('swapping seats mirrors the winner and health margins for random pairings', () => {
    const rng = xorshift128(777);
    for (let i = 0; i < 150; i++) {
      const a = randomBoard(rng);
      const b = randomBoard(rng);
      const ab = simulateDuel(a, b).result;
      const ba = simulateDuel(b, a).result;
      expect(flip(ab.winner), `pair #${i}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(ba.winner);
      expect(ba.healthA, `pair #${i} healthA/B swap`).toBe(ab.healthB);
      expect(ba.healthB, `pair #${i} healthB/A swap`).toBe(ab.healthA);
    }
  });
});
