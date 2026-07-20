/**
 * Stale-tab detector: an open tab keeps running the JS it loaded with
 * forever and never learns a new build shipped (see PWA-SCOPE.md Phase 1 —
 * this is what player "CarryRotte" hit right after the 0.6.0 ship).
 *
 * REWORK (2026-07-20): this used to diff the hashed entry-script filename
 * referenced by a freshly-fetched `./index.html` against the one this tab
 * booted with. That looked robust but was blind by construction once a
 * service worker is active — i.e. for essentially every returning player,
 * not some edge case: `index.html` is itself precached, WITH a
 * `NavigationRoute` serving that same precached copy for every navigation
 * too (see vite.config.ts). So a plain `fetch('./index.html')` — even with
 * `cache: 'no-store'`, which only affects the browser's HTTP cache and does
 * nothing once a service-worker route claims the request — was intercepted
 * and answered by the SAME stale service worker this poll was trying to
 * catch. Both sides of the comparison always came from the old bundle, so
 * a real deploy could sit undetected indefinitely on any client with an
 * active SW. Confirmed by reading the built `dist/sw.js`'s
 * `precacheAndRoute`/`NavigationRoute` registration directly (2026-07-20),
 * not inferred — a live player was still buying a unit retired in v0.7.0 a
 * full day after release.
 *
 * Fixed by comparing against `version.txt` instead: a plain file
 * vite.config.ts regenerates every build and explicitly excludes from the
 * PWA precache manifest (`workbox.globIgnores`), so no service-worker route
 * can ever intercept a request for it — it always reaches the network.
 * `__BUILD_ID__` (baked into this tab's own JS at build time, via Vite's
 * `define`) is the baseline; `version.txt` is "whatever's actually deployed
 * right now."
 */

/** Poll every ~3 minutes; also re-checked whenever the tab becomes visible. */
export const POLL_INTERVAL_MS = 3 * 60_000;

/** Fetch the live `./version.txt` (never precached — see the module doc
 * comment above), bypassing the HTTP cache. Never throws — callers treat a
 * null return as "couldn't tell this tick, try again next time." */
async function fetchServedBuildId(): Promise<string | null> {
  try {
    const res = await fetch('./version.txt', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

/**
 * Starts polling for a new deployed build. `onUpdateAvailable` is called
 * (possibly more than once) whenever a mismatch is detected; the caller
 * decides what "available" means for its UI (e.g. re-showing a dismissed
 * banner). Returns a teardown function that clears the interval and the
 * visibility listener — call it from the component's `onMount` cleanup.
 */
export function startUpdateCheck(onUpdateAvailable: () => void): () => void {
  async function check(): Promise<void> {
    const served = await fetchServedBuildId();
    if (served && served !== __BUILD_ID__) onUpdateAvailable();
  }

  const intervalId = setInterval(() => void check(), POLL_INTERVAL_MS);

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') void check();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
