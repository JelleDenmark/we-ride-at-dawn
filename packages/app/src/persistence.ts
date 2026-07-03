import type { BuildState } from '@wrad/core';
import { CHANNEL } from './env';

// Channel-namespaced so a dev build never clobbers the prod build state
// on the same origin.
const KEY = CHANNEL === 'prod' ? 'wrad-build' : 'wrad-build-dev';

export function saveBuild(build: BuildState): void {
  try {
    localStorage.setItem(`${KEY}:${build.date}`, JSON.stringify(build));
  } catch {
    // Storage full or unavailable — the build only lives for the session.
  }
}

export function loadBuild(date: string): BuildState | null {
  try {
    const raw = localStorage.getItem(`${KEY}:${date}`);
    return raw ? (JSON.parse(raw) as BuildState) : null;
  } catch {
    return null;
  }
}
