> **Pharmacy:** файл переписан под Pharmacy — брокеры сообщений (RabbitMQ, Kafka, BullMQ, NATS…) пока не выбраны — вводятся через ADR; фоновые задачи и очередь синхронизации офлайн-точек — таблицы-очереди в PostgreSQL (ADR-0002), планировщик — `@nestjs/schedule`. Ограничения: `CLAUDE.md`.

# Фоновые задачи и очереди в PostgreSQL (без брокера)

## Почему так

- Брокер сообщений пока не выбран — вводится через ADR; до ADR действует решение ADR-0002 (очереди-таблицы PostgreSQL). BullMQ — это брокер поверх Redis; Redis в проекте используется только для сессий и кэша.
- ADR-0002: модульный монолит, одна PostgreSQL, очередь синхронизации — таблицы в PostgreSQL.
- Главный плюс: постановка задачи идёт **в той же транзакции**, что и бизнес-операция (outbox) — чек и «отправить чек в фискализацию» либо оба есть, либо обоих нет.
- Нагрузка (30 точек, 50 кассиров, ×5) для очереди-таблицы с `SKIP LOCKED` — малая.

Понадобится брокер — переход только через новый ADR, пересматривающий ADR-0002.

## Где применяется

| Тип задачи (`type`) | Модуль | Что делает | Постановка |
|---|---|---|---|
| `fiscal.send` | fiscal | Отправка чека в адаптер фискализации (в MVP — заглушка) | outbox в транзакции чека |
| `sync.upload` | sync (офлайн-точка) | Досылка операций точки в облако по HTTPS | outbox в транзакции операции |
| `export-1c.build` | export-1c | Формирование файла CommerceML/XML за период | по запросу пользователя |
| `billing.invoice` | billing | Счета тенантам за период (в сомони, ADR-0016) | планировщик |

Названия и состав очередей — иллюстрация; фиксируются при реализации модулей. Приём операций
офлайн-точки в облаке (`sync.apply`) **не** идёт через очередь: операции применяются в самом
запросе `POST /sync/operations` с карантином (ADR-0014 §6, вариант 3б).

## Схема таблицы

DDL иллюстративный — реальная схема создаётся миграцией node-pg-migrate (ADR-0006) по модели
данных (`docs/architecture/data-model/06-sync-audit-billing.md`, класс `system`, ADR-0013).

```sql
-- Columns follow the data model (06-sync-audit-billing.md, «Очередь задач»)
CREATE TABLE pharmacy.job_queue (
  id             uuid        PRIMARY KEY,         -- newId() (UUIDv7), no default
  tenant_id      uuid        REFERENCES pharmacy.tenants (id), -- NULL = platform-level job
  type           text        NOT NULL,            -- fiscal.send, sync.apply, export-1c.build, usage.recompute, billing.invoice…
  payload        jsonb       NOT NULL,            -- ids and parameters only, no PII
  status         text        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  attempts       int         NOT NULL DEFAULT 0,
  run_at         timestamptz NOT NULL DEFAULT now(),
  lease_until    timestamptz,                     -- set on claim; an expired lease = the worker died
  last_error     text,                            -- sanitized message, no PII
  correlation_id text        NOT NULL,
  dedupe_key     text                             -- unique among unfinished jobs
);

CREATE UNIQUE INDEX job_queue_dedupe_uq ON pharmacy.job_queue (tenant_id, type, dedupe_key)
  NULLS NOT DISTINCT WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'processing'); -- PostgreSQL 15+
CREATE INDEX job_queue_ready_idx ON pharmacy.job_queue (type, run_at) WHERE status = 'pending';
CREATE INDEX job_queue_lease_idx ON pharmacy.job_queue (lease_until) WHERE status = 'processing';
```

- `pending` → `processing` → `done`; ошибка с оставшимися попытками → снова `pending` с новым `run_at`; попытки исчерпаны (лимит — у обработчика типа, `maxAttempts`) → `dead` (dead-letter, разбирается вручную).
- `dedupe_key` уникален среди **незавершённых** задач (`pending`/`processing`) — повторная постановка, пока задача не выполнена, не создаёт дубль (и для платформенных задач с `tenant_id IS NULL`). После `done` тот же ключ можно поставить снова: от повторного эффекта защищает идемпотентность обработчика.
- Класс таблицы — `system` (ADR-0013): RLS `ENABLE` + `FORCE`; `pharmacy_app` видит и меняет
  только строки своего тенанта (политика тенанта); `pharmacy_platform` видит все строки
  (диагностика), а ставит и меняет только платформенные задачи (`tenant_id IS NULL`).
