# NestJS Data Access — PostgreSQL, tenant isolation, transactions, migrations

ORM-независимый слой доступа к данным apps/api.

> **ORM и инструмент миграций НЕ выбраны.** Их фиксирует первый ADR разработки
> (`/03-adr`). Ниже контракт слоя (обязателен при любом выборе) и пример на драйвере `pg`.
> Пример — иллюстрация: применять как есть только если ADR выберет `pg` без ORM.
> Prisma — вариант А в конце файла, не стандарт.

## Контракт слоя (обязателен при любом ORM)

1. Прикладной код работает с БД только через `DatabaseService` и репозитории модулей.
   Прямой пул/клиент в сервисах и контроллерах запрещён.
2. Любой запрос к прикладным таблицам выполняется в **tenant-транзакции**: в её начале
   `set_config('app.tenant_id', <tenantId>, true)` (эквивалент `SET LOCAL`, но с параметром).
   `tenantId` берётся из контекста запроса (серверная сессия), не из входных данных.
3. Репозиторий **дополнительно** фильтрует по `tenant_id` в каждом SQL (первый рубеж);
   RLS-политики PostgreSQL — второй рубеж.
4. Операция + её движения + запись аудита — одна транзакция.
5. Ошибки драйвера/ORM переводятся в доменные исключения в одном месте
   (unique violation → 409 и т.д.), см. `nestjs-enterprise-patterns.md`.
6. Схема меняется только версионированными миграциями.

## Контекст запроса

`tenantId`, `employeeId`, `storeIds`, `correlationId` кладёт в `AsyncLocalStorage` guard
аутентификации (`nestjs-security-auth.md`); механика контекста — в
`nestjs-resilience-context.md`. Здесь нужен только один вызов:

```typescript
// apps/api/src/common/context/request-context.ts (fragment; names are illustrative)
export function requireTenantId(): string {
  const tenantId = requestContextStorage.getStore()?.tenantId;
  if (!tenantId) throw new Error('Tenant context is missing'); // programming error → 500
  return tenantId;
}
```

## DatabaseService (пример на `pg`)

```typescript
// apps/api/src/core/database/database.service.ts
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import databaseConfig from '../../config/database.config';
import { requireTenantId } from '../../common/context/request-context';

export interface Tx {
  query<R extends QueryResultRow>(sql: string, params?: unknown[]): Promise<R[]>;
  readonly tenantId: string;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(databaseConfig.KEY) cfg: ConfigType<typeof databaseConfig>) {
    this.pool = new Pool({ connectionString: cfg.url, max: cfg.poolMax });
  }

  /** The only entry point for tenant data. Sets app.tenant_id for RLS, commits or rolls back. */
  async tenantTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const tenantId = requireTenantId();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await work(this.wrap(client, tenantId));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private wrap(client: PoolClient, tenantId: string): Tx {
    return {
      tenantId,
      query: async <R extends QueryResultRow>(sql: string, params: unknown[] = []) =>
        (await client.query<R>(sql, params)).rows,
    };
  }
}
```

Почему транзакция даже для чтения: `set_config(..., true)` действует только до конца
транзакции — на пуле соединений это единственный безопасный способ не «протечь» тенантом в
чужой запрос. Кросс-тенантные операции оператора платформы (apps/admin, «вход от имени»,
биллинг) — отдельный явный путь с аудитом; его механику (отдельная роль БД / политика)
зафиксировать в ADR до реализации.

## RLS (второй рубеж, в миграции)

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;  -- applies even to the table owner

