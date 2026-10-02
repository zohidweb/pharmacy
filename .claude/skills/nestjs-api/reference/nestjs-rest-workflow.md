# NestJS REST — процесс разработки эндпоинта в Nx

Порядок работы над новым эндпоинтом/ресурсом apps/api. Шаблоны кода —
`nestjs-templates-features.md`, данные — `nestjs-config-data-access.md`.

## 0. Нужен ли ADR?

Сначала ADR (`/03-adr`, `docs/architecture/adr/`), потом код, если изменение:
- добавляет технологию/библиотеку, которой нет в стеке (ORM, адаптер, логгер, брокер…);
- добавляет интеграцию (закрытый список: 1С файлы, фискализация, синхронизация точек);
- добавляет модуль api или меняет границы между модулями;
- меняет модель изоляции тенантов, аутентификации или хранения аудита.

## 1. Требования и термины

- Сценарий — из ТЗ/бэклога; термины и имена сущностей — из `docs/architecture/glossary.md`.
- Определить: какой модуль владеет ресурсом, какое право каталога ADR-0018 требуется
  (`модуль:действие`, охват точек — у сотрудника; нового права в каталоге не придумывать), затрагиваются ли деньги, остатки, ПКУ, аудит,
  нужна ли идемпотентность (финансовая операция / синхронизация → да).

## 2. Контракт в libs/shared/dto

- Request/Response DTO, query-DTO списка (limit/offset), коды ошибок (`code`).
- Путь: `/api/v1/<ресурс-во-множественном-числе-kebab-case>`, JSON camelCase.
- Деньги — `*Dirams: number` (integer), количества — integer.
- Изменение контракта сразу видно web и admin — `npx nx affected -t build test lint` это проверит.

## 3. Схема БД (если нужна)

- Миграция node-pg-migrate (ADR-0006, только Up): ключ `(tenant_id, id)`, индексы
  `(tenant_id, …)`, RLS-политика `TO pharmacy_app`, явные гранты, для журналов — append-only
  права/триггер; класс таблицы — в `table-classes.ts`.
- Ревью миграции — агент `postgresql-database-reviewer`; правила —
  скил `postgres-best-practices`.

## 4. Генерация и код

```bash
# check syntax for your Nx version: npx nx g @nx/nest:<generator> --help
npx nx g @nx/nest:controller apps/api/src/app/pos/receipts
npx nx g @nx/nest:service    apps/api/src/app/pos/receipts
```

- Миграция (если меняется схема): `apps/api/migrations/*.sql` по модели данных, запись в
  `table-classes.ts`, `npx nx run api:migrate`, `npx nx run api:db-types`.
- Репозиторий: Kysely-запросы с `.where('tenantId', '=', tenantId)`, принимает `TenantTransaction`.
- Сервис: бизнес-правила, `TenantDatabase.tenantTransaction()`, аудит в той же транзакции.
- Контроллер: `@RequirePermission('<модуль>:<действие>'[, scope])`, DTO на входе/выходе, никакой логики.
- Внешний вызов (фискализация, синхронизация) — только через клиент-адаптер модуля с таймаутом,
  никогда внутри транзакции кассы (`nestjs-rest-services.md`).

## 5. Тесты (Jest)

- Unit: сервис с замоканными репозиториями — бизнес-правила, округление денег, FEFO.
- Интеграционные/e2e (`apps/api-e2e`): реальная PostgreSQL; обязательно тест
  «данные другого тенанта не видны» и тест повторного запроса с тем же idempotency key.
- Детали — `nestjs-testing-*.md`.

## 6. Проверка перед MR

```bash
npx nx affected -t build test lint
npx nx e2e api-e2e
```

Плюс `npx nx run api:integration` и `npx nx run api:db-types-verify`. CI — GitHub Actions (ADR-0009); пока workflow-файлов нет, перед PR — полный прогон `npm run check`.
Затем — агенты ревью (SKILL.md, «Post-Code Review») и обязательное ревью человеком.

## Пример контроллера ресурса с идемпотентностью

```typescript
// apps/api/src/app/pos/receipts.controller.ts
import { Body, Controller, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompleteReceiptDto, ReceiptResponseDto } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { IdempotencyKeyMismatchException } from '../../common/errors/idempotency-key-mismatch.exception';
import { IdempotencyKeyPipe } from '../../common/pipes/idempotency-key.pipe';
import { ReceiptsService } from './receipts.service';

@ApiTags('pos')
@Controller({ path: 'stores/:storeId/receipts', version: '1' }) // /api/v1/stores/{storeId}/receipts
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('pos:create', { storeParam: 'storeId' }) // a sale creates a receipt (ADR-0018 catalog)
  @ApiOperation({ summary: 'Complete a receipt: sale lines, payments, FEFO batch write-off' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  complete(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Headers('idempotency-key', IdempotencyKeyPipe) idempotencyKey: string,
    @Body() dto: CompleteReceiptDto,
  ): Promise<ReceiptResponseDto> {
    // Transport check, not business logic: the header and the body carry the same operation id
    if (idempotencyKey !== dto.operationId) throw new IdempotencyKeyMismatchException(); // 422
    return this.receipts.completeReceipt(storeId, dto);
  }
}
```

**Контракт идемпотентности финансовой операции (один для всех скилов):** касса (apps/web)
генерирует UUIDv7 `operationId` один раз на операцию и при каждой досылке из буфера отправляет
его и в теле (`dto.operationId`), и в заголовке `Idempotency-Key`. `IdempotencyKeyPipe` требует
заголовок и проверяет формат; контроллер сверяет заголовок с `dto.operationId` (422 при
расхождении); сервис `completeReceipt(storeId, dto)` идемпотентен по `operationId` (уникальный
ключ `(tenant_id, operation_id)`, `nestjs-config-data-access.md`).
