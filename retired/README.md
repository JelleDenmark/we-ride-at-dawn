# Retired-site redirect

What GitHub Pages serves for WRAD1 since its retirement (2026-11-06). The
deploy workflow copies this directory to both channels with `__TARGET__`
replaced: prod `/we-ride-at-dawn/` goes to `/we-ride-at-dawn-2/`, dev
`/we-ride-at-dawn/dev/` goes to `/we-ride-at-dawn-2/dev/`.

- `index.html` / `404.html`: meta-refresh, JS redirect and a visible link. Also
  unregisters any service worker and clears the old `wrad-*` caches.
- `sw.js`: a self-destroying service worker at the old SW's URL, so installed
  copies of the game stop serving the cached build offline.
