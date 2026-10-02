> **Pharmacy:** файл переписан под Pharmacy — брокеры сообщений (RabbitMQ, Kafka, BullMQ, NATS…) пока не выбраны — вводятся через ADR; фоновые задачи и очередь синхронизации офлайн-точек — таблицы-очереди в PostgreSQL (ADR-0002), планировщик — `@nestjs/schedule`. Ограничения: `CLAUDE.md`.

# Фоновые задачи и очереди в PostgreSQL (без брокера)

## Почему так

- Брокер сообщений пока не выбран — вводится через ADR; до ADR действует решение ADR-0002 (очереди-таблицы PostgreSQL). BullMQ — это брокер поверх Redis; Redis в проекте используется только для сессий и кэша.
- ADR-0002: модульный монолит, одна PostgreSQL, очередь синхронизации — таблицы в PostgreSQL.
- Главный плюс: постановка задачи идёт **в той же транзакции**, что и бизнес-операция (outbox) — чек и «отправить чек в фискализацию» либо оба есть, либо обоих нет.
- Нагрузка (30 точек, 50 кассиров, ×5) для очереди-таблицы с `SKIP LOCKED` — малая.

Понадобится брокер — переход только через новый ADR, пересматривающий ADR-0002.

## Где применяется

| Очередь (`queue`) | Модуль | Что делает | Постановка |
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
CREATE TABLE job_queue (
  id               uuid        PRIMARY KEY,       -- newId() (UUIDv7), no default
  tenant_id        uuid,                          -- NULL = platform-level job (e.g. billing period run)
  queue            text        NOT NULL,
  payload          jsonb       NOT NULL,          -- ids and parameters only, no PII
  idempotency_key  text        NOT NULL,
  correlation_id   text        NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  attempts         int         NOT NULL DEFAULT 0,
  max_attempts     int         NOT NULL DEFAULT 8,
  run_after        timestamptz NOT NULL DEFAULT now(),
  locked_by        text,
  locked_at        timestamptz,
  last_error       text,                          -- sanitized message, no PII
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, queue, idempotency_key)   -- PostgreSQL 15+
);

CREATE INDEX job_queue_ready_idx ON job_queue (queue, run_after) WHERE status = 'pending';
CREATE INDEX job_queue_stale_idx ON job_queue (locked_at) WHERE status = 'processing';
```

- `pending` → `processing` → `done`; ошибка с оставшимися попытками → снова `pending` с новым `run_after`; попытки исчерпаны → `dead` (dead-letter, разбирается вручную).
- `UNIQUE NULLS NOT DISTINCT (tenant_id, queue, idempotency_key)` — повторная постановка не создаёт дубль (и для платформенных задач с `tenant_id IS NULL`).
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
  queue: string;
  payload: P;
  idempotencyKey: string;
  correlationId: string;
  maxAttempts?: number;
  runAfter?: Date;
}

export interface ClaimedJob<P = unknown> extends Required<Omit<NewJob<P>, 'runAfter'>> {
  id: string;
  attempts: number;
}

export abstract class JobQueueRepository {
  /** INSERT ... ON CONFLICT (tenant_id, queue, idempotency_key) DO NOTHING — inside the caller's trx (outbox). */
  abstract enqueue(trx: TenantTransaction, job: NewJob): Promise<void>;
  /** Platform-level job (tenant_id = NULL) — inside PlatformDatabase.platformTransaction (ADR-0013). */
  abstract enqueuePlatform(job: NewJob & { tenantId: null }): Promise<void>;
  /** Claims jobs of ONE tenant inside its tenant transaction (RLS sees only that tenant's rows). */
  abstract claim(trx: TenantTransaction, queue: string, limit: number, workerId: string): Promise<ClaimedJob[]>;
  abstract complete(id: string): Promise<void>;
  /** nextRunAfter = null → status 'dead'. */
  abstract fail(id: string, error: string, nextRunAfter: Date | null): Promise<void>;
  abstract releaseStale(olderThanMs: number): Promise<number>;
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
    queue: 'fiscal.send',
    payload: { receiptId: receipt.id },
    idempotencyKey: `receipt:${receipt.id}`,
    correlationId: getCorrelationId() ?? receipt.id,
  });
  return this.toResponse(receipt); // receipt, movements, audit and the job commit or roll back together
});
```

### Захват задач: `FOR UPDATE SKIP LOCKED`