CREATE POLICY tenant_isolation ON products TO pharmacy_app
  USING (tenant_id = (SELECT current_setting('app.tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
```

- Если `app.tenant_id` не установлен, запрос падает с ошибкой (fail-closed, без `missing_ok`) —
  канон: postgres-best-practices `security-rls-basics.md`. Политики — с явным `TO <роль>`
  (черновик ADR-0013).
- Прикладная роль БД — не суперпользователь и без `BYPASSRLS`.
- Индексы начинаются с `tenant_id`: `(tenant_id, …)`. Правила по индексам/RLS/локам —
  скил `postgres-best-practices`.

## Tenant-scoped репозиторий

```typescript
// apps/api/src/modules/catalog/products.repository.ts
import { Injectable } from '@nestjs/common';
import { Tx } from '../../core/database/database.service';

export interface ProductRow {
  id: string;
  tenant_id: string;
  name_ru: string;
  name_tj: string;
  inn: string | null;
  is_prescription: boolean;
  is_controlled_substance: boolean;
  barcodes: string[];
  archived_at: Date | null;
}

@Injectable()
export class ProductsRepository {
  async findById(tx: Tx, id: string): Promise<ProductRow | undefined> {
    const rows = await tx.query<ProductRow>(
      'SELECT * FROM products WHERE tenant_id = $1 AND id = $2',
      [tx.tenantId, id],
    );
    return rows[0];
  }
}
```

Репозиторий принимает `Tx` параметром — так несколько репозиториев разных таблиц работают в
одной транзакции, а без транзакции (и без тенанта) запрос выполнить нельзя.

## Транзакция «чек + движения партий + аудит»

```typescript
// apps/api/src/modules/pos/receipts.service.ts (fragment)
async completeReceipt(storeId: string, dto: CompleteReceiptDto, idempotencyKey: string): Promise<ReceiptResponseDto> {
  // storeId is already checked against the employee's store scope by PermissionsGuard
  return this.db.tenantTransaction(async (tx) => {
    // 1. Idempotent replay: same key -> return the original result, do not sell twice
    const existing = await this.receipts.findByIdempotencyKey(tx, idempotencyKey);
    if (existing) return this.assertSamePayloadAndMap(existing, dto);

    // 2. Lock the affected batches so concurrent sales cannot oversell the same batch
    const batchIds = dto.lines.map((l) => l.batchId);
    const locked = await tx.query(
      'SELECT id FROM batches WHERE tenant_id = $1 AND store_id = $2 AND id = ANY($3) ORDER BY id FOR UPDATE',
      [tx.tenantId, storeId, batchIds],
    );
    if (locked.length !== new Set(batchIds).size) throw new BatchNotFoundException(); // batch of another store/tenant

    // 3. Stock is derived: SUM(quantity) over stock_movements, never a stored balance
    const available = await this.stock.availableByBatch(tx, batchIds);
    for (const line of dto.lines) {
      if ((available.get(line.batchId) ?? 0) < line.quantity) {
        throw new InsufficientStockException(line.batchId); // 422 problem+json
      }
    }

    // 4. Receipt, its negative movements and the audit record commit together
    const receipt = await this.receipts.insert(tx, storeId, dto, idempotencyKey);
    await this.stock.insertMovements(
      tx,
      dto.lines.map((l) => ({ batchId: l.batchId, quantity: -l.quantity, sourceType: 'receipt', sourceId: receipt.id })),
    );
    await this.audit.append(tx, { action: 'receipt.completed', entityId: receipt.id });
    return this.toResponse(receipt);
  });
}
```

- Блокировки партий берутся в стабильном порядке (`ORDER BY id`) — меньше дедлоков.
- `idempotency_key` — `UNIQUE (tenant_id, idempotency_key)`; гонку двух одинаковых запросов
  разрешает unique violation (повторно прочитать и вернуть исходный результат).
- Бюджет операции кассы ≤ 1 сек: в транзакции нет HTTP-вызовов (фискализация — после
  коммита через очередь-таблицу, `nestjs-messaging-basics.md`).

## Unique violation → 409

```typescript
// apps/api/src/core/database/pg-errors.ts
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_SERIALIZATION_FAILURE = '40001';
export const PG_DEADLOCK_DETECTED = '40P01';

export function pgErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}
```

Маппинг в глобальном фильтре: `23505` → 409 Conflict (без имени констрейнта и значений в
`detail`), `23503` → 409, `23514` → 422, `40001`/`40P01` → повторить транзакцию (ограниченно)
или 503. С ORM коды те же — ORM оборачивает ошибку драйвера (у Prisma: `P2002`).

## Деньги и количества в БД

- Суммы — `bigint` в дирамах (`integer` допустим для цены позиции). Драйвер `pg` отдаёт
  `int8` строкой — конвертировать утилитой из `libs/shared/util` с проверкой
  `Number.isSafeInteger`, не `parseFloat`.
- `numeric`/`real`/`double precision` для денег не использовать.
- Количества — целые в минимальной единице учёта (штука/блистер при делимой упаковке).

## Append-only аудит и журнал ПКУ (в миграции)

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM pharmacy_app;

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % is not allowed on %', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
```

То же — для `controlled_substance_journal` и `stock_movements` (движения не исправляют,
а сторнируют новым движением).

## Миграции

- Только версионированные файлы миграций в репозитории; применяются явной командой при деплое
  и при обновлении офлайн-точки. Инструмент — по ADR.
- Запрещено: `synchronize: true` (TypeORM), `prisma db push`, любой auto-sync схемы вне
  локальной одноразовой БД.
- Миграция содержит всё, что относится к изоляции и целостности: `tenant_id NOT NULL`,
  RLS-политики, гранты, append-only триггеры, индексы `(tenant_id, …)`.
- Миграции должны быть совместимы с офлайн-точкой: та же цепочка применяется к её локальной
  PostgreSQL (ADR-0002).
- Изменения схемы ревьюит агент `postgresql-database-reviewer`.

---

## Вариант А: Prisma 7 (только если ADR выберет Prisma)

Кратко, чтобы не наступить на изменения 7.x:
- генератор `provider = "prisma-client"` с явным `output` (сгенерированный клиент — в `.gitignore`);
- URL БД — в `prisma.config.ts`, не в `schema.prisma`; клиент — через driver adapter `@prisma/adapter-pg`;
- `PrismaService` — композиция (`new PrismaClient({ adapter })`), не наследование.

Tenant-транзакция на Prisma — только интерактивная:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  // every model query still filters by tenantId explicitly
  return tx.product.findMany({ where: { tenantId } });
});
```

Миграции — `prisma migrate deploy` (в проде), `prisma migrate dev` — только локально.
`P2002` → 409. Деньги — `BigInt`/`Int`, не `Decimal`.
