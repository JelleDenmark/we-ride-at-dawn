/**
 * Keyword families (issue #166) — the game's one classification of what a
 * Unit *does*, shared by every surface that lists Units.
 *
 * Why this lives in core and not in the UI: the mapping started life as
 * `keywordTag()` inside `App.svelte`, which meant it could not be tested and
 * nothing stopped it drifting from the `Effect` union it claims to classify.
 * Core owns `UnitDef` and `Effect`, so the classification belongs next to
 * them — and `EFFECT_FAMILY`/`EFFECT_KEYWORD` below are written with
 * `satisfies Record<Effect['kind'], ...>` so the COMPILER refuses a new
 * effect kind until it has been classified and named. `test/keyword-family.
 * test.ts` is the runtime half of the same guard (colours present, colours
 * distinct, every kind actually reachable from the shipped defs).
 *
 * Why keyed off effect kind and NOT `archetype` or `tribe` (both of which
 * look like they'd do the job):
 *   - `UnitDef.archetype` is set on ENEMIES only — 15 defs in `enemies.ts`,
 *     zero player rats. It classifies what a Wave leans toward, not what a
 *     Rat does.
 *   - `UnitDef.tribe` is an untyped `string` present on roughly half the
 *     roster, described in `units.ts` as a tag the UI never surfaces; later
 *     reworks moved away from it.
 * Neither covers the roster. Every Unit with an Ability has exactly one
 * effect kind, so the effect union does.
 *
 * ADR-0005 is the standing rule this enables: every unit-facing surface
 * states its keyword family in colour, and a new Rat declares its family
 * rather than inventing a fresh encoding.
 */
import type { Effect, UnitDef } from './units';

export type KeywordFamily = 'poison' | 'defence' | 'offence' | 'summon' | 'buff' | 'sustain';

export const KEYWORD_FAMILIES = [
  'poison',
  'defence',
  'offence',
  'summon',
  'buff',
  'sustain',
] as const satisfies readonly KeywordFamily[];

/**
 * Every hex below is lifted from a sprite already in
 * `packages/app/src/replay/art/`, so the UI reads as the same palette the
 * art does instead of a second, drifting one:
 *   poison   plague-bearer.svg     defence  grate-golem.svg
 *   offence  steel-whisker.svg     summon   watch-whelp.svg
 *   buff     muster-herald.svg     sustain  draughtsman-moe.svg
 *
 * Offence's red was originally only in `md-rattyfock.svg`, which is a
 * dormant reskin kept for replay compatibility (see units.ts) — it was
 * re-homed onto Steel-Whisker's thorn tips as part of #166 so the colour
 * still has a living source sprite.
 *
 * The colours must stay mutually distinct — that is the whole point of the
 * encoding, and `keyword-family.test.ts` enforces it.
 */
export const FAMILY_COLOR = {
  poison: '#6fae3a',
  defence: '#5f7288',
  offence: '#a34a3f',
  summon: '#b9a78f',
  buff: '#c9a24a',
  sustain: '#9a5fb0',
} satisfies Record<KeywordFamily, string>;

/**
 * One glyph per family, from the game's existing restrained-glyph vocabulary
 * (⚙ ❄ ✦ ★) — not illustrated icons or emoji. Colour carries the family for
 * a sighted player at a glance; the glyph carries it for anyone who can't
 * separate these hues, which is why both are always rendered together.
 */
export const FAMILY_GLYPH = {
  poison: '☠',
  defence: '⛨',
  offence: '⚔',
  summon: '❋',
  buff: '▲',
  sustain: '✚',
} satisfies Record<KeywordFamily, string>;

/**
 * `satisfies Record<Effect['kind'], KeywordFamily>` is load-bearing: adding a
 * member to the `Effect` union in units.ts fails typecheck here until it is
 * classified. That is the mechanism that keeps this from decaying into a
 * one-off paint job the next unit quietly breaks.
 */
export const EFFECT_FAMILY = {
  summon: 'summon',
  maintainSummons: 'summon',
  summonScaledPup: 'summon',
  buffSummoned: 'summon',
  poisonFrontEnemy: 'poison',
  poisonLastEnemy: 'poison',
  poisonTarget: 'poison',
  poisonAllEnemies: 'poison',
  blockFrontHits: 'defence',
  grantArmor: 'defence',
  poisonResist: 'defence',
  backlineDamage: 'offence',
  reflectDamage: 'offence',
  buffBehind: 'buff',
  buffAdjacent: 'buff',
  gainStats: 'buff',
  bequeathAttack: 'buff',
  chargeWhileBenched: 'buff',
  teamBuff: 'buff',
  teamBuffByWave: 'buff',
  distributeStatsOnFaint: 'buff',
  revive: 'sustain',
  healSelf: 'sustain',
} satisfies Record<Effect['kind'], KeywordFamily>;

