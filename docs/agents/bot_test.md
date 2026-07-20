# Bot Playtest

How to run an automated multi-agent playtest of the `dev` build — UI, wording, and gameplay-clarity review from a phone-first perspective. Ran once on 2026-07-17 against `dev` day 5/7; this doc exists so the next season can repeat it without re-deriving the approach.

## When to run this

Before or shortly after a season's content lands on `dev` — new units/relics, a copy pass, or a UI change to the shop/board/ride panels. Not needed for pure balance-number tweaks (use `balance-analyst` for those) or backend-only changes.

## Setup

1. Confirm the `dev` build is live: `https://jelledenmark.github.io/we-ride-at-dawn/dev/` (see [[wrad-project-overview]] in memory for the two-channel deploy setup — dev data is Supabase-namespaced separately from prod, so playtest actions are safe to take freely: buy/sell, rename the warlord, submit scores).
2. Open one Browser-pane tab per agent (`tabs_create`), navigate each to the dev URL, `resize_window` preset `"mobile"` (375×812) — phone is the primary target. Playing on separate tabs (not separate windows/sessions) lets several agents work concurrently without fighting over the same page state.
3. Note the exact `tabId` assigned to each tab; pass it explicitly in each agent's prompt and tell them not to touch any other tab.

## Agent roster

Ran 4 agents in parallel (`general-purpose`, background), each on its own tab, each told upfront this is a real dev deployment (safe to click freely) and given the dev-tooling context (the "testing" panel: `+6h income`, `next day`, `reset test date`, `+10 scrap` — needed to fast-forward through the hourly-ride / daily-dawn cycle since real time is too slow to observe in one session):

| Agent | Model | Focus |
|---|---|---|
| Onboarding & shop | sonnet | First-time-player experience: does the core loop explain itself, can you tell what a card does before buying, tap targets, wording friction |
| Full loop | sonnet | Multi-day progression via dev fast-forward buttons: ride/haul feedback, difficulty theme changes, Boss Trial, leaderboard, overall pacing |
| Layout sweep | haiku | Pure UI/rendering bugs at mobile viewport: overflow, touch-target sizing, console errors, network failures — screenshots + DOM measurement, no wording/balance judgment |
| Copy pass | haiku | Pure wording: typos, terminology consistency, stale copy vs. actual engine behavior, tone — reading every screen's text, no layout/gameplay judgment |

Sonnet for the two roles needing judgment calls about what's confusing to a new player; haiku for the two mechanical sweeps (spot the bug, quote the text) where the review criteria are narrow and objective.

Each prompt is self-contained (the agents have no memory of this conversation) and ends with: a structured report format (severity-tagged findings, grouped by category), and an explicit instruction not to modify code — pure playtest via the browser.

## Known false positives — verify before fixing

Two agents in this run reported the `computer` screenshot/zoom action timing out for their entire session, so they fell back to `get_page_text`/`read_page` text extraction. That tooling **flattens nested inline elements** (e.g. `<strong>` inside a sentence) and can produce phantom artifacts:

- A sentence like `the drains <strong>every hour</strong>, hauling...` got reported as a literal typo — `"the drains , hauling"` (missing the bold span, stray space) — when the actual rendered HTML was correct. Traced by reading the source directly.
- A `.stat` block using `flex-direction: column` (two lines) got reported as text visually running together (`"2m 11srides in"`) — an artifact of `get_page_text` joining sibling nodes on one line, not a real rendering bug.

**Before fixing any agent-reported finding, re-derive it from the source** (`Grep` the exact string, read the surrounding component/CSS) rather than trusting the quote verbatim. This cut the real fix list roughly in half this run. Also check for **already-deliberately-solved** cases — one "bug" (dev "next day" button breaking Boss Trial resolution) turned out to be already fixed, with an explicit code comment referencing the exact scenario and an issue number. Read the comment above the relevant function before treating something as a gap.

Findings backed by actual DOM measurement (`getBoundingClientRect()`, `scrollWidth` vs `clientWidth`) rather than text extraction are more trustworthy — trust those over prose-quoted "typos."

## Triaging findings into fixes

Split surviving (verified) findings by risk, not by who reported them:

- **Easy** (isolated CSS/copy/one-line-condition change, single file, no design judgment required, blast radius obviously contained) → parallelizable to Haiku agents. Cap concurrency at 2 agents editing the same file at once (this run used 2 batches of 2) — non-overlapping line ranges reduce risk but don't eliminate it, and the orchestrating agent should do its own harder fixes to the same file *before* or *after* the Haiku batches, never concurrently with them.
- **Harder** (cross-file terminology decisions, anything touching `CONTEXT.md`'s glossary, event/accessibility logic, stale-copy rewrites that need to match actual current mechanics) → fix directly, sequentially, checking `CONTEXT.md` for the project's canonical vocabulary first (e.g. this run found the UI mislabeling the `depth` stat as `wave` in six places — `CONTEXT.md` makes the two terms' distinct meanings explicit, which is what turned a vague "inconsistent terminology" note into a confident, mechanical find-and-replace).
- **Bigger feature gaps** (e.g. no visible stat feedback after a whole-horde buff, no merge-progress indicator) are playtest-worthy findings but not "fixes" — file them as GitHub issues per `docs/agents/issue-tracker.md` rather than shoehorning a UI feature into a playtest-response session.

## Reproducing this run

1. Open 4 mobile-viewport tabs on the dev URL as above.
2. Fire the 4-agent roster from the table, one `Agent` tool call per row, all in the same message (they don't share state, so true parallelism is fine for *review* — it's only *fixing* that needs the concurrency cap).
3. Wait for all 4 completion notifications, compile findings, verify each against source before actioning.
4. Fix easy/haiku-suitable findings in capped-concurrency batches; fix the rest directly.
5. Rebuild (`npm run build` in `packages/app`) to confirm no compile errors, then spot-check the fixes live against the local dev server (or a fresh `dev` deploy) before considering the pass done.
