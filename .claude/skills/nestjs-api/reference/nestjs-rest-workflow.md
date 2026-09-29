# NestJS REST — процесс разработки эндпоинта в Nx

Порядок работы над новым эндпоинтом/ресурсом apps/api. Шаблоны кода —
`nestjs-templates-features.md`, данные — `nestjs-config-data-access.md`.

## 0. Нужен ли ADR?

Сначала ADR в архитектурном репозитории (`/03-adr`), потом код, если изменение:
- добавляет технологию/библиотеку, которой нет в стеке (ORM, адаптер, логгер, брокер…);
- добавляет интеграцию (закрытый список: 1С файлы, фискализация, курсы НБТ, синхронизация точек);
- добавляет модуль api или меняет границы между модулями;
- меняет модель изоляции тенантов, аутентификации или хранения аудита.

## 1. Требования и термины

- Сценарий — из ТЗ/бэклога; термины и имена сущностей — из `docs/architecture/glossary.md`.
- Определить: какой модуль владеет ресурсом, какое право требуется
  («модуль × действие × охват точек»), затрагиваются ли деньги, остатки, ПКУ, аудит,
  нужна ли идемпотентность (финансовая операция / синхронизация → да).

## 2. Контракт в libs/shared/dto

- Request/Response DTO, query-DTO списка (limit/offset), коды ошибок (`code`).
- Путь: `/api/v1/<ресурс-во-множественном-числе-kebab-case>`, JSON camelCase.
- Деньги — `*Dirams: number` (integer), количества — integer.
- Изменение контракта сразу видно web и admin — `npx nx affected -t build test lint` это проверит.

## 3. Схема БД (если нужна)

- Версионированная миграция (инструмент — по ADR): `tenant_id NOT NULL`, индексы
  `(tenant_id, …)`, RLS-политика, для журналов — append-only права/триггер.
- Ревью миграции — агент `postgresql-database-reviewer`; правила —
  скил `postgres-best-practices`.

## 4. Генерация и код

```bash
# check syntax for your Nx version: npx nx g @nx/nest:<generator> --help
npx nx g @nx/nest:controller apps/api/src/modules/pos/receipts
npx nx g @nx/nest:service    apps/api/src/modules/pos/receipts
```

- Репозиторий: SQL с `tenant_id`, принимает `Tx`.
- Сервис: бизнес-правила, транзакция `db.tenantTransaction()`, аудит в той же транзакции.
- Контроллер: `@RequirePermission(...)`, DTO на входе/выходе, никакой логики.
- Внешний вызов (НБТ, фискализация) — только через клиент-адаптер модуля с таймаутом,
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

CI пока не выбран (вводится через ADR) — до ADR команды запускаются вручную; полный прогон — `npm run check`.
Затем — агенты ревью (SKILL.md, «Post-Code Review») и обязательное ревью человеком.

## Пример контроллера ресурса с идемпотентностью

```typescript
// apps/api/src/modules/pos/receipts.controller.ts
import { Body, Controller, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompleteReceiptDto, ReceiptResponseDto } from '@pharmacy/shared/dto';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { IdempotencyKeyPipe } from '../../common/pipes/idempotency-key.pipe';
import { ReceiptsService } from './receipts.service';

@ApiTags('pos')
@Controller({ path: 'stores/:storeId/receipts', version: '1' }) // /api/v1/stores/{storeId}/receipts
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('pos', 'sell', { storeParam: 'storeId' })
  @ApiOperation({ summary: 'Complete a receipt: sale lines, payments, FEFO batch write-off' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  complete(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Headers('idempotency-key', IdempotencyKeyPipe) idempotencyKey: string,
    @Body() dto: CompleteReceiptDto,
  ): Promise<ReceiptResponseDto> {
    return this.receipts.completeReceipt(storeId, dto, idempotencyKey);
  }
}
```

`IdempotencyKeyPipe` — требует заголовок и проверяет формат (UUID); ключ генерирует касса
(apps/web) один раз на операцию и повторяет его при досылке из офлайн-буфера.
