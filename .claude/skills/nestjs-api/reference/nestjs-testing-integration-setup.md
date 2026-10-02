> **Pharmacy:** адаптировано под стек Pharmacy — Jest; реальная PostgreSQL из docker compose (ADR-0009, ось А; Testcontainers не используем); миграции — node-pg-migrate тем же `apps/api/scripts/migrate.mjs`, что в проде (ADR-0006); два уровня — интеграционные тесты слоя данных в `apps/api` и HTTP e2e в `apps/api-e2e`. Ограничения: `CLAUDE.md`.

# NestJS Testing — Integration & E2E Setup

Только реальная PostgreSQL — никаких in-memory/SQLite-подмен: RLS, `FOR UPDATE SKIP LOCKED`,
уникальность ключей идемпотентности и транзакции проверяются на той же СУБД (образ
`docker/postgres`, PostgreSQL 17), что в проде и на офлайн-точке. Локально и в CI —
`npm run dev:deps` (compose), отдельная БД, прикладная роль без обхода RLS.

## Уровень 1 — интеграционные тесты `apps/api` (`*.int-spec.ts`) — уже есть

| Что | Где |
|---|---|
| Запуск | `npx nx run api:integration` (`jest.integration.config.cts`, `runInBand`, без кэша) |
| БД | `pharmacy_test` (создаёт initdb dev-контейнера); имя обязано оканчиваться на `_test` |
| Global setup | `apps/api/test/integration/global-setup.ts`: защита от dev-БД → `drop schema pharmacy cascade` + `public.pgmigrations` → `docker/postgres/initdb/02-database.sql` → `node apps/api/scripts/migrate.mjs` |
| URL | `testDatabaseUrls(process.env)` подменяет имя БД в `DATABASE_URL` / `PLATFORM_DATABASE_URL` / `MIGRATION_DATABASE_URL` из корневого `.env` |
| Пулы | `apps/api/test/integration/connections.ts`: `appPool()` (`pharmacy_app`), `platformPool()` (`pharmacy_platform`), `ownerPool()` (`pharmacy_owner`), `closeAll()` |
| Данные | `apps/api/test/integration/seed.ts`: `seedTenant(code)` — тенант под платформой, юрлицо и точка под приложением в контексте тенанта, id — `newId()` |

Что здесь проверяется:
- `TenantDatabase` / `PlatformDatabase` на пуле из одного соединения (контекст не протекает,
  откат и освобождение соединения, таймауты);
- каталог `pg_catalog` (`catalog.int-spec.ts`) и поведение двух тенантов
  (`isolation.int-spec.ts`) — `nestjs-testing-integration-patterns.md`;
- репозитории модулей с реальным SQL (FEFO, остатки, идемпотентная вставка).

## Уровень 2 — HTTP e2e `apps/api-e2e`

Проект `apps/api-e2e` (Jest + supertest/axios, ADR-0015: `axios` только здесь) запускает собранный
API (`dependsOn: api:serve`) и ходит в него по HTTP. Он требует ту же PostgreSQL, свою БД
(`pharmacy_e2e_test`) и Redis.

```typescript
// apps/api-e2e/src/support/global-setup.ts (when e2e needs the database)
import { execFileSync } from 'node:child_process';
import { waitForPortOpen } from '@nx/node/utils';

export default async function globalSetup() {
  const ownerUrl = process.env.E2E_MIGRATION_DATABASE_URL;   // pharmacy_owner, database *_test
  if (!ownerUrl) throw new Error('E2E_MIGRATION_DATABASE_URL is not set');
  // The same migrator and migration files as production — no schema sync.
  execFileSync(process.execPath, ['apps/api/scripts/migrate.mjs'], {
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
    stdio: 'inherit',
  });
  // Seed synthetic tenants/employees through the API or a seed script that uses the app's
  // PasswordHasher — no hashes hard-coded in tests.
  await waitForPortOpen(Number(process.env.API_PORT ?? 3000), { host: 'localhost' });
}
```

- API в e2e подключается прикладными ролями (`DATABASE_URL` → `pharmacy_app`,
  `PLATFORM_DATABASE_URL` → `pharmacy_platform`) к той же `*_test` БД; суперпользователь и
  владелец таблиц для приложения запрещены — тест изоляции «пройдёт» ложно.
- Очистка между файлами — пересоздание схемы, как в уровне 1 (append-only таблицы не
  очищаются `TRUNCATE` прикладной ролью — и не должны).
- Cookie сессии — `__Host-sid` с `Secure` (ADR-0008): по `http://localhost` cookie-jar
  supertest его не отправит. Тестовая среда либо поднимает API за HTTPS, либо конфигурация
  **только test-окружения** снимает префикс `__Host-` и `Secure` (как офлайн-точка, ADR-0008).

## Каркас e2e-файла

```typescript
// apps/api-e2e/src/catalog/products.spec.ts
import request from 'supertest';
import { loginAs, TENANT_A } from '../support/auth';

const baseUrl = `http://localhost:${process.env.API_PORT ?? 3000}`;

describe('Catalog API (e2e)', () => {
  it('POST /api/v1/products creates a product in the caller tenant', async () => {
    const agent = await loginAs(baseUrl, TENANT_A.owner);

    const res = await agent
      .post('/api/v1/products')
      .send({ name: { ru: 'Парацетамол 500 мг', tj: 'Парасетамол 500 мг' }, piecesPerPack: 10,
              isPrescription: false, isControlled: false, barcodes: ['4600000000017'] })
      .expect(201);

    // The other tenant does not see it — 404, not 403
    const other = await loginAs(baseUrl, TENANT_A.otherTenantOwner);
    await other.get(`/api/v1/products/${res.body.id}`).expect(404);
  });

  it('returns RFC 7807 problem on validation error', async () => {
    const agent = await loginAs(baseUrl, TENANT_A.owner);
    const res = await agent.post('/api/v1/products').send({ barcodes: [123] }).expect(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', correlationId: expect.any(String) });
  });
});
```

```typescript
// apps/api-e2e/src/support/auth.ts
import request from 'supertest';
import { SEED } from './fixtures'; // synthetic seed users, the same file the seed step reads

export const TENANT_A = SEED.tenants.a;

/** Logs in with login+password (POST /api/v1/sessions); the agent keeps the session cookie. */
export async function loginAs(baseUrl: string, user: { tenantCode: string; login: string; password: string }) {
  const agent = request.agent(baseUrl);
  await agent.post('/api/v1/sessions').set('Origin', baseUrl).send(user).expect((res) => {
    if (res.status >= 300) throw new Error(`login failed: ${res.status}`);
  });
  return agent;
}
```

Небезопасные методы проходят CSRF-guard: `Origin` должен совпасть с разрешённым origin
(`nestjs-security-auth.md`). Тестовые учётные данные — синтетические, в fixtures; реальные
пароли и данные клиентов в тестах запрещены. Внешний вендор ККМ в e2e — локальный фейк-сервер
на `node:http` в globalSetup (ADR-0009, ось Б); в MVP фискализация — заглушка.

## Внутрипроцессные тесты с подменой провайдера

Когда нужно заставить провайдер упасть (например, адаптер фискализации), —
`Test.createTestingModule({ imports: [AppModule] }).overrideProvider(FISCAL_REGISTRAR).useValue(...)`
+ `app.getHttpServer()` в supertest. Такие тесты импортируют код api и живут в `apps/api` как
`*.int-spec.ts` (уровень 1). Предпочтительно вызывать сбой через данные (кейс атомарности в
`nestjs-testing-integration-patterns.md`).
