# Каталог товаров и цены — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сеть ведёт каталог товаров (штрихкоды, деление упаковки, категории с наценками, формы) и
цены по точкам со скидочными правилами по настоящему API; экраны каталога, цен и наценок `apps/web`
работают с ним в режиме `partial`.

**Architecture:** миграция `catalog-pricing` вводит восемь тенантных таблиц из
`02-catalog-prices.md`; `provision_tenant` получает стартовый каталог (`p_catalog_defaults`).
Модуль `apps/api/src/app/catalog` (товары, категории, справочники, наценки) экспортирует
`ProductsReader`; модуль `apps/api/src/app/pricing` (цены точек, скидочные правила) читает товары
только через него. Оба — только `TenantDatabase`, только облако. `apps/web`: контракт и моки,
маршруты в `REAL_API_ROUTES`, правки экранов.

**Tech Stack:** NestJS 11, Kysely + pg (CamelCasePlugin), node-pg-migrate (SQL, только Up),
class-validator, Next.js static export, TanStack Query, use-intl, `libs/ui`.

**Spec:** `docs/superpowers/specs/2026-10-07-catalog-pricing-design.md` (утверждена архитектором
2026-10-07).

## Global Constraints

- Новые автотесты не пишутся до MVP (решение 2026-10-05); существующие наборы — зелёные, тесты под
  изменённый контракт правятся. Проверка задач — живая (curl, браузер) по разделу 12 спецификации.
- Ни одной новой библиотеки; стек — CLAUDE.md «Fixed technology stack».
- `CatalogModule` и `PricingModule` регистрируются только в облаке:
  `ConditionalModule.registerWhen(..., env.STORE_MODE !== 'offline')`, как `StoresModule`.
- Только `TenantDatabase.tenantTransaction`; `pricing` не обращается к таблицам каталога, только к
  `ProductsReader`.
- Права маршрутов — таблицы разделов 5 и 6 спецификации. Декоратор `@RequirePermission` принимает одно
  право: на `PUT /prices/{id}` стоит `pricing:view`, на записи скидок — `discounts:view`; сервис
  проверяет `pricing:update-store`/`update-network` и `discounts:manage-store`/`manage-network`.
  `@RequireFreshAuth` на этих маршрутах нет.
- Коды ошибок — раздел 9 спецификации, ровно эти: 400 `validation_failed` (`FieldProblemException`
  с `errors[]`); 403 `forbidden`, `store_not_in_scope`; 404 `not_found`; 409 `barcode_taken`,
  `category_name_taken`, `category_in_use`, `product_archived`; 422 `above_max_price`.
- Аудит (та же транзакция, `AuditService.append`): `product.created`, `product.updated`
  (`details.fields`), `product.status_changed`, `category.created`, `category.updated`,
  `category.status_changed`, `markups.updated`, `price.changed` (`entityType: 'product'`,
  `details: { storeId, oldPriceMinor, newPriceMinor }`), `discount_rule.created`,
  `discount_rule.updated`.
- Деньги — `bigint` дирамы; пул отдаёт `bigint` как `BigInt` — в DTO `Number(...)`; проценты в API
  целые, в БД `_bp = percent × 100`; минимальный остаток в БД — штуки, в API — пачки.
- Названия `jsonb` `{ru, tj}` (D6): обязателен ключ `tenant_settings.default_language`; локаль сессии
  `tg` ↔ ключ `tj`.
- Лимиты полей: название товара 1–200, категории 1–100, правила 1–200; `inn`/`dosage`/`manufacturer` ≤
  200; `piecesPerPack` 1–10 000; `markupPercent` 0–1000; `minStockPacks` 0–1 000 000; штрихкод
  `^[0-9]{8,14}$`, ≤ 20 на товар; `limit` 1–100 (20); цены 1–10¹⁰, 1–200 точек; пороги 1–10, процент
  1–100.
- Тексты web — RU и TJ (локаль `tg`); идентификаторы и комментарии — английские; Conventional
  Commits; GPG подписывает pinentry; перед PR пользователь запускает `npm run check`.

## Rulings плана (отступления от текста спецификации)

- **R1 (§3, гранты).** `catalog.int-spec.ts` требует у `pharmacy_app` ровно `SELECT, INSERT, UPDATE,
  DELETE` на всех тенантных таблицах — гранты полные на все восемь; приложение товары, категории и
  правила не удаляет (архив). Цена ошибки: нет — правило манифеста сильнее.
- **R2 (§5, интерфейс).** Вместо `searchIds` — `listForPricing` (страница товаров с фильтром): одна
  выборка вместо двух.
