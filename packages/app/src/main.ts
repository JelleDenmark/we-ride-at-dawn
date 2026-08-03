import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

mount(App, { target: document.getElementById('app')! });

// Tells the blank-screen self-heal in index.html that the bundle really did
// execute, standing its watchdog down. Set only after `mount` returns, so a
// throw during mount still counts as a failed boot and recovers.
(window as unknown as { __WRAD_MOUNTED__?: boolean }).__WRAD_MOUNTED__ = true;

// Recovery reloads carry a one-off `?_fresh=<ts>` cache-buster (see
// index.html). Drop it once we're safely running so it never gets bookmarked,
// shared, or added to the PWA home screen — `replaceState` leaves no history
// entry, so Back still behaves normally.
if (location.search.indexOf('_fresh=') !== -1) {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('_fresh');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    // Cosmetic only — a stuck query param is harmless.
  }
}
