> **Pharmacy:** адаптировано под стек Pharmacy — Jest вместо Vitest, фабрики без faker (детерминированные синтетические данные, ADR-0009 ось В), сущности из глоссария. Ограничения: `CLAUDE.md`. <!-- docs-check: ok -->

# NestJS Unit Testing — Controllers & Test Data Factories

## Паттерн unit-теста контроллера

Контроллер тонкий (без бизнес-логики), поэтому его unit-тест проверяет только передачу параметров в сервис и проброс исключений. Валидация DTO, guards (сессия, права, охват точек), `IdempotencyKeyPipe` и фильтр RFC 7807 проверяются в e2e (`nestjs-testing-integration-patterns.md`).

```typescript
// apps/api/src/app/pos/receipts.controller.spec.ts
import { Test } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { IdempotencyKeyMismatchException } from '../../common/errors/idempotency-key-mismatch.exception';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';

describe('ReceiptsController', () => {
  let controller: ReceiptsController;
  const service = { completeReceipt: jest.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReceiptsController],
      providers: [{ provide: ReceiptsService, useValue: service }],
    }).compile();
    controller = moduleRef.get(ReceiptsController);
  });

  const operationId = '01920000-0000-7000-8000-000000000001'; // UUIDv7 from the POS = Idempotency-Key
  const dto = {
    operationId,
    lines: [{ batchId: '00000000-0000-4000-8000-000000000101', quantity: 2, unitPriceDirams: 1250 }],
    payments: [{ method: 'cash' as const, amountDirams: 2500 }],
  };

  it('passes storeId and DTO to the service when the header equals dto.operationId', async () => {
    service.completeReceipt.mockResolvedValue({ id: 'r-1', totalDirams: 2500 });

    await expect(controller.complete('store-1', operationId, dto)).resolves.toEqual({ id: 'r-1', totalDirams: 2500 });
    expect(service.completeReceipt).toHaveBeenCalledWith('store-1', dto);
  });

  it('rejects an Idempotency-Key that differs from dto.operationId (422) without calling the service', async () => {
    await expect(controller.complete('store-1', '01920000-0000-7000-8000-0000000000ff', dto))
      .rejects.toThrow(IdempotencyKeyMismatchException);
    expect(service.completeReceipt).not.toHaveBeenCalled();
  });

  it('propagates domain exceptions unchanged (the global filter maps them to problem+json)', async () => {
    service.completeReceipt.mockRejectedValue(new UnprocessableEntityException());

    await expect(controller.complete('store-1', operationId, dto)).rejects.toThrow(UnprocessableEntityException);
  });
});
```

Для списков контроллер возвращает `Page<T>` = `{ items, total, limit, offset }` (`nestjs-rest-dto-pagination.md`) — проверяйте именно эту форму.

## Фабрики тестовых данных

Правила проекта:
- **Только синтетические данные** — никаких реальных ФИО, телефонов, рецептов, реквизитов поставщиков.
- Детерминированные значения (счётчик), без генераторов случайных данных — тесты воспроизводимы. faker не используем (ADR-0009).
- Деньги — integer в дирамах; сроки годности — явные даты.
- Фабрики строк БД — в форме строк Kysely (camelCase, как возвращает `CamelCasePlugin`) — для моков репозиториев и сидера e2e.
- Расположение: общие билдеры — Nx-библиотека `libs/shared/testing` (тег `type:testing`: импорт только из `*.spec.ts` и проектов `*-e2e`, ADR-0009 ось В; создаётся с первой потребностью двух проектов); до неё — `apps/api/test/factories/`.

```typescript
// apps/api/test/factories/index.ts
let seq = 0;
const next = () => ++seq;
export const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

export function buildProductRow(overrides: Partial<ProductRow> = {}): ProductRow {
  const n = next();
  return {
    id: uuid(n),
    tenant_id: uuid(0),
    name_ru: `Test product ${n}`,
    name_tj: `Test product ${n}`,
    inn: null,
    is_prescription: false,
    is_controlled_substance: false,
    barcodes: [`46000000${n.toString().padStart(5, '0')}`],
    archived_at: null,
    ...overrides,
  };
}

export function buildBatchRow(overrides: Partial<BatchRow> = {}): BatchRow {
  const n = next();
  return {
    id: uuid(n),
    tenant_id: uuid(0),
    store_id: uuid(0),
    product_id: uuid(0),
    expiry_date: '2027-12-31',
    purchase_price_dirams: 1500,   // integer, minor units TJS
    ...overrides,
  };
}
```

Поля — иллюстрация; источник истины — схема миграций, типы `libs/shared/domain` и глоссарий (`docs/architecture/glossary.md`).

### Сидирование для e2e

В e2e данные создаются через публичный API (предпочтительно — проверяет реальный путь) или сидером через `TestDb` (`nestjs-testing-integration-setup.md`) — когда нужно состояние, недоступное через API (например, начальные остатки).

```typescript
// apps/api-e2e/src/support/seeder.ts
import { TestDb } from './test-db';
import { buildBatchRow, buildProductRow } from './factories';

export class TestSeeder {
  constructor(private readonly db: TestDb) {}

  async productWithStock(tenantId: string, storeId: string, quantity: number) {
    const product = buildProductRow({ tenant_id: tenantId });
    const batch = buildBatchRow({ tenant_id: tenantId, store_id: storeId, product_id: product.id });
    // Table/column names are illustrative — the schema comes from migrations (tool per ADR).
    await this.db.query(
      'INSERT INTO products (id, tenant_id, name_ru, name_tj, barcodes) VALUES ($1, $2, $3, $4, $5)',
      [product.id, tenantId, product.name_ru, product.name_tj, product.barcodes],
    );
    await this.db.query(
      `INSERT INTO batches (id, tenant_id, store_id, product_id, expiry_date, purchase_price_dirams)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [batch.id, tenantId, storeId, product.id, batch.expiry_date, batch.purchase_price_dirams],
    );
    // Stock is never stored — it is the sum of movements.
    await this.db.query(
      `INSERT INTO stock_movements (tenant_id, store_id, batch_id, quantity, source_type)
       VALUES ($1, $2, $3, $4, 'initial_balance')`,
      [tenantId, storeId, batch.id, quantity],
    );
    return { product, batch };
  }
}
```
