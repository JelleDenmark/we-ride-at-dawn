# Sprite ramps

The documented palette for `packages/app/src/replay/art/*.svg`, enforced by `packages/core/test/sprite-ramps.test.ts` and referenced by [ADR-0006](../adr/0006-ui-comes-from-tokens.md).

Side-reads-as-colour is the one thing in the current visual identity that already works: at 40px on a phone, in a replay where bodies are moving, hue is what tells a player which line is theirs. It happened by convention rather than by rule, which is exactly the kind of thing that survives right up until the first new sprite quietly breaks it.

## The two ramps

**Rats — warm browns.** Hue 8–50.

| Role | Hex |
| --- | --- |
| Outline | `#201209` |
| Shadow fur | `#5e3120` |
| Base fur | `#8a4b2f` |
| Mid fur | `#7a4128` |
| Highlight | `#b4715a` |

**Enemies — cool blue-greys.** Hue 205–215.

| Role | Hex |
| --- | --- |
| Deep shadow | `#1a222b` |
| Shadow | `#2a3540` |
| Base | `#33414f` |
| Mid | `#46586e` |
| Highlight | `#5f7288` |
| Rim | `#8a97a6` |

## Shared accents

These sit outside both ramps on purpose and are available to either side — they carry meaning, not identity:

| Accent | Hex | Reads as |
| --- | --- | --- |
| Bone | `#e8e2cf` | skulls, teeth, bandages |
| Cloth / rope | `#b9a78f` | tabards, sacks, bindings |
| Brass | `#c9a24a`, `#d4af37` | horns, charms, insignia |
| Blood | `#8a2f2f`, `#a34a3f` | wounds, the offence keyword family |
| Blight | `#6fae3a`, `#7a9a4e` | poison, boils, rot |
| Steel | `#7d8792`, `#b9c2ca` | armor plate, blades |

## What the guard actually checks

Per sprite, every colour with meaningful saturation is bucketed by hue: **warm** (0–60° or 330–360°), **cool** (180–260°), or neither (greens, purples, near-greys — all unbucketed and ignored). A rat sprite must have at least as many warm colours as cool ones; an enemy sprite, the reverse. Plus: no pure `#000` or `#fff` anywhere, and every id in `UNIT_DEFS` and `ENEMY_POOL` has a matching `<id>.svg`.

It counts distinct colours, not pixel area, and it is deliberately a *majority* test rather than a whitelist. Hand-drawn art needs room — Blight-Witch is mostly purple, Plague-Bearer mostly green, Steel-Whisker half blue-grey steel, and all three are correct as drawn. A hard allowlist would have rejected every one of them.

## Declared outliers

The escape hatch is "declare the exception", not "forbid it". A sprite that fails the majority test is fine as long as it is listed in `DECLARED_OUTLIERS` in the test with a reason. The list is checked in both directions: a sprite that stops needing its exception fails the test too, so entries cannot quietly rot.

| Sprite | Why |
| --- | --- |
| `dusk-runt` | Cold moonlight is the whole unit. Its twin `dawn-runt` carries the warm half of the pair. |
| `draughtsman-moe` | Prestige reskin of Blight-Witch (issue #115) with an owner-specced blue coat; the purple/green blight palette it inherits leaves no warm majority. |

If you are adding a sprite and reaching for this table, the question to answer first is whether the outlier is doing narrative work (as both of these are) or whether the sprite has simply drifted off-ramp.
