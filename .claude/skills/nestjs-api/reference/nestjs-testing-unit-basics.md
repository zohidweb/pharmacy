> **Pharmacy:** адаптировано под стек Pharmacy — Jest (стандарт Nx) вместо Vitest, мок слоя данных (`TenantDatabase` + репозитории модуля, ADR-0006) вместо клиента ORM; пороги покрытия ADR-0009, модули api вместо users. Ограничения: `CLAUDE.md`.

# NestJS Unit Testing — Basics & Service Tests

Настройка Jest в Nx-монорепо и паттерн unit-теста сервиса с замоканными зависимостями.

## Категории тестов

| Категория | Доля | Где | Чем |
|---|---|---|---|
| **Unit** | 70–80% | `apps/api/src/**/*.spec.ts`, `libs/**/*.spec.ts` | Jest + `@nestjs/testing`, зависимости — моки |
| **Integration / e2e** | 15–25% | `apps/api-e2e/src/**/*.spec.ts` | supertest против запущенного api + реальная PostgreSQL (`nestjs-testing-integration-setup.md`) |
| **Контракт интеграций** | 5–10% | рядом с клиентом интеграции | только закрытый список: адаптер фискализации, синхронизация, формат файла выгрузки 1С |

Команды: `npx nx test api`, `npx nx test <lib>`, `npx nx e2e api-e2e`; перед MR — `npx nx affected -t build test lint`.

## Jest-конфигурация (генерируется Nx)

```typescript
// apps/api/jest.config.cts (real file, abridged)
module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',            // @nx/jest preset
  testEnvironment: 'node',
  transform: {
    // SWC with decoratorMetadata + legacyDecorator from apps/api/.spec.swcrc (Nest DI needs them)
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  clearMocks: true,                          // same as jest.clearAllMocks() before each test
  coverageDirectory: '../../coverage/apps/api',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts',
  ],
  // ADR-0009: differentiated thresholds, raised only ("ratchet"); directory keys are aggregated
  coverageThreshold: {
    global: { lines: 70, branches: 60, functions: 70, statements: 70 },
    './src/app/pos/': { lines: 85, branches: 75, functions: 85, statements: 85 },
    './src/app/inventory/': { lines: 85, branches: 75, functions: 85, statements: 85 },
    './src/app/returns/': { lines: 85, branches: 75, functions: 85, statements: 85 },
    './src/app/pricing/': { lines: 85, branches: 75, functions: 85, statements: 85 },
    './src/app/billing/': { lines: 85, branches: 75, functions: 85, statements: 85 },
  },
};
```

- Декораторы: в `tsconfig.spec.json` должны действовать `experimentalDecorators` и `emitDecoratorMetadata` — иначе DI в `Test.createTestingModule` не резолвит типы.
- Пакеты `@pharmacy/shared-dto`, `@pharmacy/shared-util` резолвятся как npm workspaces — отдельный `moduleNameMapper` не нужен; ESM-only зависимости — в `apps/api/jest.esm-packages.cjs`.
- Пороги покрытия — по ADR-0009 (таблица в `nestjs-testing-ci-troubleshooting.md`); из покрытия исключаются только `main.ts`, `*.module.ts`, `*.dto.ts`; повышаются, не понижаются.

## Паттерн unit-теста сервиса

Слой данных — по `nestjs-config-data-access.md`: сервис открывает транзакцию через `TenantDatabase.tenantTransaction()`, репозитории модуля принимают `trx` и `tenantId`. В unit-тесте мокаются `TenantDatabase` и репозиторий — не Kysely и не драйвер. Контекст запроса — настоящий `AsyncLocalStorage` через `runWithContext`, без мока.

