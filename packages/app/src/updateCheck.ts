/**
 * Stale-tab detector: an open tab keeps running the JS it loaded with
 * forever and never learns a new build shipped (see PWA-SCOPE.md Phase 1 —
 * this is what player "CarryRotte" hit right after the 0.6.0 ship). Since
 * every real deploy content-hashes the entry bundle (e.g.
 * `assets/index-RbDxdpOe.js`), a changed filename is a reliable, zero-config
 * signal of a new build — and it's channel-safe because everything here is
 * a relative fetch (`./index.html`), so prod and dev each check their own
 * path with no configuration.
 *
 * No service worker, no manifest, no build changes — see PWA-SCOPE.md
 * Phase 1. This module is deliberately small and framework-agnostic; the
 * Svelte component wires it to a local `$state` via `onUpdateAvailable`.
 */

/** Poll every ~3 minutes; also re-checked whenever the tab becomes visible. */
export const POLL_INTERVAL_MS = 3 * 60_000;

/** Pull the hashed entry script filename referenced by an index.html document
 * (works on both the live DOM and a freshly fetched HTML string). Returns
 * null if no module script tag is found — callers must treat that as "can't
 * tell, don't act." */
function extractEntryScript(doc: Document): string | null {
  const script = doc.querySelector('script[type="module"][src]');
  const src = script?.getAttribute('src');
  return src ?? null;
}

/** The baseline must represent the code actually running in this tab, not a
 * fresh fetch (a fresh fetch could already reflect a newer deploy while this
 * tab is still executing the old bundle). `import.meta.url` resolves to the
 * hashed entry file this module was loaded from, so it's the most direct
 * signal. Fall back to the DOM's own script tag if that ever looks wrong
 * (e.g. a bundler change makes import.meta.url point somewhere unexpected). */
function captureBaseline(): string | null {
  try {
    const url = new URL(import.meta.url);
    const file = url.pathname.split('/').pop();
    if (file) return file;
  } catch {
    // fall through to the DOM fallback below
  }
  const src = extractEntryScript(document);
  if (!src) return null;
  try {
    return new URL(src, document.baseURI).pathname.split('/').pop() ?? null;
  } catch {
    return src.split('/').pop() ?? null;
  }
}

/** Fetch `./index.html` fresh (bypassing caches) and pull out the entry
 * script filename it currently references. Relative so it resolves under
 * each channel's own base path. Never throws — callers treat a null return
 * as "couldn't tell this tick, try again next time." */
async function fetchServedEntryScript(): Promise<string | null> {
  try {
    const res = await fetch('./index.html', { cache: 'no-store' });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const src = extractEntryScript(doc);
    if (!src) return null;
    return src.split('/').pop() ?? null;
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
  const baseline = captureBaseline();

  async function check(): Promise<void> {
    // No reliable baseline captured — never claim an update is available,
    // since we'd have nothing trustworthy to compare against.
    if (!baseline) return;
    const served = await fetchServedEntryScript();
    if (served && served !== baseline) onUpdateAvailable();
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
