> **Pharmacy:** адаптировано под стек Pharmacy — Jest вместо Vitest; мок `DatabaseService`/репозиториев вместо Prisma-клиента (ORM не выбран — ADR); настоящий контекст запроса вместо мока; внешние HTTP — только закрытый список интеграций. Ограничения: `CLAUDE.md`.

# NestJS Unit Testing — Mock Patterns & Conventions

## Мок слоя данных (ORM-независимо)

Контракт слоя — `nestjs-config-data-access.md`: `DatabaseService.tenantTransaction(work)` + репозитории модулей, принимающие `Tx`. В unit-тестах мокаются именно они. Глубокие моки ORM (`mockDeep<PrismaClient>()` и т.п.) не используем: они привязывают тесты к ORM, который ещё не выбран.

```typescript
// apps/api/test/mocks/database.mock.ts
import type { Tx } from '../../src/core/database/database.service';

/** tenantTransaction runs the callback immediately with a fake tx — tests can assert "same tx everywhere". */
export function createDatabaseServiceMock(tenantId = 'tenant-a') {
  const tx = { tenantId, query: jest.fn() } as unknown as jest.Mocked<Tx>;
  const db = {
    tenantTransaction: jest.fn(async <T>(work: (t: Tx) => Promise<T>) => work(tx)),
    ping: jest.fn(),
  };
  return { db, tx };
}
```

```typescript
// apps/api/test/mocks/context.ts
import { runWithContext, type RequestContext } from '../../src/common/context/request-context';

/** Runs fn inside a real AsyncLocalStorage context — no need to mock getTenantId()/getCorrelationId(). */
export function inContext<T>(ctx: Partial<RequestContext>, fn: () => Promise<T>): Promise<T> {
  return runWithContext({ correlationId: 'corr-test', storeScope: 'all', ...ctx }, fn);
}
```

Пример — чек и движения партий пишутся в одной транзакции, при нехватке остатка ничего не пишется (сервис — как в `nestjs-config-data-access.md`, раздел «Транзакция чек + движения партий + аудит»):

```typescript
// apps/api/src/modules/pos/receipts.service.spec.ts (fragment)
const { db, tx } = createDatabaseServiceMock('tenant-a');
const receipts = { findByIdempotencyKey: jest.fn(), insert: jest.fn() };
const stock = { availableByBatch: jest.fn(), insertMovements: jest.fn() };
const audit = { append: jest.fn() };
const BATCH = '00000000-0000-4000-8000-000000000101';
const dto = { lines: [{ batchId: BATCH, quantity: 2, unitPriceDirams: 1250 }], payments: [{ method: 'cash', amountDirams: 2500 }] };

beforeEach(() => {
  receipts.findByIdempotencyKey.mockResolvedValue(undefined);
  tx.query.mockResolvedValue([{ id: BATCH }]);               // FOR UPDATE lock on batches
});

it('writes receipt, negative movements and audit with the same tx', async () => {
  stock.availableByBatch.mockResolvedValue(new Map([[BATCH, 10]]));
  receipts.insert.mockResolvedValue({ id: 'r-1' });

  await inContext({ tenantId: 'tenant-a' }, () => service.completeReceipt('store-1', dto, 'idem-1'));

  expect(db.tenantTransaction).toHaveBeenCalledTimes(1);
  expect(receipts.insert).toHaveBeenCalledWith(tx, 'store-1', dto, 'idem-1');
  expect(stock.insertMovements).toHaveBeenCalledWith(tx, [
    expect.objectContaining({ batchId: BATCH, quantity: -2, sourceType: 'receipt', sourceId: 'r-1' }),
  ]);
  expect(audit.append).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'receipt.completed' }));
});

it('writes nothing when stock is insufficient', async () => {
  stock.availableByBatch.mockResolvedValue(new Map([[BATCH, 1]]));

  await expect(inContext({ tenantId: 'tenant-a' }, () => service.completeReceipt('store-1', dto, 'idem-2')))
    .rejects.toThrow(InsufficientStockException);
  expect(receipts.insert).not.toHaveBeenCalled();
  expect(stock.insertMovements).not.toHaveBeenCalled();
});

it('replays the original result for the same idempotency key', async () => {
  receipts.findByIdempotencyKey.mockResolvedValue({ id: 'r-1', payload_hash: '…' });

  await inContext({ tenantId: 'tenant-a' }, () => service.completeReceipt('store-1', dto, 'idem-1'));

  expect(receipts.insert).not.toHaveBeenCalled();
});
```

Реальный откат транзакции, гонку одинаковых запросов и RLS unit-тестом не проверить — это обязательные e2e-кейсы (`nestjs-testing-integration-patterns.md`).

