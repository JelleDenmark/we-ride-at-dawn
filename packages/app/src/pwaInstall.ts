/**
 * Install-prompt capture for PWA Phase 2 (PWA-SCOPE.md). Framework-agnostic,
 * same style as updateCheck.ts: small functions, no throws, callers decide
 * the UI. ROADMAP.md's retention-loop notes want the install nudge surfaced
 * after the player's first good ride, not shown cold on page load — the
 * *timing* of that is App.svelte's job (it already tracks `seasonBest`);
 * this module only handles capturing/firing the underlying browser prompt.
 *
 * Chromium/Android fires `beforeinstallprompt`, which we capture and defer
 * (calling `.prompt()` ourselves later, once the "first good ride" gate
 * passes). iOS Safari never fires that event — there is no programmatic
 * install API — so callers must fall back to a manual "Share → Add to Home
 * Screen" nudge, gated on `isIOS() && !isStandalone()`.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

/**
 * Starts listening for the browser's install prompt. `onAvailable` fires
 * once the prompt has been captured and is ready to show via
 * `promptInstall()`. Also clears the captured prompt on `appinstalled` (a
 * user can install via the browser's own UI, not just ours) and calls
 * `onInstalled` so the caller can hide any nudge for good. Returns a
 * teardown function — call it from the component's `onMount` cleanup.
 */
export function startInstallPromptCapture(
  onAvailable: () => void,
  onInstalled: () => void
): () => void {
  function onBeforeInstallPrompt(e: Event): void {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    onAvailable();
  }
  function onAppInstalled(): void {
    deferredPrompt = null;
    onInstalled();
  }
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.removeEventListener('appinstalled', onAppInstalled);
  };
}

/**
 * Shows the captured browser install prompt. A `BeforeInstallPromptEvent`
 * can only be used once, so the captured reference is cleared regardless of
 * outcome. Returns 'unavailable' if no prompt has been captured (e.g.
 * already installed, unsupported browser, or called before
 * `beforeinstallprompt` fired).
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const evt = deferredPrompt;
  deferredPrompt = null;
  await evt.prompt();
  const { outcome } = await evt.userChoice;
  return outcome;
}

/** iOS/iPadOS Safari has no `beforeinstallprompt` — needs the manual
 * "Share → Add to Home Screen" nudge instead. */
export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** True once the app is already running installed (standalone display
 * mode) — covers both the standard media query and iOS Safari's older
 * `navigator.standalone` flag. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}
