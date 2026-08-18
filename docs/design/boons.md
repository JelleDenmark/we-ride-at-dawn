# Daily PvP boons — design bank

Design bank for the daily boon system (issue #184). Written 2026-08-12, after the
patron/companion framing (#114) was dropped in favour of a bare choice screen.

Same status convention as `future-minions.md` for the design reasoning. The
system itself is now BUILT and measured — phases 1-6 shipped to `dev` over
2026-08-12/13, and the magnitudes for the original nine boons below are
measured values from `pvp:boons`, no longer placeholders.

Five more (Rust, Barren, Antidote, Stripped, First Blood) were added to Held
on 2026-08-14 from the roster-dimensionality pass below, then promoted into
Shipping on 2026-08-15 (owner call) on the strength of a DIRECTIONAL
`pvp:boons` pass — no dominance violation, but no magnitude sweep, and three
of the five likely undersold by the general population the same way Echo's
first population undersold it. Their magnitudes ARE still placeholders. See
the roster's Shipping section and "The 2026-08-14 pass" under measurement for
the full reasoning.

This file is the design bank. Issue #184 is the build spec. When they disagree, the
issue wins for *what gets built* and this file wins for *why*.

---

## What the system is

Every dawn, every player is offered **the same three boons** and picks **one**. The
pick applies to that night's 22:00 league round and nothing else. The three on offer
rotate daily, drawn from a shared pool.

The point is season identity without unit churn: under the nightly league, a boon is
the axis where your week diverges from five rivals who chose differently, and it costs
no new unit authoring to keep producing different weeks.

---

## Decided rules

Owner decisions (Jesper, 2026-08-12). Not open for re-litigation.

1. **Boons are PvP-only.** They apply inside `simulateDuel` and nowhere else. No
   gauntlet effect, no economy effect, no shop effect.
2. **Buffs resolve first; the opponent's positional manipulation resolves last.** A
   displacement boon can push a buffed rat off the front, but never erases the buff.
3. **Positional boons snapshot the line as submitted.** They read `units[0]` /
   `units[n-1]` once, before the sim starts. They never follow whoever is currently
   front.
4. **One pick per player per day.** No stacking, no carry-over, no combining.
5. **The three on offer are identical for every player**, derived from the ride-date.
   No per-player rolls, no rerolls.
6. **No grouping.** The trio is three draws from one flat pool. An
   aggressive/defensive/tactical split was considered and dropped as premature — it
   constrains authoring before there is any evidence about what the pool needs.
7. **No pick means no boon.** Never an auto-pick. A random default would hand the
   disengaged path an edge it didn't choose, which makes the mechanic dishonest.

### Why PvP-only is the load-bearing rule

A duel is **one wave** (`duel.ts`). A once-per-battle effect in a one-wave battle has
nothing to compound against, so ADR-0003's compounding law is structurally
inapplicable — which is what lets combat boons ship at all.

This inverts the earlier recommendation in #165, which favoured economy-only boons
and parked the combat ones. That reasoning assumed combat meant the 45-wave gauntlet,
where the compounding law bites hard. Narrowing scope to the duel removed the risk
rather than adding to it.

---

## The targeting principle

**A boon targets one end of a line, or the whole line — never an arbitrary slice.**

The narrow version of this rule ("positional boons only touch `units[0]` and
`units[n-1]`") is what was originally proposed, and it is correct for positional
boons specifically. The reason is worth being precise about, because it determines
how far the rule generalises:

Positional boons exist to **invalidate the opponent's ordering**. Ordering is the one
strategic lever a player fully controls, so a boon that can reach into the middle of
the line makes ordering unreasonable — you would have to hedge every slot. Restricting
manipulation to the two ends means you hedge your ends and the middle of your board
stays yours. That is what keeps the counter-play "protect your ends" rather than
"build interchangeable rats," which would collapse board diversity.

**Stat boons do not carry that risk** and are not restricted to the ends. A stat boon
that touches the whole team moves no rats and invalidates no ordering decision. It is
a legitimate shape.

What is ruled out in both cases is the **arbitrary slice** — "your last two," "the
middle three." A slice is neither an end (cheap to reason about) nor the whole line
(no reasoning needed); it is the shape that makes a board hard to think about for no
design gain. This is why the original `Rearguard` spec ("+attack on your last two")
trims to the backmost only.

---

## Roster

### Shipping

| Boon | Effect | Class |
|---|---|---|
| **Drag** | The opponent's `units[n-1]` moves to their `units[0]` | pre-sim lineup write |
| **Buried** | The opponent's `units[0]` moves to their `units[n-1]` | pre-sim lineup write |
| **A Body First** | A retired Gutter Runt is inserted at the front of your own line | pre-sim lineup write |
| **Silence** | The opponent's `units[0]` loses its ability for the duel | pre-sim instantiate flag |
| **Bulwark** | +X health on your `units[0]` | pre-sim stat write |
| **Blunt** | −X attack on the opponent's `units[n-1]` | pre-sim stat write |
| **Rearguard** | +X attack on your `units[n-1]` | pre-sim stat write |
| **Deep Scout** | Read every rival's exact roster for the day | client-only, no sim |
| **Guardian** | Block the first X incoming attacks on your side | adopts orphaned plumbing |
| **Rust** | Opponent, whole line, −X armor (`damageReduction`), floored at 0 | pre-sim stat write |
| **Barren** | Opponent's summon headroom cut to X for the duel, never raised | pre-sim cap write |
| **Antidote** | Self, whole line, X flat poison negation for the duel | adopts orphaned plumbing |
| **Stripped** | The opponent's `units[0]` loses its equipped unit relics for the duel | pre-sim instantiate flag |
| **First Blood** | Your `units[0]` resolves its opening blow before the return, wave's first tick only | trigger modifier |

**Rust through First Blood promoted 2026-08-15 (owner call, Jesper), ahead of
the follow-up work the pass below calls for.** No dominance violation on any
of three seeds either direction, but no magnitude sweep, and three of the
five (Barren, Stripped, First Blood) measured on the general population the
same way Echo did before it got its own summoner-only field — conditional by
design, so that population likely undersells them rather than proving them
weak. Shipped anyway; the magnitude sweep and the targeted-population passes
for the conditional three are still open, tracked below.

### Held

- **Long Knives** — your `units[n-1]` gains `backlineDamage` for the duel. Good shape
  and nearly free (it reuses the Slink-Rat / MBP Rat primitive exactly), and
  self-limiting by accident: that code sums base attack + relics + team attack +
  `attackBuffs` while deliberately excluding `tierAttackMultiplier`, so parking a 3★
  monster at the back yields its base attack, not 9×. Held only to keep the launch
  roster small.
- **About Face** — reverse the opponent's entire line. Held because on any board of
  three or more it strictly dominates Drag, and Drag is the better design: surgical,
  leaves the rest of the opponent's plan intact. Shipping both would make one dead.
- **Silence (backmost)** — a sibling that strips the opponent's `units[n-1]` ability.
  Held to ship after the frontmost version, so the two are not introduced as a
  confusing pair.
- **Echo** — the first unit summoned is summoned twice. Built, tested, and then
  held on measurement: 2 of 90 duels improved on summoner boards under one
  population, 3 of 210 under another, every percentile zero. Conditional was
  accepted as a design, but conditional should mean "strong when it applies",
  and one extra body in a ONE-WAVE duel almost never flips a result even on the
  boards built for it. Lives in `HELD_BOONS` with its tests, including its
  compounding-law canary. Restoring it needs a reason to be worth a pick — a
  magnitude knob, or a bigger effect than one body — not just moving the entry.

### Rejected, with reasons

- **Wheel** (rotate your own line by one) — strictly worse than building the board in
  that order in the first place. Any self-repositioning boon is dominated by the board
  editor. This generalises: **a boon must do something the player cannot already do
  for free.**
- **Shove** (swap the opponent's front two) — too small to notice. This is the exact
  failure that got the original anomaly trio (One Warren / Teeming Dark / Two Warrens)
  deleted on 2026-08-08 after shipping.

---

## Engine notes

Grounded against the code, 2026-08-12. These are the facts the roster leans on.

**The line is an ordered array and the clash is strictly front-vs-front.** `horde[0]`
against `enemies[0]` each tick; the dead rotate out and the next steps up. Everything
positional is therefore an array permutation applied before `simulateCore` is called.

**Drag hard-counters backline attackers for free.** The `backlineDamage` case in
`sim.ts` breaks when `index === 0` — a unit at the front already deals damage through
the normal clash, so the backline path is skipped to avoid a double-dip. It fires at
`startOfWave`, which is *inside* the sim and therefore after every pre-sim transform.
So dragging a backline attacker to the front disables its ability outright and exposes
its body. Two units carry it today: Slink-Rat and **MBP Rat** (`attack: 3, health: 1`),
which dies to the first clash tick once dragged.

**A Body First eats first-hit relic bonuses.** `firstAttackDone` is a per-unit flag,
and both `bonusOf` and `ignoresArmorOf` read it. The enemy front's first attack lands
on whatever is in front of it — so a decoy spends Glass Shard's armour-ignoring opener
on a 1-health body. The decoy must **not** count against `combatCap` (each duel board
carries its own, `sim.ts:405`) or the boon is a dud on full boards, which is most
boards by midweek.

**Silence strips the ability only, never relics.** Abilities come from `UNIT_DEFS` at
instantiate time, so Silence needs an optional per-entry flag on the Lineup that
`instantiate` respects — slightly deeper than an array write, still pre-sim, no
sim-logic change. Consequences worth stating in the copy: a silenced rat keeps
Marrow-Snap, keeps Glass Shard, and **keeps Weeping Boil** (`relics.ts:106` — it is a
relic, not a unit, so a silenced carrier still detonates on death). What Silence does
reach on the front slot is unit faint triggers: Brood-Mother's death-summon,
Bone-Priest's revive, and the runt faint payloads.

**Silence removes buffs, because a buff unit's buff *is* its ability** — and the front
slot turns out to be the right place to aim it, for a reason that is a property of the
engine rather than a coincidence. The split matters:

- **Position-dependent buffs are reliably hit.** `buffBehind` buffs the units behind
  its caster, so a `buffBehind` carrier wants to sit at or near the front to cover the
  most rats. That puts it exactly where front-Silence lands. This is why front-Silence
  is well-targeted rather than a coin flip.
- **Position-independent buffs are hit only by accident.** `teamBuff`, `teamBuffByWave`
  and `grantArmor { all: true }` fire the same wherever their caster stands, so
  front-Silence catches them only if the player happened to put that rat first.

The counter-play this creates is exactly the kind the system wants: *don't lead with
your team-buffer*. It is an ordering decision with a real cost, since a `buffBehind`
carrier gives up coverage by moving back. Note the boon fires pre-sim, so a silenced
buff never applies at all — there is no partial-buff or already-applied case to resolve.

**Guardian has no collision.** Ward-Weaver moved to `grantArmor` on 2026-07-24, leaving
`blockFrontHits` and the whole `blockCharges` machinery — pool, `shieldAbsorbed` event,
replay rendering — wired with zero shipped users. Guardian adopts it. The `Math.max`
cap-not-sum rule on that pool exists to stop stacked casters and is irrelevant to a
single non-stackable source.

**Positional boons re-target support buffs for free.** `buffAdjacent` and `buffBehind`
read a unit's live board position, so any displacement silently changes who the
opponent's support rats are buffing. Depth at no code cost.

**Boons cannot be aimed.** `scoreRound` is all-vs-all: every entrant duels every other
entrant once. A boon applies across all of a player's duels that night. Deep Scout
reads the field, not a target; Drag displaces every opponent's backmost.

---

## The choice screen

**Placement: not a dawn gate.** Boons are PvP-only, and at 06:00 the player has not
built the board the boon applies to — no shop seen, no idea what they can afford. A
gate at dawn maximises pick rate and minimises pick quality. Instead the card lives at
the top of the league panel with a persistent unpicked marker, and the screen surfaces
itself once the day's board sync settles. Unmissable, never between the player and the
ride.

**The trio stays readable all day, and after lock.** Players need to see what the three
options were while positioning their board, and after the round to reason about what
rivals could have taken. The screen is a permanent fixture of the day, not a one-shot
prompt.

**Picks are secret until the round is scored, then revealed in the replay.** Decided
2026-08-12, reversing an earlier draft that let the pick ride in the anon-readable
`pvp_boards.board` payload. A visible pick turns the choice into a counter-picking race
rather than a read; hiding it until reveal makes it a genuine simultaneous commitment.

This is a commit-reveal without any cryptography, because the server holds the secret:
the pick lives in its own table with no anon access, the nightly job reads every pick
under the service role, and the boon is written into the round's snapshotted boards —
which are already public post-round for the duel replay (`bbc9ee9`). So the reveal
surface already exists; the boon just has to ride along in the snapshot.

The honest cost: this gives up the cheapest part of the original plan. Riding in the
board jsonb meant no schema change and no new RPC. Secrecy means a new table plus a
write RPC and a read-own RPC, both security-definer and keyed on `device_id` (which is
no longer published to anon as of `b6489d8` — that is the boundary secrecy leans on).

**SUPERSEDED 2026-08-17 — see "Confirm-and-lock" below.** The section that followed
this one argued picks should stay freely changeable right up to the round. That turned
out to have a real hole: Deep Scout's information leaks the instant it's picked, so
"changeable" let a player scout, then swap to a real combat boon before the round
scored — banking both. Kept below for the historical reasoning (secrecy made the
original "lock on pick" concern moot), since the NEW design still relies on that same
conclusion; only the "therefore stay changeable" step is reversed.

~~**Picks stay changeable until 22:00.**~~ The decision survives the secrecy reversal but
its reasoning does not, so re-deriving it: the original argument was that public picks
would make "lock on pick" degenerate, since the correct play would be to pick last after
reading everyone else's commitment, and all six players would sit until 21:59. With
secret picks that argument is void — nobody can read anyone. What remains is simpler and
still points the same way: a changeable pick is a pure simultaneous-reveal game with one
lock moment shared with the board, and there is no longer any downside to weigh against
it.

### Confirm-and-lock (2026-08-17, owner call, Jesper)

Two bugs, reported together from the same screenshot, turned out to share one root
cause — the pick stayed mutable, client- and server-side, right up until the nightly job
happened to read it:

1. **Deep Scout cost nothing.** `scoutLevel` in the app derived the exact-roster reveal
   from whatever the DRAFT pick currently was, live, with no server round-trip needed to
   read it. A player could tap Deep Scout, read every rival's line, then tap back to
   Bulwark before the round scored — banking the scouting AND a real combat boon. Free
   information plus a combat boon is exactly the "must cost what it costs" failure the
   `Wheel` rejection already named for a different boon.
2. **The "until 22:00" copy was false.** `wrad-pvp-cron.yml` fires the nightly job ~22
   minutes before the advertised 22:00 slot on purpose (anti clock-sniping), and
   `submit_pvp_boon` deliberately had no close-time lock at all — the migration's own
   comment called it "a UI affordance, not a security boundary." A pick changed in that
   22-minute window looked to the player like it landed on time and had actually already
   missed the round.

**Fix: a pick is a DRAFT until explicitly confirmed, and confirming is a one-way door.**
`pvp_boon_picks` gained a `confirmed` column; `submit_pvp_boon` refuses any further write
— a different boon, or clearing back to no-pick — once `confirmed=true` for that
(season, ride_date, device). The nightly job's `fetchBoonPicks` now filters
`confirmed=eq.true`, so an unconfirmed draft can never silently score — that's the other
half of the fix, without it the confirm step would be theatre.

**Deep Scout's reveal is gated on `confirmed`, not on the draft pick.** This is the
actual fix for bug 1: the app only unlocks the exact-roster view once the pick reads
back as confirmed, so seeing the intel now IS spending the day's pick on it,
irrevocably. There is no window where you can look and still walk away with something
else.

**All boons lock the same way, not just Deep Scout.** Considered and rejected: a
Deep-Scout-only sticky rule, which closes the one boon with a real information leak but
leaves every other boon needing its own justification for why IT gets to stay
changeable. "Pick, then confirm, then it's tonight's boon" is one rule for all fourteen,
not a special case plus a general case.

**The deadline copy now states the real trigger, ~21:38 CET, instead of 22:00** — matching
`wrad-pvp-cron.yml`'s 19:38 UTC schedule (22 minutes ahead of the advertised slot, DST
ignored the same way the rest of this UI already treats "CET" as a year-round label for
the Copenhagen slot). The tradeoff named when this was scoped still applies: the cron
trigger has drifted before (this file's own history — GitHub's schedule queue running
~66 minutes late, a missed night on 2026-08-04) and could again, so a hardcoded clock
time in the copy can go stale the same way the trigger's own comment already hedges with
"≈". Accepted anyway, on the owner's explicit call, over dropping the number entirely.

**Copy.** One declarative sentence per card, in the game's voice, no numbers and no
category tags. Cards stack vertically — three across at phone width gives ~100px
columns and tap targets below the 44px floor. Colours from the tokens per ADR-0006.

**The overnight state is unspecified.** Rounds close at 22:00 but ride-dates roll at
06:00 (`currentRideDate`), leaving eight hours where the player's ride-date belongs to
a round that has already fought — the same seam that caused the 2026-07-21
no-rides-overnight bug. Most likely the same screen with the cards inert and the footer
swapped to a countdown, but it needs designing.

---

## Showing a boon in the replay

A boon is invisible unless something is built to show it, and the reason is
structural rather than an oversight: pre-sim transforms emit no `BattleEvent`s.
That is the property the whole safety argument rests on — boons never enter
`simulateCore`, so ADR-0003 has nothing to bite. But the replay renders the
event log, and the log begins after the boards have already been rearranged.

Left alone, each boon fails differently, and one of them fails badly:

- **Drag / Buried** are not merely invisible, they are misleading. The opening
  board render shows the post-transform order, so a viewer sees MBP Rat leading
  and concludes the player placed it there.
- **Silence** is the worst case: nothing on screen differs except an absence.
- **Bulwark / Rearguard / Blunt** show a rat with stats its def does not have,
  with no stated cause.
- **A Body First** shows a body that was not bought. The Gutter Runt swap helps
  here by accident — a retired rat nobody can buy is itself a hint.

Three options were weighed. **Naming the boon in the banner** is free and keeps
the sim untouched, but it tells you a drag happened without showing which rat
moved. **Emitting real events** would animate properly, but only by teaching
`simulateCore` about boons, which spends the exact property that makes them
safe. Neither is worth it.

What shipped is the third: `boardsForDuel` returns **its own account of what it
did** — moved this defId from index 2 to index 0 on that side, silenced this
one, granted this much to that one — surfaced as `DuelResult.boonNotes`. The
replay plays it as a scripted pre-battle beat before the log begins. The
transform stays pure, the sim stays ignorant, and the replay shows the movement
rather than a label.

Indices describe the board as it stood when that step ran, which matters when
both sides picked: a decoy shifts its own line before the opponent's drag reads
it, so the drag note reports the shifted index. Getting that wrong would point
the replay at the wrong rat.

**Still needed for Silence specifically.** A pre-battle beat that flashes past
does not carry an absence for the whole fight. The silenced rat needs a marker
on the board render itself, or the viewer forgets by the third clash and just
sees a rat that never did anything.

## What the measurement found

`pvp:boons` (`scripts/pvp-boon-matrix.ts`) generates its board population rather
than using the hand-authored comps, reports a distribution rather than a mean,
and gates on overlap: a boon whose p25 clears another's p75 is a pick you take
without thinking.

**Two fixture bugs of mine changed conclusions before any boon did.** Worth
recording because both looked like findings about the boons:

- The first population randomised board order, which is right for avoiding a
  fixture convention but is a *straw board* for positional boons. Under it,
  **Buried measured as a trap** — median -0.034, hurting 42 matchups. Against a
  tank-first population it is one of the better boons, +0.103 and helping 68.
  Against an unordered line Buried can promote a better rat than it demotes;
  real players lead with their toughest. Positional boons are judged tank-first.
- The first population handed out **no relics at all**, which made A Body First
  unmeasurable — it exists largely to spend the enemy's first-hit relic bonus on
  a worthless body, and that can never fire in a relic-free field.

**Measured magnitudes:** Bulwark 10 health, Blunt 14 attack, Rearguard 14
attack, Guardian 2 blocked hits (4 was dominant over six other boons).

**Unresolved, deliberately:** Silence is consistently the strongest and flags
against the two weakest on one of three seeds. It has no magnitude knob, so
tuning it means inflating everything else. Left as a live-data question —
`pvp_results.boon_id` gives pick rate for free, and six players cannot resolve
anything subtler than dominance anyway (#186).

### The 2026-08-14 pass: the five Held candidates (promoted 2026-08-15)

`pvp-boon-matrix.ts` extended to pull in `rust`/`barren`/`antidote`/`stripped`/
`first-blood` alongside the shipping nine (`HELD_CANDIDATES`, tagged `~` in the
table), so they're measured against the SAME live field rather than in
isolation. Three seeds (`boon-matrix-v1`, `alt-population-2`, `boon-matrix-v3`)
at the current placeholder magnitudes (Rust 4 armor, Barren 1 headroom,
Antidote 3 resist).

**No dominance violation involving any of the five, on any seed, in either
direction.** None ever appears on the winning side of a `!` line — they never
strictly outrank a shipping boon — but they also never get outranked so hard
it would read as a trap. Nothing here says "this is broken" — that's the bar
the promotion below actually leaned on, not a claim that magnitude tuning or
the conditional-population question was settled.

**Two read as solid already, on the general population alone:**
- **Antidote** — consistently net-positive on every field/seed combination
  (e.g. 40 helped / 1 hurt, 42/0, 32/1 across the three field-A runs) and
  essentially never backfires. The safest-looking of the five.
- **Rust** — smaller magnitude but the same shape: always more helped than
  hurt, never negative-trending, across all six field/seed runs.

**Three show Echo's exact shape — conditional-by-design, undersold by a
population that mostly doesn't trigger them:**
- **Barren** only moves anything on a board that both has a summoner AND has
  headroom to spare; most of the general population has neither, so it fires
  on roughly 5-9 of 30 boards per run (compare Echo's own summoner-only
  requirement, and its dedicated field C for exactly this reason).
- **Stripped** only matters against a front unit that actually carries a
  relic worth stripping. The population hands out a unit relic to about a
  third of units at random, but the FRONT specifically needs one — same
  fixture-bug shape #186 already found for A Body First in a relic-free
  population, just less severe here since this population does carry relics.
- **First Blood** only matters when the wave's opening blow is lethal against
  a real board (not a 1-hit fixture) — a narrow window against boards built
  from real health totals. Fires on roughly 7-27 of 870 duels per run, never
  once net-negative across all six runs.

**Not yet resolved:** whether any of these three would look different measured
the way Echo was — against a board population built to actually trigger them
(a summoner-heavy field for Barren, a relic-heavy front for Stripped, a
glass-cannon-heavy field for First Blood) rather than the general population.
Given the shape match to Echo, that's the obvious next step before writing any
of the three off OR promoting them. The general-population numbers above are
real, just possibly an underestimate the same way Echo's first population
was — see #186's "two fixture bugs" note above for why that distinction
mattered enough to change a real conclusion once already.

**Promoted to Shipping anyway, 2026-08-15 (owner call, Jesper).** The bar the
owner applied was narrower than "fully measured": no dominance violation is
enough to ship, the magnitude sweep and the conditional-population passes
above can happen with the boons live rather than gating their release. Six
players scouting each other daily also generates real pick-rate and
`pvp_results` data no synthetic population can — same argument #186 already
made for leaving Silence's magnitude as a live-data question rather than
tuning it blind. Recorded here rather than silently reversing the "safe to
leave Held" framing above, which was accurate for what it measured — the
decision moved past it, not around it.

## Proposal: day-gated magnitude pairs (not built, scoped 2026-08-15)

### The problem this answers

Every boon magnitude here is a FLAT number, but a duel board's stats scale
exponentially with tier (`tierAttackMultiplier`/`tierHealthMultiplier`,
~3^(tier-1)), and tier tracks the expedition day: `BOARD_GROWTH` and the real
economy mean a day-1 board is small and mostly tier-1, a day-6/7 board is
bigger and tier-2/3. A flat amount is therefore a HUGE fraction of a small
early stat and background noise against a large late one, by construction —
not a fixture artifact, a property of every flat-amount boon in the pool.

Measured directly (Dire-Rat-vs-Dire-Rat mirror, same tier both sides,
first-hit damage):

| Tier | Plain | Rust (-4 armor) | Swing |
|---|---|---|---|
| 1 | 2 | 4 | **+100%** |
| 2 | 8 | 12 | +50% |
| 3 | 30 | 34 | +13% |

And this is NOT new to Rust — **Bulwark, already shipped and already
"measured," has the identical curve**: +10 health flips a tier-1 or tier-2
Dire-Rat mirror from a mutual-kill draw into an outright win, and does
nothing at all at tier 3 (the board's health pool has outgrown 10 flat by
then). Nobody checked this for the original nine either; it surfaced only
because Jesper asked whether the win-rate sweep would have caught a day-1
power spike, and it wouldn't have — win/draw/loss scoring saturates, and a
population that mixes armor-carriers with everything else dilutes a spike
that's real on the boards where it applies.

**Decided (Jesper, 2026-08-15): ship flat magnitudes as-is for now** (see the
promotion note above) rather than block launch on this. This section is the
scoped follow-up, not a blocker.

### Two designs were on the table

**A. Thread the ride-date through scoring, magnitude as a function of day.**
Rejected — not because it's impossible, but because it reaches somewhere it
shouldn't have to. `boonEffect(boonId)` resolves a bare id to a fixed effect
with NO date input, called fresh at SCORING time by `boardsForDuel`/
`simulateDuel`, which `scoreRound` calls with just `LeagueEntrant.boonPick`
— a string. `LeagueEntrant`'s own doc comment states outright that
`scoreRound` "deliberately does not take" a ride-date. Making magnitude
day-dependent this way means either (a) `scoreRound`/`simulateDuel`/
`boardsForDuel`/`boonEffect` all gain a ride-date parameter so scoring
resolves the SAME magnitude the player was shown at pick time (real signature
churn across the whole scoring path, plus whatever the app layer's nightly-
job caller does outside `packages/core`), or (b) skip that and risk scoring
drifting from what was shown at pick time — a correctness bug, not a tuning
one. Either way this touches the determinism contract the whole PvP
anti-cheat story leans on (`simulateDuel`'s doc comment: "the client and the
nightly server job can independently re-simulate and agree"). Not something
to reach for under a deadline.

**B. Day-gate WHICH boon is offered, not what any boon resolves to (Jesper's
proposal) — two ordinary, date-agnostic `BoonDef` entries, mutually
exclusive by day.** This is the one to build. `boonEffect(id)` never changes
— every `BoonDef` stays a fixed, date-independent id→effect mapping, exactly
like today. The only date-aware code is `boonsFor(rideDate)`, which already
exists precisely to be the one date-aware boundary (rule 1 in the module
doc comment: "pure function of the ride-date... re-derivable anywhere with
no stored state"). Scoring, replay, and `boonEffect` are completely
untouched — zero risk to the determinism story, because a scored duel only
ever needs to resolve a fixed id it already knows about.

### Concrete shape, using Rust as the pilot

- **`rust`** (existing id, unchanged) — amount stays 4, now understood as the
  EARLY-week version. Keeping the id stable matters: any pick already
  recorded against `'rust'` (once this is live) keeps resolving to the same
  effect it always did — nothing about promoting an existing id to
  "day-gated" changes what that id itself means.
- **`rust-major`** (new id) — amount 8, the LATE-week version. A sibling
  entry, same shape as how Silence (backmost) is already a held sibling of
  Silence (frontmost) — two ids, never offered on the same day, so they
  never read as a confusing pair.
- **Day source: `weekdayFor(rideDate)` from `shop.ts`**, not a new day
  concept. Already the exact function `BOARD_GROWTH`/`unlockDay`/`retireDay`
  use for "which expedition day is this," pure, already tested, and
  importing it into `boons.ts` creates no cycle (`shop.ts` doesn't import
  `boons.ts`). Split: `rust` eligible days 1-3, `rust-major` eligible days
  4-7 — Jesper's exact split.
- **`boonsFor` changes shape slightly:** today it Fisher-Yates draws
  `BOONS_PER_DAY` straight over `Object.values(BOON_DEFS)`. It would need to
  FILTER the pool by day-eligibility first (most entries always eligible;
  a day-gated pair contributes exactly one of itself, never both, never
  neither), then draw over the filtered array — keeping the array the same
  LENGTH every day (swapping which entry occupies the "Rust" slot, not
  changing how many slots exist) is what keeps rule 4's "insertion order is
  the roll order" reasoning intact rather than needing new reasoning about
  what a variable-length pool does to historical days.
- **Test fallout, not just an implementation nicety:** `boons.test.ts`'s
  "does not lean hard on any one boon" bound (15-50% share over 120 days)
  assumes every entry is offerable every day. A day-gated id can only ever
  be drawn on its ~3-4 of 7 eligible days, so its ceiling share is lower by
  construction — the bound needs a per-id exception, not a blanket loosen,
  or a day-gated boon that's otherwise perfectly healthy will read as
  starved.

### Open questions this proposal does NOT answer yet

- **Decided (Jesper, 2026-08-15): all of the flat-magnitude stat boons or
  none — not a per-boon judgment call.** Applying day-gating to Rust alone
  while Bulwark/Blunt/Rearguard/Guardian/Barren/Antidote stay flat would make
  the pool inconsistent for no principled reason; the day-1-vs-day-7 swing is
  a property of "flat amount against exponentially-scaling stats," not of any
  one boon, so the fix scope is the whole class: **Bulwark, Blunt, Rearguard,
  Guardian, Rust, Barren, Antidote** (every `BoonEffect` carrying a numeric
  `amount`/`hits`/`headroom`). Drag/Buried/A Body First/Silence/Deep Scout/
  Stripped/First Blood are unaffected either way — nothing about them scales
  with a stat number. This turns the proposal from "spec one sibling pair"
  into "spec up to seven," each needing its own day-split numbers from a
  measurement pass (the 4→8 Rust split was Jesper's illustrative example, not
  yet re-derived per-boon) — real follow-up work, still not started.
- Exact day-1-3/4-7 split was Jesper's stated example, not re-derived from
  the swing table above — worth confirming against the actual tier
  distribution `boardCapForDay`/the real economy produces by each day,
  rather than assuming the swing curve is linear across days 1-7.
- Naming convention for the sibling id (`rust-major` here is a placeholder,
  not a commitment) and whether the card copy needs to say anything
  different between the two, given blurbs currently carry no numbers and no
  day information.

## The rotation: pool size, and the no-repeat rule (2026-08-16)

Two of the open questions below are now answered, measured against the real
`boonsFor` over 520 seasons (`pvp:boon-rotation`).

**Pool size is not the lever, and 14 is already past the useful ceiling.** A
season is 7 days x 3 offers = 21 slots, so the pool is bigger than one season
can show. Under the old unfiltered draw a player saw 11.4 of 14 boons a
season; growing the pool to 18 raises that to 12.9 but doubles what is never
seen at all (2.7 -> 5.1). Adjacent-day repeats fall only 0.66 -> 0.50 for
that. **Never add a boon for count. Only ever add one for coverage** — the
roster-dimensionality argument below is the only admissible reason.

**No boon repeats on consecutive days within a season (built).** An
independent daily draw clusters much harder than it reads: at 14 entries a
boon recurred the very next day two-thirds of the time, and launch week as
first derived offered **Silence on three consecutive dawns** — the pool's
strongest entry, and the one with no magnitude knob to tune it with. Three
identical cards in four days is not a rotation, and it would have been the
first thing players ever saw of the mechanic.

`boonsFor` now draws from the pool minus yesterday's three. This keeps rule 1
intact: still a pure function of the ride-date, just one that reads one day
further back. **The chain is cut at each season boundary** — expedition day 1
(Monday, `weekdayFor`) always draws from the full pool — which bounds the
recursion at six levels instead of letting it walk back to `BOON_FIRST_DATE`
and grow a level longer every day the calendar advances. The cost is that
Sunday->Monday may repeat; that is the right seam to spend, since a reset
already changes everything else about the week.

Side effect worth having: distinct boons seen per season rose 11.4 -> 12.4,
and launch week went from offering 11 of 14 to all 14.

**A 2-day exclusion window was measured and rejected.** It zeroes gap-2
repeats, but makes whole-trio repeats slightly WORSE (6.9% vs 6.5% of
seasons) while narrowing the daily draw to 8 candidates. The residual — the
same three cards twice in one week, which launch week does hit on 08-20 and
08-22 — is a **pool-size artifact, not a rule artifact**, and the only thing
that shrinks it is a bigger pool. Which loops back to: add for coverage.

## Roster dimensionality: the empty quadrant (2026-08-16)

Classifying the live 14 on two axes — which board a boon touches, and whether
it needs a particular build to do anything — leaves one cell empty:

| | works on anything | reads opponent's build | reads YOUR build |
|---|---|---|---|
| **self** | 5 | 2 (antidote, a-body-first) | **0** |
| **opponent** | 1 (blunt) | 6 | 0 |

**No boon rewards the board you built.** Opponent-side boons all read the
rival's build — their abilities (Silence), relics (Stripped), summoners
(Barren), armor (Rust), backline attacker (Drag). Self-side boons are all
*mass*: a number, a body, a shield, a timing flip, applied identically
whether you assembled a summon engine or seven Dire-Rats. So a pick makes you
think about your rival's board and never about your own, which halves the
strategic surface the mechanic could have.

**Echo is the only entry ever authored in that empty cell** (self-side, needs
a summoner) and it measured dead. That is a magnitude failure, not evidence
the axis is bad — and it matches what this file already concluded, that
restoring Echo needs "a magnitude knob, or a bigger effect than one body".

Secondary one-sided axes, each a denial with no counterpart: armor (Rust saps,
nothing grants — and armor scales with HIT COUNT, so it is the natural answer
to swarm boards, which nothing addresses), poison (Antidote negates, nothing
applies), summoning (Barren denies, Echo is held), information (Deep Scout
reveals, nothing conceals).

## A Body First: the design rationale was never on the evidence (2026-08-16)

This boon exists largely to spend the enemy front's FIRST-HIT relic bonus
(Glass Shard: +4 and ignores armor) on a worthless body. #186 already caught
one fixture bug here — the first population handed out no relics at all — and
recorded it as fixed once the population started handing out relics to about
a third of units.

**It was fixed in letter, not in substance.** A first-hit relic lands on a
board's FRONT about 5% of the time (33% relic chance x 1 of 7 unit relics),
and on the primary seed exactly **0 of 30 boards** have one. So the shipped
`pvp:boons` row for A Body First measures its chump-body and line-shift
effects only — never the mechanic it was designed around. Same shape as the
original bug, one level down, and it survived because A Body First is a
SHIPPING boon and the scrutiny went to the held ones.

Given the field-C treatment (`pvp:boon-fields`, every front carrying Glass
Shard) the rationale does hold — it improves on all three seeds:

| field | a-body-first | echo |
|---|---|---|
| general population | +0.070 / +0.006 / +0.021 | +0.034 / +0.044 / +0.030 |
| every front has Glass Shard | **+0.114 / +0.038 / +0.043** | +0.028 / +0.046 / +0.028 |
| every board has a summoner | +0.018 / **−0.029 / −0.018** | +0.049 / +0.045 / +0.026 |

Mean league points per duel, seeds `boon-matrix-v1` / `alt-population-2` /
`boon-matrix-v3`.

**Two findings that are not about magnitude:**

- **A Body First goes NEGATIVE against summoner boards** on two of three
  seeds, hurting 18-22 duels of 870. Mechanism NOT isolated — the two obvious
  candidates both died on inspection (no duel in this population resolves by
  survivor margin at all; `buffAdjacent` re-targeting is neutral for real
  units because the shifted carrier keeps its original target and merely wastes
  a second buff on the runt). A boon that is a trap against the most-fielded
  board shape of both leagued seasons is a worse problem than a weak boon.
  Open.
- **It is not board-agnostic, and the roster table above reflects that.** Its
  upside is conditional on the opponent's front carrying a first-hit relic and
  its downside on the opponent having summoners, so it belongs in "reads
  opponent's build" alongside Antidote, not in the reliable self-side column.

**Versus Echo, since the two look alike on paper (both "one extra body"):**
they are not the same shape. Echo is tiny but strictly non-negative — it hurts
0-4 duels of 870, ever. A Body First swings both ways and can genuinely cost
the duel. Echo's failure is "never worth the pick"; A Body First's risk is
"sometimes the wrong pick", which is the more dangerous of the two because it
punishes a player for engaging with the mechanic.

## Open

- The Silence marker on the board render (see the replay section above) — the
  last unbuilt piece.
- **Why A Body First goes negative against summoner boards** (see above).
  Unexplained, reproducible on two of three seeds.
- Whether Barren/Stripped/First Blood look different under `pvp:boon-fields`
  the way A Body First did — the tool now exists, the pass has not been run.
- **Coverage, not count: the empty self-side/reads-your-own-build quadrant.**
  Two or three entries there (an ability re-fire, relic amplification, a
  summon amplifier with Echo's shape but a magnitude that matters) would also
  shrink the whole-trio-repeat rate, which is the one rotation artifact the
  no-repeat rule cannot touch.
- The overnight/locked screen state.
- **Day-gated magnitude pairs, scoped for ALL seven flat-magnitude stat
  boons (Bulwark, Blunt, Rearguard, Guardian, Rust, Barren, Antidote) per
  Jesper's all-or-none call, not built.** Rust's `rust`/`rust-major` split
  (days 1-3 / 4-7) is the illustrative example, not yet re-derived for the
  other six. Flat magnitudes swing far harder on a day-1 board than a day-6
  one (measured: Rust doubles tier-1 damage, adds 13% at tier-3; Bulwark
  flips a mirror draw to a win at tier 1-2, does nothing at tier 3), and the
  proposed design avoids the correctness trap of the alternative (threading
  the ride-date through scoring) entirely, since it only touches `boonsFor`.
- X values for Rust, Barren, Antidote, Stripped and First Blood are still
  placeholders (`sim.ts`'s `BOON_DEFS`) even though all five are live —
  the 2026-08-14 `pvp:boons` pass measured direction (none is broken, two
  look solid, three look Echo-shaped) at the CURRENT placeholder magnitudes,
  but never swept alternate values the way Bulwark/Blunt/Rearguard/Guardian's
  shipped numbers imply happened for them. Still open, now against live data
  instead of gating the release.
- Whether Barren/Stripped/First Blood need Echo's field-C treatment (a board
  population built to actually trigger them) to get a real read, now that
  `pvp_results.boon_id` pick-rate data will start accumulating alongside
  whatever a targeted synthetic pass would show — see the pass write-up
  above.
- **First Blood's interaction with Drag/Buried needs to be stated at pick
  time, not just discoverable in the replay (Jesper, 2026-08-14).** First
  Blood binds to WHICHEVER unit is at `units[0]` when the wave's opening tick
  fires — which is after every pre-sim transform, including an opponent's
  Drag/Buried. So if a rival drags your backline attacker to the front, First
  Blood follows it there, not the rat you actually built your line around
  (confirmed against the engine: a dragged 1-health MBP Rat survived a fight
  it would normally trade even in, because its own hit landed first and the
  return never came). The card's one-sentence blurb convention (no numbers,
  no rules panel — see `BoonDef`'s doc comment) isn't the right place to spell
  this out. Decided: the patch note that announces First Blood's release
  states the ordering rule explicitly, rather than leaving it to be
  discovered in a replay. Draft language, ready for whenever First Blood
  actually ships (it is still Held, so nothing to announce yet):
  > **First Blood** resolves after every other pre-fight effect, including a
  > rival's Drag or Buried — so it always follows whichever rat is actually
  > standing at your front when the fight starts, not whichever one you
  > built your line around.
- **A real gap found while building this batch, not introduced by it:**
  `boonBlockHits` (Guardian) has no per-battle bound the way Echo's
  `echoSpent` flag gives Echo one — `blockCharges` is topped up fresh every
  wave regardless of `mode.kind`. If a `boonBlockHits`-carrying `Lineup` ever
  reached the 45-wave gauntlet (it structurally cannot today — nothing outside
  `boardsForDuel` writes it, and `validateBoard` refuses it on any submitted
  board), it would be a genuine per-wave repeating grant, not a bounded one.
  Caught because fixing a vacuous assertion in the Echo compounding-law canary
  (`boon-guardian-echo.test.ts` was comparing two `undefined`s) exposed it.
  Not fixed here — this file's batch didn't touch Guardian's engine code —
  but worth its own follow-up before this convention-only PvP-only boundary is
  leaned on any harder.

## A note on measuring boons

The pass/fail bar is that **no boon may be a dominant pick**. In a six-player league
where everyone scouts everyone, a single best boon is identified within a week and the
mechanic collapses into a mandatory tap.

But one boon resists the fixture sweep by construction. **Silence is read-dependent** —
against a vanilla front with no ability it does literally nothing, against a support
front it is devastating. It will measure poorly on an averaged sweep and well in live
play, so a sweep alone must not decide its fate. The same caution applies to Deep Scout,
whose entire value is information a simulation cannot act on.
