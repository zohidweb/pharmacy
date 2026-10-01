import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { findDataAccessViolations } from '../../../test/architecture';

const apiRoot = resolve(__dirname, '../../..');

function listSources(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listSources(full));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.int-spec.ts') &&
      entry.name !== 'db.generated.ts'
    ) {
      result.push(full);
    }
  }
  return result;
}

describe('findDataAccessViolations', () => {
  const scan = (path: string, source: string) =>
    findDataAccessViolations([{ path, source }]);

  describe('rule 1: PlatformDatabase only in app/platform/** and app/sync/**', () => {
    it('flags a relative import of core/database/platform in another module', () => {
      const violations = scan(
        'src/app/pos/pos.service.ts',
        `import { PlatformDatabase } from '../../core/database/platform';`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('src/app/pos/pos.service.ts');
      expect(violations[0]).toContain('ADR-0013');
    });

    it('flags a multi-line import and an export-from', () => {
      expect(
        scan(
          'src/app/pos/a.ts',
          `import {\n  PlatformDatabase,\n} from '../../core/database/platform';`,
        ),
      ).toHaveLength(1);
      expect(
        scan(
          'src/app/pos/b.ts',
          `export { PlatformDatabase } from '../../core/database/platform/index';`,
        ),
      ).toHaveLength(1);
    });

    it.each([
      'src/app/platform/tenants/tenants.service.ts',
      'src/app/sync/sync.service.ts',
    ])('allows the import in %s', (path) => {
      const depth = path.split('/').length - 2; // directories below src
      const up = '../'.repeat(depth);
      expect(
        scan(
          path,
          `import { PlatformDatabase } from '${up}core/database/platform';`,
        ),
      ).toEqual([]);
    });
  });

  describe('rule 2: no direct pg / Kysely / Pool outside core/database', () => {
    it('flags an import from pg', () => {
      const violations = scan(
        'src/app/inventory/inventory.service.ts',
        `import { Pool } from 'pg';`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('ADR-0006');
    });

    it('flags require of pg and a side-effect import', () => {
      expect(scan('src/app/a.ts', `const pg = require('pg');`)).toHaveLength(1);
      expect(scan('src/app/b.ts', `import 'pg';`)).toHaveLength(1);
    });

    it('flags new Kysely( and new Pool(', () => {
      expect(
        scan('src/app/pos/a.ts', `const db = new Kysely<DB>({ dialect });`),
      ).toHaveLength(1);
      expect(scan('src/app/pos/b.ts', `const p = new Pool({});`)).toHaveLength(
        1,
      );
    });

    it('allows pg, Pool and Kysely inside core/database', () => {
      expect(
        scan(
          'src/core/database/pool.ts',
          `import { Pool } from 'pg';\nexport const p = new Pool({});\nconst k = new Kysely<DB>({ dialect });`,
        ),
      ).toEqual([]);
    });

    it('does not flag unrelated packages whose name starts with pg', () => {
      expect(scan('src/app/a.ts', `import x from 'pgsql-helper';`)).toEqual([]);
    });
  });

  describe('rule 3: core/database only through its index', () => {
    it('flags an import of an internal file', () => {
      const violations = scan(
        'src/app/pos/pos.service.ts',
        `import { TenantDatabase } from '../../core/database/tenant-database';`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('index');
    });

    it('flags a non-relative internal import', () => {
      expect(
        scan('src/app/a.ts', `import { x } from 'core/database/pool';`),
      ).toHaveLength(1);
    });

    it('allows the public index, with or without the /index suffix', () => {
      expect(
        scan(
          'src/app/pos/a.ts',
          `import { TenantDatabase } from '../../core/database';`,
        ),
      ).toEqual([]);
      expect(
        scan(
          'src/app/pos/b.ts',
          `import { TenantDatabase } from '../../core/database/index';`,
        ),
      ).toEqual([]);
    });

    it('allows internal imports within core/database', () => {
      expect(
        scan(
          'src/core/database/index.ts',
          `export { TenantDatabase } from './tenant-database';`,
        ),
      ).toEqual([]);
      expect(
        scan(
          'src/core/database/platform/platform-database.ts',
          `import { createPool } from '../pool';`,
        ),
      ).toEqual([]);
    });
  });

  it('reports every violation across several files', () => {
    const violations = findDataAccessViolations([
      { path: 'src/app/a.ts', source: `import { Pool } from 'pg';` },
      { path: 'src/app/b.ts', source: `import { ok } from './c';` },
      {
        path: 'src/app/pos/d.ts',
        source: `import { PlatformDatabase } from '../../core/database/platform';`,
      },
    ]);
    expect(violations).toHaveLength(2);
  });
});

describe('apps/api/src', () => {
  it('apps/api/src has no data access violations', () => {
    const files = listSources(join(apiRoot, 'src')).map((full) => ({
      path: relative(apiRoot, full).split(sep).join('/'),
      source: readFileSync(full, 'utf8'),
    }));
    expect(files.map((f) => f.path)).toContain('src/main.ts');
    expect(findDataAccessViolations(files)).toEqual([]);
  });
});
