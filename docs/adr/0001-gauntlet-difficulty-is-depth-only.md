---
status: accepted
---

# Gauntlet difficulty scales with Wave depth only — not with Day or calendar date

The Gauntlet used to be regenerated per calendar date, which meant a fixed Horde could see up to an 11-wave Depth swing purely from re-rolling the same Day (issue #41) — nothing about the player's Horde changed, but the answer did. We fixed this by keying Gauntlet generation off the *Season* (the Monday that starts the current 7-day period) instead of the date, making the whole 45-wave Gauntlet byte-identical for every Ride across all 7 days of a Season.

Having removed date-to-date noise, we went further and set `difficultyForDay` to a constant `1` rather than keeping a modest per-Day ramp: since the leaderboard metric is max Depth over the whole Season, a Day-based difficulty ramp would let players "peak early and coast," rewarding *when* you play over *how deep you push*. `difficultyForDay` is kept as a function (not inlined) purely for API stability — reintroducing Day-scaling later is a one-line change if ever revisited, but the deliberate default is that Depth position is the only difficulty axis; Day only governs the Shop/Board-cap economy, never the Gauntlet itself.