- **Задачи тенантов — «по тенанту в цикле»** (ADR-0013 §4): воркер получает список активных
  тенантов (облако — через `PlatformDatabase`, офлайн-точка — один тенант) и для каждого в
  `runWithContext({ correlationId, tenantId })` открывает `TenantDatabase.withTenant(tenantId, …)`
  и захватывает **свои** задачи `FOR UPDATE SKIP LOCKED` под RLS. Обработчик ничем не отличается
  от HTTP-запроса. Справедливость между тенантами — бонус цикла; N коротких транзакций на опрос
  при ~15 тенантах пренебрежимы.
- **Платформенные задачи** (`tenant_id IS NULL`, например оркестратор `billing.invoice`) —
  через `PlatformDatabase.platformTransaction({ kind: 'system', job: 'billing.invoice' }, …)`.

## Порт очереди

```typescript
// apps/api/src/common/job-queue/job-queue.repository.ts
import type { TenantTransaction } from '../../core/database';

export interface NewJob<P = unknown> {
  tenantId: string | null;              // null = platform-level job
  type: string;
  payload: P;
  dedupeKey?: string;                   // unique among unfinished jobs of the same tenant and type
  correlationId: string;
  runAt?: Date;
}

export interface ClaimedJob<P = unknown> {
  id: string;
  tenantId: string | null;
  type: string;
  payload: P;
  correlationId: string;
  attempts: number;
}

export abstract class JobQueueRepository {
  /** INSERT ... ON CONFLICT (tenant_id, type, dedupe_key) WHERE <index predicate> DO NOTHING — inside the caller's trx (outbox). */
  abstract enqueue(trx: TenantTransaction, job: NewJob): Promise<void>;
  /** Platform-level job (tenant_id = NULL) — inside PlatformDatabase.platformTransaction (ADR-0013). */
  abstract enqueuePlatform(job: NewJob & { tenantId: null }): Promise<void>;
  /** Claims jobs of ONE tenant inside its tenant transaction (RLS sees only that tenant's rows). */
  abstract claim(trx: TenantTransaction, type: string, limit: number, leaseMs: number): Promise<ClaimedJob[]>;
  abstract complete(id: string): Promise<void>;
  /** nextRunAt = null → status 'dead'. */
  abstract fail(id: string, error: string, nextRunAt: Date | null): Promise<void>;
  abstract releaseExpiredLeases(): Promise<number>;
}
```

Реализация — Kysely-запросы по SQL ниже (`forUpdate().skipLocked()`, `onConflict(...).doNothing()`).

### Постановка в транзакции операции (outbox)

Дополнение к транзакции чека из `nestjs-config-data-access.md` — задача фискализации ставится в той же транзакции:

```typescript
// apps/api/src/app/pos/receipts.service.ts (fragment of completeReceipt)
return this.db.tenantTransaction(async (trx) => {
  // ... idempotent replay, batch locks, stock check, receipt, movements, audit ...
  await this.jobs.enqueue(trx, {
    tenantId,                                         // from requireTenantId() at the top of the method
    type: 'fiscal.send',
    payload: { receiptId: receipt.id },
    dedupeKey: `receipt:${receipt.id}`,
    correlationId: getRequestContext()?.correlationId ?? receipt.id,
  });
  return this.toResponse(receipt); // receipt, movements, audit and the job commit or roll back together
});
```

### Захват задач: `FOR UPDATE SKIP LOCKED`

```sql
WITH next AS (
  SELECT id FROM pharmacy.job_queue
  WHERE type = $1 AND status = 'pending' AND run_at <= now()
  ORDER BY run_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
UPDATE pharmacy.job_queue j
SET status = 'processing', lease_until = now() + make_interval(secs => $3),
    attempts = j.attempts + 1
FROM next
WHERE j.id = next.id
RETURNING j.*;
```

Два режима обработки:
- **Эффект только в нашей БД** (`billing.invoice` по тенанту, пересчёт витрин) — можно захватить и обработать в одной tenant-транзакции: изменения и `status = 'done'` коммитятся атомарно.
- **Вызов внешней системы** (`fiscal.send`, `sync.upload`) — короткая транзакция захвата → вызов вне транзакции (не держим блокировку и соединение) → отдельная транзакция `complete`/`fail`. Вызов обязан быть идемпотентным: во внешнюю систему передаётся idempotency key задачи, т.к. после сбоя задача может выполниться повторно (at-least-once).

