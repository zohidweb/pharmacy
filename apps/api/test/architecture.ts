import { posix } from 'node:path';

export interface SourceFile {
  /** Path relative to apps/api, forward slashes (e.g. `src/app/pos/pos.service.ts`). */
  path: string;
  source: string;
}

const PLATFORM_ZONES = ['src/app/platform/', 'src/app/sync/'];
const DATABASE_ZONE = 'src/core/database/';

const IMPORT_PATTERNS: RegExp[] = [
  // import … from '…' / export … from '…' (also multi-line)
  /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
  // import '…'
  /\bimport\s*['"]([^'"]+)['"]/g,
  // import('…')
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  // require('…')
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const DIRECT_CLIENT = /\bnew\s+(Kysely|Pool)\s*[(<]/;
const DATABASE_SPECIFIER = /(?:^|\/)core\/database(?:\/(.*))?$/;

function specifiers(source: string): string[] {
  const result: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      result.push(match[1]);
    }
  }
  return result;
}

function resolveSpecifier(filePath: string, specifier: string): string {
  return specifier.startsWith('.')
    ? posix.normalize(posix.join(posix.dirname(filePath), specifier))
    : specifier;
}

const startsWithAny = (path: string, prefixes: string[]) =>
  prefixes.some((prefix) => path.startsWith(prefix));

/**
 * Data-access boundary rules (ADR-0013 §7, ADR-0006) over a set of source files.
 * Returns one human-readable message per violation; an empty array means clean.
 */
export function findDataAccessViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];

  for (const { path, source } of files) {
    const insideDatabase = path.startsWith(DATABASE_ZONE);
    const platformAllowed =
      insideDatabase || startsWithAny(path, PLATFORM_ZONES);

    for (const specifier of specifiers(source)) {
      if (
        !insideDatabase &&
        (specifier === 'pg' || specifier.startsWith('pg/'))
      ) {
        violations.push(
          `${path}: ADR-0006: use TenantDatabase from core/database; no direct pg access (import '${specifier}').`,
        );
      }

      const match = DATABASE_SPECIFIER.exec(resolveSpecifier(path, specifier));
      if (!match || insideDatabase) continue;

      const rest = match[1] ?? '';
      const [first] = rest.split('/');
      if (first === 'platform') {
        if (!platformAllowed) {
          violations.push(
            `${path}: ADR-0013: PlatformDatabase is available only in app/platform/** and app/sync/** (import '${specifier}').`,
          );
        }
      } else if (rest !== '' && rest !== 'index') {
        violations.push(
          `${path}: ADR-0006: import core/database through its index (import '${specifier}').`,
        );
      }
    }

    if (!insideDatabase) {
      const direct = DIRECT_CLIENT.exec(source);
      if (direct) {
        violations.push(
          `${path}: ADR-0006: use TenantDatabase from core/database; no direct pg access (new ${direct[1]}()).`,
        );
      }
    }
  }

  return violations;
}
