// The static exports of web and admin in a test or prod build (security review 2026-10-22, F1): each must exist and
// must not carry the API mocks. NEXT_PUBLIC_API_MOCKS is inlined at build time, and a mock build left in the Nx cache
// or picked up from the environment would ship in-memory mocks and the demo session. The mock transports keep their
// session under these keys (SESSION_KEY in apps/web/src/shared/api/mocks/session.ts and
// apps/admin/src/shared/api/mocks/transport.ts — keep them in step), so a bundle that carries one carries the mocks.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOCK_MARKERS = ['pharmacy-web-mock-session', 'pharmacy-admin-mock-session'];

/** Why the static exports of the apps cannot ship, or null when they can. */
export function frontendBuildProblem(root, apps = ['web', 'admin']) {
  for (const app of apps) {
    const out = join('apps', app, 'out');
    let files;
    try {
      files = readdirSync(join(root, out), { recursive: true });
    } catch {
      return `${out} is missing: the build left no static export of ${app}`;
    }
    for (const file of files) {
      if (!/\.(js|html)$/.test(file)) continue;
      const text = readFileSync(join(root, out, file), 'utf8');
      if (MOCK_MARKERS.some((marker) => text.includes(marker))) {
        return `${join(out, file)} carries the API mocks (NEXT_PUBLIC_API_MOCKS): rebuild without it`;
      }
    }
  }
  return null;
}
