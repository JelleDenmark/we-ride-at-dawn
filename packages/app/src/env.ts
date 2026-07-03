/**
 * Build channel: the deploy workflow sets VITE_CHANNEL=prod for the
 * master build. Everything else — local dev server, local builds, the
 * dev-branch deployment — is 'dev' and gets the testing toolbar,
 * namespaced storage, and dev-flagged telemetry.
 */
export const CHANNEL: 'dev' | 'prod' =
  import.meta.env.VITE_CHANNEL === 'prod' ? 'prod' : 'dev';
