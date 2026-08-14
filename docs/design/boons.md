# Daily PvP boons — design bank

Design bank for the daily boon system (issue #184). Written 2026-08-12, after the
patron/companion framing (#114) was dropped in favour of a bare choice screen.

Same status convention as `future-minions.md` for the design reasoning. The
system itself is now BUILT and measured — phases 1-6 shipped to `dev` over
2026-08-12/13, and the magnitudes for the nine SHIPPING boons below are
measured values from `pvp:boons`, no longer placeholders.

Five more (Rust, Barren, Antidote, Stripped, First Blood) were added to
**Held** on 2026-08-14 from the roster-dimensionality pass below — built and
tested the same way the shipping nine were, but not yet run through
`pvp:boons`, so their magnitudes ARE still placeholders. See the Held section
of the roster for the reasoning behind each.

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

The five below are held for the OPPOSITE reason Echo is: not measured and found
wanting, but not yet measured at all. Added 2026-08-12 from the
roster-dimensionality pass (#181/#182's "one axis" diagnosis), each one closes a
specific gap the launch nine left open rather than adding another effect on top
of what the pool already had. Built and tested exactly like a shipping boon —
`HELD_BOONS`, resolved by `boonEffect`, covered in `boon-ideas.test.ts` — with
every magnitude a PLACEHOLDER pending a `pvp:boons` pass. Moving one to Shipping
is the same one-line move restoring Echo would be.

- **Rust** — opponent, whole line loses flat armor (`damageReduction`),
  floored at 0 per unit. Closes the largest hole in the game, not just in this
  pool: nothing anywhere answers stacked flat armor (three ★3 Ward-Weavers put
  +18 `damageReduction` on every rat, and with `MIN_ATTACK_DAMAGE` at 1 that
  converts survival into health-in-ticks). Unlike Silence it cannot be dodged
  by standing somewhere else, which is the point — the grants worth answering
  are precisely the ones that ignore position. A whole-line stat write, so the
  targeting principle's end-vs-whole-line split doesn't restrict it, the same
  way Bulwark/Rearguard/Blunt aren't restricted despite being single-end.
- **Barren** — opponent's summon headroom (`combatCap` above however many rats
  they deployed) cut for the duel, never raised. Echo amplifies summoning and
  nothing in the pool opposes it, while summoners are the most-fielded board
  shape of both leagued seasons — this is that missing half. A cap READ, not a
  slice, so it sits outside the targeting principle entirely. Worth nothing
  against a board with no summoner, same accepted shape as Echo.
- **Antidote** — self, whole line, flat poison negation for the duel. Adopts
  orphaned plumbing rather than adding any: `poisonResistApplied` is already a
  per-side, per-wave, cap-not-sum budget (Gutter-Acolyte's `poisonResist`), so
  this seeds the same pool instead of reimplementing it. Also doubles as the
  free-of-body-cost probe #155 never ran — isolating whether the RESIST is too
  weak from whether the ACOLYTE's body is too weak, which no prior change
  could tell apart.
- **Stripped** — opponent's `units[0]` loses its equipped unit relics for the
  duel; team relics untouched. Relics are unconditional picks on a mature
  board and nothing in the pool denies one. Silence deliberately leaves relics
  alone (a silenced rat keeps Marrow-Snap, Glass Shard, Weeping Boil), so this
  opens the denial axis Silence stops short of — the two read as a deliberate
  pair, not a redundant one. Implemented as a pre-`instantiate` relic filter
  rather than a post-hoc patch, since relic stats are baked into a `BattleUnit`
  at that point.
- **First Blood** — self, `units[0]` resolves its opening blow before the
  return, on the wave's first clash tick only. The clash is normally
  simultaneous (a 9/1 and a 1/9 trade identically — both die); this makes
  attack a DEFENSIVE stat for one tick, a genuinely new axis, and a structural
  counter to 1-attack swarm bodies. Bounded to a single clash by construction
  — the clearest case yet of the boon layer shipping something the 45-wave
  gauntlet could not safely hold. Both sides picking it cancels out rather
  than compounding, keeping an identical mirror board a draw. The highest-risk
  entry here: it touches the clash loop's net-damage floor clamp directly, so
  it shipped with its own compounding-law canary (`currentWave === 1`, not
  merely `ticks === 1` — `ticks` resets every wave, so the weaker check would
  have re-fired on every wave's opening tick if the flag ever reached a
  multi-wave gauntlet battle).

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
its body. Two units carry it today: Slink-Rat and **MBP Rat** (`attack: 4, health: 1`),
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

**Picks stay changeable until 22:00.** The decision survives the secrecy reversal but
its reasoning does not, so re-deriving it: the original argument was that public picks
would make "lock on pick" degenerate, since the correct play would be to pick last after
reading everyone else's commitment, and all six players would sit until 21:59. With
secret picks that argument is void — nobody can read anyone. What remains is simpler and
still points the same way: a changeable pick is a pure simultaneous-reveal game with one
lock moment shared with the board, and there is no longer any downside to weigh against
it.

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

### The 2026-08-14 pass: the five Held candidates

`pvp-boon-matrix.ts` extended to pull in `rust`/`barren`/`antidote`/`stripped`/
`first-blood` alongside the shipping nine (`HELD_CANDIDATES`, tagged `~` in the
table), so they're measured against the SAME live field rather than in
isolation. Three seeds (`boon-matrix-v1`, `alt-population-2`, `boon-matrix-v3`)
at the current placeholder magnitudes (Rust 4 armor, Barren 1 headroom,
Antidote 3 resist).

**No dominance violation involving any of the five, on any seed, in either
direction.** None ever appears on the winning side of a `!` line — they never
strictly outrank a shipping boon — but they also never get outranked so hard
it would read as a trap. Safe to leave Held; nothing here says "ship it now,"
nothing says "this is broken."

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

## Open

- The Silence marker on the board render (see the replay section above) — the
  last unbuilt piece.
- How large the pool needs to be before the daily rotation reads as a rotation rather
  than a near-fixed trio.
- Whether the trio should avoid repeating a boon on adjacent days (the Slay the Spire
  rule, cited in #165's design refresh).
- The overnight/locked screen state.
- X values for Rust, Barren, Antidote and First Blood are still placeholders
  (`sim.ts`'s `HELD_BOONS`) — the 2026-08-14 `pvp:boons` pass above measured
  direction (none is broken, two look solid, three look Echo-shaped) at the
  CURRENT placeholder magnitudes, but never swept alternate values the way
  Bulwark/Blunt/Rearguard/Guardian's shipped numbers imply happened for them.
  A magnitude sweep is still open for whichever of the five moves toward
  Shipping.
- Whether Barren/Stripped/First Blood need Echo's field-C treatment (a
  board population built to actually trigger them) before their Held status
  is revisited — see the pass write-up above.
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
