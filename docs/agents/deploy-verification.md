# Post-deploy verification

Run after **every** push to `dev` or `master`. One workflow deploys both
channels (prod at `/`, dev at `/dev/`), so a push to either branch re-serves
**both** — verify the channel you changed, and spot-check the one you didn't.

Channels:

- prod → `https://jelledenmark.github.io/we-ride-at-dawn/`
- dev → `https://jelledenmark.github.io/we-ride-at-dawn/dev/`

## 1. The workflow itself

`gh run list --branch <branch> --limit 1` → the "Deploy to GitHub Pages" run
is green. A green run means Pages accepted the artifact — it does **not**
mean the CDN serves it yet, which is what the rest of this checklist is for.

Never push `dev` and `master` back-to-back: the workflow's `concurrency`
group cancels the in-flight run, and the loser's channel can end up serving
whatever the winner's checkout happened to contain (see the deploy-race
incident notes).

## 2. `version.txt` freshness (the update-detection mechanism)

Since commit `44ab3d7` (issue #145), `version.txt` is the deployed
checkout's **commit SHA**, so the check is exact:

```
curl -s https://jelledenmark.github.io/we-ride-at-dawn/dev/version.txt
git rev-parse origin/dev   # must match — origin/, not local: unpushed
                           # local commits are (correctly) not deployed
```

Same for prod against `git rev-parse origin/master` (only once master carries
`44ab3d7`; before that prod serves a per-build timestamp — just confirm the
`Last-Modified` header lines up with the run that just deployed).

Also confirm the **unchanged** channel's `version.txt` did **not** change:
a dev-only push must leave prod's value untouched (that invariance is the
whole point of #145 — if it flips, prod players are getting spurious
"update rode in" banners again).

CDN note: Pages serves this with `Cache-Control: max-age=600` via Fastly.
Stacked on the app's poll cadence that's a ~13-minute worst-case detection
window — accepted as-is (analysis in #144); don't chase it below that.

## 3. `sw.js` precache exclusion (regression guard)

```
curl -s https://jelledenmark.github.io/we-ride-at-dawn/dev/sw.js | grep -c version.txt
```

Must print `0`. If `version.txt` ever appears in the precache manifest, a
stale service worker will answer the freshness poll from its own cache and
updates become undetectable — the exact blind-by-construction bug fixed in
`cec1276`. This is the one regression this checklist exists to catch early.

## 4. Served-bundle spot check (the original step)

Confirm the change you just shipped is actually in the served content —
`curl` something that distinguishes it. Examples: grep the served
`index-*.js` for a new version marker or copy string; hash a changed asset
and compare to the local `dist/` copy (done for the #142 icons by MD5).
A green deploy has served a stale bundle before; check bytes, not statuses.

## 5. Live-tab banner (end-to-end, opportunistic)

A tab that was open from **before** the deploy should show
"⚔ an update rode in — tap to reload" within ~13 minutes (poll + CDN
window). Don't set up a synthetic watch for this — just notice it when you
happen to have a pre-deploy tab open, and it only needs re-confirming after
changes to the update-detection path itself (`updateCheck.ts`,
`pwaUpdate.ts`, the `version.txt` plumbing in `vite.config.ts`).
First confirmed live: owner's open prod tab, 2026-07-20.

## 6. Anon read posture (added 2026-08-13, issue #187)

Part B of the hide-device-id migration sat unapplied for twelve days because a
"apply this later" comment inside a `.sql` file is invisible the day after it
is written. Raw `device_id` — the unverified key every write RPC accepts — was
publicly readable that whole time, and it was found by accident.

This check is cheap and would have caught it within a day. Every table below
must refuse anon; every view must serve it.

```
for t in pvp_boards pvp_results scores pvp_boon_picks; do
  printf "%-16s " "$t"
  curl -s -o /dev/null -w "%{http_code}
"     "https://wvrllhiktnkvbpclmrpq.supabase.co/rest/v1/$t?select=device_id&limit=1"     -H "apikey: <anon key from telemetry.ts>"
done
```

Expect **401** on all four. A **200 is a finding**, even with an empty body —
an empty array from an empty table looks identical to one from RLS doing its
job, so never read `200 []` as proof of anything.

```
for v in pvp_boards_public pvp_results_public scores_public; do
  printf "%-20s " "$v"
  curl -s -o /dev/null -w "%{http_code}
"     "https://wvrllhiktnkvbpclmrpq.supabase.co/rest/v1/$v?select=player_id&limit=1"     -H "apikey: <anon key>"
done
```

Expect **200** on all three — those are what the app actually reads, and a
revoke that also broke them would empty every leaderboard.

Also: Supabase grants `anon` select on new public tables **by default**. Any
new table that is not meant to be public needs an explicit `revoke`, not just
RLS. RLS alone is sufficient, but the second layer is one line.
