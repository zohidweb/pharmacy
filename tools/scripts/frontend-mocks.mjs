// The API mocks of web and admin must never reach a test or prod build (security review 2026-10-22, F1):
// NEXT_PUBLIC_API_MOCKS is inlined at build time, and a mock build left in the Nx cache or picked up from the
// environment would ship in-memory mocks and the demo session. The mock transports keep their session under these
// keys, so a bundle that carries one carries the mocks.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOCK_MARKERS = ['pharmacy-web-mock-session', 'pharmacy-admin-mock-session'];

/** The first file of `apps/<app>/out` that carries the API mocks, relative to the root, or null. */
export function findMockBuild(root, apps = ['web', 'admin']) {
  for (const app of apps) {
    const out = join(root, 'apps', app, 'out');
    let files;
    try {
      files = readdirSync(out, { recursive: true });
    } catch {
      continue; // no build of this app
    }
    for (const file of files) {
      if (!/\.(js|html)$/.test(file)) continue;
      const text = readFileSync(join(out, file), 'utf8');
      if (MOCK_MARKERS.some((marker) => text.includes(marker))) {
        return join('apps', app, 'out', file);
      }
    }
  }
  return null;
}
