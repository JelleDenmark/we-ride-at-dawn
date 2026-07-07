# We Ride at Dawn — Improvement Roadmap (draft)

_Generated 2026-07-06 overnight by a 5-agent Opus design panel (archetypes/minions, relics/systems/meta, seasons/anomalies, easter-eggs/lore, retention/social). Every proposal was grounded in the real deterministic sim, the merge-3 system, the max-depth-over-week metric, the synchronized weekly season, and the phone-first casual audience. This is a review draft for us to prioritize together — nothing here is built._

---

## 0. Executive summary — the one design tension everything orbits

The game just changed shape. Enemy toughness now **scales with wave depth** (`health ×(1 + 0.6·w)`, `attack ×(1 + 0.08·w)`), so deep foes are HP **sponges** and the deep game is a **damage-throughput problem** — and any damage past a kill is **discarded as overkill**. That single fact drives most of the best ideas below:

- **Attack finally matters** (the goal of the change), but throughput needs *payoff*: cleave/overkill-carry/execute/on-kill relics let attack builds scale multiplicatively the way swarm already does via summons.
- **⚠️ Poison is the next dominant strategy.** Poison is flat-per-tick and **depth-independent**, so as foes get tankier it scales *relatively better* the deeper you go. **Two independent agents flagged this unprompted.** The counter-tech (a poison-*immune* `warded` archetype, anti-poison enemies) is the single highest-leverage content addition — it stops plague from trivializing the sponges and makes attack relics genuinely mandatory. **This is the first thing to verify against the balance sim.**
- **Depth is sacred and singular.** Because the leaderboard is one number on a synchronized shared seed, every system must protect it: meta-progression may add *options/identity/lore*, **never stats**; anomalies must be classified depth-neutral vs depth-distorting; the all-time board must exclude distorting weeks.

### Convergent ideas (multiple agents proposed independently)
- **All-time / personal-best leaderboard** alongside the weekly one (relics agent, seasons agent, retention agent) — the safest big retention lever; separate table, cannot corrupt the weekly board.
- **Anti-poison counter-tech** (archetypes + relics agents) — the balance keystone.
- **Celebrate the personal best + a share card** (retention + easter-eggs agents) — the felt-progress gap and the missing virality loop, fixable together.
- **Damage-type / archetype rock-paper-scissors** (relics + seasons agents) — turns the four archetypes from flavor into deterministic counter-play the scout report can telegraph.

### Load-bearing constraints (true for every item)
- Deterministic seeded sim only — secrets/anomalies fire on reproducible conditions, never unseeded RNG (this is a *feature*: it makes them shareable facts).
- Merge-3 and once-per-carrier relic rules stay intact.
- Weekly board fairness is non-negotiable: `core`'s scored path must read nothing from a per-account progression store.
- Phone-first, grimy tone.

---

## 1. Suggested priority view (my synthesis — for us to argue with)

### NOW — cheap, high-impact, mostly client-only, protects what we just shipped
1. **Verify/patch poison dominance** against the new depth scaling (balance sim) — and ship the **`warded` poison-immune archetype + a couple of tanky deep foes** (one boolean + one guard in `applyDamage`). _Balance keystone; makes attack relics mandatory._
2. **Celebrate the personal best + emoji/image share card.** _Closes the felt-progress gap AND lights word-of-mouth in one change; all data already in state, no backend._
3. **First-session clarity pass** — scrap-first line, delay the name modal until after the first buy, three tap-to-dismiss coach-marks (esp. merge-3), instant first ride. _Protects the top of every funnel._
4. **Gore-Cleaver relic** (overkill carries to the next enemy, single target, no chaining) — _directly reclaims the overkill waste the deep curve manufactures._

### NEXT — bigger but high-value; some backend
5. **PWA install + Monday/daily push** — the missing return hook for an idle game (already scoped in `plan.md`).
6. **All-time leaderboard + achievement-gated cosmetic titles/banners** — legacy chase that can't touch the fair weekly ladder.
7. **`anomalyFor(seasonId)` weekly-anomaly machinery** + a safe launch trio (Iron Vigil / Plague Week / Bounty Run — all depth-neutral), first ~4 weeks clean.
8. **Damage-type vs archetype (soft armor)** + a ramping-attack player carry (Gutter-Butcher) and a couple of new relics (Rust-Fang, Blood-Debt).
9. **Rival callout + "you were passed" nudge + rival horde peek** (lineup jsonb already stored).

