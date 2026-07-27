## Agent skills

### Issue tracker

Issues live in GitHub Issues for `JelleDenmark/we-ride-at-dawn`, via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Deploy verification

Post-deploy checklist (workflow, `version.txt` freshness, SW-precache regression guard, served-bundle spot check). Run after every push to `dev` or `master`. See `docs/agents/deploy-verification.md`.

### Bot playtest

Multi-agent playtest of the `dev` build (UI/wording/gameplay, phone-first) — agent roster, setup, and known false-positive patterns to check before fixing. See `docs/agents/bot_test.md`.