Задачи с истёкшей арендой (воркер упал) возвращаются в `pending` — тоже в цикле по тенантам:

```sql
UPDATE pharmacy.job_queue SET status = 'pending', lease_until = NULL
WHERE status = 'processing' AND lease_until < now();
```

### Retry с backoff и dead-letter

```typescript
// apps/api/src/common/job-queue/job-worker.ts (fragment)
import { backoffDelay } from '../resilience/retry';

private async handleFailure(job: ClaimedJob, error: unknown): Promise<void> {
  const message = sanitizeError(error);               // no PII, no payload dump
  const exhausted = job.attempts >= this.handlerFor(job.type).maxAttempts;
  const nextRunAt = exhausted
    ? null                                            // → status 'dead'
    : new Date(Date.now() + backoffDelay(job.attempts, 5_000, 30 * 60_000));
  await this.jobs.fail(job.id, message, nextRunAt);
  this.logger[exhausted ? 'error' : 'warn']({ msg: 'job failed', jobId: job.id, type: job.type, attempts: job.attempts, dead: exhausted });
}
```

## Воркер в NestJS

```typescript
// apps/api/src/common/job-queue/job-worker.ts
import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TenantDatabase } from '../../core/database';
import { runWithContext } from '../context/request-context';
import { ActiveTenants } from './active-tenants';   // cloud: PlatformDatabase resolver; offline store: its one tenant
import { ClaimedJob, JobQueueRepository } from './job-queue.repository';

export interface JobHandler<P = unknown> {
  readonly type: string;
  readonly maxAttempts: number;          // e.g. 8; exhausted → 'dead'
  /** Must be idempotent: the same job can be delivered more than once. */
  handle(payload: P, job: ClaimedJob<P>): Promise<void>;
}

export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

@Injectable()
export class JobWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(JobWorker.name);
  private readonly leaseMs = 5 * 60_000;              // longer than the slowest handler
  private running = false;
  private stopping = false;

  constructor(
    private readonly db: TenantDatabase,
    private readonly tenants: ActiveTenants,
    private readonly jobs: JobQueueRepository,
    @Inject(JOB_HANDLERS) private readonly handlers: JobHandler[],
  ) {}

  @Interval(1_000)
  async tick(): Promise<void> {
    if (this.running || this.stopping) return;        // no overlapping ticks
    this.running = true;
    try {
      // "Per tenant in a loop" (ADR-0013 §4): claim under RLS of one tenant at a time
      for (const tenantId of await this.tenants.list()) {
        for (const handler of this.handlers) {
          const claimed = await this.db.withTenant(tenantId, (trx) =>
            this.jobs.claim(trx, handler.type, 10, this.leaseMs));
          for (const job of claimed) await this.process(handler, job); // outside the claim transaction
        }
      }
    } finally {
      this.running = false;
    }
  }

  private handlerFor(type: string): JobHandler {
    const handler = this.handlers.find((h) => h.type === type);
    if (!handler) throw new Error(`No handler for job type ${type}`);
    return handler;
  }

  private process(handler: JobHandler, job: ClaimedJob): Promise<void> {
    // Restore context from the job row: logs carry correlationId, data access is tenant-scoped.
    return runWithContext({ correlationId: job.correlationId, tenantId: job.tenantId ?? undefined }, async () => {
      try {
        await handler.handle(job.payload, job);
        await this.jobs.complete(job.id);
      } catch (error) {
        await this.handleFailure(job, error);
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;                              // graceful: finish current tick, take no new jobs
  }
}
```

- Несколько инстансов API безопасно работают параллельно — `SKIP LOCKED` не даёт двум воркерам взять одну задачу.
- Долгие задачи (выгрузка 1С за период) не должны задерживать короткие (`fiscal.send`) — при необходимости отдельный тик/лимит на очередь.
- Обработчик не должен выполнять работу, которую касса ждёт синхронно: касса отвечает ≤ 1 сек, всё внешнее — через очередь.

## Планировщик: `@nestjs/schedule`

`@nestjs/schedule` — пакет экосистемы NestJS (в рамках ADR-0003), не отдельная технология стека. Cron срабатывает **на каждом инстансе**, поэтому cron только ставит задачу с `dedupe_key` периода — дубль незавершённой задачи отсечёт уникальный индекс, а обработчик идемпотентен по периоду:

