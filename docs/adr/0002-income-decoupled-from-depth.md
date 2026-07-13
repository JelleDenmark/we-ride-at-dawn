---
status: accepted
---

# Scrap income diminishes with Depth; leaderboard Score does not

Early on, Scrap income was a flat multiple of Depth (`SCRAP_PER_DEPTH`), which meant the same enemy-scaling changes that let a strong Horde push deeper also snowballed its bank — a deeper Ride was rewarded twice, once on the leaderboard and once in the Shop. This became a blocker for issue #92 (softening the enemy HP wall for deep-run headroom): any softening pass had to touch leaderboard-relevant Depth and economy-relevant income together, at deep risk of both a leaderboard blowout and an unwanted scrap glut.

We split the two: `scrapForDepth(depth)` pays full rate up to `SCRAP_FULL_DEPTH` waves and a diminished `SCRAP_DEEP_RATE` beyond that, while the leaderboard Score stays raw Depth (`wavesCleared`), untouched by the income curve. This means enemy-scaling and Board-growth tuning can move Depth freely (for prestige/leaderboard purposes) without independently having to re-tune the whole Scrap economy every time — the two levers are now orthogonal. `SCRAP_FULL_DEPTH=8` was chosen as a deliberate mild surplus over the income-neutral value, so a merge-fishing player has Scrap to chase a Tier-3 Rat rather than banking an unspendable pile.