- **R3 (§7, наценки).** `CategoryMarkup.markupPercent` → `number | null`: у стартовых категорий
  наценки нет; web отправляет в `PUT /settings/markups` только заполненные.

## Review Focus

Тестов нет — пункты проверяются живой проверкой задачи-владельца и финальным ревью:

1. Два параллельных `POST`/`PUT` товаров с одним штрихкодом → один 200/201, второй 409
   `barcode_taken`, а не 500 (Задача 3: `uniqueConstraint` → тот же 409; curl двумя фоновыми запросами).
2. `PUT /prices` заведующего с охватом-списком: одна своя и одна чужая точка в одном запросе → 403, и
   ни одна цена не записана (Задача 4, curl).
3. Правка скидочного правила сети заведующим с `manage-store` (сменить на свою точку) → 403: права
   проверяются и на текущий охват (Задача 4, curl).
4. Поиск: `q` с `%`, `_` и `\` ищет их буквально (экранирование `ILIKE`); `q` из цифр короче 8 не
   ломает запрос (Задача 3, curl).
5. Сеть с `default_language = 'tj'`: товар без `nameTj` → 400 у `nameTj`; список сортируется по `tj`
   (Задача 3, curl через `psql` смену языка сети).

---

### Task 1: Схема, стартовый каталог, справочные константы

**Files:**
- Create: `libs/shared/domain/src/lib/catalog.ts` (+ экспорт в `src/index.ts`)
- Create: `apps/api/migrations/<Date.now()>_catalog-pricing.sql`
- Modify: `apps/api/src/core/database/table-classes.ts`, `db.generated.ts` (`npx nx run api:db-types`)
- Modify: `apps/api/src/app/platform/tenants/tenants.repository.ts`, `tenants.service.ts`
- Modify: `apps/api/src/app/app.module.ts` (`CatalogModule`, `PricingModule` — `registerWhen` облака)

**Interfaces:**
- Produces (`@pharmacy/shared-domain`):
  - `productUnits = ['pack', 'piece', 'ml'] as const`, `type ProductUnit`;
  - `countries: ReadonlyArray<{ code: string; name: { ru: string; tj: string } }>` — TJ, RU, UZ, KZ,
    KG, BY, UA, TR, IN, CN, DE, FR, PL, HU, SI, AT, CH, CZ, GB, US, IR, PK (порядок — этот);
  - `catalogDefaults: { categories: ReadonlyArray<{ name: {ru, tj} }>; dosageForms:
    ReadonlyArray<{ code: string; name: {ru, tj} }> }` — значения §4 спецификации, коды форм
    `tablets, capsules, syrup, suspension, solution, ointment, cream, gel, drops, spray, powder,
    suppositories, ampoules`.
- Produces: `pharmacy.provision_tenant(...15 прежних..., p_catalog_defaults jsonb)`;
  `ProvisionInput.catalogDefaults: { categories: Array<{ id, name }>; dosageForms: Array<{ id, code,
  name }> }`.
- Produces: таблицы `categories, dictionary_values, products, product_barcodes, store_products,
  discount_rules, discount_rule_tiers, discount_rule_stores` — колонки, проверки и индексы §3
  спецификации; ограничения уникальности с именами `products_article_uq`, `categories` — без
  уникального индекса имени (проверка в приложении).

- [ ] **Step 1: константы** `catalog.ts`; тип `ProductUnit` в `shared-dto` реэкспортирует доменный.
- [ ] **Step 2: миграция.** Файл `<Date.now()>_catalog-pricing.sql`, шапка `-- Up Migration`. Порядок: таблицы →
  индексы (`create index … using gin (lower(name->>'ru') pharmacy.gin_trgm_ops)` — `pg_trgm` в схеме
  `pharmacy`) → RLS `enable`/`force` + `tenant_isolation` для `pharmacy_app` (как в
  `1790829987726_org-foundation.sql`) → `grant select, insert, update, delete` (R1) → новая
  `provision_tenant` по образцу `1791349873783_default-roles.sql` (`drop function` старой сигнатуры с 15
  аргументами; проверка `jsonb_typeof(p_catalog_defaults) = 'object'`; категории с `pos_sort_order`
  по порядку массива; формы `kind 'dosage_form'`, `is_system true`) → `grant insert` и политика
  `provisioner_all` на `categories`, `dictionary_values` → backfill под `set local role
  pharmacy_provisioner` для сетей без категорий (`gen_random_uuid()`, копия значений Step 1 с пометкой
  даты).
- [ ] **Step 3: манифест и регистрация.** Восемь таблиц — `'tenant'` в `TABLE_CLASSES`; модули — под
  `registerWhen`.
- [ ] **Step 4: провижининг.** `TenantsService` передаёт `catalogDefaults` с `newId()` на каждую
  строку; репозиторий — 16-й аргумент `::jsonb`.
- [ ] **Step 5: проверка.**
  Run: `npx nx run api:migrate && npx nx run api:db-types && npx nx run api:integration`
  Expected: миграция применена; `db.generated.ts` содержит восемь новых интерфейсов; интеграционные —
  все зелёные (в т. ч. `catalog.int-spec.ts`: манифест, RLS, гранты).
  Run: `psql` — `select t.code, count(c.*) from pharmacy.tenants t left join pharmacy.categories c on
  c.tenant_id = t.id group by 1` (ролью владельца БД).
  Expected: у каждой сети 6 категорий; `dictionary_values` — по 13 форм.
  Run: создать сеть через admin API (`POST /operator/tenants`, как в Задаче 1 плана сотрудников).
  Expected: у новой сети 6 категорий и 13 форм.
- [ ] **Step 6: коммит** `feat(api): catalog and pricing schema, starter catalog of a new network`.

### Task 2: Контракт и моки web

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-catalog.ts`, `tenant-owner.ts`
- Modify: `apps/web/src/shared/api/routes.ts`, `mocks/handlers-catalog.ts`, `mocks/db-catalog.ts`,
  `mocks/handlers-owner.ts` (наценки), фикстуры, если перестали компилироваться
