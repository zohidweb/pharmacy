> **Pharmacy:** адаптировано под стек Pharmacy — circuit breaker / retry / timeout только для закрытого списка внешних интеграций (курсы НБТ, адаптер фискализации, синхронизация офлайн-точек); собственная реализация без библиотек; «database fallback» с in-memory кэшем удалён (противоречит инвариантам остатков). Ограничения: `docs/architecture/generated/CLAUDE.pharmacy-app.md`.

# NestJS Resilience — Circuit Breaker, Retry, Timeout

Контекст запроса и correlation ID — `nestjs-resilience-context.md`. Тесты — `nestjs-testing-patterns.md`.

## Где применять

Только исходящие вызовы из закрытого списка интеграций:

| Интеграция | Имя цепи | Timeout | Retry | Поведение при OPEN |
|---|---|---|---|---|
| Курсы НБТ (HTTPS) | `nbt-rates` | 5 с (в клиенте) | 3 попытки, backoff | задача `nbt-rates.fetch` уходит в повтор по очереди; документы читают курс из БД, нет курса на дату → 422 (`nestjs-rest-services.md`) |
| Адаптер фискализации (в MVP — заглушка) | `fiscal` | по требованиям вендора | через очередь `fiscal.send` | чек уже проведён; задача ждёт в очереди |
| Синхронизация офлайн-точки → облако (HTTPS + лицензионный ключ) | `sync-upload` | 15 с | через очередь `sync.upload` | точка работает автономно, операции копятся в `sync_outbox` |

Выгрузка 1С — файловый обмен вручную, цепь не нужна.

Не применять:
- к собственной PostgreSQL и Redis (сбой БД — это отказ операции, а не «фолбэк»);
- к кассе и остаткам: никаких ответов «из устаревшего кэша» для остатков, цен в проведённом чеке и движений партий. Кэш каталога/цен для скорости — Redis (`RedisService`) с явной инвалидацией.

Библиотеки (opossum, cockatiel и т.п.) — **только через ADR**. По умолчанию — простая собственная реализация ниже.

Фискализация — после коммита чека через очередь-таблицу (`nestjs-rest-services.md`, `nestjs-messaging-basics.md`), поэтому касса укладывается в ≤ 1 сек при недоступности ККМ. Если выбранный вендор (открытый вопрос № 9 stack.md) потребует синхронной фискализации — это отдельный ADR.

## 1. Circuit breaker

Модель: N **подряд** неудачных вызовов → OPEN; через `resetTimeoutMs` → HALF_OPEN (пропускается пробный вызов); успех → CLOSED, неудача → снова OPEN.

```typescript
// apps/api/src/common/resilience/circuit-breaker.ts
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;               // 'nbt-rates' | 'fiscal' | 'sync-upload'
  failureThreshold: number;   // consecutive failures to open
  resetTimeoutMs: number;     // OPEN → HALF_OPEN after this time
  halfOpenMaxCalls: number;   // concurrent trial calls in HALF_OPEN
}

export class CircuitOpenError extends Error {
  constructor(readonly circuit: string) {
    super(`Circuit "${circuit}" is open`);
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private trialsInFlight = 0;

  constructor(private readonly opts: CircuitBreakerOptions, private readonly now: () => number = Date.now) {}

  getState(): CircuitState {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.opts.resetTimeoutMs) return 'HALF_OPEN';
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.getState();
    if (state === 'OPEN') throw new CircuitOpenError(this.opts.name);
    if (state === 'HALF_OPEN') {
      if (this.trialsInFlight >= this.opts.halfOpenMaxCalls) throw new CircuitOpenError(this.opts.name);
      this.state = 'HALF_OPEN';
      this.trialsInFlight++;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      if (state === 'HALF_OPEN') this.trialsInFlight--;
    }
  }

  snapshot() {
    return { name: this.opts.name, state: this.getState(), consecutiveFailures: this.consecutiveFailures,
             openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null };
  }

  private onSuccess(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.opts.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }
}
```

### Реестр

Одна цепь на интеграцию и процесс. Реестр отдаёт снимки состояния для readiness и диагностики (`nestjs-observability.md`, `nestjs-debugging-performance.md`).

```typescript
// apps/api/src/common/resilience/circuit-breaker.registry.ts
@Injectable()
export class CircuitBreakerRegistry {
  private readonly logger = new Logger(CircuitBreakerRegistry.name);
  private readonly breakers = new Map<string, CircuitBreaker>();   // bounded: closed list of integrations

  get(opts: CircuitBreakerOptions): CircuitBreaker {
    let breaker = this.breakers.get(opts.name);
    if (!breaker) {
      breaker = new CircuitBreaker(opts);
      this.breakers.set(opts.name, breaker);
      this.logger.log({ msg: 'circuit registered', circuit: opts.name });
    }
    return breaker;
  }

  snapshots() {
    return [...this.breakers.values()].map((b) => b.snapshot());
  }
}
```