/**
 * The 1-2 word label shown on a tile. Several kinds deliberately share one
 * label (all four poisons read "poison") — the tile is a glance, and the full
 * sentence lives in the inspect sheet (`abilitySentence` in App.svelte).
 */
export const EFFECT_KEYWORD = {
  summon: 'summon',
  maintainSummons: 'summon',
  summonScaledPup: 'summon',
  buffSummoned: 'train',
  poisonFrontEnemy: 'poison',
  poisonLastEnemy: 'poison',
  poisonTarget: 'poison',
  poisonAllEnemies: 'poison',
  blockFrontHits: 'block',
  grantArmor: 'armor',
  poisonResist: 'ward',
  backlineDamage: 'snipe',
  reflectDamage: 'thorns',
  buffBehind: 'buff',
  buffAdjacent: 'buff',
  gainStats: 'buff',
  bequeathAttack: 'buff',
  chargeWhileBenched: 'buff',
  teamBuff: 'buff',
  teamBuffByWave: 'buff',
  distributeStatsOnFaint: 'buff',
  revive: 'revive',
  healSelf: 'drain',
} satisfies Record<Effect['kind'], string>;

/**
 * Dawn-Runt/Dusk-Runt swap the family glyph for a time-of-day one, since
 * *when* the buff applies is the whole point of those two. Family is still
 * `buff` — only the glyph changes.
 */
const TIME_OF_DAY_GLYPH: Record<string, string> = { beforeNoon: '☀', afterNoon: '☾' };

export type UnitKeyword = {
  family: KeywordFamily;
  /** Family glyph, or the time-of-day variant for a conditional `teamBuff`. */
  glyph: string;
  label: string;
  color: string;
  /** `${glyph} ${label}` — what a tile renders. */
  text: string;
};

/**
 * The keyword for a Unit, or `null` for a plain body with nothing to say.
 *
 * The `damageReduction` fallback matters: flat armor is a bare `UnitDef`
 * field, not an Ability, so armored bodies with no ability (Dire-Rat and
 * friends) would otherwise read as blank tiles despite being defence units.
 */
export function unitKeyword(def: UnitDef): UnitKeyword | null {
  const ability = def.ability;
  if (ability) {
    const kind = ability.effect.kind;
    const family = EFFECT_FAMILY[kind];
    const glyph =
      kind === 'teamBuff' && ability.condition?.timeOfDay
        ? (TIME_OF_DAY_GLYPH[ability.condition.timeOfDay] ?? FAMILY_GLYPH[family])
        : FAMILY_GLYPH[family];
    const label = EFFECT_KEYWORD[kind];
    return { family, glyph, label, color: FAMILY_COLOR[family], text: `${glyph} ${label}` };
  }
  if ((def.damageReduction ?? 0) > 0) {
    return {
      family: 'defence',
      glyph: FAMILY_GLYPH.defence,
      label: EFFECT_KEYWORD.grantArmor,
      color: FAMILY_COLOR.defence,
      text: `${FAMILY_GLYPH.defence} ${EFFECT_KEYWORD.grantArmor}`,
    };
  }
  return null;
}

/** Convenience for surfaces that only need the colour (a tile edge, a chip). */
export function keywordFamily(def: UnitDef): KeywordFamily | null {
  return unitKeyword(def)?.family ?? null;
}

/**
 * The keyword for a RELIC. Relics reuse the unit families rather than getting
 * a second vocabulary — pinning Glass Shard to a rat genuinely does make that
 * rat more offensive — so a player learns one encoding, not two that nearly
 * rhyme.
 *
 * Takes a structural `{ family }` rather than `RelicDef` on purpose:
 * `relics.ts` imports `KeywordFamily` from here, and importing `RelicDef`
 * back would close a module cycle for no gain. Unlike a unit, a relic can
 * never be family-less — `RelicDef.family` is required, which is the whole
 * enforcement — so this returns `UnitKeyword`, never null.
 */
export function relicKeyword(relic: { family: KeywordFamily }): UnitKeyword {
  const glyph = FAMILY_GLYPH[relic.family];
  // Relics carry the family GLYPH, not the ✦ the UI stamps on them as a
  // "this is an item" marker — the two say different things and both are
  // rendered, so neither has to do the other's job.
  return {
    family: relic.family,
    glyph,
    label: relic.family,
    color: FAMILY_COLOR[relic.family],
    text: `${glyph} ${relic.family}`,
  };
}
