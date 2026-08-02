// Canary for the keyword-family encoding (issue #166, ADR-0005) — the same
// shape of guard as compounding-law.test.ts next door: parametrized over the
// shipped defs, so a FUTURE unit is covered without anyone remembering to add
// a test.
//
// The point is that board legibility is a standing rule, not a one-off paint
// job. Adding a new `Effect` kind already fails typecheck (EFFECT_FAMILY and
// EFFECT_KEYWORD are `satisfies Record<Effect['kind'], ...>`); this file is
// the runtime half — that every kind actually REACHABLE from UNIT_DEFS and
// ENEMY_POOL resolves to a family, that every family has a colour, and that
// no two families share one. Two families sharing a colour would silently
// erase the distinction the whole encoding exists to draw, and nothing in the
// type system catches that.
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS, type UnitDef } from '../src/data/units';
import { ENEMY_POOL } from '../src/data/enemies';
import { RELIC_DEFS } from '../src/data/relics';
import {
  EFFECT_FAMILY,
  EFFECT_KEYWORD,
  FAMILY_COLOR,
  FAMILY_GLYPH,
  KEYWORD_FAMILIES,
  relicKeyword,
  unitKeyword,
} from '../src/data/keyword-family';

const ALL_DEFS: UnitDef[] = [...Object.values(UNIT_DEFS), ...ENEMY_POOL];

describe('keyword families', () => {
  it('classifies every effect kind reachable from the shipped defs', () => {
    const unclassified = ALL_DEFS.filter((def) => {
      const kind = def.ability?.effect.kind;
      return kind !== undefined && EFFECT_FAMILY[kind] === undefined;
    }).map((def) => `${def.id} (${def.ability?.effect.kind})`);
    expect(unclassified).toEqual([]);
  });

  it('names every effect kind reachable from the shipped defs', () => {
    const unnamed = ALL_DEFS.filter((def) => {
      const kind = def.ability?.effect.kind;
      return kind !== undefined && !EFFECT_KEYWORD[kind];
    }).map((def) => `${def.id} (${def.ability?.effect.kind})`);
    expect(unnamed).toEqual([]);
  });

  it('gives every family a colour and a glyph', () => {
    for (const family of KEYWORD_FAMILIES) {
      expect(FAMILY_COLOR[family], `${family} colour`).toMatch(/^#[0-9a-f]{6}$/);
      expect(FAMILY_GLYPH[family], `${family} glyph`).toBeTruthy();
    }
  });

  it('never gives two families the same colour', () => {
    const colors = KEYWORD_FAMILIES.map((f) => FAMILY_COLOR[f]);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('never gives two families the same glyph', () => {
    const glyphs = KEYWORD_FAMILIES.map((f) => FAMILY_GLYPH[f]);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('resolves a keyword for every unit with an ability', () => {
    const silent = ALL_DEFS.filter((def) => def.ability && unitKeyword(def) === null).map(
      (def) => def.id,
    );
    expect(silent).toEqual([]);
  });

  // Flat `damageReduction` is a bare UnitDef field, not an Ability, so an
  // armored body with no ability (Dire-Rat and friends) has to fall through to
  // the defence family rather than rendering a blank tile.
  it('treats a bare armored body as defence', () => {
    const armoredNoAbility = ALL_DEFS.filter((d) => !d.ability && (d.damageReduction ?? 0) > 0);
    expect(armoredNoAbility.length).toBeGreaterThan(0);
    for (const def of armoredNoAbility) {
      expect(unitKeyword(def)?.family, def.id).toBe('defence');
    }
  });

  it('renders a keyword as glyph + label', () => {
    const kw = unitKeyword(UNIT_DEFS['steel-whisker']);
    expect(kw).toMatchObject({ family: 'offence', label: 'thorns', text: '⚔ thorns' });
    expect(kw?.color).toBe(FAMILY_COLOR.offence);
  });

  // Relics reuse the unit families rather than getting a second vocabulary.
  // `RelicDef.family` is required, so the compiler already refuses a new
  // relic without one — this catches the runtime hole that leaves: a bad
  // cast, or a hand-written def that predates the field.
  it('gives every relic a real family', () => {
    const bad = Object.values(RELIC_DEFS)
      .filter((r) => !(KEYWORD_FAMILIES as readonly string[]).includes(r.family))
      .map((r) => `${r.id} (${r.family})`);
    expect(bad).toEqual([]);
  });

  it('resolves a relic keyword to its family colour and glyph', () => {
    for (const relic of Object.values(RELIC_DEFS)) {
      const kw = relicKeyword(relic);
      expect(kw.family, relic.id).toBe(relic.family);
      expect(kw.color, relic.id).toBe(FAMILY_COLOR[relic.family]);
      expect(kw.glyph, relic.id).toBe(FAMILY_GLYPH[relic.family]);
    }
  });

  // Dawn-Runt/Dusk-Runt swap the glyph for a time-of-day one; the family (and
  // therefore the colour) must NOT change with it.
  it('keeps the buff family when a time-of-day glyph replaces the family glyph', () => {
    const dawn = unitKeyword(UNIT_DEFS['dawn-runt']);
    const dusk = unitKeyword(UNIT_DEFS['dusk-runt']);
    expect(dawn).toMatchObject({ family: 'buff', glyph: '☀', text: '☀ buff' });
    expect(dusk).toMatchObject({ family: 'buff', glyph: '☾', text: '☾ buff' });
    expect(dawn?.color).toBe(FAMILY_COLOR.buff);
    expect(dusk?.color).toBe(FAMILY_COLOR.buff);
  });
});
