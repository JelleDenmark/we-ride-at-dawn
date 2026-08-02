---
status: accepted
---

# UI surfaces come from tokens; component styles carry no raw hex

`app.css` was 19 lines with five tokens while roughly 130 hardcoded hexes sat in a 1300-line `<style>` block in `App.svelte` — including seven near-identical darks (`#1a140f`, `#1c150f`, `#191310`, `#1d1713`, `#17110d`, `#14100c`, `#100d0a`) that no one had chosen so much as arrived at. The visible result was a screen of matte fills with uniform 8px radii, no texture and no light source: the pitch says grimy dark-fantasy and the drains, and the UI said "div". Nothing forced the drift; nothing would have stopped the next panel adding an eighth brown.

The ramp in `packages/app/src/app.css` is now the whole palette. Component styles reference tokens and carry no raw hex of their own. `packages/core/test/ui-tokens.test.ts` fails the build on a new one, and also fails on a `var(--…)` that app.css does not declare, so the two halves cannot drift apart.

This is a standing constraint, in the ADR-0003 mould:

- **New panels, screens and states pick from the token set, or extend it deliberately.** Extending means adding to the ramp in `app.css` with the rest — not introducing a one-off brown at the call site. Pick by *depth* (`--well` → `--surface` → `--surface-lit`), not by component name.
- **The atmosphere layers are global, never per-panel.** Grain, lamp and vignette are fixed to the shell in `app.css`. A panel that paints its own light stops the screen reading as one place, which is the entire point of the pass.
- **Because `--sheen` is a background-IMAGE, state rules swap `background-color`, never the `background` shorthand** — a shorthand silently wipes the sheen and flattens the surface back to a fill. Same for `box-shadow`: a state that adds a glow must re-state the wet-metal insets (see `.unit-tile.maxed`).
- **The one declared exception is the `--family` / `--family-text` pair**, set inline per tile from `FAMILY_COLOR` and `FAMILY_TEXT_COLOR` in core. The keyword palette has exactly one home and it is ADR-0005's, not this one. Use `--family` for graphical marks and `--family-text` for anything rendered as glyphs or words — the split exists precisely because the contrast floor below is different for the two.
- **Sprites stay on their side's ramp** — warm browns for rats, cool blue-greys for enemies. Documented in [`docs/design/sprite-ramps.md`](../design/sprite-ramps.md) and enforced by `packages/core/test/sprite-ramps.test.ts`, with a declared-outlier escape hatch that is checked in both directions so it cannot rot.

**Contrast note.** Grain over 10px `--ink-dim` text on `--surface` is the combination most likely to fall below legibility, and a desktop monitor is a bad place to judge it. `--grain-opacity` is the single dial; the grain layer is dropped entirely under `prefers-reduced-motion` (a fixed overlay over a scrolling page shimmers) and `prefers-contrast: more`. Anything under 12px belongs at `--ink-dim` or brighter — `--ink-faint` is placeholder text only.

This rule shipped as prose here and was violated the same day by three of the six sprite-true family hexes, on the 10px keyword line that ADR-0005 had just made load-bearing. It is now **measured, not asserted in a comment**: `keyword-family.test.ts` computes the WCAG ratio for every family text colour against `--surface` and fails below 4.5:1. A prose rule about contrast that nothing evaluates is a rule that gets broken by the next colour that looks fine on a desk monitor.

Purely presentational: no game logic, no balance impact, no data migration. `color-scheme: dark` is permanent; there is no light theme to maintain.
