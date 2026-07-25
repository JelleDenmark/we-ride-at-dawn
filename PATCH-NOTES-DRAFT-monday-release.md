# Monday release — season 4 lands on master

**STATUS: DRAFT — NOT POSTED. Awaiting Jesper's approval.**

This is a pre-release **herald** (dev-only preview), not the post-merge
patch-notes flow — `dev` has not been merged to `master`/prod yet, so the
`patch-notes` subagent's hard rules correctly forbid it from touching this.
Per the established precedent ([[wrad-patch-notes-herald-vs-prod]]), I drafted
and will post this myself via `post-with-images.sh`, same as the 0.6.5/0.7.0
heralds, sourced from the `master..dev` diff (`git log master..dev`, 33
commits).

## Open items before posting

1. **Version number.** `packages/app/src/telemetry.ts` still reads `0.7.0`
   (unchanged since the season-4 units-reveal herald on 2026-07-20). Everything
   below has landed on `dev` since then without a version bump. Confirm the
   actual release version before posting — using **v0.7.0** as a placeholder
   below since that's what's currently in the code.
2. **Raabi dedication.** Confirmed with Jesper: Gutter Gourmand is dedicated
   to **Raabi**, same tribute framing as Draughtsman Moe → RatMoe. The repo
   itself (issue #151, commit f8e368c) has no name attached — it ships as a
   plain chef reskin of Twilight-Runt — so the dedication line below is
   sourced from Jesper directly, not the commit history. Flag if any specific
   detail about Raabi should be woven in beyond the bare dedication.
3. Not mentioning PWA/update-banner/leaderboard-plumbing work item-by-item per
   Jesper's ask — folded into one "under the hood" QoL line at the end.
4. Per Jesper's review: no tuning callouts on units that are brand-new this
   season (Squeak-Sensei's curve bump, Gutter-Acolyte's flat→% rework, and
   Grave-Leech's day-gate all reveal that they shipped under-tuned/exploitable
   — cut from the "tuned" list and from Grave-Leech's day-gate note in
   message 1). Sentences now start with a capital letter throughout (also
   noted in `.claude/agents/patch-notes.md` for future drafts). Dropped the
   "not everything... is written here" closer — that line is for a full
   post-merge release, not a herald that already discloses everything above.

## Sourcing (commit → claim)

- Reskin: f8e368c (Gutter Gourmand replaces Twilight-Runt, same kit/stats).
- New units: 8e88ac7 (Squeak-Sensei #133, Steel-Whisker #134, Grave-Leech
  #135, Gutter-Acolyte #137, enemy enchanter wing #138).
- Retunes (only pre-existing units named per Jesper's call, see open item 4):
  85742b1 + 2e753ca (Warren-Warden/MD-Rattyfock own-attack 2→3, reskin pair
  swapped back). 5f80427 (Sensei curve bump), c6c266e (Acolyte flat → %
  shred), and 4222114 (Grave-Leech day-gate) happened but are cut from the
  copy since they're changes to units that are new this season.
- Enemy scaling: 5d9f15e (health 0.20→0.22, attack 0.08→0.09), 4222114
  (attack 0.09→0.10).
- Ward-Weaver rework + Rat-Piper retirement + Slink-Rat merge scaling:
  f4c85c9, 28a66d0 (these predate season 4 but are still only on `dev`,
  unreleased — included since they're part of the same `master..dev` diff).

---

## DRAFT copy — 3 messages (images attach to message 1)

### Message 1 — reveal + new faces

```
v0.7.0 — The drains grow teeth (1/3)

Season 4 rides in. Four new rats, an enemy wing that fights back smarter,
and the gutters get a cook.

🍲 A tribute rides with this one: **Gutter Gourmand** carries Twilight-Runt's
exact kit — a hearty buff at the start, thinned rations from wave 15 on —
recostumed and dedicated to **Raabi**. Twilight-Runt retires into the name,
same honour Draughtsman Moe pays RatMoe.

New to the roster:
🥋 **Squeak-Sensei** (5) — Trains every rat you summon as it arrives
🩸 **Grave-Leech** (6) — Bites back health on every clash it survives
🛡️ **Steel-Whisker** (6) — Armored, and its bristles cut back when hit
📜 **Gutter-Acolyte** (5) — Saps the whole enemy line's attack, every wave

New to the drains fighting back: an enchanter wing waits past wave 12 —
**Muster-Herald** rallies the line, **Sluice-Warden** shields the front.
```
(images: `squeak-sensei.png`, `steel-whisker.png`, `grave-leech.png`,
`gutter-acolyte.png`, `gutter-gourmand.png`)

### Message 2 — the tuning

```
v0.7.0 — The drains grow teeth (2/3)

**Retired**
• Twilight-Runt — Replaced in the shop by Gutter Gourmand, same slot
• Rat-Piper — Bought back at par, made room for this season's roster
• Warren-Warden — Swapped back out; MD Rattyfock takes the day-1 slot again

**Tuned**
• Warren-Warden / MD Rattyfock — Own attack 2 → 3, felt dead-weight early
• Ward-Weaver — Swaps its old full-block for flat armor on the whole warren.
  The old version let a strong board take zero damage all the way to the
  Boss Trial's cap; this one still gets worn down
• Slink-Rat — Merging now hits more targets at ★2/★3 instead of one target
  for silly damage

**The drains hit harder**
Enemy health and attack scaling both stepped up again this pass, and the
new enchanter wing (Muster-Herald, Sluice-Warden) starts showing up past
wave 12 — the gauntlet should feel noticeably less soft past the midgame.
```

### Message 3 — closing

```
v0.7.0 — The drains grow teeth (3/3)

Under the hood: PWA install icons got real art, the update banner is
clearer about when a new build is waiting, the leaderboard now folds depth,
boss damage, and kills into one combined board (with a Crown for the top
seat), and an overnight ride-freeze bug got fixed. Quality-of-life, no
gameplay swing.
```

Footer on every embed (same as 0.6.5/0.7.0 precedent):
`we ride at dawn · season resets Monday 06:00 CET`, color `5793266`.

---

Payload + post: draft only. Do NOT generate the final Discord JSON/attach
images or post until Jesper signs off on the copy, the version number, and
the Raabi dedication wording.