Состояние цепи — в памяти процесса: у каждого инстанса API своя цепь. Для малой нагрузки проекта этого достаточно; общий для инстансов breaker (в Redis) — только при реальной потребности и через ADR.

## 2. Retry с экспоненциальным backoff и jitter

Повторять можно только **идемпотентные** вызовы: GET курса; отправку чека/пачки синхронизации — только с idempotency key, который принимающая сторона дедуплицирует.

```typescript
// apps/api/src/common/resilience/retry.ts
import { HttpException } from '@nestjs/common';
import { CircuitOpenError } from './circuit-breaker';

export interface RetryOptions {
  attempts: number;                          // total attempts including the first
  baseDelayMs: number;
  maxDelayMs: number;
  retryOn?: (error: unknown) => boolean;     // default: network errors and 5xx
  sleep?: (ms: number) => Promise<void>;     // injectable for tests
}

/** Exponential backoff with "equal jitter": delay ∈ [cap/2, cap], cap = min(max, base·2^(attempt-1)). */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random = Math.random): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.round(cap / 2 + (random() * cap) / 2);
}

const isTransient = (error: unknown): boolean => {
  if (error instanceof CircuitOpenError) return false;       // do not hammer an open circuit
  const status = error instanceof HttpException ? error.getStatus() : (error as { status?: number }).status;
  return status === undefined || status >= 500 || status === 429; // network errors, 5xx (incl. 502 from clients), 429
};

export async function retry<T>(operation: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const { attempts, baseDelayMs, maxDelayMs, retryOn = isTransient,
          sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= attempts || !retryOn(error)) throw error;
      await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }
}
```

Та же `backoffDelay` вычисляет `run_after` при повторе задач очереди-таблицы (`nestjs-messaging-basics.md`). Длинные повторы (минуты/часы) — через очередь, а не циклом в памяти процесса.

## 3. Timeout

```typescript
// apps/api/src/common/resilience/timeout.ts
export function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  return operation(AbortSignal.timeout(timeoutMs));   // fetch() aborts with TimeoutError
}
```

Операция обязана передать `signal` в `fetch` — иначе таймаут не прервёт вызов.

## 4. Композиция: обработчик задачи курсов НБТ

Клиент `NbtRatesClient` (`nestjs-rest-services.md`) уже ограничивает вызов таймаутом (`AbortSignal.timeout`) и переводит сбой в `BadGatewayException`. Цепь и повторы добавляет вызывающая сторона — обработчик задачи очереди. Порядок: **retry( breaker( call-with-timeout ) )** — каждая попытка ограничена таймаутом и учитывается цепью; при OPEN повторы прекращаются, задача уходит в повтор очереди по backoff.

```typescript
// apps/api/src/modules/pricing/nbt-rates.job-handler.ts
@Injectable()
export class NbtRatesJobHandler implements JobHandler<{ date: string }> {
  readonly queue = 'nbt-rates.fetch';
  private readonly breaker: CircuitBreaker;

  constructor(
    registry: CircuitBreakerRegistry,
    private readonly client: NbtRatesClient,
    private readonly rates: NbtRatesRepository,
  ) {
    this.breaker = registry.get({ name: 'nbt-rates', failureThreshold: 5, resetTimeoutMs: 60_000, halfOpenMaxCalls: 1 });
  }

  async handle({ date }: { date: string }): Promise<void> {
    const rates = await retry(
      () => this.breaker.execute(() => this.client.fetchRates(date)),
      { attempts: 3, baseDelayMs: 500, maxDelayMs: 5_000 },
    );
    await this.rates.upsertForDate(date, rates);   // idempotent by (currency, onDate); integer-scaled rates
  }
}
```

Для клиента без собственного таймаута оборачивайте вызов в `withTimeout((signal) => fetch(url, { signal }), ms)`. Адрес НБТ — из конфигурации (`.env`), только HTTPS.

## 5. Best practices

- Порог `failureThreshold` 3–5 подряд, `resetTimeoutMs` 30–60 с, `halfOpenMaxCalls` 1.
- Логируйте переходы состояний (warn при OPEN) с именем цепи и correlationId — без тела запроса/ответа.
- `CircuitOpenError` для задачи очереди — обычная временная ошибка: задача уходит в повтор по backoff.
- Никаких новых внешних адресов: новая интеграция = сначала ADR.
