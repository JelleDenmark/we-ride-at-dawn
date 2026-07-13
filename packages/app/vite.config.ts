import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// Mirrors env.ts's CHANNEL logic (that file resolves it at runtime via
// import.meta.env; here we need the same value at *build* time to
// channel-namespace the service-worker cache, matching persistence.ts's
// `NS = 'wrad' | 'wrad-dev'` scheme so a dev SW can never collide with or
// evict a prod precache entry on the shared origin — see PWA-SCOPE.md's
// "two-channel / base-path gotchas".
const CHANNEL = process.env.VITE_CHANNEL === 'prod' ? 'prod' : 'dev';

export default defineConfig({
  // Relative asset paths so the build works under any GitHub Pages
  // subpath (e.g. /we-ride-at-dawn/) without hardcoding the repo name.
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      // 'prompt' (not 'autoUpdate'): a waiting SW must NOT silently take
      // over and reload the page out from under a mid-ride player. This
      // maps onto the existing Phase-1 "fresh build rode in" banner
      // (updateCheck.ts / App.svelte) — see pwaUpdate.ts for the glue.
      registerType: 'prompt',
      // We register the SW ourselves (pwaUpdate.ts) so we can wire
      // onNeedRefresh into the same banner state Phase 1 already uses,
      // instead of the plugin's own auto-injected prompt UI.
      injectRegister: null,
      manifest: {
        name: 'We Ride at Dawn',
        short_name: 'WRAD',
        description: 'An idle auto-battler horde-builder. Ride at dawn.',
        // Relative start_url/scope so the identical manifest works
        // unmodified at both deploy paths (prod at /, dev at /dev/) —
        // same reasoning as `base: './'` above.
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#0d0b09',
        theme_color: '#0d0b09',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Channel-scoped cache names (see CHANNEL comment above).
        cacheId: `wrad-${CHANNEL}`,
        cleanupOutdatedCaches: true,
        // Precached, content-hashed assets are safely cache-first by
        // construction (a new deploy = new hashed filenames = new precache
        // entries). Navigation requests fall back to the precached
        // index.html only once the new SW has actually activated — the
        // `registerType: 'prompt'` flow above means a stale index.html is
        // never served cache-first indefinitely; see PWA-SCOPE.md's "key
        // risk" note.
        navigateFallback: './index.html',
      },
      // Icons/manifest only — Supabase calls are never precached (the app
      // already tolerates offline there; see PWA-SCOPE.md Phase 2 "Offline").
      includeAssets: ['icons/*.png'],
    }),
  ],
  server: { port: 5173, strictPort: true },
  optimizeDeps: { exclude: ['@wrad/core'] },
  build: {
    // Keep unit SVGs as real files (never inline as data: URLs) so PixiJS's
    // extension-based SVG detection works on the production build.
    assetsInlineLimit: (file: string) => (file.endsWith('.svg') ? false : undefined),
  },
});