```typescript
// apps/api/src/app/billing/billing-invoice.scheduler.ts
@Injectable()
export class BillingInvoiceScheduler {
  constructor(private readonly jobs: JobQueueRepository) {}

  @Cron('0 6 1 * *', { timeZone: 'Asia/Dushanbe' })
  scheduleMonthlyRun(): Promise<void> {
    const period = previousMonthInDushanbe();          // 'YYYY-MM'
    return runWithContext({ correlationId: newId() }, () =>
      this.jobs.enqueuePlatform({                      // platform path (PlatformDatabase, system actor), tenant_id = NULL
        tenantId: null,
        type: 'billing.invoice',
        payload: { period },
        dedupeKey: `billing-invoice:${period}`,
        correlationId: getRequestContext()!.correlationId,
      }));
  }
}
```

Обработчик платформенной задачи `billing.invoice` только раскладывает её на задачи по тенантам
(`tenant_id` задан, ключ `billing-invoice:<period>`) — счёт каждого тенанта формируется в контексте
его `tenant_id`, в сомони. Эффект только в нашей БД — захват и обработка в одной транзакции.

Альтернатива для эксклюзивных задач — `pg_try_advisory_lock(<key>)` в начале обработки.

## Очередь синхронизации офлайн-точек

Офлайн-точка — та же система в Docker с локальной PostgreSQL.

Протокол — ADR-0014; таблицы — модель данных `06-sync-audit-billing.md`.

1. **На точке.** Каждая операция (чек, возврат, проведённый документ, смена…) в своей транзакции
   пишет запись в `sync_outbox`: `operation_id` (UUIDv7, `newId()`), `store_seq` (локальный
   `bigint identity`), тип и версия, `payload_hash` (SHA-256), `correlation_id`, автор.
2. **Досылка.** Задача `sync.upload` отправляет батчи (≤ 500 операций, ≤ 2 МБ) по HTTPS с
   `Authorization: Bearer phk_<keyId>_<secret>`; retry с backoff + circuit breaker
   (`nestjs-resilience-circuit-breaker.md`) — пока связи нет, точка не «долбит» облако.
3. **В облаке — применение в самом запросе** (не воркером): `LicenseKeyGuard` → tenant-транзакция
   → `pg_advisory_xact_lock` точки → поиск `operation_id` в `sync_inbox` под этой блокировкой
   (таблица секционирована по `received_at`, уникального ключа по трём колонкам нет — `ON CONFLICT`
   невозможен; правило `postgres-best-practices/rules/data-idempotency-keys.md`) → найден —
   `duplicate` (или `rejected: id-reused` при другом хеше), нет — вставка в inbox, применение
   операции и её движений в той же транзакции. Ответ —
   статус по каждому `operation_id`: `applied`, `duplicate`, `quarantined`, `rejected`,
   `pending_dependency`. Повтор с тем же id и другим хешем — `rejected: id-reused`.
4. **Порядок и карантин.** Операции точки применяются по `store_seq`; операция с нарушенной
   зависимостью или невалидная (суммы строк ≠ итог, знаки движений) уходит в карантин, а не
   ломает батч. Облако не пересчитывает FEFO и не проверяет остаток при приёме фактов точки —
   отрицательный остаток выявляет сверка `stock.checkpoint`.
5. **Лента «облако → точка»** (`sync_changes`, окно 90 дней) — справочники, цены, роли,
   сотрудники без хешей, входящие перемещения, решения по конфликтам цен, статус лицензии.
6. **Конфликты** — только два: цена (решает владелец в облаке) и дубль товара (решает точка);
   записи `sync_conflicts`, не молчаливая перезапись.
7. **Лицензия** — статус в каждом ответе (`Pharmacy-License-Status`); отозванный или истёкший
   ключ — льготный период приёма, `revoked-hard` — `401` (`nestjs-security-auth.md`).

Буфер перебоев связи в браузере кассы (apps/web) — отдельный механизм фронтенда с той же идемпотентной досылкой.

## Эксплуатация

- **Наблюдаемость** — без Bull Board: SQL-запросы состояния и сводка в readiness/health (`nestjs-observability.md`):

  ```sql
  SELECT type, status, count(*), min(run_at) FROM pharmacy.job_queue GROUP BY type, status;
  ```

- **Разбор dead-letter** — действие оператора в админке (с правом и записью в аудит): исправить причину → `UPDATE pharmacy.job_queue SET status = 'pending', attempts = 0, run_at = now() WHERE id = $1 AND status = 'dead'`.
- **Очистка** — плановая задача удаляет `done` с `run_at` старше N дней (N — настройка). Аудит и журнал ПКУ в очереди не хранятся.
- **Тесты** — `nestjs-testing-patterns.md` (раздел «Очередь-таблица»).
