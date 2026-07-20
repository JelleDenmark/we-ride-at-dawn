/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injected via vite.config.ts's `define` — a fresh value per build, used by
 * updateCheck.ts to detect a new deploy. See that file's doc comment. */
declare const __BUILD_ID__: string;
