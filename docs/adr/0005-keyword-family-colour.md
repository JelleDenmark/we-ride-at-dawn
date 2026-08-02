---
status: accepted
---

# Every unit-facing surface states its keyword family in colour

A full Board was five identical brown boxes: the sprite is 40px of an 86px tile and everything else was 10–12px text on the same `#241a14` ground, so nothing on screen distinguished a poison Rat from an armor Rat from a summoner — and nothing marked the front Rat, even though only the frontmost Unit ever Clashes. Every Unit was already classified (the old `keywordTag()` in `App.svelte` mapped Effect kinds to 13 labels), but that classification lived inside a Svelte component: untestable, invisible to the compiler, and free to drift from the `Effect` union it claimed to cover.

We now treat the **Keyword Family** — `poison | defence | offence | summon | buff | sustain` — as the game's one classification of what a Unit does, owned by `@wrad/core` (`data/keyword-family.ts`) alongside `UnitDef` and `Effect`. It is keyed off the Ability's effect kind, deliberately not `archetype` (set on Enemies only — 15 defs, zero player Rats) and not `tribe` (an untyped string on roughly half the roster that the UI never surfaced). Each family owns exactly one colour and one glyph, and both are lifted from sprites already in `packages/app/src/replay/art/`, so the UI and the art read as one palette instead of two drifting ones.

This is a standing constraint on new work, not a one-off paint job:

- A new Rat declares a family. Adding a member to the `Effect` union fails typecheck until it appears in `EFFECT_FAMILY` and `EFFECT_KEYWORD` (both written with `satisfies Record<Effect['kind'], …>`), and `packages/core/test/keyword-family.test.ts` is the runtime half — every kind reachable from `UNIT_DEFS`/`ENEMY_POOL` resolves, every family has a colour, no two families share one.
- Any new surface that lists Units — Shop, Bench, compendium, scout, PvP scouting — takes its colour from `UnitKeyword.color` rather than inventing its own encoding. A second colour vocabulary for the same concept is the failure mode this exists to prevent.
- Colour never carries a meaning alone. The family glyph (`☠ ⛨ ⚔ ❋ ▲ ✚`) ships with it everywhere, so the encoding survives a player who cannot separate these hues.
- A family colour keeps a living source sprite. Offence's red was re-homed off the dormant `md-rattyfock.svg` reskin onto Steel-Whisker's blooded whisker tips when this shipped; retiring a Unit whose sprite is a family's only source means moving the colour first.

Purely presentational: no game logic, no balance impact, no data migration.
