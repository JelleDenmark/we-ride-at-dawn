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
 * index.html-hash poll keeps running too (cheap, already battle-tested, and
 * a useful fallback for browsers/contexts where the SW never registers).
 * Both signals feed the same `updateAvailable` flag in App.svelte, so the
 * player only ever sees one banner regardless of which one fired first.
 */

type UpdateSWFn = (reloadPage?: boolean) => Promise<void>;

/**
 * Registers the service worker and starts listening for a waiting update.
 * `onNeedRefresh` fires (possibly more than once) whenever a new SW has
 * installed and is ready to take over — the caller should surface/re-show
 * its "reload" banner. Returns an `applyUpdate` function: call it (e.g. from
 * the banner's reload button) to activate the waiting SW and reload.
 *
 * Safe to call in environments without SW support (e.g. some dev setups) —
 * the dynamic import of the virtual module is wrapped so a failure here
 * never breaks the rest of the app; `updateCheck.ts`'s poll still works.
 */
export async function startPwaUpdate(onNeedRefresh: () => void): Promise<UpdateSWFn | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // Virtual module injected by vite-plugin-pwa; typed via
    // `vite-plugin-pwa/client` (see vite-env.d.ts).
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        onNeedRefresh();
      },
    });
    return updateSW;
  } catch {
    // No SW support in this build/context (e.g. `vite dev` without the
    // plugin's dev SW enabled) — Phase 1's poll-and-banner still covers us.
    return null;
  }
}