- Modify: `apps/web/src/pages/catalog/ui/*.tsx`, `pages/pricing/ui/*.tsx`,
  `pages/owner/settings/ui/SettingsPage.tsx` — только чтобы компилировалось с новым контрактом

**Interfaces:**
- Produces (контракт, §7 спецификации + R3): `ProductBarcode { code }`; `CatalogProduct` без
  `retailPriceMinor`, с `status: CatalogStatus` (`'active' | 'archived'`); `CatalogListItem.
  retailPriceMinor: number | null`, `status`; `CatalogProductCard = CatalogProduct`;
  `CatalogListQuery.status?`; `UpdateCatalogStatusRequest { status: CatalogStatus }`;
  `CatalogReferences.units: ProductUnit[]`; `Category { id, nameRu, nameTj, markupPercent: number |
  null, status: CatalogStatus, products: number }`; `CategoryInput { nameRu, nameTj }`;
  `StorePrice.priceMinor: number | null`; `PriceRow.markupPercent: number | null`;
  `PriceRow.costMinor?: number | null`; `CategoryMarkup.markupPercent: number | null`; удалить
  `ProductBatchRow`.
- Produces (маршруты web): `catalog.status` (`POST /catalog/products/{id}/status`),
  `catalog.categories` (`GET /catalog/categories`), `catalog.createCategory` (`POST`),
  `catalog.updateCategory` (`PUT /catalog/categories/{id}`), `catalog.categoryStatus`
  (`POST /catalog/categories/{id}/status`), `prices.get` (`GET /prices/{productId}` → `StorePrice[]`).

- [ ] **Step 1: контракт** с JSDoc маршрутов и кодами ошибок раздела 9.
- [ ] **Step 2: маршруты и моки** по правилам §5–§6 спецификации (моки — та же логика, что у API,
  включая 409 `barcode_taken`, `category_in_use`, `product_archived`, 403 `store_not_in_scope`).
- [ ] **Step 3: экраны** — минимальные правки компиляции (без новых функций — они в Задаче 5).
- [ ] **Step 4: проверка.**
  Run: `npx nx run-many -t build -p shared-dto shared-domain web admin api && npx nx run-many -t
  typecheck test lint --parallel=1 -p shared-dto shared-domain web`
  Expected: всё зелёное (тесты web, завязанные на старые поля, поправлены).
- [ ] **Step 5: коммит** `feat(dto): catalog and pricing contract on the data model`.

### Task 3: Модуль `catalog`

**Files:**
- Create: `apps/api/src/app/catalog/{catalog.repository, products.service, products.controller,
  categories.service, categories.controller, markups.controller, products-reader}.ts`,
  `dto/catalog.dto.ts`
- Modify: `apps/api/src/app/catalog/catalog.module.ts`

**Interfaces:**
- Consumes: таблицы и константы Задачи 1, контракт Задачи 2; `AuditService`, `requirePrincipal`,
  `uniqueConstraint`, `FieldProblemException`, `newId`.
