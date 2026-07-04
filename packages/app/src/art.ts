// Shared unit art: defId -> bundled SVG url, resolved at build time by Vite.
// Used by both the replay renderer (as PixiJS textures) and the shop/board
// tiles (as <img> portraits).
export const ART_URL: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('./replay/art/*.svg', { eager: true, query: '?url', import: 'default' })
  ).map(([path, url]) => [path.split('/').pop()!.replace('.svg', ''), url as string])
);
