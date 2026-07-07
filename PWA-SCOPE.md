# PWA Implementation Scope — We Ride at Dawn

_Scoping doc (not built). Generated 2026-07-07. The driver is the stale-tab-after-deploy problem: open tabs keep running old JS and submit old/broken data until manually hard-refreshed (see `handoff.md`; it's what player "CarryRotte" hit right after the 0.6.0 ship). Companion: `ROADMAP.md` (retention/social section), `handoff.md` (deploy model + gotchas)._

## Grounding (what's actually in the repo)
- **`packages/app/vite.config.ts`: `base: './'`** — all output uses **relative** asset paths, which is why the deploy workflow copies the identical `dist/` into both `site/` (prod root) and `site/dev/` with zero rewriting. Manifest/SW should follow the same relative-path discipline so one file works at both channel paths.
- **No PWA tooling today** — Vite 6 + Svelte 5; no `vite-plugin-pwa`/`workbox-*` in the tree. `main.ts` has no SW registration. `index.html` has no manifest link; only asset is `public/icon.jpg` (a JPEG, not PNG).
- **Version marker:** `telemetry.ts` `APP_VERSION = '0.6.0'(+ '-dev')`, hand-bumped. No `version.json`.
- **Channel:** `env.ts` `CHANNEL` = `prod` only when `VITE_CHANNEL=prod` (master build); else `dev`. Precedent for isolation: `persistence.ts` namespaces localStorage `NS = 'wrad' | 'wrad-dev'` — mirror this for SW cache names.
- **Backend:** Supabase REST + one RPC; **no push/notification infra, no Edge Functions** exist. Deploy has the documented race + flaky-Pages hazards.

## Phase 1 — Update flow (SHIP FIRST, the priority)
**Recommendation: no service worker yet — a lightweight version poll fixes the actual bug fastest and with zero new deploy risk.** The bug isn't "assets uncached," it's "open tabs never learn a new build exists." A SW adds real risk (two-channel scope/cache isolation, "bad cache bricks the app") for a payoff Phase 1 doesn't need.

Approach:
1. On load, capture the current build marker (`APP_VERSION`, or the hashed script `src` read from the live DOM).
2. Every ~2–5 min **and** on `visibilitychange`→visible, `fetch('./index.html', { cache: 'no-store' })` and compare the marker. (Optionally emit a tiny `version.json` at build, but re-diffing `index.html` is zero-config since it changes every deploy.)
3. On mismatch → **non-intrusive banner: "New version available — tap to reload"** (dismissible-but-persistent, fixed strip, doesn't block shop/replay). Reload = plain `location.reload()`.
4. Channel-safe by construction: relative `./index.html` fetch resolves to each channel's own path.

**Effort: small (~1 session), client-only, no build/deploy changes.** Directly fixes the documented incident. Note: this logic isn't wasted later — in Phase 2 it becomes the trigger for the SW-driven refresh.

## Phase 2 — Installability
- **`manifest.webmanifest`** with **relative** `start_url`/`scope` (`"."`), so the identical file works at both channel paths (same reason as `base: './'`). `name` "We Ride at Dawn", `short_name` "WRAD", `theme_color`/`background_color` reuse `#0d0b09`, `display: standalone`. Link via `<link rel="manifest" href="./manifest.webmanifest">`.
- **Icons — asset gap:** need real PNG icons (192, 512, maskable); today there's only `icon.jpg`.
- **Install UX:** capture `beforeinstallprompt` (Chromium/Android) → in-game "Install" affordance after some engagement; iOS Safari has no such event → manual "Share → Add to Home Screen" nudge, gated on iOS + not-already-standalone. **This iOS install nudge is a hard prerequisite for Phase 3 push on iPhone.**
- **Offline:** minimal **app-shell cache only** (HTML/JS/CSS/icons), **not** Supabase — the client already tolerates network failure (`submitScore` catch treats offline as "local best authoritative"; `fetchTop`/`fetchRank` return `[]`/`null`). Game plays offline; leaderboard resumes on reconnect. No new sync logic needed.
- **Tooling:** add **`vite-plugin-pwa` (Workbox)** here — integrates with Vite, auto-precaches the real hashed filenames, supports per-channel config via `VITE_CHANNEL`, and `registerType: 'prompt'` maps onto the Phase-1 banner UX (merge Phase 1's poll into its `onNeedRefresh` hook). Hand-rolling risks exactly the scope/invalidation bugs Workbox handles for free.

**Effort: small–medium, mostly client + a small icon task.**

## Phase 3 — Push notifications (hourly ride / Monday reset) — biggest lift, mostly backend
Requires: SW `push` + `notificationclick` handlers (channel-scoped deep links); a **VAPID keypair** (public in client, **private as a secret** — a genuinely sensitive new secret, unlike the RLS-safe Supabase publishable key); a **`push_subscriptions` table** keyed by existing `deviceId()` with RLS + an upsert RPC (**apply the `supabase-rpc-arity-gotcha` lesson: drop-and-recreate on any signature change, never `CREATE OR REPLACE` with a new arity**); a **scheduled sender** (Supabase Edge Function / `pg_cron`, Deno web-push w/ VAPID) running hourly + Monday 06:00 CET; and permission UX requested only on explicit action + only when installed. **iOS: push works only for an installed PWA (16.4+)** — a tab visitor on iPhone can never receive it, so copy should say "install to get ride alerts."

**Effort: medium–large, mostly new backend. Gate behind Phase 2; scope as its own project.**

## Two-channel / base-path gotchas
- **Register the SW with a relative path** (`register('./sw.js', { scope: './' })`) so each copied build self-registers at its own channel scope. Never absolute `/sw.js` (could out-scope both channels).
- **Namespace cache names by channel + version** (`wrad-prod-precache-v0.6.0` vs `wrad-dev-…`) — `caches` storage is per-**origin** (shared across scopes), so without this a dev SW could name-collide and evict a prod cache entry. Use `vite-plugin-pwa`'s `cacheId`. (Scope only gates which *pages* a SW controls, not which cache keys it can touch — hence the naming discipline is the real fix.)
- **Deploy interaction:** a SW makes the existing flaky/race deploy hazards *worse* — a half-deployed state can leave a precache manifest disagreeing with served assets. Extend the existing "verify the served bundle yourself" post-deploy step to also verify the SW/precache actually updated. This is a recurring per-deploy cost, not a one-time one.

## Recommended plan & effort
| Phase | What | Effort | Client/Backend | Gate |
|---|---|---|---|---|
| 1 | Version-poll + reload banner, **no SW** | Small | Client-only | **Ship first, now** — fixes the documented stale-tab incident |
| 2 | manifest + PNG icons + `vite-plugin-pwa` SW, app-shell cache, install UX | Small–medium | Mostly client | After Phase 1 stable; supersede its poll with the plugin's update hook |
| 3 | Push (VAPID, subscription table/RPC, Edge Function cron, permission UX) | Medium–large | Mostly backend | Gate behind Phase 2 (iOS needs installed PWA); its own project |

**Key risk — a bad SW can brick the app for returning users** (stale precache → 404s in cache-first mode). Mitigation: (a) **`index.html` must be NetworkFirst/StaleWhileRevalidate, never pure CacheFirst**; precache-cache-first only hashed content-addressed assets (safe by construction); (b) ship a **kill-switch** (version-gated `skipWaiting()` + `caches.delete()` sweep triggerable by bumping a cache-name constant); (c) extend the post-deploy verification to include the SW.
