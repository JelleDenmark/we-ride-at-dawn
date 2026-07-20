import { POLL_INTERVAL_MS } from './updateCheck';

/**
 * PWA Phase 2 (PWA-SCOPE.md) service-worker registration, wired into the
 * Phase 1 "fresh build rode in" banner (updateCheck.ts / App.svelte) instead
 * of introducing a second, competing update UI.
 *
 * `registerType: 'prompt'` (set in vite.config.ts) means a new service
 * worker installs but sits WAITING — it never activates or reloads the page
 * on its own. That matters here: an unannounced reload mid-ride would yank
 * the player out of a running battle. Activation only happens when the
 * caller (App.svelte, via the same banner Phase 1 already shows) invokes
 * the `applyUpdate` callback this module hands back, typically from a
 * "tap to reload" button.
 *
 * This module is additive, not a replacement: `updateCheck.ts`'s
 * version.txt poll keeps running too (cheap, and the only signal in
 * contexts where the SW never registers). Both feed the same
 * `updateAvailable` flag in App.svelte, so the player only ever sees one
 * banner regardless of which one fired first.
 *
 * REWORK (2026-07-20): this used to rely entirely on the browser's own
 * automatic check for whether `sw.js`'s bytes changed — real, but throttled
 * to roughly once per 24h per registration by most browsers. Combined with
 * updateCheck.ts's poll being separately blind at the time (see that file's
 * doc comment), a player could go a full day or more without ever seeing
 * the banner, purely from that throttling — not a malfunction, just two
 * slow paths compounding. Now `registration.update()` is called explicitly
 * on the same 3-minute-plus-on-focus cadence updateCheck.ts already polls
 * on, so THIS mechanism — the one that actually detects a real update —
 * fires promptly after a real deploy instead of waiting on browser
 * throttling. Nothing about the "never force-reload a mid-ride player"
 * guarantee changes: this only makes the waiting-SW banner appear sooner,
 * never activates anything on its own.
 */

type UpdateSWFn = (reloadPage?: boolean) => Promise<void>;

export interface PwaUpdateHandle {
  /** Activates the waiting SW and reloads — pass to the banner's button.
   * `null` if this browser/context has no SW support. */
  updateSW: UpdateSWFn | null;
  /** Stops the periodic `registration.update()` poll — call from the
   * component's `onMount` cleanup. A no-op if there was nothing to stop. */
  stop: () => void;
}

/**
 * Registers the service worker, starts listening for a waiting update, and
 * starts forcing prompt update checks (see the module doc comment above).
 * `onNeedRefresh` fires (possibly more than once) whenever a new SW has
 * installed and is ready to take over — the caller should surface/re-show
 * its "reload" banner. The returned `updateSW` function activates the
 * waiting SW and reloads (e.g. from the banner's reload button).
 *
 * Safe to call in environments without SW support (e.g. some dev setups) —
 * the dynamic import of the virtual module is wrapped so a failure here
 * never breaks the rest of the app; updateCheck.ts's poll still works.
 */
export async function startPwaUpdate(onNeedRefresh: () => void): Promise<PwaUpdateHandle> {
  const noop: PwaUpdateHandle = { updateSW: null, stop: () => {} };
  if (!('serviceWorker' in navigator)) return noop;
  try {
    // Virtual module injected by vite-plugin-pwa; typed via
    // `vite-plugin-pwa/client` (see vite-env.d.ts).
    const { registerSW } = await import('virtual:pwa-register');
    let registration: ServiceWorkerRegistration | undefined;
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        onNeedRefresh();
      },
      onRegisteredSW(_swScriptUrl, reg) {
        registration = reg;
      },
    });

    // `registration.update()` asks the browser to re-fetch sw.js from the
    // network right now, bypassing the default throttled automatic check —
    // see the module doc comment. `registration` may still be undefined for
    // a tick after registerSW returns (onRegisteredSW hasn't fired yet); a
    // no-op call here just waits for the next tick of this same interval.
    const check = () => void registration?.update();
    const intervalId = setInterval(check, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return {
      updateSW,
      stop: () => {
        clearInterval(intervalId);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      },
    };
  } catch {
    // No SW support in this build/context (e.g. `vite dev` without the
    // plugin's dev SW enabled) — updateCheck.ts's poll-and-banner still
    // covers us.
    return noop;
  }
}
