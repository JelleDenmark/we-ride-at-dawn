import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Relative asset paths so the build works under any GitHub Pages
  // subpath (e.g. /we-ride-at-dawn/) without hardcoding the repo name.
  base: './',
  plugins: [svelte()],
  server: { port: 5173, strictPort: true },
  optimizeDeps: { exclude: ['@wrad/core'] },
  build: {
    // Keep unit SVGs as real files (never inline as data: URLs) so PixiJS's
    // extension-based SVG detection works on the production build.
    assetsInlineLimit: (file: string) => (file.endsWith('.svg') ? false : undefined),
  },
});
