# NestJS Data Access — PostgreSQL, tenant isolation, transactions, migrations

Слой доступа к данным `apps/api`: **Kysely поверх `pg`, SQL-миграции node-pg-migrate** (ADR-0006),
кросс-тенантный путь — отдельная роль без `BYPASSRLS` (ADR-0013). Реальный код —
`apps/api/src/core/database/`; примеры ниже повторяют его API, а не придумывают своё.

## Контракт слоя

1. Прикладной код работает с БД только через `TenantDatabase` (`core/database/index.ts`) и
   репозитории модулей. Пул `pg`, корневой `Kysely<DB>` и настройки наружу не экспортируются;
   импорт `pg` и внутренних файлов `core/database/*` вне `core/database/**` запрещён ESLint и
   архитектурным тестом (`apps/api/src/core/database/architecture.spec.ts`).
2. Любой запрос к прикладным таблицам — в **tenant-транзакции**: первым оператором
   `set_config('app.tenant_id', …, true)`, `statement_timeout` и `lock_timeout` (тоже `true` —
   только до конца транзакции). `tenantId` — из контекста запроса (guard), не из входных данных.
3. Репозиторий **дополнительно** фильтрует по `tenant_id` в каждом запросе (первый рубеж);
   RLS — второй рубеж.
4. Операция + её движения + запись аудита — одна транзакция.
5. Ошибки драйвера переводятся в доменные исключения в одном месте (ниже, «Коды ошибок»).
6. Схема меняется только миграциями node-pg-migrate (ниже, «Миграции»).

## TenantDatabase

```typescript
// apps/api/src/core/database/index.ts — the public surface
export { DatabaseModule } from './database.module';           // @Global, imported by AppModule
export { TenantDatabase, type TenantTransaction } from './tenant-database';
export type { DB } from './db.generated';                       // kysely-codegen output
```

| Метод | Когда |
|---|---|
| `tenantTransaction((trx) => …)` | **Сервисы.** Тенант берётся из контекста запроса (`requireTenantId()`); без контекста — `TenantContextMissingError` (500), а не запрос без тенанта |
| `withTenant(tenantId, (trx) => …)` | Только код, который сам устанавливает контекст: guards, обработчики задач «по тенанту в цикле» (ADR-0013 §4). `tenantId` проверяется как UUID до обращения к БД |

```typescript
// apps/api/src/app/catalog/products.service.ts (fragment)
import { Injectable } from '@nestjs/common';
import { requireTenantId } from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';
import { ProductsRepository } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly products: ProductsRepository,
  ) {}

  findOne(id: string) {
    const tenantId = requireTenantId();
    return this.db.tenantTransaction((trx) => this.products.findById(trx, tenantId, id));
  }
}
```

```typescript
// apps/api/src/app/catalog/products.repository.ts
import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';

@Injectable()
export class ProductsRepository {
  findById(trx: TenantTransaction, tenantId: string, id: string) {
    return trx
      .selectFrom('products')
      .select(['id', 'name', 'piecesPerPack', 'isControlled'])
      .where('tenantId', '=', tenantId) // first line of defence; RLS is the second
      .where('id', '=', id)
      .executeTakeFirst();
  }
}
```

- Репозиторий принимает `TenantTransaction` (`Transaction<DB>`) параметром — несколько
  репозиториев работают в одной транзакции, а вне транзакции запрос написать нельзя.
- **Внутри транзакции — только `trx`.** Обращение к корневому `Kysely` при наличии `trx`
  запрещено (ADR-0006 п. 1, чек-лист ревью).
- Почему транзакция даже для чтения: `set_config(…, true)` живёт до конца транзакции — на пуле
  соединений это единственный способ не «протечь» тенантом в чужой запрос. Регрессионный тест —
  `tenant-database.int-spec.ts`.
- Имена: в БД `snake_case`, в коде `camelCase` (`CamelCasePlugin`). Алиасы внутри сырого
  `sql\`…\`` пишутся в `snake_case`.
- Raw SQL — только тег `sql` с параметрами; `sql.raw`/`sql.lit` со входными данными запрещены.
  Тип `sql<T>` — утверждение разработчика: такой запрос покрывается тестом.

## Транзакция «чек + движения партий + аудит»