`@golevelup/ts-jest` (`createMock<T>()` с автомоком всех методов) удобен, но это новая dev-зависимость — **согласовать**; до этого — явные объекты `{ method: jest.fn() }`.

## Кэш (Redis)

Redis в стеке (stack.md) — для сессий и кэша каталога/цен. Мокается обёртка `RedisService`, не клиент.

```typescript
export const createRedisMock = () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), delByPrefix: jest.fn(), ping: jest.fn() });
```

## Внешние интеграции (только закрытый список)

Разрешены только: адаптер фискализации (в MVP — заглушка; HTTP-клиент вендора ККМ), синхронизация офлайн-точек (HTTPS + лицензионный ключ), выгрузка 1С (файлы). Никаких других внешних адресов ни в коде, ни в тестах.

- **Потребители** мокают порт интеграции (`FiscalRegistrar` по токену `FISCAL_REGISTRAR`, клиент синхронизации) через `useValue`.
- **Сам клиент** тестируется с подменой встроенного `fetch` (Node LTS) — без сети:

```typescript
// apps/api/src/modules/fiscal/http-fiscal-registrar.spec.ts
import { BadGatewayException } from '@nestjs/common';
import { HttpFiscalRegistrar } from './http-fiscal-registrar';
import type { FiscalReceipt } from './fiscal-registrar.port';

describe('HttpFiscalRegistrar', () => {
  const registrar = new HttpFiscalRegistrar({ adapter: 'http', baseUrl: 'https://kkm.test', timeoutMs: 5_000 } as never);
  const receipt: FiscalReceipt = {                   // synthetic data only
    receiptId: 'receipt-1', storeId: 'store-1', totalDirams: 1_250,
    lines: [{ name: 'Test product', quantity: 1, amountDirams: 1_250 }],
  };
  afterEach(() => jest.restoreAllMocks());

  it('sends the job idempotency key with the registration', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValue(new Response(KKM_SAMPLE_BODY, { status: 200 })); // synthetic vendor sample
    await registrar.register(receipt, 'receipt:receipt-1');

    const [, init] = fetchSpy.mock.calls[0];
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('receipt:receipt-1');
  });

  it('maps vendor failure to BadGatewayException (retry/circuit breaker decide next)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('fail', { status: 503 }));

    await expect(registrar.register(receipt, 'receipt:receipt-1')).rejects.toThrow(BadGatewayException);
  });
});
```

`nock` — альтернатива подмене `fetch`, но это новая dev-зависимость — **согласовать**.

## ConfigService

```typescript
export const createConfigMock = (values: Record<string, unknown> = {}) => ({
  get: jest.fn((key: string) => values[key]),
  getOrThrow: jest.fn((key: string) => {
    if (!(key in values)) throw new Error(`Configuration key ${key} not found`);
    return values[key];
  }),
});

// Only synthetic values — never real connection strings or keys
const config = createConfigMock({ FISCAL_BASE_URL: 'https://kkm.test' });
```

Если конфиг внедряется через `registerAs` + `ConfigType` (`nestjs-config-basics.md`) — подставляйте объект конфига по его `KEY`: `{ provide: fiscalConfig.KEY, useValue: { adapter: 'http', baseUrl: 'https://kkm.test', timeoutMs: 5000 } }`.

## Время и сроки годности

FEFO и сроки годности зависят от «сегодня» — фиксируйте время:

```typescript
beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-09-29T09:00:00+05:00')));
afterEach(() => jest.useRealTimers());
```

## Именование и структура

```text
apps/api/src/modules/pos/receipts.service.spec.ts   # unit, рядом с кодом
libs/shared/util/src/lib/money.spec.ts              # unit библиотеки
apps/api-e2e/src/pos/receipts.spec.ts               # e2e (проект api-e2e)
```

```typescript
describe('ReceiptsService', () => {
  describe('completeReceipt', () => {
    it('should write receipt and movements in one transaction', async () => {
      // Arrange → Act → Assert
    });
  });
});
```

## Запуск

```bash
npx nx test api                                   # все unit-тесты api
npx nx test api --watch
npx nx test api --testFile=receipts.service.spec.ts
npx nx test api --testNamePattern="one transaction"
npx nx test api --coverage
npx nx test shared-util                           # имя проекта библиотеки — по project.json
```

---

**Главное:**
1. Мокать `DatabaseService`, репозитории модулей, клиенты интеграций — не ORM.
2. Контекст (тенант, сотрудник, correlationId) — настоящий, через `inContext()`.
3. Моки — через `useValue` в `Test.createTestingModule`; `clearMocks: true` в jest-конфиге.
4. Деньги — integer, время — фиксировано, данные — синтетические.
5. Откат транзакций, изоляция тенантов и идемпотентность под гонкой подтверждаются e2e против реальной PostgreSQL.