### LATER — strategic, needs foundations
10. **Portable identity upgrade** (magic-link / recovery code) — prerequisite for durable friend groups, streaks, and paid cosmetics.
11. **Friend / private leaderboards** (group codes) — highest retention ceiling; gate behind identity.
12. **New archetypes `broodkin` / `reaver`**, season arcs ("Descents") with capstone compound-anomaly weeks + per-week board partitions, and the flagship easter eggs (Rat King, 45-clear payoff).
13. **Cosmetic-only monetization** (horde skins, supporter frames) — the *only* honest lane; pay-for-power is permanently off the table and worth saying publicly.

### Open questions to decide together
- Do we keep `WAVE_COUNT = 45` as an aspirational ceiling, or lower it once stat-scaling gates depth naturally?
- How hard do we lean into anomalies vs. keeping the base game clean longer for new players?
- Is a lightweight portable identity worth building early to unlock the whole social/cosmetic tier?
- Poison: nerf it directly, or counter it purely with `warded` content and let telemetry decide?

---

## 2. Smaller changes / quick wins

A running list of small, self-contained improvements (distinct from the big backlog above).

- **Shop auto-reroll when emptied (free).** When all stalls have been bought/consumed, automatically reroll the shop **at no scrap cost**, so a player is never left staring at a dead, empty shop. Contained in `core` `shop.ts` (the buy paths + a free-reroll on "shop exhausted") with a test. _(Decide the exact trigger: when every slot is empty, vs. when all unit slots are gone — lean "every slot empty".)_
- **"harder every dawn" copy fix** — the progression line (`App.svelte:725`, `… interest banked each dawn · harder every dawn`) still claims day-scaling difficulty, which is false post-0.6.0. Reword/remove as part of the broader copy-vs-engine sweep (see the `wrad-copy-vs-engine-audit` memory).
- **PWA "new version — reload" nudge** — ✅ Phase 1 shipped to dev (`updateCheck.ts` + banner). Phases 2–3 (installability, push) still scoped in `PWA-SCOPE.md`.

---

## 3. Proposed near-term features (from Jesper, 2026-07-07)

My read + suggested order. All three are bigger than the quick-wins above. **Order: A → B → C.**