- Produces: `CatalogModule` с `exports: [ProductsReader]`;
  ```ts
  export interface PricingProduct {
    id: string; name: string /* на языке сессии, иначе сети */; status: 'active' | 'archived';
    piecesPerPack: number; maxPriceMinor: number | null;
    markupBp: number | null; categoryMarkupBp: number | null;
  }
  class ProductsReader {
    findForPricing(trx: TenantTransaction, tenantId: string, ids: readonly string[]): Promise<PricingProduct[]>;
    listForPricing(trx: TenantTransaction, tenantId: string,
      query: { q?: string; categoryId?: string; limit: number; offset: number }
    ): Promise<{ items: PricingProduct[]; total: number }>; // только активные, сортировка как у списка
  }
  ```
  `catalog.repository.ts` экспортирует `escapeLike(value: string): string` и
  `localizedName(name: unknown, locale: 'ru' | 'tg', fallback: 'ru' | 'tj'): string` — их же
  использует `pricing`.

- [ ] **Step 1: DTO** (`class-validator`, `trim`, лимиты Global Constraints) для `CatalogListQuery`,
  `CatalogProductInput` (вложенные штрихкоды — `ValidateNested` + `ArrayMaxSize(20)`), статуса,
  `CategoryInput`, `UpdateMarkupsRequest`.
- [ ] **Step 2: репозиторий** — список (`ILIKE` с `escapeLike` по `name->>'ru'`, `name->>'tj'`,
  `inn->>'ru'`; цифры 8–14 — ещё `exists` по `product_barcodes`; флаги; `status`; сортировка
  `lower(name->>'<язык сети>'), id`; `count(*) over ()`), карточка, вставка/правка товара, замена
  набора штрихкодов, категории со счётчиком активных товаров, наценки, подсказки (`select distinct …
  limit 500`), цена точки сессии (`left join store_products` по `currentStoreId`).
- [ ] **Step 3: сервисы** — правила §5: язык сети из `tenant_settings`; категория/форма/единица/страна;
  `divisible` ↔ `piecesPerPack`; занятые штрихкоды → 409 `barcode_taken` (поле `barcodes`) и тот же
  ответ на `uniqueConstraint(error) === 'product_barcodes_pkey'`; архивный товар → 409
  `product_archived`; категории — уникальность имени `toLocaleLowerCase('ru')` → 409
  `category_name_taken`, архив с активными товарами → 409 `category_in_use`; `PUT /settings/markups`
  — активные категории, иначе 400 `categoryId`; `kpi` списка (`duplicates` всегда 0); справочники —
  активные категории, формы на языке сети, `productUnits`, `countries` на языке сессии, подсказки;
  аудит — Global Constraints.
- [ ] **Step 4: контроллеры** — маршруты и права §5 (`@Controller({ path: 'catalog', version: '1' })`,
  `settings/markups` — отдельный контроллер); `ParseUUIDPipe` на `id`.
- [ ] **Step 5: проверка.** `npx nx serve api` (через `preview_start` `api`); curl по §12 (каталог,
  категории, наценки) + Review Focus 1, 4, 5. JSON с кириллицей — `--data-binary @file`.
  Expected: каждый шаг §12 даёт описанный ответ; журнал сети содержит события Global Constraints.
  Run: `npx nx run-many -t build lint test --parallel=1 -p api`
  Expected: зелёное.
- [ ] **Step 6: коммит** `feat(api): catalog — products, barcodes, categories, markups`.

### Task 4: Модуль `pricing`

**Files:**
- Create: `apps/api/src/app/pricing/{pricing.repository, prices.service, prices.controller,
  discount-rules.service, discount-rules.controller}.ts`, `dto/pricing.dto.ts`
- Modify: `apps/api/src/app/pricing/pricing.module.ts` (`imports: [CatalogModule, AuditModule]`)

**Interfaces:**
- Consumes: `ProductsReader`, `escapeLike`, `localizedName` (Задача 3); `priceWarnings`,
  `discountRuleStatus`, `hasPermissions` (`shared-domain`); `scopeOf` (`staff/assignment-rules.ts` —
  не импортировать между модулями: повторить однострочник в `pricing`).
- Produces: маршруты §6; `PricingModule` пока без `exports` (касса — позже).

- [ ] **Step 1: DTO** — `PriceListQuery`, `UpdatePricesRequest` (1–200, `ArrayUnique` по `storeId`),
  `DiscountRuleInput` (`thresholds` 1–10, `period` — `IsDateString` формата `YYYY-MM-DD`).
- [ ] **Step 2: охват.** Точки списка — активные точки охвата (`'all'` → все активные точки сети).
  Запись цены: точка в охвате — `update-store` или `update-network`; вне — только `update-network`,
  иначе 403 `store_not_in_scope` до любой записи (Review Focus 2).