```typescript
// apps/api/src/app/catalog/products.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { TenantDatabase } from '../../core/database';
import { RedisService } from '../../core/redis/redis.service';
import { createTenantDatabaseMock, inContext } from '../../../test/mocks';
import { buildProductRow } from '../../../test/factories';

describe('ProductsService', () => {
  const { db, trx } = createTenantDatabaseMock();
  const TENANT = '01920000-0000-7000-8000-000000000001';
  const repo = { findById: jest.fn(), findByBarcode: jest.fn(), insert: jest.fn(), search: jest.fn() };
  const cache = { get: jest.fn(), set: jest.fn(), delByPrefix: jest.fn() };
  let service: ProductsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: TenantDatabase, useValue: db },
        { provide: ProductsRepository, useValue: repo },
        { provide: RedisService, useValue: cache },
      ],
    }).compile();
    service = moduleRef.get(ProductsService);
  });

  describe('create', () => {
    const dto = { name: { ru: 'Парацетамол 500 мг', tj: 'Парасетамол 500 мг' }, piecesPerPack: 10,
                  isPrescription: false, isControlled: false, barcodes: ['4600000000017'] };

    it('inserts within tenant transaction and invalidates tenant catalog cache', async () => {
      repo.findByBarcode.mockResolvedValue(undefined);
      repo.insert.mockResolvedValue(buildProductRow({ tenantId: TENANT, name: dto.name }));

      const result = await inContext({ tenantId: TENANT }, () => service.create(dto));

      expect(result.name).toEqual(dto.name);
      expect(db.tenantTransaction).toHaveBeenCalledTimes(1);
      expect(repo.insert).toHaveBeenCalledWith(trx, TENANT, expect.objectContaining({ name: dto.name }));
      expect(cache.delByPrefix).toHaveBeenCalledWith(`catalog:${TENANT}:`);
    });

    it('throws ConflictException when barcode already exists in the tenant', async () => {
      repo.findByBarcode.mockResolvedValue(buildProductRow());

      await expect(inContext({ tenantId: TENANT }, () => service.create(dto)))
        .rejects.toThrow(ConflictException);
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns cached product; cache key is tenant-scoped', async () => {
      cache.get.mockResolvedValue({ id: 'p-1', nameRu: 'X' });

      await inContext({ tenantId: TENANT }, () => service.findOne('p-1'));

      expect(cache.get).toHaveBeenCalledWith(`catalog:${TENANT}:product:p-1`);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when product is absent in current tenant', async () => {
      cache.get.mockResolvedValue(null);
      repo.findById.mockResolvedValue(undefined);

      await expect(inContext({ tenantId: TENANT }, () => service.findOne('missing')))
        .rejects.toThrow(NotFoundException);
      expect(repo.findById).toHaveBeenCalledWith(trx, TENANT, 'missing');
    });
  });

  it('paginates with limit/offset and returns Page<T>', async () => {
    repo.search.mockResolvedValue({ rows: [buildProductRow()], total: 41 });

    const page = await inContext({ tenantId: TENANT }, () => service.list({ limit: 20, offset: 40 }));

    expect(page).toMatchObject({ total: 41, limit: 20, offset: 40 });
    expect(page.items).toHaveLength(1);
  });
});
```

Что проверяет каждый тест сервиса проекта:
- запись/чтение идёт через `tenantTransaction` (а значит, с `tenantId` из контекста), репозиторий получает `trx` и `tenantId`;
- ключи кэша содержат `tenantId`;
- отказ без тенанта (fail closed) проверяется один раз — тестами `request-context.spec.ts` и `tenant-database.int-spec.ts`, а не в каждом сервисе.

## Деньги — integer (обязательный unit-кейс)

Денежная арифметика живёт в `libs/shared/util` и тестируется как чистые функции.

```typescript
// libs/shared/util/src/lib/money.spec.ts
import { unitCostFromPack, sumDirams } from './money';

describe('money (dirams, integer minor units)', () => {
  it.each([
    [1000, 3, 334], // 333.33… → up, in favour of the pharmacy
    [1000, 4, 250],
    [1, 10, 1],
  ])('unitCostFromPack(%i, %i) = %i', (packCostDirams, unitsPerPack, expected) => {
    const unit = unitCostFromPack(packCostDirams, unitsPerPack);
    expect(unit).toBe(expected);
    expect(Number.isInteger(unit)).toBe(true);
  });

  it('rejects non-integer amounts', () => {
    expect(() => sumDirams([100, 0.5])).toThrow(RangeError);
  });
});
```