```typescript
// apps/api/src/app/pos/receipts.service.ts (fragment)
async completeReceipt(storeId: string, dto: CompleteReceiptDto): Promise<ReceiptResponseDto> {
  const tenantId = requireTenantId(); // storeId is already checked against the store scope by the guard
  return this.db.tenantTransaction(async (trx) => {
    // 1. Idempotent replay: same operationId -> the original result, never a second sale
    const existing = await this.receipts.findByOperationId(trx, tenantId, dto.operationId);
    if (existing) return this.assertSamePayloadAndMap(existing, dto);

    // 2. Lock the batches — one statement, stable order (fewer deadlocks)
    const batchIds = [...new Set(dto.lines.map((l) => l.batchId))].sort();
    const locked = await this.batches.lockForSale(trx, tenantId, storeId, batchIds);
    if (locked.length !== batchIds.length) throw new BatchNotFoundException();

    // 3. Count stock in the NEXT statement: stock is the sum of movements, never stored
    const onHand = await this.stock.onHandByBatch(trx, tenantId, batchIds); // Map<batchId, bigint>
    for (const line of dto.lines) {
      if ((onHand.get(line.batchId) ?? 0n) < BigInt(line.qtyPieces)) {
        throw new InsufficientStockException(line.batchId); // 422 problem+json
      }
    }

    // 4. Receipt, its negative movements and the audit record commit together
    const receipt = await this.receipts.insert(trx, tenantId, storeId, dto);
    if (!receipt) return this.replayAfterConcurrentInsert(trx, tenantId, dto); // ON CONFLICT DO NOTHING lost the race
    await this.stock.insertSaleMovements(trx, tenantId, storeId, receipt.id, dto.lines);
    await this.audit.append(trx, { action: 'receipt.completed', entityId: receipt.id });
    return this.toResponse(receipt);
  });
}
```

```typescript
// batches.repository.ts (fragment) — the lock is its own statement
lockForSale(trx: TenantTransaction, tenantId: string, storeId: string, batchIds: string[]) {
  return trx
    .selectFrom('batches')
    .select('id')
    .where('tenantId', '=', tenantId)
    .where('storeId', '=', storeId)
    .where('id', 'in', batchIds)
    .orderBy('id')
    .forUpdate()
    .execute();
}

// receipts.repository.ts (fragment) — idempotent insert
insert(trx: TenantTransaction, tenantId: string, storeId: string, dto: CompleteReceiptDto) {
  return trx
    .insertInto('receipts')
    .values({ id: newId(), tenantId, storeId, operationId: dto.operationId /* … */ })
    .onConflict((oc) => oc.columns(['tenantId', 'operationId']).doNothing())
    .returning(['id'])
    .executeTakeFirst(); // undefined when a concurrent request already inserted it
}
```

- **Блокировка отдельно от подсчёта** (ADR-0006 п. 2): `FOR UPDATE` — одним оператором, `SUM`
  движений — следующим. Объединённый «`FOR UPDATE` + подзапрос `SUM`» в READ COMMITTED видит
  старый снимок и приводит к перепродаже (воспроизведено в spike ADR-0006).
- id новых строк — `newId()` (UUIDv7, файл `core/database/ids.ts`; импорт — только из `core/database` (index): экспорт добавить вместе с первым использующим его сервисом, глубокий импорт запрещает ESLint); у `id` нет `default` в БД
  (ADR-0014 §2: строки создаёт и офлайн-точка).
- Бюджет кассы ≤ 1 сек: в транзакции нет HTTP-вызовов (фискализация — после коммита через
  очередь, `nestjs-messaging-basics.md`).

## PlatformDatabase — кросс-тенантный путь (ADR-0013)

```typescript
// only in apps/api/src/app/platform/** and apps/api/src/app/sync/** (ESLint + architecture test)
import { PlatformDatabase, PlatformDatabaseModule } from '../../core/database/platform';

await this.platform.platformTransaction({ kind: 'operator', operatorId }, (trx) =>
  trx.selectFrom('stores').select(['id', 'tenantId', 'name', 'mode', 'status']).execute(),
);
```

- Роль `pharmacy_platform`, свой пул, `application_name = api-platform`, без `BYPASSRLS`.
  `actor` обязателен (`{ kind: 'operator', operatorId }` или `{ kind: 'system', job }`),
  попадает в `app.actor`; без него — исключение.
- Платформа видит только платформенные таблицы, витрины и колонки реестра `stores`; тенантные
  таблицы — `42501`. Данные тенанта оператор видит только через вход «от имени» — это обычная
  tenant-сессия (`nestjs-security-auth.md`).
- `PlatformDatabaseModule` не `@Global` и импортируется только модулями платформы.

## RLS, роли и гранты (в миграции)

```sql
create table pharmacy.legal_entities (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,                                   -- UUIDv7 from the application, no default
  name text not null,
  primary key (tenant_id, id)
);
alter table pharmacy.legal_entities enable row level security;
alter table pharmacy.legal_entities force row level security;   -- binds the owner too
create policy tenant_isolation on pharmacy.legal_entities for all to pharmacy_app
  using      (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on pharmacy.legal_entities to pharmacy_app;
```

- Без `app.tenant_id` запрос падает (fail-closed, без `missing_ok`). Политики — с явным
  `TO <роль>`; default privileges для `pharmacy_app` нет — гранты явно по классу таблицы.
- Ссылки внутри тенанта — составные: `foreign key (tenant_id, store_id) references stores (tenant_id, id)`.
- Класс каждой таблицы — в `apps/api/src/core/database/table-classes.ts` в том же PR; тест
  каталога (`catalog.int-spec.ts`) сверяет манифест, RLS, точные наборы прав по ролям и
  отсутствие `default` у `id`. Подробно — скил `postgres-best-practices`.

