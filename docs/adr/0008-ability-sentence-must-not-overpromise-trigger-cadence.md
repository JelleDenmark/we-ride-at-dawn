---
status: accepted
---

# Ability sentences must match how often the effect actually fires, not how often the trigger is checked

Gutter Gourmand's inspect sheet read "At the start of every wave, it grants the whole horde +2/+1 ... plus +1/+1 more from wave 15 onward — both permanent for the rest of the ride" (reported 2026-08-10: "Nothing happens at the start of every wave"). The unit is a `teamBuffByWave` reskin of Twilight-Runt — it grants its buff exactly twice ever, gated by `source.waveBuffPhase` in `sim.ts`, not once per wave. The sentence was true of the *trigger* (`startOfWave` is checked every wave) and false of the *effect* (the effect only fires twice), and nothing caught the gap because `abilitySentence()` in `App.svelte` builds most sentences generically: `${TRIGGER_WHEN[trigger]} it ${what}${when}.` That template silently assumes the effect fires every time the trigger condition is met.

Several other effects already knew this and opted out with a bespoke sentence: `chargeWhileBenched`, `poisonResist`, `blockFrontHits`, and `distributeStatsOnFaint` all bypass the generic switch specifically because their own doc comments say the trigger-frame phrasing would misstate how often (or under what condition) they actually fire. `teamBuffByWave` was the one case that fell through the generic path uncaught — same class of bug, just not yet given the same treatment.

**Standing rule, in the ADR-0003/ADR-0006 mould:** before wiring a new `Effect` kind through `abilitySentence()`'s generic switch, check whether the effect fires exactly as often as its `trigger` is checked. If it doesn't — fire-once, phase-gated, capped, or conditioned on state the trigger name doesn't name (front/back position, wave count, charge totals, etc.) — write a bespoke `if (e.kind === '…') return …` branch above the switch instead, and lead the sentence with what actually happens rather than the trigger's literal cadence. `teamBuffByWave` now does this (see the branch and its comment in `App.svelte`, just above `backlineDamage`'s).

This is a copy-accuracy rule, not a balance change — no numbers moved, only which code path renders them. `abilitySentence()` remains the sole place a unit's ability is ever explained to a player (see the doc comment directly above it); this ADR is the rule for keeping that one generator honest as new effect kinds are added.
