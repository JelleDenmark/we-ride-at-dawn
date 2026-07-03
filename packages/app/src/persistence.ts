import type { BuildState } from '@wrad/core';

const KEY = 'wrad-build';

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