### A. Bench — store rats outside the horde — **strongest; do first**
Store units that aren't in the fighting horde: (1) hold 2 copies while hunting the 3rd for a merge — kills the merge-3 frustration (same root as the board-cap-starves-a-2nd-Piper report), (2) keep counter-units to swap in against the daily archetype theme.
- **Design:** bench does NOT count toward `BOARD_CAP` (bench units don't fight); merges **auto-resolve across board+bench** (the whole point). New `BuildState.bench: BoardUnit[]`, persisted + carried across days like the board. Size ~3 to start (5 if tight).
- **Sim impact: none** — only board units enter `simulate()`, so no golden/determinism change. A `shop.ts` + build-state + UI feature.
- **Balance:** raises optimization/flexibility, but bench rats never fight → QoL + depth, not raw stat power. Low risk.
- **Effort:** small–medium.

### B. Buyable horde slots — late-game scrap sink — **promising, needs balance care**
Supplement (don't fully replace) the passive `boardCapForDay` 5→8 growth with **purchased** slots at an escalating price (10/50/100+). Gives scrap real meaning late game — pairs directly with the flagged near-vestigial interest (see `wrad-interest-tuning`).
- **Watch:** (1) keep a small passive floor so early/cold-join players aren't gated behind purchases; (2) **if slots can exceed `BOARD_CAP = 8`, that's a real sim/balance change** — the depth curve + enemy wave-depth scaling were tuned around 8 fighting units; (3) a depth→scrap→slots→depth **snowball** could inflate top scores (the interest cap exists partly to damp this).
- **Must** validate with `npm run balance` before shipping. Resets weekly with the roster.
- **Effort:** medium; touches core economy (and the sim if it goes past 8).

### C. Split unit shop / relic shop — **lowest priority; validate the need first**
Independence has some appeal, but the main benefit is **already largely served by the existing freeze** (protect a relic, reroll units). A full split adds phone-first UI cost (two panels, two reroll buttons, more taps) for modest gain.
- **Recommendation:** don't build a full split yet. If a concrete pain shows up in play, the cheaper fix is a **per-row reroll** (reroll just the unit row or just the relic row), not two shops. Revisit only if freeze proves insufficient.

---
---

# Detailed sections

_(Verbatim design output from each panel agent, lightly formatted. Names/stats are proposals, not final.)_


## Archetypes & Minions

**Design thesis.** The front-clash sim only ever pits two frontmost units against each other, so every enemy's identity has to live in *how it survives or punishes that one exchange*. Today's four archetypes cover "many bodies / big hit / high HP / damage-over-time," but with health scaling ×0.6/wave vs attack ×0.08/wave, deep waves become undifferentiated HP sponges that only raw attack or flat poison can chew. The three new archetypes each attack a *different horde assumption* — poison-reliance, summon-reliance, glass-cannon front-loading — so "push deeper" means "bring the right answer," not "bring more stats." Only genuinely new primitive: a poison-immune flag (one data field read at damage time, no RNG).

### New archetypes
- **`warded` — the poison-wall.** Moderate atk, very high HP, **immune to poison** (new `poisonImmune` flag). Deep-wave anchors that switch off plague's flat-damage shortcut. Counter = raw attack burst (Rusted Nail / Glass Shard on a carry). Scout-read: "Iron-shod and blessed against rot — bring teeth, not sickness." _Low effort, high impact — one boolean + one guard in `applyDamage`._
- **`broodkin` — the summoner.** Low-HP bodies that on `faint` summon replacements in front (reuses `summon` + `faint` trigger, zero new machinery). Stalls the horde, runs the attrition clock. Counter = wide self-replacing swarm, or front burst. Scout-read: "They breed as fast as we do — the tunnel never empties." _Low effort, medium impact._
- **`reaver` — front-loaded glass cannon.** Very high atk, low HP, first-clash spike (new `firstHitBonus` on enemies). One-shots your front rat, dies to anything back. Counter = disposable front chump or Tail-Charm anchor. Rewards marching-order thinking. _Medium effort, medium impact._

### New enemies
| Name | Archetype | Atk/HP | Cost | Ability | Role |
|---|---|---|---|---|---|
| Reliquary-Knight | warded | 3/12 | 7 | poison-immune | Mid-deep wall; forces attack |
| Ossuary-Colossus | warded | 5/22 | 10 | poison-immune | Flagship "attack shines" deep foe |
| Font-Bearer | warded | 2/8 | 5 | startOfBattle: buffBehind +0/+3 all | Poison-immune anchor + team-tank |
| Warren-Ratter | broodkin | 2/2 | 3 | faint: summon gutter-watch ×1 (front) | Cheap stall vs single-carry |
| Whelp-Marshal | broodkin | 3/4 | 6 | faint: summon watch-whelp ×2 | Deeper spawner; drags attrition |
| Grate-Reaver | reaver | 8/2 | 5 | firstHitBonus +4 | Alpha-strikes front, then dies |
| Maul-Sergeant | reaver | 11/4 | 8 | firstHitBonus +5 | Deep glass cannon |

### New player units
| Name | Atk/HP | Cost | Ability | Strategy |
|---|---|---|---|---|
| Rot-Warlord | 5/4 | 7 | afterAttack: poisonTarget 2 | Poison carry that also hits; bounces off warded (intended) |
| Gutter-Butcher | 6/3 | 7 | afterAttack: gainStats +1/+0 | **Ramping attack carry — the clean answer to HP scaling & warded** |
| Warren-Broodqueen | 2/5 | 8 | faint: summon pup ×3 | Anchor-summoner; answers broodkin stalls |
| Tunnel-Chumps | 0/4 | 2 | none | Deliberate front chump vs reaver alpha |
| Bile-Deacon | 2/4 | 6 | startOfBattle: buffBehind +2/+0 all | Team attack enabler vs warded/deep HP |
| Grave-Piper | 1/3 | 5 | faint: revive health 3 | Attrition tech for long deep pushes |

**Risks:** Gutter-Butcher tier-3 (+3 atk/clash) could trivialize low-HP waves — curve if balance spikes. `warded` + deep HP is the intended depth gate but risks a hard wall if attack tools aren't reliably shoppable. New archetypes need `ARCHETYPES`/`ARCHETYPE_LABEL` + scout flavor entries or the truthful-scout contract breaks (esp. `warded` — plague players must be warned).

**Top 3:** (1) `warded` + poison-immune flag — lowest effort, delivers "make attack matter." (2) Gutter-Butcher ramping carry — cleanest player-side answer. (3) `broodkin` + Broodqueen — pure data, opens the horde-width axis.

---

## Relics, Combat Systems & Meta-Progression

**Design thesis.** With HP outscaling attack at depth, the deep game is damage-throughput and overkill is waste. The richest, lowest-risk space is relics that convert attack/kills into board-wide value (cleave, execute, pierce, overkill-carry, on-kill snowball) so attack builds get the multiplicative payoff swarm has via summons — without touching the front-clash model or determinism. Meta-progression adds options/lore/parallel all-time board, **never stats**.

### New relics
| Name | Scope | Cost | Effect | New mechanic |
|---|---|---|---|---|
| **Gore-Cleaver** | unit | 5 | On kill, carry overkill damage to the next enemy | `cleaveOverkill` — bounded to one target, no chaining |
| **Rust-Fang** | unit | 5 | Ignore first N of a foe's health each hit (armor-pen) | `armorPen`, best vs armored |
| **Gallows-Hook** | unit | 6 | Execute foe below X% max HP after your hit | `executeThreshold` — cap low (see risks) |
| **Blood-Debt** | unit | 5 | On kill, +1 attack permanently this battle | `onKillAttack` — brute carry fantasy |
| **Wretch-Thorns** | unit | 4 | Reflect X damage per clash | `thorns` — converts HP into offense |
| **Plague-Censer** | team | 6 | Poison persists across waves | ⚠️ degenerate-poison enabler — ship weak or not at all |
| **Carrion-Standard** | team | 6 | First ally death/wave → new front rat +2 atk | Rewards sacrifice/attrition |
| **Runt-Banner** | team | 6 | Summoned pups enter +1/+1 | Gives swarm an attack-era relic |
| **Iron-Muzzle** | unit | 4 | +0/+3, cannot be poisoned | Anti-plague tech, cheap counter |

### Combat-system extensions (deterministic)
- **Back-rank auras** via existing board order (position predicate in `applyEffect`) — real front/back placement decisions.
- **Damage types vs archetype (soft armor):** `physical`/`caustic` tags; armored takes −1 physical, plague takes +1 caustic. Deterministic lookup; turns archetypes into RPS the scout can hint.
- **Formation lever** (`vanguard`/`phalanx` in `Lineup`) — one bit, deterministic stat transform, meaningfully different builds.
- Formalize leftover/overkill damage as one shared helper + one `overkillCarry` event.

### Meta-progression (fairness-preserving)
- **Relic & Bestiary Codex** (cross-season unlock of lore/knowledge — shops stay identical for all).
- **All-time leaderboard** (separate table/column; weekly board stays the competitive surface).
- **Cosmetic prestige** (banners/frames/skins by all-time milestones; `app`-only, zero sim).
- **Unlock options not stats** — cleanest fair version: unlocks add to the *shared* pool for everyone that season (community unlocks).
- **Season lore chapters** on the Codex.
- Load-bearing rule: `core`'s scored path reads nothing from a per-account store.

**Balance risks:** ⚠️ **poison is the next Rusted Nail** (flat, depth-independent — ship poison-persist relics weak or never). Execute inverts the HP-wall design (cap low / make flat finisher). Cleave → bound to one target. Blood-Debt/Carrion snowball on an immortal front rat (watch Fat Tick + Tail-Charm combo). Meta-progression scope-creep into stats = existential; hard-wall in `core`.

**Top 3:** (1) **Gore-Cleaver** — solves the design's own overkill tension, one insertion. (2) **All-time board + cosmetic prestige** — best retention lever that provably can't corrupt the weekly board. (3) **Damage-type vs archetype** — biggest build-diversity gain for a small RNG-free change.

---

## Seasons, Anomalies & Live-Ops

**Design thesis.** The engine already hands us a fair, globally synchronized shared puzzle; the staleness risk is that only the theme (4 archetypes × secondary × pivot) changes week to week. A weekly **anomaly** is one deterministic modifier derived from `seasonId` (not the date), applied identically to all seven days for everyone — a pure `anomalyFor(seasonId)` layered on the pipeline, never RNG. It reshapes optimal play without breaking fairness. Hard constraint: protect max-depth comparability — classify each anomaly depth-neutral vs depth-distorting.

### Anomaly catalog
_Effort: **C** = client-only pure function; **C+cfg** = wants a season-config table; **B** = backend/board change._

| Anomaly | Rule | Strategy shift | Surfaced | Effort |
|---|---|---|---|---|
| **The Long Dark** | Start at wave N (foes already tanky) | No free early scrap; wave-6-viable horde immediately; front-load attack | "You ride into the deep." | C |
| **Plague Week** | Every enemy poisons on attack (per-wave) | Bone-Priest/Fat Tick spike; racing beats sustain | Poison-drip icons | C |
| **Iron Vigil** | Force armored primary, bias high-HP | Attack-per-hit king; poison shines as armor-pen | Locks armored hint | C |
| **Bounty Run** | Double scrap + deadlier foes | Rewards active rerolling over pure idle | "Fat this week — and it bites" | C |
| **Feast** | Merge at 2-of-a-kind / +6 start scrap | Tall single-unit power over wide | "Two of a kind is enough" | C |
| **Sudden Death** | Revive/heal/Tail-Charm disabled | One-way attrition; anchoring matters | Struck-through revive icons | C |
| **Swarm Tide** | Force swarm, cap 5→6 | AoE/wide-buff beats single-target | "Bodies beyond counting" | C |
| **Brute Vanguard** | Force brute, +atk scale | Health-stack/Tail-Charm shine; glass one-shot | "Something big paces" | C |
| **Warlord's Gambit** | Two modifiers combined (arc capstone) | Hardest week; per-week board | Full-screen intro | C+cfg |
| **Archetype Lock** | Horde restricted to one archetype | Total meta reset; separate board | Greys off-theme rats | C+cfg |

All pure functions of `seasonId`; golden-log tests extend with anomaly-on fixtures; hourless base path stays byte-identical.

### Season structure
- **Rotating schedule (ship first):** `anomalyFor(seasonId)` hashes the Monday; **first ~4 weeks clean** so newcomers learn the base game and the all-time baseline stays honest; anomalies switch on week 5.
- **Themed arcs ("Descents"):** 4-week narrative blocks (Iron Descent, Rotting Descent) capped by a Warlord's Gambit.
- **Escalating chapters** within an arc reuse existing tunables (`ENEMY_*_SCALE`, `difficultyForDay`).
- **Off-season "Night Rides":** 48h non-leaderboard mutator sandbox over Sun→Mon.
- **Pre-season teaser:** Sunday banner computed from `anomalyFor(seasonId+7d)` — "Next week: Iron Vigil."

### Alternate boards
- Global weekly (exists) — depth-neutral anomalies ride it unchanged.
- **Per-week Anomaly board** for depth-distorting anomalies — tag the `season_id` (schema PK already `(season_id, device_id)`, dev already prefixes). Firewall against polluting all-time.
- **All-time / personal-best** — clean (non-anomaly) weeks only.
- **Weekly Kills board** — same rows sorted by `enemiesDefeated` (already stored). Query-only.
- Friend/private boards — orthogonal; anomalies need no change.

### Comparability firewall
Classify up front: *depth-neutral* (Plague, Iron Vigil, Swarm Tide, Brute Vanguard, Bounty reward) ride the global + all-time board; *depth-distorting* (Long Dark, Sudden Death, Warlord's Gambit, Archetype Lock) are walled into per-week partitions and excluded from all-time. Never let a distorting week write the global frame.

**Top 3:** (1) `anomalyFor(seasonId)` machinery + rotating schedule, first 4 weeks clean. (2) Iron Vigil + Plague Week + Bounty Run launch trio (depth-neutral, zero fairness debt). (3) Per-week board partitioning + Sunday pre-season teaser.

---

## Easter Eggs, Secrets & Lore

**Thesis.** The loop is quiet and low on told-you-so moments. Because the sim is deterministic, every buried secret is a *shareable fact* ("field a full board of one type and the Rat King wakes up"), turning a solo grind into a social scavenger hunt. Rule: fire on reproducible build/date/seed conditions, never hidden RNG.

### Easter eggs & secrets
| Name | Trigger | Payoff | Client/sim |
|---|---|---|---|
| **The Rat King** | Full board of one unit type, all tier 2+ | Front merges into a crowned Rat King (stat swell + summons pups = board size) | Sim (golden update) |
| **Cleared the Drains x45** | Clear all 45 waves | "THE CITY IS OURS" dawn sequence + permanent gilded name frame | Client cosmetic |
| **Piper's Pact** | Rat-Piper + Brood-Mother + Bone-Priest on board | Hidden "We Are Legion" relic offered next shop | Sim (conditional offer) |
| **The Tithe-Man** | Seeded days: armored primary + odd pivot | Final wave's front armored foe renamed + scout call-out (no stat change) | Sim-adjacent (cosmetic name) |
| **Blood Moon Ride** | Ride on the 7th, or season's final day | Red-midnight replay palette | Client (date) |
| **Choir of the Drowned** | All-plague board | Green poison FX + "the drains remember" line | Client (or opt-in sim) |
| **The Empty Ride** | Ride with zero units | "The city sleeps easy" + "Coward's Dawn" gag badge | Client |
| **Warlord Name Echo** | Name matches hidden list / contains "Dawn" | Whispered greeting on open | Client |

### Hidden achievements (leaderboard-neutral)
First Blood at Dawn · The Warden Held · Patient Rot · Runt of the Litter · Merge-Lord · The Long Ride (wave 45) · Plague Saint · Hollow Horde · Seven Dawns · Coward's Dawn · Felled a Thousand (ties `seasonKills`) · The Tithe Paid.

### World lore bible (condensed)
The city above is dead; the warrens below are not. A plague-town choked on its own filth and sank — streets became ceilings, the **drains** became a world, and rats bred past counting. **You ride at dawn** because it's the one hour the city's dead garrison (the **Watch**) stands down; each ride is a raid, not a war — you never win the city, you measure how deep the tide reached before it broke. **Depth is the only true score.** Scrap (one shard per depth) feeds the warren to breed a deeper horde. Value is in numbers, never heroes — a Pup is worth nothing, a thousand Pups worth everything; the named rats are just ones who lived long enough to earn a name. The four defenders: **The Watch** (swarm, endless conscripts), **Hounds & Draymen** (brute, feral beasts that hit first), **The Iron Watch** (armored, the sluice-gate machinery still standing where it was left — the Tithe-Man still collects), **The Sick** (plague, the rot the drains remember). The stakes are none, and that's the tone: the city is already dead, the horde expendable and knows it. _"We ride at dawn because the dark is ours and the light is only borrowed."_

### Flavor upgrades
Depth-specific scout lines ("past where scouts return"); deterministic per-ride **epitaphs** in the ride log keyed on (outcome, hour) — 45-clear "THE CITY IS OURS", wave-1 wipe "the tide broke on the first grate"; cause-of-death victory/defeat lines from the event log; relic/unit `desc` polish; dawn/midnight palette hook; name-derived warlord greeting on open.

**Top 3:** (1) The Rat King — most shareable secret, rewards a legible build. (2) 45-clear payoff + gilded frame — trophy for the elite, client-only. (3) Ride-log epitaphs + cause-of-death lines — highest flavor-per-effort, deepens *every* ride.

---

## Retention, Social & Growth

**Thesis — the retention shape and the gap.** Two nested clocks: the **hourly ride** (a slow drip; rides score automatically whether watched or not) and the **weekly season** (the real competitive spine). The felt loop: tune → check back for deeper rides → climb the board → wiped Monday → ride again. **The middle of that loop is silent.** The payoff moment — "my horde just rode deeper than ever" — has no celebration, no notification, and no way to be pulled back. Concretely: (a) no return hook — income accrues offline but nothing tells you, so a no-push web idle game is forgotten by Wednesday; (b) felt-progress under-celebrated — `seasonKills`/`seasonBest` are quiet text lines; (c) the board is a scoreboard, not a social graph — no rival, no "you were passed," no friends, and **no share card** (the Wordle-style loop the web-PWA bet was justified on was never built).

### Social features
| Feature | Value | Backend? | Effort |
|---|---|---|---|
| **Emoji/text share card** (Web Share API + clipboard) | The word-of-mouth loop; carries the URL | No | S |
| **Image brag card** (canvas → blob → share) | Far more shareable on IG/Discord | No | M |
| **Rival callout** (row one rank above you) | Turns rank into a person to beat | No | S |
| **"You were passed" nudge** (on refresh) | Classic idle re-engagement pull | Banner no; push needs PWA | S–M |
| **Full-clear flex** (dedicated share prompt) | Rarest event = most viral | No | S |
| **Friend / private boards** (join by code) | Competition with people you know | Yes (groups + identity) | L |
| **Rival horde peek** (tap row → see lineup) | "How did they get so deep?" (lineup jsonb already stored) | Minor | M |

**Identity limitation:** the whole social layer rides on a `localStorage` device UUID. Clear the browser/switch phones → warlord, streak, history gone. Global/share features survive; **friend groups and streaks are fragile without portable identity.** A one-tap magic-link / recovery code is the prerequisite for the friends tier.

### Retention loops
1. **PWA install + hourly/Monday push (highest impact).** Manifest + SW (scoped in `plan.md`), install prompt after the first good ride, a Monday 06:00 "the horde rides — new season" push + an opt-in "your horde rode to wave N while you were gone" daily digest. Never nag.
2. **Celebrate the personal best.** New `seasonBest` → banner + rat-cheer + counting-up number + immediate share prompt; milestone `seasonKills` thresholds ("the drains run red"). Cheapest, highest-satisfaction change — the numbers exist, they just need a bell.
3. **Weekly streak** ("3 weeks riding") with a comeback-safe grace — turns Monday into a ritual.
4. **Comeback/cold-join hook** — "days left this season" + "next Monday everyone starts level" reframes a mid-week join as *their* real start.
5. **While-away dramatized** — `awaySummary` already computes offline rides/scrap; make it a proper welcome-back beat.

### Onboarding fixes (cheapest first)
1. **Lead with the scrap, not the roster** — first screen: "You have 24 ⚙ scrap. Spend it to recruit rats — your horde rides the drains every hour." Above the shop.
2. **Sequence the name modal after the first purchase** — buy a rat, then name the warlord who leads them.
3. **Tutorial-lite via 3 coach-marks** — ① tap a stall to recruit ② three of a kind merge into one ★ rat ③ ▶ watch your horde ride. Merge-3 is the least-obvious mechanic; teach it explicitly.
4. **A first, instant ride** — let the first session hit "watch the next ride" immediately; seeing rats clash *is* "I get it."
5. **Show depth→scrap causality** on the stat block — "deeper rides → more scrap → bigger horde."

### Identity & (fair) monetization
**Pay-for-power is off the table permanently** — the synchronized equal-stipend puzzle is the whole point; say it publicly ("a fair game, no whales"). Cosmetic-only, fairness-safe: achievement-gated **warlord banners & titles** (free, the identity backbone); **horde skins** (the only honest paid lane, purely visual on share card/replay); **named horde / custom sigil**; **supporter cosmetic pack** (tip jar → distinct frame). Cosmetic purchases are the strongest argument for the portable-identity upgrade — nobody pays for a banner a cache-clear deletes.

### Virality
1. **The share card is the whole growth engine — and it doesn't exist yet.** Every PB/rank-up/full-clear ends in a one-tap share carrying the play URL.
2. **"Cleared the drains" is the natural flex** — rare, already badged, the sentence people type to a friend.
3. **Rival callouts create stories** — "Grime-Fang passed me at wave 13" is shareable; "rank 47" isn't.
4. **Same-week comparability is a viral gift** — a friend who taps the link can beat your exact week. "Go deeper than me."
5. **Group-ride codes** (once friend boards land) — "join my warren."

**Top 3:** (1) **Share card + celebrated PB** (S–M, very high) — closes the felt-progress gap AND lights word-of-mouth in one change, no backend. (2) **PWA install + Monday/daily push** (M, very high) — the difference between "opened it once" and "rides every season." (3) **First-session clarity pass** (S, high) — protects the top of every funnel the other two feed. Friend groups are the next tier, gated behind portable identity.

---

_End of draft. Detailed sections are proposals from the design panel; the priority view in §1 is a synthesis for us to revise together._
