# Оптовая продажа (PR 3): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** касса продаёт организации по оптовой цене точки: покупатель на чеке и накладной A4, ПКУ, штуки и скидки
исключены; оптовую цену задаёт владелец на странице цен, смена и отчёт по точкам показывают опт отдельно.

**Architecture:**
- Оптовая цена — колонка `store_products.wholesale_price_per_pack_dirams`, свой маршрут `PUT /prices/{id}/wholesale`
  модуля `pricing` и свой журнал `wholesale_price.changed`. `price_version` и лента `PricingFeed` её не видят: офлайн-точкам
  опт не нужен (D30), а версия — основа их конфликтов.
- Оптовый чек — тот же `POST /receipts` с полем `wholesale`. Цена строки проверяется по правилу поправки ADR-0015
  2026-10-23, но по оптовой цене и её журналу (поправка ADR-0015 2026-11-03). Право автора — новое спецправо
  `pos:sell-wholesale` (поправка ADR-0018 2026-11-03).
- Касса: режим «Опт» черновика чека (`ReceiptDraft.wholesale`), цена строки — оптовая, скидки сети не применяются.
  Накладная печатается `SheetPrint` + `InvoiceSheet` из данных проведённого чека.
- Миграция — одна пара файлов: колонки с CHECK `NOT VALID` и отдельная проверка, как `pos-offline-limits`.

