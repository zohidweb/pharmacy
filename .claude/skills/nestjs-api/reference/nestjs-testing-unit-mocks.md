> **Pharmacy:** адаптировано под стек Pharmacy — Jest вместо Vitest; мок `TenantDatabase` и репозиториев вместо клиента ORM; настоящий контекст запроса вместо мока; внешние HTTP — только закрытый список интеграций; правила ADR-0009 (фейки портов, без nock/MSW/faker/`@golevelup/ts-jest`). Ограничения: `CLAUDE.md`.

# NestJS Unit Testing — Mock Patterns & Conventions

## Мок слоя данных

Контракт слоя — `nestjs-config-data-access.md`: сервис вызывает `TenantDatabase.tenantTransaction(work)`
и передаёт `trx` репозиториям; **все запросы — в репозиториях**. Поэтому в unit-тесте `trx` —
непрозрачный объект, а мокаются `TenantDatabase` и репозитории. Глубокие моки Kysely не пишем:
SQL, RLS и откат проверяют интеграционные тесты на реальной PostgreSQL (`*.int-spec.ts`).

```typescript
// apps/api/test/mocks/database.mock.ts
import type { TenantDatabase, TenantTransaction } from '../../src/core/database';

/** tenantTransaction runs the callback immediately with one fake trx — tests can assert "same trx everywhere". */
export function createTenantDatabaseMock() {
  const trx = { fake: 'trx' } as unknown as TenantTransaction;
  const db = {
    tenantTransaction: jest.fn(async <T>(work: (t: TenantTransaction) => Promise<T>) => work(trx)),
    withTenant: jest.fn(async <T>(_tenantId: string, work: (t: TenantTransaction) => Promise<T>) => work(trx)),
  } satisfies Partial<Record<keyof TenantDatabase, unknown>>;
  return { db, trx };
}
```

```typescript
// apps/api/test/mocks/context.ts
import { runWithContext, type RequestContext } from '../../src/common/context/request-context';

/** Runs fn inside a real AsyncLocalStorage context — requireTenantId() works without mocks. */
export function inContext<T>(ctx: Partial<RequestContext>, fn: () => Promise<T>): Promise<T> {
  return runWithContext({ correlationId: 'corr-test', ...ctx }, fn);
}
```

Пример — чек и движения партий пишутся в одной транзакции, при нехватке остатка ничего не пишется (сервис — как в `nestjs-config-data-access.md`, раздел «Транзакция чек + движения партий + аудит»):

```typescript
// apps/api/src/app/pos/receipts.service.spec.ts (fragment)
const { db, trx } = createTenantDatabaseMock();
const TENANT = '01920000-0000-7000-8000-000000000001'; // synthetic UUIDv7-shaped ids
const BATCH = '01920000-0000-7000-8000-000000000101';
const receipts = { findByOperationId: jest.fn(), insert: jest.fn() };
const batches = { lockForSale: jest.fn() };
const stock = { onHandByBatch: jest.fn(), insertSaleMovements: jest.fn() };
const audit = { append: jest.fn() };
const dto = { operationId: '01920000-0000-7000-8000-0000000000aa',
  lines: [{ batchId: BATCH, qtyPieces: 2, unitPriceDirams: 1250 }], payments: [{ paymentMethodId: 'cash', amountDirams: 2500 }] };

beforeEach(() => {
  receipts.findByOperationId.mockResolvedValue(undefined);
  batches.lockForSale.mockResolvedValue([{ id: BATCH }]);
});

it('writes receipt, negative movements and audit with the same trx', async () => {
  stock.onHandByBatch.mockResolvedValue(new Map([[BATCH, 10n]]));   // stock is bigint (int8 parser)
  receipts.insert.mockResolvedValue({ id: 'r-1' });

  await inContext({ tenantId: TENANT }, () => service.completeReceipt('store-1', dto));

  expect(db.tenantTransaction).toHaveBeenCalledTimes(1);
  expect(receipts.insert).toHaveBeenCalledWith(trx, TENANT, 'store-1', dto);
  expect(stock.insertSaleMovements).toHaveBeenCalledWith(trx, TENANT, 'store-1', 'r-1', dto.lines);
  expect(audit.append).toHaveBeenCalledWith(trx, expect.objectContaining({ action: 'receipt.completed' }));
});

it('writes nothing when stock is insufficient', async () => {
  stock.onHandByBatch.mockResolvedValue(new Map([[BATCH, 1n]]));

  await expect(inContext({ tenantId: TENANT }, () => service.completeReceipt('store-1', dto)))
    .rejects.toThrow(InsufficientStockException);
  expect(receipts.insert).not.toHaveBeenCalled();
  expect(stock.insertSaleMovements).not.toHaveBeenCalled();
});

it('replays the original result for the same operationId', async () => {
  receipts.findByOperationId.mockResolvedValue({ id: 'r-1', payloadHash: '…' });

  await inContext({ tenantId: TENANT }, () => service.completeReceipt('store-1', dto));

  expect(receipts.insert).not.toHaveBeenCalled();
});
```

Реальный откат транзакции, гонку одинаковых запросов и RLS unit-тестом не проверить — это обязательные интеграционные и e2e-кейсы (`nestjs-testing-integration-patterns.md`).

Моки — явные типизированные объекты `{ method: jest.fn() }` и фабрики в `apps/api/test/mocks` / `libs/shared/testing`; `@golevelup/ts-jest` не используем (ADR-0009, ось Г).

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
// apps/api/src/app/fiscal/http-fiscal-registrar.spec.ts
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

`nock` и MSW не используем (ADR-0009, ось Б): потребители мокают порт, клиент — `jest.spyOn(global.fetch)`. В `setupFiles` unit-тестов стоит предохранитель: `fetch` по умолчанию бросает ошибку «реальная сеть в тесте», тест разрешает его явно через `spyOn`.

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
apps/api/src/app/pos/receipts.service.spec.ts   # unit, рядом с кодом
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
1. Мокать `TenantDatabase`, репозитории модулей, порты интеграций — не Kysely и не пул.
2. Контекст (тенант, сотрудник, correlationId) — настоящий, через `inContext()`.
3. Моки — через `useValue` в `Test.createTestingModule`; `clearMocks: true` в jest-конфиге.
4. Деньги — integer, время — фиксировано, данные — синтетические.
5. Откат транзакций, изоляция тенантов и идемпотентность под гонкой подтверждаются интеграционными тестами (`npx nx run api:integration`) и e2e против реальной PostgreSQL.