- [ ] **Step 3: цены** — `findForPricing` (нет → 404, архив → 409 `product_archived`); предельная
  цена без `confirmAboveMax` → 422 `above_max_price` (поле `prices`); запись `insert … on conflict
  (tenant_id, store_id, product_id) do update … where store_products.retail_price_per_pack_dirams is
  distinct from excluded.retail_price_per_pack_dirams returning` старую цену (`price_version + 1`,
  `price_changed_at`, `price_changed_by`, `price_source 'cloud'`); аудит только изменённых; ответ —
  `PriceRow` товара. `costMinor` — `null` при `finance:view-cost`, иначе поля нет.
- [ ] **Step 4: скидки** — видимость, права на старый и новый охват (Review Focus 3), хранение
  `level`/`store_scope`, замена набора порогов и точек, статус по дате сети
  (`Intl.DateTimeFormat` с `tenant_settings.timezone`, формат `YYYY-MM-DD`), `author` — создатель и
  название его роли (`localizedName`).
- [ ] **Step 5: проверка.** curl по §12 (цены, скидки) + Review Focus 2, 3; повтор той же цены — тот
  же `price_version`.
  Run: `npx nx run-many -t build lint test --parallel=1 -p api`
  Expected: зелёное.
- [ ] **Step 6: коммит** `feat(api): pricing — store prices and discount rules`.

### Task 5: Web — экраны на API

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES`)
- Modify: `apps/web/src/pages/catalog/ui/{CatalogPage, ProductPage, ProductForm}.tsx`,
  `pages/pricing/ui/{PricingPage, PricingDialogs}.tsx`, `pages/owner/settings/ui/SettingsPage.tsx`
  (раздел «Категории и наценки»; при росте файла — `CategoriesCard.tsx` рядом)
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/*.json`

**Interfaces:**
- Consumes: маршруты Задачи 2, API Задач 3–4.

- [ ] **Step 1: `REAL_API_ROUTES`** — список §8 спецификации.
- [ ] **Step 2: каталог** — фильтр «Активные / Архив» (`status`), «—» при `retailPriceMinor === null`.
- [ ] **Step 3: карточка** — цены `prices.get` (при `pricing:view`), без блока партий; «В архив» /
  «Восстановить» (`catalog:delete`); архивный товар — без «Изменить».
- [ ] **Step 4: форма** — без поставщика штрихкода; обязательное название на языке сети; ошибки
  `errors[]` и 409 `barcode_taken` — у полей.
- [ ] **Step 5: цены** — «не продаётся» при `priceMinor === null`; подтверждение выше предельной по 422
  `above_max_price`.
- [ ] **Step 6: настройки** — категории: список (название, наценка, товаров, статус), «Добавить»,
  «Переименовать» (RU/TJ), «В архив» (`catalog:update`; 409 `category_in_use` и
  `category_name_taken` — у поля/в окне); наценки — пустое поле допустимо, отправляются только
  заполненные (R3).
- [ ] **Step 7: тексты** RU/TJ.
- [ ] **Step 8: проверка.** `npx nx run web:dev-api` (порт 4210 через `.claude/launch.json`
  `web-partial`, API с `WEB_ORIGIN` на 4210); браузер — сценарий §12; полный мок-режим — экраны
  открываются.
  Run: `npx nx run-many -t build && npx nx run-many -t typecheck lint test fsd --parallel=1 -p web`
  Expected: зелёное. `npx nx e2e web-e2e` — зелёное.
- [ ] **Step 9: коммит** `feat(web): catalog, prices and categories on the API`.

### Task 6: Документы

**Files:**
- Modify: `docs/architecture/adr/0013-*.md` (дополнение п. 6 поправки 2026-10-05: стартовый каталог,
  права `pharmacy_provisioner` на `categories`, `dictionary_values`), `docs/architecture/APPROVAL.md`
  (строка «на утверждении»)
- Modify: `docs/architecture/data-model/02-catalog-prices.md` (введённые колонки, отложенные — с
  модулем; штрихкод без поставщика; `unit` — закрытый список; `dictionary_values.kind` сейчас
  `dosage_form`; цена только у точки — подтверждено 2026-10-07)
- Modify: `CLAUDE.md` (модули `catalog`, `pricing` — облако; `web:dev-api` — каталог, цены, скидки)
- Modify: справочники скилов `nestjs-api` (`ProductsReader` как образец публичного интерфейса модуля;
  `escapeLike`), если паттерн новый

- [ ] **Step 1: правки** документов.
- [ ] **Step 2: коммит** `docs: catalog and pricing — ADR-0013 amendment, data model, CLAUDE.md`.