```sql
WITH next AS (
  SELECT id FROM job_queue
  WHERE queue = $1 AND status = 'pending' AND run_after <= now()
  ORDER BY run_after, id
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
UPDATE job_queue j
SET status = 'processing', locked_by = $3, locked_at = now(),
    attempts = j.attempts + 1, updated_at = now()
FROM next
WHERE j.id = next.id
RETURNING j.*;
```

Два режима обработки:
- **Эффект только в нашей БД** (`billing.invoice` по тенанту, пересчёт витрин) — можно захватить и обработать в одной tenant-транзакции: изменения и `status = 'done'` коммитятся атомарно.
- **Вызов внешней системы** (`fiscal.send`, `sync.upload`) — короткая транзакция захвата → вызов вне транзакции (не держим блокировку и соединение) → отдельная транзакция `complete`/`fail`. Вызов обязан быть идемпотентным: во внешнюю систему передаётся idempotency key задачи, т.к. после сбоя задача может выполниться повторно (at-least-once).

Зависшие `processing` (воркер упал) возвращаются в `pending` — тоже в цикле по тенантам:

```sql
UPDATE job_queue SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = now()
WHERE status = 'processing' AND locked_at < now() - make_interval(secs => $1);
```

### Retry с backoff и dead-letter

```typescript
// apps/api/src/common/job-queue/job-worker.ts (fragment)
import { backoffDelay } from '../resilience/retry';

private async handleFailure(job: ClaimedJob, error: unknown): Promise<void> {
  const message = sanitizeError(error);               // no PII, no payload dump
  const exhausted = job.attempts >= job.maxAttempts;
  const nextRunAfter = exhausted
    ? null                                            // → status 'dead'
    : new Date(Date.now() + backoffDelay(job.attempts, 5_000, 30 * 60_000));
  await this.jobs.fail(job.id, message, nextRunAfter);
  this.logger[exhausted ? 'error' : 'warn']({ msg: 'job failed', jobId: job.id, queue: job.queue, attempts: job.attempts, dead: exhausted });
}
```

## Воркер в NestJS

```typescript
// apps/api/src/common/job-queue/job-worker.ts
import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { hostname } from 'node:os';
import { runWithContext } from '../context/request-context';
import { ClaimedJob, JobQueueRepository } from './job-queue.repository';

export interface JobHandler<P = unknown> {
  readonly queue: string;
  /** Must be idempotent: the same job can be delivered more than once. */
  handle(payload: P, job: ClaimedJob<P>): Promise<void>;
}

export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

@Injectable()
export class JobWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(JobWorker.name);
  private readonly workerId = `${hostname()}:${process.pid}`;
  private running = false;
  private stopping = false;

  constructor(
    private readonly jobs: JobQueueRepository,
    @Inject(JOB_HANDLERS) private readonly handlers: JobHandler[],
  ) {}

  @Interval(1_000)
  async tick(): Promise<void> {
    if (this.running || this.stopping) return;        // no overlapping ticks
    this.running = true;
    try {
      for (const handler of this.handlers) {
        const claimed = await this.jobs.claim(handler.queue, 10, this.workerId);
        for (const job of claimed) await this.process(handler, job);
      }
    } finally {
      this.running = false;
    }
  }

  // Simplified: the real tick iterates active tenants (TenantJobRunner.forEachActiveTenant) and claims
  // inside TenantDatabase.withTenant(tenantId, trx => this.jobs.claim(trx, …)); see the bullets above.
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

`@nestjs/schedule` — пакет экосистемы NestJS (в рамках ADR-0003), не отдельная технология стека. Cron срабатывает **на каждом инстансе**, поэтому cron только ставит задачу с idempotency key периода — дубль отсечёт `UNIQUE`:

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
        queue: 'billing.invoice',
        payload: { period },
        idempotencyKey: `billing-invoice:${period}`,
        correlationId: getCorrelationId()!,
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
   → `pg_advisory_xact_lock` точки → `INSERT INTO sync_inbox … ON CONFLICT (tenant_id, store_id,
   operation_id) DO NOTHING` → применение операции и её движений в той же транзакции. Ответ —
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
  SELECT queue, status, count(*), min(run_after) FROM job_queue GROUP BY queue, status;
  ```

- **Разбор dead-letter** — действие оператора в админке (с правом и записью в аудит): исправить причину → `UPDATE job_queue SET status = 'pending', attempts = 0, run_after = now() WHERE id = $1 AND status = 'dead'`.
- **Очистка** — плановая задача удаляет `done` старше N дней (N — настройка). Аудит и журнал ПКУ в очереди не хранятся.
- **Тесты** — `nestjs-testing-patterns.md` (раздел «Очередь-таблица»).
