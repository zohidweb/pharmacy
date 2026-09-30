> **Pharmacy:** адаптировано под стек Pharmacy — Jest (fake timers вместо реальных ожиданий), circuit breaker/retry собственной реализации, контекст запроса (correlationId, tenantId, employeeId, storeId), тесты очереди-таблицы PostgreSQL. Ограничения: `CLAUDE.md`.

# NestJS Advanced Testing — Resilience, Request Context, DB Queues

Тестируемые реализации: `nestjs-resilience-circuit-breaker.md`, `nestjs-resilience-context.md`, `nestjs-messaging-basics.md`.

## Circuit breaker

Время управляется `jest.useFakeTimers()` (мокает и `Date.now()`), поэтому тесты не ждут реальные секунды.

```typescript
// apps/api/src/common/resilience/circuit-breaker.spec.ts
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    jest.useFakeTimers();
    breaker = new CircuitBreaker({ name: 'fiscal', failureThreshold: 3, resetTimeoutMs: 30_000, halfOpenMaxCalls: 1 });
  });
  afterEach(() => jest.useRealTimers());

  const failTimes = async (n: number) => {
    const op = jest.fn().mockRejectedValue(new Error('KKM vendor down'));
    for (let i = 0; i < n; i++) await expect(breaker.execute(op)).rejects.toThrow('KKM vendor down');
    return op;
  };

  it('passes calls through while CLOSED', async () => {
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('opens after threshold consecutive failures and fails fast', async () => {
    const op = await failTimes(3);

    expect(breaker.getState()).toBe('OPEN');
    await expect(breaker.execute(op)).rejects.toThrow(CircuitOpenError);
    expect(op).toHaveBeenCalledTimes(3); // not called while OPEN
  });

  it('success resets the consecutive failure counter', async () => {
    await failTimes(2);
    await breaker.execute(async () => 'ok');
    await failTimes(2);
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('goes HALF_OPEN after reset timeout and closes on successful trial', async () => {
    await failTimes(3);
    jest.advanceTimersByTime(30_000);

    expect(breaker.getState()).toBe('HALF_OPEN');
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('reopens when the trial call fails', async () => {
    await failTimes(3);
    jest.advanceTimersByTime(30_000);

    await expect(breaker.execute(() => Promise.reject(new Error('still down')))).rejects.toThrow('still down');
    expect(breaker.getState()).toBe('OPEN');
  });
});
```

## Retry с backoff

```typescript
// apps/api/src/common/resilience/retry.spec.ts
import { retry, backoffDelay } from './retry';

describe('retry', () => {
  const noSleep = jest.fn(async () => undefined);

  it('retries transient errors up to attempts and then rethrows', async () => {
    const op = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

    await expect(retry(op, { attempts: 3, baseDelayMs: 200, maxDelayMs: 5_000, sleep: noSleep }))
      .rejects.toThrow('ECONNRESET');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors (e.g. 4xx)', async () => {
    const op = jest.fn().mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));

    await expect(retry(op, {
      attempts: 3, baseDelayMs: 200, maxDelayMs: 5_000, sleep: noSleep,
      retryOn: (e) => ((e as { status?: number }).status ?? 500) >= 500,
    })).rejects.toThrow('bad request');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1, 200], [2, 400], [3, 800], [10, 5_000],
  ])('backoffDelay(attempt=%i) is within [cap/2, cap] where cap=%i', (attempt, cap) => {
    expect(backoffDelay(attempt, 200, 5_000, () => 0)).toBe(cap / 2);
    expect(backoffDelay(attempt, 200, 5_000, () => 1)).toBe(cap);
  });
});
```

## Контекст запроса (AsyncLocalStorage)

```typescript
// apps/api/src/common/context/request-context.spec.ts
import { runWithContext, getCorrelationId, getRequestContext, requireTenantId } from './request-context';

describe('request context', () => {
  it('exposes correlationId inside the scope and nothing outside', () => {
    runWithContext({ correlationId: 'corr-1' }, () => expect(getCorrelationId()).toBe('corr-1'));
    expect(getCorrelationId()).toBeUndefined();
  });

  it('keeps contexts of concurrent requests separate', async () => {
    const read = (id: string, ms: number) =>
      runWithContext({ correlationId: id }, async () => {
        await new Promise((r) => setTimeout(r, ms));
        return getCorrelationId();
      });

    await expect(Promise.all([read('r-1', 10), read('r-2', 1)])).resolves.toEqual(['r-1', 'r-2']);
  });

  it('requireTenantId fails closed until SessionAuthGuard fills the principal', () => {
    runWithContext({ correlationId: 'corr-1' }, () => {
      expect(() => requireTenantId()).toThrow();
      Object.assign(getRequestContext()!, { tenantId: 'tenant-a', employeeId: 'employee-1', storeScope: ['store-1'] });
      expect(requireTenantId()).toBe('tenant-a');
    });
  });
});
```

