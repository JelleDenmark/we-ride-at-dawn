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

  it('has the same ability as Warren-Warden (startOfBattle, +1/+1 to all behind)', () => {
    const warren = UNIT_DEFS['warren-warden'];
    const md = UNIT_DEFS['md-rattyfock'];
    expect(md.ability).toBeDefined();
    expect(md.ability?.trigger).toBe('startOfBattle');
    expect(md.ability?.effect.kind).toBe('buffBehind');
    if (md.ability?.effect.kind === 'buffBehind') {
      expect(md.ability.effect.attack).toBe(1);
      expect(md.ability.effect.health).toBe(1);
      expect(md.ability.effect.all).toBe(true);
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

  it('is described as a Season 1 tribute/survivor', () => {
    const md = UNIT_DEFS['md-rattyfock'];
    expect(md.desc).toBeDefined();
    expect(md.desc).toMatch(/Season 1|survivor|tribute/i);
  });
});
