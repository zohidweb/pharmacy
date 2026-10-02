import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkText } from './check-docs.mjs';

const noFiles = () => false;
const rulesOf = (text, exists = noFiles) => checkText('.claude/skills/x/SKILL.md', text, exists).map((v) => v.rule);

test('flags each stale pattern with its rule name', () => {
  const cases = {
    'orm-undecided': 'ORM не выбран — смотри ADR',
    'rejected-orm': 'Вариант А: Prisma 7',
    'old-db-service': 'constructor(private readonly db: DatabaseService) {}',
    'old-module-path': 'apps/api/src/modules/pos/pos.service.ts',
    currency: 'Курсы валют НБТ загружаются ночью',
    'old-redis-client': "import Redis from 'ioredis';",
    'old-hash': 'Хеш пароля — bcrypt',
    'fsd-old-layer': 'Провайдеры лежат в src/_app/providers',
    'ci-undecided': 'CI пока не выбран — запускайте вручную',
    'tailwind-pending': 'Tailwind — только после ADR-0007',
    'rls-missing-ok': "using (tenant_id = current_setting('app.tenant_id', true)::uuid)",
    'uuid-default': 'id uuid primary key default gen_random_uuid()',
    'old-alias': "import { CreateReceiptDto } from '@pharmacy/shared/dto';",
    'perm-two-args': "@RequirePermission('catalog', 'create')",
    'perm-not-in-catalog': "@RequirePermission('catalog:read')",
    'old-app-structure': "import { CatalogModule } from '../modules/catalog/catalog.module';",
    'cors-enabled': 'app.enableCors({ origin: secCfg.corsOrigins, credentials: true });',
    'ts-jest': "transform: { '^.+\\\\.ts$': 'ts-jest' }",
    'orm-after-adr': 'логирование SQL — средствами выбранного ORM после ADR',
    'deep-db-import': "import { newId } from '../../core/database/ids';",
    'ctx-getter-missing': 'const correlationId = getCorrelationId();',
    'health-route': 'GET /api/health/ready — readiness',
    'inbox-on-conflict': 'ON CONFLICT (tenant_id, store_id, operation_id) DO NOTHING',
    'job-queue-columns': 'update pharmacy.job_queue set locked_by = $1',
  };
  for (const [rule, line] of Object.entries(cases)) {
    assert.deepEqual(rulesOf(line), [rule], `line: ${line}`);
  }
});

test('allows legitimate neighbours of the stale-pattern rules', () => {
  assert.deepEqual(rulesOf('`@golevelup/ts-jest` is not used'), []);
  assert.deepEqual(rulesOf('**File:** `apps/api/src/app/config/config.module.ts`'), []);
  assert.deepEqual(rulesOf("import { PlatformDatabase } from '../../core/database/platform';"), []);
  assert.deepEqual(rulesOf("import { DatabaseModule } from '../core/database';"), []);
  assert.deepEqual(rulesOf("@RequirePermission('pos:sell-controlled', { storeParam: 'storeId' })"), []);
});

test('skips a line marked docs-check: ok', () => {
  assert.deepEqual(rulesOf('Prisma отклонена (ADR-0006) <!-- docs-check: ok -->'), []);
  assert.deepEqual(rulesOf('  id uuid default gen_random_uuid() primary key  -- docs-check: ok'), []);
});

test('reports a relative link to a missing file and accepts an existing one', () => {
  const exists = (p) => p.endsWith('reference/present.md');
  assert.deepEqual(rulesOf('[a](reference/missing.md)', exists), ['broken-link']);
  assert.deepEqual(rulesOf('[a](reference/present.md#section)', exists), []);
});

test('ignores http links and pure anchors', () => {
  assert.deepEqual(rulesOf('[a](https://example.com/x.md) [b](#section) [c](mailto:x@y.z)'), []);
  assert.deepEqual(rulesOf(String.raw`date pattern [0-9](\d{1,2}) in prose`), []);
});

test('reports 1-based line numbers', () => {
  const violations = checkText('CLAUDE.md', 'ok line\nCI не выбран', noFiles);
  assert.deepEqual(violations.map((v) => v.line), [2]);
});