## Коды ошибок PostgreSQL

Файла ещё нет — создаётся с первым прикладным модулем вместе с глобальным фильтром ошибок.

```typescript
// apps/api/src/core/database/pg-errors.ts (to be added)
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_INSUFFICIENT_PRIVILEGE = '42501'; // RLS WITH CHECK or a missing grant
export const PG_QUERY_CANCELED = '57014';         // statement_timeout
export const PG_LOCK_NOT_AVAILABLE = '55P03';     // lock_timeout
export const PG_SERIALIZATION_FAILURE = '40001';
export const PG_DEADLOCK_DETECTED = '40P01';

export function pgErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}
```

Маппинг в глобальном фильтре: `23505`/`23503` → 409 (без имени констрейнта и значений в
`detail`), `23514` → 422, `42501` → 500 (ошибка программы: запрос вне своего тенанта),
`57014`/`55P03` → 503, `40001`/`40P01` → ограниченный повтор транзакции или 503.

## Деньги, количества, даты

- Суммы — `bigint` в дирамах (`_dirams`), количества — `integer` в штуках (`_pieces`),
  проценты — `integer` в базисных пунктах (`_bp`) — модель данных `docs/architecture/data-model/`.
- Type parser пула (`core/database/pool.ts`, свой у каждого пула): `int8 → BigInt`,
  `date → строка YYYY-MM-DD`. Тот же маппинг в `kysely-codegen` (`typeMapping`). Значения
  `bigint` в коде сравниваются как `bigint` (`0n`), не через `Number`.
- `JSON.stringify` на `bigint` падает: в response-DTO сумма преобразуется явно в мэппере
  (целое число дирамов после проверки `Number.isSafeInteger`; хелпер — в `@pharmacy/shared-util`
  с первым денежным эндпоинтом).
- `numeric`/`real`/`double precision` для денег не используются.

## Типы БД — kysely-codegen

- `npx nx run api:db-types` — генерирует `apps/api/src/core/database/db.generated.ts` из
  мигрированной dev-БД (роль owner, схема `pharmacy`, `camelCase`). Файл руками не правится.
- `npx nx run api:db-types-verify` — обязательная проверка перед PR (будущий гейт CI): падает,
  если типы разошлись со схемой.

## Append-only таблицы (в миграции)

```sql
revoke update, delete, truncate on pharmacy.audit_log from pharmacy_app;

create function pharmacy.forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'append-only table: % is not allowed on %', tg_op, tg_table_name;
end $$;

create trigger audit_log_append_only
  before update or delete on pharmacy.audit_log
  for each row execute function pharmacy.forbid_mutation();
```

То же — для `stock_movements`, `shift_cash_operations`, `controlled_sale_records` (кроме
очистки данных рецепта по сроку), `supplier_ledger_entries`: ошибку исправляют новой записью
(сторно). Для таких таблиц тесту каталога нужен свой разрешённый набор прав (`SELECT, INSERT`).

## Миграции — node-pg-migrate

- Файлы — `apps/api/migrations/<timestamp>_<name>.sql`, **только Up** (секции
  `-- Down Migration` нет): откат — новой миграцией или из бэкапа. Создание:
  `npx node-pg-migrate create <name> --migration-file-language sql -m apps/api/migrations`.
- Каждый `.sql` выполняется в транзакции. `CREATE INDEX CONCURRENTLY` и другие операции вне
  транзакции — отдельной `.mjs`-миграцией с `pgm.noTransaction()`.
- Применение — роль `pharmacy_owner` через `apps/api/scripts/migrate.mjs` (advisory-лок,
  журнал `public.pgmigrations`): dev — `npx nx run api:migrate`; test/prod — сервис `migrate`
  в compose до старта API; офлайн-точка — тот же скрипт из образа API после `pg_dump`.
- Миграция совместима с ещё не обновлёнными офлайн-точками (expand/contract, ADR-0014).
- `FORCE ROW LEVEL SECURITY` действует и на `pharmacy_owner`: бэкфилл данных в миграции
  выполняется по тенантам с `set_config('app.tenant_id', …, true)`, иначе видит 0 строк.
- Миграция содержит всё для изоляции и целостности: `tenant_id`, составные ключи, RLS,
  политики `TO <роль>`, гранты, триггеры, индексы. Каждую миграцию ревьюит агент
  `postgresql-database-reviewer`.
- Auto-sync схемы запрещён везде.

## Интеграционные тесты

- `*.int-spec.ts` рядом с кодом, запуск `npx nx run api:integration` (нужен `npm run dev:deps`).
  Стенд пересоздаёт схему в отдельной БД `pharmacy_test` (имя обязано оканчиваться на `_test`) и
  прогоняет миграции. Хелперы: `apps/api/test/integration/{connections,seed}.ts`.
- Изоляцию проверяют `catalog.int-spec.ts` (каталог `pg_catalog`) и `isolation.int-spec.ts`
  (поведение двух тенантов) — новая таблица без манифеста, RLS или с лишними правами валит их.
