> **Pharmacy:** адаптировано под стек Pharmacy — Jest (стандарт Nx) вместо Vitest, мок слоя данных (`DatabaseService` + репозитории модуля) вместо Prisma (ORM не выбран — ADR), модули api вместо users. Ограничения: `docs/architecture/generated/CLAUDE.pharmacy-app.md`.

# NestJS Unit Testing — Basics & Service Tests

Настройка Jest в Nx-монорепо и паттерн unit-теста сервиса с замоканными зависимостями.

## Категории тестов

| Категория | Доля | Где | Чем |
|---|---|---|---|
| **Unit** | 70–80% | `apps/api/src/**/*.spec.ts`, `libs/**/*.spec.ts` | Jest + `@nestjs/testing`, зависимости — моки |
| **Integration / e2e** | 15–25% | `apps/api-e2e/src/**/*.spec.ts` | supertest против запущенного api + реальная PostgreSQL (`nestjs-testing-integration-setup.md`) |
| **Контракт интеграций** | 5–10% | рядом с клиентом интеграции | только закрытый список: курсы НБТ, адаптер фискализации, синхронизация, формат файла выгрузки 1С |

Команды: `npx nx test api`, `npx nx test <lib>`, `npx nx e2e api-e2e`; перед MR — `npx nx affected -t build test lint`.

## Jest-конфигурация (генерируется Nx)

```typescript
// apps/api/jest.config.ts
export default {
  displayName: 'api',
  preset: '../../jest.preset.js',            // @nx/jest preset: resolves tsconfig.base.json paths
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
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
  coverageThreshold: {
    global: { lines: 90, functions: 90, branches: 80, statements: 90 },
  },
};
```

- Декораторы: в `tsconfig.spec.json` должны действовать `experimentalDecorators` и `emitDecoratorMetadata` — иначе DI в `Test.createTestingModule` не резолвит типы.
- Алиасы `@pharmacy/shared/dto`, `@pharmacy/shared/util` берутся из `tsconfig.base.json` — отдельный `moduleNameMapper` не нужен.
- Пороги покрытия — стартовое предложение; окончательные значения фиксирует команда (`nestjs-testing-ci-troubleshooting.md`).

## Паттерн unit-теста сервиса

Слой данных — по `nestjs-config-data-access.md`: сервис открывает транзакцию через `DatabaseService.tenantTransaction()`, репозитории модуля принимают `Tx` (в нём `tenantId`). В unit-тесте мокаются `DatabaseService` и репозиторий — не ORM и не драйвер. Контекст запроса — настоящий `AsyncLocalStorage` через `runWithContext`, без мока.

```typescript
// apps/api/src/modules/catalog/products.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { DatabaseService } from '../../core/database/database.service';
import { RedisService } from '../../core/redis/redis.service';
import { createDatabaseServiceMock, inContext } from '../../../test/mocks';
import { buildProductRow } from '../../../test/factories';

describe('ProductsService', () => {
  const { db, tx } = createDatabaseServiceMock('tenant-a');
  const repo = { findById: jest.fn(), findByBarcode: jest.fn(), insert: jest.fn(), search: jest.fn() };
  const cache = { get: jest.fn(), set: jest.fn(), delByPrefix: jest.fn() };
  let service: ProductsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: DatabaseService, useValue: db },
        { provide: ProductsRepository, useValue: repo },
        { provide: RedisService, useValue: cache },
      ],
    }).compile();
    service = moduleRef.get(ProductsService);
  });

  describe('create', () => {
    const dto = { nameRu: 'Парацетамол 500 мг', nameTj: 'Парасетамол 500 мг', isPrescription: false,
                  isControlledSubstance: false, barcodes: ['4600000000017'] };

    it('inserts within tenant transaction and invalidates tenant catalog cache', async () => {
      repo.findByBarcode.mockResolvedValue(undefined);
      repo.insert.mockResolvedValue(buildProductRow({ tenant_id: 'tenant-a', name_ru: dto.nameRu }));

      const result = await inContext({ tenantId: 'tenant-a' }, () => service.create(dto));

      expect(result.nameRu).toBe(dto.nameRu);
      expect(db.tenantTransaction).toHaveBeenCalledTimes(1);
      expect(repo.insert).toHaveBeenCalledWith(tx, expect.objectContaining({ nameRu: dto.nameRu }));
      expect(cache.delByPrefix).toHaveBeenCalledWith('catalog:tenant-a:');
    });

    it('throws ConflictException when barcode already exists in the tenant', async () => {
      repo.findByBarcode.mockResolvedValue(buildProductRow());

      await expect(inContext({ tenantId: 'tenant-a' }, () => service.create(dto)))
        .rejects.toThrow(ConflictException);
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns cached product; cache key is tenant-scoped', async () => {
      cache.get.mockResolvedValue({ id: 'p-1', nameRu: 'X' });

      await inContext({ tenantId: 'tenant-a' }, () => service.findOne('p-1'));

      expect(cache.get).toHaveBeenCalledWith('catalog:tenant-a:product:p-1');
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when product is absent in current tenant', async () => {
      cache.get.mockResolvedValue(null);
      repo.findById.mockResolvedValue(undefined);

      await expect(inContext({ tenantId: 'tenant-a' }, () => service.findOne('missing')))
        .rejects.toThrow(NotFoundException);
      expect(repo.findById).toHaveBeenCalledWith(tx, 'missing');
    });
  });

  it('paginates with limit/offset and returns Page<T>', async () => {
    repo.search.mockResolvedValue({ rows: [buildProductRow()], total: 41 });

    const page = await inContext({ tenantId: 'tenant-a' }, () => service.list({ limit: 20, offset: 40 }));

    expect(page).toMatchObject({ total: 41, limit: 20, offset: 40 });
    expect(page.items).toHaveLength(1);
  });
});
```

Что проверяет каждый тест сервиса проекта:
- запись/чтение идёт через `tenantTransaction` (а значит, с `tenantId` из контекста), репозиторий получает `tx`;
- ключи кэша содержат `tenantId`;
- отказ без тенанта (fail closed) проверяется один раз — тестом `DatabaseService`/`requireTenantId` (`nestjs-testing-patterns.md`), а не в каждом сервисе.

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
