import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../src/data/units';
import { newBuild, buyUnit } from '../src/shop';

describe('MD Rattyfock (issue #23)', () => {
  it('exists in UNIT_DEFS with id "md-rattyfock"', () => {
    expect(UNIT_DEFS['md-rattyfock']).toBeDefined();
  });

  it('has the exact same stats as Warren-Warden (attack, health, cost)', () => {
    const warren = UNIT_DEFS['warren-warden'];
    const md = UNIT_DEFS['md-rattyfock'];
    expect(md.attack).toBe(warren.attack);
    expect(md.health).toBe(warren.health);
    expect(md.cost).toBe(warren.cost);
  });

  it('has the same ability as Warren-Warden (startOfBattle, +2/+1 to the rat behind)', () => {
    const warren = UNIT_DEFS['warren-warden'];
    const md = UNIT_DEFS['md-rattyfock'];
    expect(md.ability).toBeDefined();
    expect(md.ability?.trigger).toBe('startOfBattle');
    expect(md.ability?.effect.kind).toBe('buffBehind');
    // `all` dropped on 2026-08-31 — the kit is single-target now. Asserted
    // against the TWIN rather than as a literal, so a future tune of one entry
    // can never silently desync the pair (which is the whole point of this
    // file, and see reskin-twins.test.ts for the same check across all pairs).
    expect(md.ability?.effect).toEqual(warren.ability?.effect);
    if (md.ability?.effect.kind === 'buffBehind') {
      expect(md.ability.effect.attack).toBe(2);
      expect(md.ability.effect.health).toBe(1);
      expect(md.ability.effect.all).toBeUndefined();
    }
  });

  it('can be purchased from the shop (is in the unit pool)', () => {
    // Verify that md-rattyfock can be rolled in the shop.
    // We generate several shop rolls to increase the chance of seeing it.
    let found = false;
    for (let roll = 0; roll < 50 && !found; roll++) {
      const build = newBuild('2026-07-04');
      // Manually create a shop with md-rattyfock to verify it's buyable
      const withMd = {
        ...build,
        scrap: 100,
        shop: {
          ...build.shop,
          slots: [{ kind: 'unit' as const, defId: 'md-rattyfock' }, ...build.shop.slots.slice(1)],
        },
      };
      const result = buyUnit(withMd, 0);
      if (result.ok) {
        found = true;
        expect(result.state.board).toHaveLength(1);
        expect(result.state.board[0].defId).toBe('md-rattyfock');
        expect(result.state.scrap).toBe(100 - UNIT_DEFS['md-rattyfock'].cost);
      }
    }
    expect(found).toBe(true);
  });
});
