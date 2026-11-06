// Self-destroying service worker. WRAD1 is retired (redirects to WRAD2).
// Any installed copy of the old game picks this up on its next update check
// (the old app calls registration.update() every few minutes), takes over at
// once, deletes the old caches, unregisters itself and reloads its pages, which
// then load the redirect page from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Caches are per-origin and WRAD2 shares this origin: delete only WRAD1's
    // ('wrad-prod-*' / 'wrad-dev-*'; WRAD2's are 'wrad2-*').
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('wrad-')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) c.navigate(c.url);
  })());
});
