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
  };
  for (const [rule, line] of Object.entries(cases)) {
    assert.deepEqual(rulesOf(line), [rule], `line: ${line}`);
  }
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
});

test('reports 1-based line numbers', () => {
  const violations = checkText('CLAUDE.md', 'ok line\nCI не выбран', noFiles);
  assert.deepEqual(violations.map((v) => v.line), [2]);
});