```typescript
// apps/api/src/common/middleware/correlation-id.middleware.spec.ts
import type { Request, Response } from 'express';
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { getCorrelationId } from '../context/request-context';

describe('CorrelationIdMiddleware', () => {
  const middleware = new CorrelationIdMiddleware();
  const req = (value?: string) => ({ header: jest.fn(() => value) }) as unknown as Request;
  const res = () => ({ setHeader: jest.fn() }) as unknown as Response;

  it('generates an id when the header is absent and echoes it in the response', () => {
    const response = res();
    let seen: string | undefined;

    middleware.use(req(undefined), response, () => { seen = getCorrelationId(); });

    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.setHeader).toHaveBeenCalledWith('X-Correlation-Id', seen);
  });

  it('accepts a well-formed incoming id and replaces a malformed one (log injection)', () => {
    let seen: string | undefined;
    middleware.use(req('pos-7f3a9c21'), res(), () => { seen = getCorrelationId(); });
    expect(seen).toBe('pos-7f3a9c21');

    middleware.use(req('bad\nvalue'), res(), () => { seen = getCorrelationId(); });
    expect(seen).not.toContain('\n');
  });
});
```

## Очередь-таблица в PostgreSQL (e2e/интеграционный уровень)

Логику `SKIP LOCKED`, уникальность idempotency key и переход в dead-letter нельзя проверить моками — только на реальной PostgreSQL (`TestDb` из `nestjs-testing-integration-setup.md`).

```typescript
// apps/api-e2e/src/queue/job-queue.spec.ts
// A single UPDATE ... WITH statement is atomic in autocommit mode; concurrent calls use separate pool connections.
const claim = (workerId: string) => db.query<{ id: number }>(`
  WITH next AS (
    SELECT id FROM job_queue
    WHERE queue = 'export-1c.build' AND status = 'pending' AND run_after <= now()
    ORDER BY run_after, id
    FOR UPDATE SKIP LOCKED
    LIMIT 5
  )
  UPDATE job_queue j SET status = 'processing', locked_by = $1, locked_at = now(), attempts = attempts + 1
  FROM next WHERE j.id = next.id
  RETURNING j.id`, [workerId]);

it('two concurrent workers never claim the same job', async () => {
  for (let i = 0; i < 10; i++) {
    await db.query(
      `INSERT INTO job_queue (tenant_id, queue, payload, idempotency_key, correlation_id)
       VALUES ($1, 'export-1c.build', '{}', $2, 'corr-test')`, [TENANT_A.id, `export:${i}`]);
  }

  const [a, b] = await Promise.all([claim('w-1'), claim('w-2')]);
  const ids = [...a, ...b].map((r) => r.id);

  expect(new Set(ids).size).toBe(ids.length); // disjoint
});

it('duplicate enqueue with same idempotency key is ignored', async () => {
  const insert = () => db.query(
    `INSERT INTO job_queue (tenant_id, queue, payload, idempotency_key, correlation_id)
     VALUES ($1, 'fiscal.send', '{}', 'receipt:42', 'corr-test')
     ON CONFLICT (tenant_id, queue, idempotency_key) DO NOTHING`, [TENANT_A.id]);

  await insert();
  await insert();

  expect(await db.query("SELECT 1 FROM job_queue WHERE idempotency_key = 'receipt:42'")).toHaveLength(1);
});

it('job moves to dead status after max_attempts failures', async () => {
  // enqueue with max_attempts = 2, run worker with a handler that always throws,
  // advance run_after manually (UPDATE ... SET run_after = now()) between attempts,
  // then assert status = 'dead' and last_error is filled (without PII)
});
```

Unit-уровень воркера (обработчик вызван с контекстом тенанта задачи, ошибка → `fail()` с `nextRunAfter`, исчерпание попыток → `dead`) тестируется с моком `JobQueueRepository`.