**Tech Stack:** NestJS, Kysely `sql`, class-validator, node-pg-migrate (SQL, только Up); Next.js static export, React,
TanStack Query, use-intl, Zustand, idb; UI-кит `libs/ui` (`SheetPrint`, `InvoiceSheet`, `ReceiptPrint`). Новых
зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-11-03-pos-store-ideas-design.md`, раздел 6 (D18–D30), 9–14; утверждена
2026-11-03. **ADR:** поправки ADR-0015 (оптовая цена на кассе) и ADR-0018 (спецправо `pos:sell-wholesale`) от 2026-11-03 —
в этом PR; код пишется только после их принятия архитектором.

## Уточнения спецификации при планировании

| № | Что нашлось | Решение | Цена ошибки |
|---|---|---|---|
| R1 | D23 вводит спецправо, а спецправа каталога ADR-0018 до сих пор добавлялись поправкой ADR-0018 (`employees:manage-peers`, `shifts:force-close`) | Поправка ADR-0018 от 2026-11-03 — в этом PR, рядом с поправкой ADR-0015 | Ещё одна поправка на утверждение |
| R2 | D19–D20: оптовая цена у товара без розничной цены на точке. Снимок кассы берёт только товары с розничной ценой, такая цена молча не работала бы | Оптовая цена задаётся только при розничной цене точки: иначе 422 `no_retail_price` (поле `prices`); в окне цены поле такой точки недоступно | Владелец сначала задаёт розничную цену |
| R3 | D21: «версия цены растёт». `price_version` — база конфликтов локальной цены офлайн-точки (`local-price-rule.ts`), а снимок кассы ищет изменения по `updated_at` | Запись оптовой цены меняет `updated_at = now()`, но не `price_version`; `SyncChanges` не пишется, `PricingFeed` не меняется | Нет |
| R4 | D20: `priceMinor: null` закрывает опт — в журнале `newPriceMinor` бывает null, а `PriceHistoryEntry.newPriceMinor` — `number` | `PriceHistoryEntry.newPriceMinor: number \| null` (null — опт закрыт); окно истории пишет «Закрыт» | Нет |
| R5 | D21: предупреждения оптовой цены | Новая функция `wholesalePriceWarnings` (domain): `above_max` > предельной, `above_retail` > розничной точки, `below_cost` < последней закупки (при `warnBelowCost` и праве себестоимости). Для null — пусто | Нет |
| R6 | D25: «без права автора — 422 `author_not_allowed`». У прочих спецправ строки автор без права только помечается | Для оптового чека — отказ, как в спецификации; приём расхождения его не снимает (поправка ADR-0015, п. 5) | Оптовый чек автора, потерявшего право до досылки, остаётся в карантине |
| R7 | D25: поля ошибок 400 | `lines.N.productId` — `wholesale_controlled` (товар ПКУ или `controlled` не null); `lines.N.unit` — `wholesale_piece`; `discountRuleId` — `discount_not_allowed`, если `discountRuleId` не null или `discountMinor`/`discountPercent` не 0 | Нет |
| R8 | Пометки чека (`price`, `discount`) и `receipt_lines.current_price_dirams` считаются по розничной цене | В оптовом чеке пометка `price` и текущая цена строки — по оптовой цене; пометка `discount` не ставится | Нет |
| R9 | `CreateReceiptRequest.wholesale`: операции буфера, записанные до выкладки, поля не знают; `whitelist` отклоняет неизвестные поля, хеш идемпотентности пропускает `undefined` | `wholesale?: WholesaleBuyer \| null` — необязательное; новая касса шлёт `null` для розницы | Нет |
| R10 | Раздел 10: «одна миграция». `receipts` — большая таблица, CHECK на ней проверяется проходом под исключительной блокировкой | Пара файлов, как `1792575377581`/`…582`: колонки и CHECK `NOT VALID`, затем `validate constraint` | Нет |
| R11 | D24: включение «Опт» с непустым чеком — спецификация молчит | Включение пересчитывает строки по оптовой цене; если у строки нет оптовой цены, она ПКУ или в штуках — включение отклоняется с сообщением о первом таком товаре. И включение, и выключение (D24 — с подтверждением) сбрасывают безналичные части и «Получено» | Кассир убирает строку и включает снова |
| R12 | Скидки сети считает `totals(draft, rules)` в восьми местах кассы | `totals` сам не применяет правила к оптовому черновику; подсказка «до скидки» в оптовом чеке скрыта | Нет |
| R13 | D27: продавец — юрлицо точки (название, ИНН, адрес), а в `PosStoreSettings` только `taxId` | `PosStoreSettings` получает `legalEntityName`, `legalAddress` (из `legal_entities`); старый снимок — `networkName` и `storeAddress` | Нет |
| R14 | D27: `InvoiceSheet` — три колонки, без подписей; печатный корень `ReceiptPrint` и `SheetPrint` общий (`.ph-print-root`) | Строка — товар; «Партия, срок, уп. × цена» — в `detail`; «Отпустил ____», «Получил ____», способ оплаты, основание — в `notes`. В окне чека смонтирован один корень печати: состояние `printing: 'receipt' \| 'sheet'` | Нет |
| R15 | Накладной нужны партия и срок строки, а `ReceiptPrintData` несёт только запрос | `ReceiptPrintData.batches: Record<batchId, { number; expiresOn }>`, заполняется из черновика при оплате | Нет |
| R16 | D29: «в т.ч. опт» в отчёте смены | `Shift.wholesale?: PaymentTotal` (Z-отчёт — снимок `Shift`, сохранённые раньше его не знают); строка в итогах смены и в Z-отчёте при `count > 0`; чеки буфера добавляет `withPending` | Нет |
| R17 | D28: возврат | `ReturnableReceipt.wholesaleBuyer: string \| null`; возврат считается от цен строк чека — оптовый чек возвращается по оптовой цене без доработок | Нет |
| R18 | D3: экран покупателя | Состояние `receipt` получает необязательное `buyer?: string \| null`; протокол остаётся v1 | Нет |
| R19 | Фильтры страницы цен («нет цены», «проблемы») — по розничной цене | В режиме «Опт» фильтры те же, по рознице; столбцы точек показывают оптовую цену | Нет |
| R20 | D23: шаблоны ролей не меняются; в моках у заведующей права нет | Моки: оптовые цены нескольких товаров store-3; право заведующей выдаётся в редакторе ролей во время живой проверки | Нет |
| R21 | Аудит `receipt.completed` | Для оптового чека в `details` — `saleKind: 'wholesale'`; покупатель — только в чеке | Нет |

## Global Constraints

- Тесты отложены до MVP: без TDD и новых автотестов, существующие наборы остаются зелёными. Тестовый долг — в описании PR
  (раздел 13 спецификации: правила оптовой цены и проверки оптового чека).
- Полный `npm run check` запускает пользователь. Здесь — проверки задач и живые прогоны.
- Работа — в `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/pilot-wholesale` (от `feature/pilot-payment-qr`;
  после слияния PR 2 — подтянуть `origin/main`); основную папку не трогать.
- Миграции применяются только к копии dev-базы (scratch); dev-базу мигрирует пользователь (`npx nx run api:migrate`).
- Коммиты — `--no-gpg-sign`, Conventional Commits, с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Новые тексты — в RU и TJ одновременно (`messages.spec.ts` сверяет ключи); таджикские — на проверку носителю.
- Только токены `--ph-*` и утилиты Tailwind из них; без hex, `px`, inline-стилей.
- Деньги — целые дирамы, на экране — `formatMoney`. Оптовая цена — только цена упаковки.
- Покупатель: организация — 1–200 знаков после обрезки пробелов, ИНН — `^\d{9}$` (как `TAX_ID` в
  `apps/api/src/app/stores/dto/store.dto.ts`), основание — до 200 знаков, пустое — null. Одни правила у формы кассы, DTO и
  CHECK.
- Синтетические данные в моках: организации — вымышленные («ООО «Клиника Пример»»), ИНН — `123456789`.
- После правки `libs/shared/*`: `npx nx run-many -t typecheck -p shared-dto shared-domain --skip-nx-cache`.
- Prettier — только на файлах, уже отформатированных на `main`.

## Review Focus

1. Данные кассы, записанные до выкладки: черновик без `wholesale`, снимок без `wholesalePriceMinor` и
   `legalEntityName`, операции буфера без `wholesale`. Касса не падает, розница работает, операции буфера проходят с
   тем же хешем идемпотентности. Задача 2, шаг 6, и задача 4, шаг 7.
2. Переключение «Опт» с непустым чеком и выбранной оплатой: цены строк пересчитаны, скидка и подсказка скидки исчезли,
   оплата сброшена, экран покупателя и «Отложить» следуют. Задача 4, шаг 7.
3. Оптовая цена изменилась или опт закрыли между снимком и продажей: цена окна снимка принимается, закрытый опт без
   истории — 422 `price_rules_violated`, карантин, приём правами на цены. Задача 6, шаг 3.
4. В оптовом чеке: ПКУ, «Поштучно», рецептурный товар, товар без оптовой цены — и через кнопку товара, и через
   сканер. ПКУ и штука не добавляются, рецептурный — с обычным предупреждением. Задача 4, шаг 7.
5. Покупатель на границе правил: пробелы вокруг, ИНН из 8 и 10 цифр или с буквой, 200 и 201 знак, пустое основание.
   Форма, API и CHECK отвечают одинаково. Задача 2, шаг 6, и задача 4, шаг 7.

---

### Task 1: Оптовая цена — миграция, правила, API цен, история

**Files:**
- Create: `apps/api/migrations/1793736000000_wholesale-sale.sql`, `apps/api/migrations/1793736000001_wholesale-sale-validate.sql`
- Modify: `apps/api/src/core/database/db.generated.ts` (`api:db-types` на scratch-копии)
- Modify: `libs/shared/domain/src/lib/stock-pricing.ts` (`PriceWarning`, `wholesalePriceWarnings`), `libs/shared/domain/src/lib/audit-groups.ts`
- Modify: `libs/shared/dto/src/lib/tenant-catalog.ts` (`StorePrice`, `UpdateWholesalePricesRequest`, `PriceHistoryEntry`)
- Modify: `apps/api/src/app/pricing/{prices.controller,prices.service,pricing.repository}.ts`, `apps/api/src/app/pricing/dto/pricing.dto.ts`
- Modify: `apps/api/src/app/audit/price-history.ts`
- Modify: моки web, чтобы сборка шла: `apps/web/src/shared/api/mocks/{db-catalog,handlers-catalog}.ts`

**Interfaces:**
- Produces:
  - `type PriceWarning = 'above_max' | 'below_cost' | 'no_price' | 'above_retail'`;
    `wholesalePriceWarnings(input: { wholesaleMinor: number | null; retailMinor: number | null; costMinor?: number | null; maxPriceMinor: number | null }): PriceWarning[]` — порядок `above_max`, `above_retail`, `below_cost`.
  - `StorePrice` += `wholesalePriceMinor: number | null; wholesaleWarnings: PriceWarning[]`.
  - `interface UpdateWholesalePricesRequest { prices: Array<{ storeId: string; priceMinor: number | null }>; confirmAboveMax: boolean }`.
  - `PUT /api/v1/prices/{productId}/wholesale` → 200 `StorePrice[]` (как `GET /prices/{productId}`); 403 `forbidden` /
    `store_not_in_scope`, 404, 409 `product_archived`, 422 `above_max_price` и `no_retail_price` (поле `prices`).
  - Журнал `wholesale_price.changed`: `entityType: 'product'`, `storeId`, `details { storeId, oldPriceMinor: number | null, newPriceMinor: number | null, source: 'prices' }`.
  - `PriceHistoryEntry.newPriceMinor: number | null`; `kind` — `'wholesale'` для `wholesale_price.changed`.

- [ ] **Step 1: Миграция.** Первый файл (`set local lock_timeout = '5s'`):
  - `store_products`: `add column wholesale_price_per_pack_dirams bigint`, constraint
    `store_products_wholesale_price_check check (wholesale_price_per_pack_dirams > 0) not valid`;
  - `receipts`: `sale_kind text not null default 'retail'`, `buyer_name text`, `buyer_tax_id text`, `buyer_basis text`;
    `receipts_sale_kind_check check (sale_kind in ('retail','wholesale')) not valid`; `receipts_buyer_check not valid`:
    ```sql
    check ((sale_kind = 'wholesale') = (buyer_name is not null and buyer_tax_id is not null)
      and (sale_kind = 'wholesale' or buyer_basis is null)
      and (buyer_name is null or char_length(buyer_name) between 1 and 200)
      and (buyer_tax_id is null or buyer_tax_id ~ '^[0-9]{9}$')
      and (buyer_basis is null or char_length(buyer_basis) between 1 and 200))
    ```
  Второй файл — `validate constraint` трёх CHECK. Применить к копии dev-базы `pharmacy_wholesale_scratch`
  (`createdb -T`), затем `npx nx run api:db-types` с `DATABASE_URL` копии и `api:db-types-verify`.
- [ ] **Step 2: Правила и DTO.** `wholesalePriceWarnings` и `'above_retail'` в domain; группа журнала `price_change`
  получает действие `wholesale_price.changed`. DTO `tenant-catalog.ts` — по Interfaces; JSDoc у `wholesalePriceMinor`:
  «null — опт товара на точке закрыт».
- [ ] **Step 3: Чтение.** `PricingRepository.prices` / `storePrices` выбирают оптовую колонку; `PricesService.rows`
  заполняет `wholesalePriceMinor` и `wholesaleWarnings` (`costMinor` — по тем же условиям, что у розницы).
- [ ] **Step 4: Запись.** `PricesService.updateWholesale(productId: string, request: UpdateWholesalePricesRequest): Promise<StorePrice[]>`
  — проверки и порядок блокировок как у `update` (права, архив, активные точки, охват, `above_max_price` без
  `confirmAboveMax`, точки по возрастанию id). Репозиторий:
  `lockWholesalePrices(trx, tenantId, productId, storeIds): Promise<Map<string, { retail: bigint | null; wholesale: bigint | null }>>`
  (`FOR UPDATE`) и `setWholesalePrice(trx, tenantId, productId, storeId, priceDirams: number | null): Promise<void>` —
  `update … set wholesale_price_per_pack_dirams, updated_at = now()`, без `price_version` и `feed.record` (R3). Нет строки или
  `retail` null — 422 `no_retail_price` (R2); то же значение — без записи и аудита; иначе запись и
  `audit.append('wholesale_price.changed')` (в `PricesService` — `AuditService`, `AuditModule` уже импортирован).
  DTO: `WholesalePriceDto { @IsUUID storeId; @ValidateIf(v !== null) @IsInt @Min(1) @Max(MAX_MONEY_MINOR) priceMinor }`
  (поле обязательно: `@IsDefined`), `UpdateWholesalePricesDto` — как `UpdatePricesDto`. Маршрут
  `@RequirePermission('pricing:view') @Put(':productId/wholesale')`.
- [ ] **Step 5: История.** `PriceHistory.page`: `a.action in ('price.changed', 'wholesale_price.changed')`, `kind` из
  `a.action`, `newPriceMinor` — `number | null`.
- [ ] **Step 6: Моки для сборки.** `CatalogMockDb.wholesalePrices: Record<storeId, Record<productId, number>>` (сид — пусто,
  сиды — в задаче 3); `pricesOf` заполняет новые поля; мок истории читает `kind` записи.
- [ ] **Step 7: Проверка.** `npx nx run-many -t typecheck -p shared-dto shared-domain --skip-nx-cache`,
  `npx nx run-many -t lint -p api shared-domain shared-dto`, `npx nx build api`, `npx tsc -p apps/web/tsconfig.json --noEmit`.
  Живой прогон API ветки на копии (скрипт по образцу `qr-live.mjs`, порт 3005): опт 200 → `StorePrice[]` с
  `wholesalePriceMinor`; тот же опт — без новой записи журнала; null закрывает; точка без розничной цены — 422
  `no_retail_price`; выше предельной — 422, с `confirmAboveMax` — 200; точка вне охвата — 403; история — `kind:
  'wholesale'` и `newPriceMinor: null` у закрытия.
- [ ] **Step 8: Commit** — `feat(pricing): the wholesale price of a store, set and audited like the retail one`.

### Task 2: Оптовый чек на API — право, контракт, проверки, снимок, возврат, смена, отчёт

**Files:**
- Modify: `libs/shared/domain/src/lib/permissions.ts` (`specialPermissions`)
- Modify: `libs/shared/dto/src/lib/tenant-pos.ts` (`WholesaleBuyer`, `CreateReceiptRequest`, `PosProduct`, `PosStoreSettings`, `ReturnableReceipt`, `Shift`), `libs/shared/dto/src/lib/tenant-owner.ts` (JSDoc `sales_by_store`)
- Modify: `apps/api/src/app/pos/dto/pos.dto.ts`, `receipts.service.ts`, `receipts.repository.ts`, `receipt-rules.ts`, `catalog-snapshot.service.ts`, `pos.repository.ts`, `sold-receipts.ts`, `shifts.repository.ts`, `shift-mapper.ts`, `sales-figures.ts`
- Modify: `apps/api/src/app/pricing/store-prices-reader.ts`, `apps/api/src/app/audit/price-changes.ts`
- Modify: `apps/api/src/app/returns/returnable.service.ts`, `apps/api/src/app/reports/report-builders.ts`
- Modify: моки web для сборки: `apps/web/src/shared/api/mocks/{fixtures-pos,handlers-pos}.ts`

**Interfaces:**
- Consumes: `wholesale_price_per_pack_dirams`, `receipts.sale_kind`/`buyer_*`, журнал `wholesale_price.changed` (задача 1).
- Produces:
  - `specialPermissions` += `'pos:sell-wholesale'`.
  - `interface WholesaleBuyer { buyerName: string; buyerTaxId: string; basis: string | null }`;
    `CreateReceiptRequest.wholesale?: WholesaleBuyer | null` (JSDoc: отсутствует в операциях буфера до выкладки).
  - `PosProduct.wholesalePriceMinor: number | null`; `PosStoreSettings.legalEntityName: string; legalAddress: string`
    (JSDoc: снимок до выкладки их не знает — читать с `??`).
  - `ReturnableReceipt.wholesaleBuyer: string | null`; `Shift.wholesale?: PaymentTotal`.
  - Отчёт `sales_by_store`: столбцы `retailMinor`, `wholesaleMinor` (`money`) сразу после `revenue`, в итоге — суммы.
  - `PriceChanges.changesAfter(trx, tenantId, storeId, productIds, after, action: 'price.changed' | 'wholesale_price.changed' = 'price.changed')`;
    `StorePricesReader`: внутренний `StorePrice` += `wholesaleDirams: number | null`,
    `wholesalePricesAround(trx, tenantId, storeId, current: ReadonlyMap<string, StorePrice>, productIds, at): Promise<Map<string, number[]>>`
    (как `packPricesAround`, по `wholesale_price.changed`, null отбрасываются).

- [ ] **Step 1: Право и контракты** — по Interfaces. `WholesaleBuyerDto`: `buyerName` — `@Transform(trim) @IsString @Length(1, 200)`,
  `buyerTaxId` — `@Transform(trim) @Matches(/^\d{9}$/)`, `basis` — обрезка, пустое → null, `@ValidateIf(v !== null) @IsString @MaxLength(200)`.
  `CreateReceiptDto.wholesale` — `@IsOptional() @ValidateNested() @Type(() => WholesaleBuyerDto)` (R9).
- [ ] **Step 2: Право автора.** В `ReceiptsService.create` после `context.operation(...)`: оптовый чек без
  `pos:sell-wholesale` в `op.author.permissions` — `ProblemException(422, 'author_not_allowed')` (R6).
- [ ] **Step 3: Ограничения строк.** В цикле проверок строк — ошибки R7 (400 `validation_failed` через `invalid()`).
- [ ] **Step 4: Цена.** Для оптового чека `nowPrices` — текущая оптовая цена точки (только `pack`), окно снимка —
  `wholesalePricesAround`; `priceErrors` и `mayAcceptDiscrepancy` — без изменений; `discountError` и пометка `discount`
  не считаются; пометка `price` и `currentPriceDirams` — по оптовой цене (R8). `insertReceipt` пишет `saleKind`,
  `buyerName`, `buyerTaxId`, `buyerBasis`; аудит `receipt.completed` — `saleKind` (R21).
- [ ] **Step 5: Снимок, возврат, смена, отчёт.**
  - `CatalogSnapshotService`: `wholesalePriceMinor` — оптовая цена при `store.mode === 'online'`, иначе null;
    `PosRepository.store` выбирает `le.name as legal_entity_name, le.legal_address`, настройки снимка — R13.
  - `SoldReceipts.find` — `sale_kind`, `buyer_name`; `ReturnableService` — `wholesaleBuyer`.
  - `ShiftsRepository.totals`: `count(*) filter (where r.sale_kind = 'wholesale')` и сумма; `ShiftMapper.view` — `wholesale`.
  - `SalesFigures.byStore` и `SalesOfStore` — `retailMinor`, `wholesaleMinor` (`filter` по `sale_kind`);
    `salesByStore` — столбцы и итоги.
  - Моки для сборки: `wholesalePriceMinor: null` в `initialProducts`, `legalEntityName`/`legalAddress` в
    `storeSettings`/`networkSettingsOf`, `wholesaleBuyer: null` в моке возврата.
- [ ] **Step 6: Проверка.** typecheck библиотек, lint `api shared-domain shared-dto`, `npx nx build api`,
  `npx tsc -p apps/web/tsconfig.json --noEmit`. Живой прогон на копии: снимок точки с оптовой ценой — `wholesalePriceMinor`,
  `legalEntityName`, `legalAddress`; отчёт `sales_by_store` — новые столбцы. Чек — сквозным прогоном задачи 6. По коду
  (записать в журнал): тело без `wholesale` проходит валидацию и даёт тот же хеш (`canonical()` пропускает `undefined`);
  `PosFacts` пишет `sale_kind` по умолчанию; граница покупателя — 200/201 знак, ИНН 8/10 цифр и с буквой — DTO и CHECK.
- [ ] **Step 7: Commit** — `feat(pos): the wholesale receipt of an organisation, priced and checked by the wholesale price`.

### Task 3: Web — цены «Розница / Опт», история, право в редакторе ролей

**Files:**
- Modify: `apps/web/src/pages/pricing/ui/{PricingPage,PricingDialogs}.tsx`
- Modify: `apps/web/src/features/price-history/ui/PriceHistoryDialog.tsx`
- Modify: `apps/web/src/shared/api/{routes,client}.ts`
- Modify: `apps/web/src/shared/api/mocks/{db-catalog,handlers-catalog}.ts`
- Modify: i18n `apps/web/src/shared/i18n/messages/{ru,tg}/{purchasing,owner,core}.json`, `apps/web/src/shared/api/error-message.ts`

**Interfaces:**
- Consumes: `StorePrice.wholesalePriceMinor`, `wholesaleWarnings`, `UpdateWholesalePricesRequest`, `PriceHistoryEntry.kind`, `pos:sell-wholesale` (задачи 1–2).
- Produces: маршрут `'prices.updateWholesale': route<StorePrice[], UpdateWholesalePricesRequest, { productId: string }>('PUT', …/wholesale)` (и в `REAL_API_ROUTES`).

- [ ] **Step 1: Переключатель.** `PricesTab`: `SegmentedControl` «Розница / Опт» рядом с фильтрами (состояние вкладки, по
  умолчанию «Розница»). В «Опт» столбцы точек показывают `wholesalePriceMinor` (null — «—», с подписью для экранного
  чтения «опт закрыт») и `wholesaleWarnings`; «Изменить» открывает `WholesalePriceDialog`. Фильтры — R19.
- [ ] **Step 2: Окно оптовой цены** `WholesalePriceDialog({ row: PriceRow; onClose })` в `PricingDialogs.tsx` — по
  образцу `PriceDialog`: поле на точку (пусто — опт закрыт), «Одинаковая для всех точек», предупреждения
  `wholesalePriceWarnings`, подтверждение выше предельной. Точка без розничной цены — поле недоступно с подписью «Сначала
  задайте розничную цену» (R2). Сохранение — `prices.updateWholesale` только изменённых точек, затем инвалидация
  `['prices']` и `['catalog']`, тост.
- [ ] **Step 3: История.** Столбец «Вид» — «Розница» / «Опт»; `newPriceMinor` null — «Закрыт».
- [ ] **Step 4: Права и тексты.** `employees.role.special."pos_sell-wholesale"` — «Оптовая продажа» (RU и TJ);
  `auditEvents.wholesale_price_changed`; предупреждение `above_retail`; `apiErrors.no_retail_price` и `knownCodes`.
- [ ] **Step 5: Моки.** Сид оптовых цен store-3 (три товара ниже розничной, один выше — для `above_retail`); обработчик
  `'prices.updateWholesale'` — правила задачи 1 (права, охват, `above_max_price`, `no_retail_price`, без записи при
  равенстве), запись журнала, `catalogVersion += 1`.
- [ ] **Step 6: Проверка.** `npx tsc -p apps/web/tsconfig.json --noEmit`, `npx nx run-many -t lint fsd -p web`. Живой
  прогон на моках (1280×800, RU и TJ): «Опт» показывает оптовые цены и значки; окно — сохранение, закрытие (пусто),
  выше предельной, точка без розницы; история — «Вид»; редактор ролей — «Оптовая продажа».
- [ ] **Step 7: Commit** — `feat(web): wholesale prices on the prices page and in the price history`.

### Task 4: Web — касса в режиме «Опт»

**Files:**
- Modify: `apps/web/src/features/pos/model/{receipt,pay,customer-display}.ts`, `apps/web/src/features/pos/lib/receipt-print.ts`
- Modify: `apps/web/src/features/pos/ui/{CartPanel,PosDialogs,SaleReceiptDialog}.tsx`, `apps/web/src/features/pos/index.ts`
- Modify: `apps/web/src/pages/pos/till/ui/PosPage.tsx`, `apps/web/src/pages/pos/customer-display/ui/CustomerDisplayPage.tsx`
- Modify: `apps/web/src/shared/lib/customer-display/protocol.ts`
- Modify: `apps/web/src/shared/api/mocks/{fixtures-pos,handlers-pos,db-pos}.ts`
- Modify: i18n `apps/web/src/shared/i18n/messages/{ru,tg}/pos.json`

**Interfaces:**
- Consumes: `PosProduct.wholesalePriceMinor`, `WholesaleBuyer`, `CreateReceiptRequest.wholesale` (задача 2).
- Produces:
  - `ReceiptDraft.wholesale?: WholesaleBuyer | null` (старый черновик — `?? null`).
  - `AddError` += `'no_wholesale_price' | 'wholesale_controlled' | 'wholesale_piece'`; `addProduct` проверяет их в
    оптовом черновике; `unitPrice(product, unit, wholesale: boolean)`.
  - `toWholesale(draft, buyer: WholesaleBuyer, products: ReadonlyMap<string, PosProduct>, priceVersion: number): { draft: ReceiptDraft; error: { code: AddError; productId: string } | null }`;
    `toRetail(draft, products, priceVersion): ReceiptDraft` — оба сбрасывают `nonCash` и `cashTenderedMinor` (R11).
  - `totals(draft, rules)` — без правил для оптового черновика (R12).
  - `DisplayState` (`receipt`) += `buyer?: string | null`; `ReceiptPrintData.batches: Record<string, { number: string; expiresOn: string }>` (R15).

- [ ] **Step 1: Модель.** Функции по Interfaces; `buildReceiptRequest` шлёт `wholesale: draft.wholesale ?? null`;
  `applySaleToSnapshot` — без изменений.
- [ ] **Step 2: Покупатель.** `WholesaleBuyerDialog({ open; initial: WholesaleBuyer | null; onConfirm(buyer); onClose })` в
  `PosDialogs.tsx` — по образцу `ControlledDialog`: «Организация» (обязательно), «ИНН» (9 цифр, `inputMode="numeric"`),
  «Основание» (необязательно, подсказка «Договор или доверенность»); проверки — Global Constraints; ошибки под полями.
- [ ] **Step 3: Чек.** `CartPanel` получает `canWholesale: boolean`, `onWholesale()`, `onRetail()`. В шапке чека —
  кнопка «Опт» (при `canWholesale`); в оптовом чеке — плашка «Оптовая продажа · {организация}» с «Изменить» и
  «Выключить»; «Отложить» недоступна; подсказка «до скидки» скрыта. `canWholesale` в `PosPage` —
  `canWrite(session, 'pos:sell-wholesale')` и точка сессии `mode === 'cloud'`.
- [ ] **Step 4: Касса.** `PosPage`: включение — окно покупателя → `toWholesale` (ошибка — уведомление
  `addErrors.<code>` с названием товара); «Изменить» — то же окно с данными покупателя; выключение с непустым чеком —
  подтверждение «Пересчитать чек по розничной цене?» → `toRetail`. `requestAdd`: в оптовом чеке ПКУ отклоняется до окна
  ПКУ (`addErrors.wholesale_controlled`), рецептурный — как обычно. Тексты: «Нет оптовой цены на этой точке», «ПКУ оптом
  не продаётся», «Оптом — только упаковками».
- [ ] **Step 5: Экран покупателя и чек.** `displayStateOf` передаёт `buyer`; страница экрана — строка «Оптовая продажа ·
  {организация}» под названием точки. `saleReceiptLines`: после кассира — «Оптовая продажа», «Покупатель: …», «ИНН …»,
  «Основание: …» (если есть).
- [ ] **Step 6: Моки.** `productAt` — `wholesalePriceMinor` из `wholesalePrices` точки; `'receipts.create'` — проверки задачи
  2 (право автора, R7, цена строки — оптовая, иначе пометка расхождения, как у розницы), `MockReceipt` — покупатель;
  `'heldReceipts.create'` — без изменений.
- [ ] **Step 7: Проверка.** `npx tsc -p apps/web/tsconfig.json --noEmit`, `npx nx run-many -t lint fsd -p web`. Живой
  прогон на моках (1280×800 и 125 %, RU и TJ; заведующей выдать право в редакторе ролей): Review Focus 1, 2, 4 и 5 — черновик
  без `wholesale` в IndexedDB, переключение с оплатой, ПКУ/штука/рецептурный/без оптовой цены кнопкой и сканером, граница
  полей; экран покупателя; чек 58 и 80 мм; продажа проходит.
- [ ] **Step 8: Commit** — `feat(web): the wholesale mode of the POS receipt`.

### Task 5: Web — накладная A4, возврат, смена, отчёт

**Files:**
- Create: `apps/web/src/features/pos/lib/wholesale-invoice.ts`
- Modify: `apps/web/src/features/pos/ui/SaleReceiptDialog.tsx`, `apps/web/src/pages/pos/till/ui/PosPage.tsx`
- Modify: `apps/web/src/pages/returns/ui/ReturnsPage.tsx`
- Modify: `apps/web/src/entities/shift/ui/ShiftSummary.tsx`, `apps/web/src/entities/shift/lib/z-report.ts`, `apps/web/src/pages/shift/lib/pending.ts`, места вызова `zReportLines` (`ShiftPage.tsx`, `ShiftCardPage.tsx`)
- Modify: `apps/web/src/shared/api/mocks/{handlers-pos,handlers-owner}.ts`
- Modify: i18n `apps/web/src/shared/i18n/messages/{ru,tg}/{pos,owner}.json`

**Interfaces:**
- Consumes: `ReceiptPrintData.batches` (задача 4), `PosStoreSettings.legalEntityName`/`legalAddress`, `ReturnableReceipt.wholesaleBuyer`, `Shift.wholesale` (задача 2).
- Produces: `wholesaleInvoiceSheet(data: ReceiptPrintData, t): InvoiceSheetProps`.

- [ ] **Step 1: Накладная.** `wholesaleInvoiceSheet` — по образцу `orderSheet` (`OrderEditor.tsx`) и R14: заголовок «Накладная
  № {номер чека} от {дата}» (номер — `data.number`, без него — локальный номер); стороны «Продавец» (юрлицо, ИНН, адрес) и
  «Покупатель» (организация, ИНН); строки — товар, «Партия {номер} · до {срок} · {N} уп. × {цена}», сумма; итог;
  примечания — основание, способ оплаты, «Отпустил ____», «Получил ____».
- [ ] **Step 2: Окно чека.** Кнопка «Накладная (A4)» — только у оптового чека; состояние `printing: 'receipt' | 'sheet'`:
  смонтирован один корень печати, накладная печатается после монтирования `SheetPrint`, `afterprint` возвращает чек.
- [ ] **Step 3: Возврат, смена, отчёт.** Возврат: в описании чека — «Оптовая продажа · {организация}». `ShiftTotals` и
  `zReportLines`: строка «в т.ч. опт: N чеков, {сумма}» при `count > 0`; `withPending` добавляет оптовые чеки буфера.
  Отчёт: `reports.columns.retailMinor` «Розница, с», `wholesaleMinor` «Опт, с» (ключ `retail` уже занят отчётом остатков).
  Моки: возврат, смена и `sales_by_store` — новые поля.
- [ ] **Step 4: Проверка.** `npx tsc -p apps/web/tsconfig.json --noEmit`, `npx nx run-many -t lint fsd -p web`. Живой
  прогон на моках: оптовая продажа → накладная (предпросмотр печати A4, затем печать чека 80 мм — печатается чек, не
  накладная); возврат оптового чека; итоги смены и Z-отчёт; отчёт по точкам и выгрузка Excel — столбцы «Розница», «Опт».
- [ ] **Step 5: Commit** — `feat(web): the A4 invoice of a wholesale receipt, wholesale in shifts, returns and reports`.

### Task 6: Документы и сквозной прогон на API

**Files:**
- Modify: `docs/architecture/glossary.md`, `docs/architecture/data-model/{02-catalog-prices,04-pos,06-sync-audit-billing}.md`
- Modify: `docs/qa/02-granitsy-pilota.md`
- Modify (после утверждения): `docs/architecture/APPROVAL.md`, статусы поправок в ADR-0015 и ADR-0018

- [ ] **Step 1: Документы.** Глоссарий — «Оптовая продажа», «Оптовая цена», «Покупатель-организация»; модель данных —
  колонки задачи 1 и действие `wholesale_price.changed`; QA-гайд — шаги проверки опта (цена, право, чек, ограничения,
  накладная, возврат, смена, отчёт).
- [ ] **Step 2: Утверждение.** Строка APPROVAL.md и статус «Утверждена архитектором …» обеих поправок — только после
  слов архитектора; делается отдельным коммитом до задачи 1, здесь — сверка.
- [ ] **Step 3: Сквозной прогон.** `web:dev-api` ветки (порт 4212, `API_PROXY_TARGET` — API ветки на копии, порт 3005):
  владелец задаёт оптовую цену и выдаёт право роли; заведующая на привязанном терминале проводит оптовый чек; чек с
  ПКУ/штукой/скидкой, отправленный в обход интерфейса (скрипт), — 400 с кодами R7; цена, которой у точки не было, — 422
  `price_rules_violated` и приём на экране смены; автор без права — 422 `author_not_allowed`; возврат оптового чека;
  «в т.ч. опт» в смене; столбцы отчёта. Что не удалось прогнать — записать ruling с ценой.
- [ ] **Step 4: Commit** — `docs: wholesale sale in the glossary, data model and the QA guide`.
