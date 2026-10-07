# Каталог товаров и цены — спецификация

Дата: 2026-10-07. Статус: на утверждении архитектора. Связано: модель данных
`docs/architecture/data-model/02-catalog-prices.md` (одобрена 2026-09-30), ADR-0013 (дополнение
2026-10-07 — стартовый каталог при создании сети), ADR-0014 (синхронизация — вне объёма), ADR-0016
(только TJS), ADR-0018 (права и охват), спецификации `2026-10-06-owner-stores-design.md` (режим
`partial` web) и `2026-10-06-staff-design.md` (`provision_tenant` с ролями по умолчанию).

## 1. Цель и критерии успеха

Сеть ведёт свой каталог товаров и цены по настоящему API: карточки товаров со штрихкодами и делением
упаковки, категории с наценками, розничные цены по точкам, скидочные правила. Экраны «Каталог
товаров», «Карточка товара», «Цены и скидки» и раздел «Категории и наценки» настроек `apps/web`
работают с API в режиме `partial`. На этом каталоге дальше строятся приход, склад и касса.

Успех:
- новая сеть сразу имеет стартовые категории и лекарственные формы; уже созданные сети получают их
  миграцией;
- товар заводится, правится, ищется по названию (RU/TJ), МНН и штрихкоду, архивируется и
  восстанавливается; штрихкод уникален в сети;
- цена есть только у пары «товар × точка»: нет цены — товар на точке не продаётся (БЛ 6.2);
  сотрудник меняет цены только точек, на которые у него есть право; цена выше предельной требует
  подтверждения;
- скидочные правила сети и точек ведутся с запретом выйти за свои права и охват;
- каждое изменение — в журнале сети (`audit_log`); история цен — там же.

## 2. Решения, принятые при обсуждении (2026-10-07)

| # | Вопрос | Решение |
|---|---|---|
| C1 | Объём | Товары, штрихкоды, категории, справочник форм, цены точек, скидочные правила. Без импорта, справочника препаратов, дублей, конфликтов цен и партий в карточке |
| C2 | Где цена | Только у точки (`store_products`), как в модели. «Цены сети» нет; экран «Цены» задаёт цену нескольким точкам одним запросом |
| C3 | Категории | Стартовый набор при создании сети + редактор в настройках (добавить, переименовать, архивировать) |
| C4 | Импорт из файла | Отдельной итерацией после склада |
| C5 | Модули | Два модуля по CLAUDE.md: `catalog` и `pricing`; `pricing` зависит от `catalog`, не наоборот |
| C6 | Поставщик у штрихкода | Убирается из контракта: в модели его нет, поставщиков ещё нет |
| C7 | Производитель и МНН | Свободный текст; подсказки — уникальные значения из товаров сети |
| C8 | Название | Обязательно на языке сети по умолчанию (`tenant_settings.default_language`), второй язык — по желанию |
| C9 | Единица товара | Закрытый список кодов `pack` / `piece` / `ml` в `libs/shared/domain` (web переводит по коду); проверка в БД; строк справочника для единиц нет |
| C10 | История цен | `audit_log`, отдельной таблицы нет |

## 3. Схема (миграция `catalog-pricing`)

Все таблицы — класс `tenant` (манифест `table-classes.ts`): `tenant_id` и составной ключ
`(tenant_id, id)`, составные внешние ключи, RLS `enable` + `force`, политика `tenant_isolation` для
`pharmacy_app`, явные гранты (`select, insert, update`; `delete` — только `product_barcodes`,
`discount_rule_tiers`, `discount_rule_stores`, которые заменяются набором). Колонки — из
`02-catalog-prices.md`; вводятся только те, у которых есть потребитель сейчас. Колонки
синхронизации, справочника препаратов, прихода и склада (`origin`, `created_at_store_id`,
`merged_into_product_id`, `drug_reference_id`, `draft_price_*`, `store_products.min_stock_pieces`)
добавят миграции своих модулей.

- **`categories`:** `name jsonb` (D6), `markup_bp integer null ≥ 0`, `pos_sort_order integer`,
  `status` (`active` / `archived`), `archived_at`, `updated_at`.
- **`dictionary_values`:** `kind` (сейчас только `dosage_form`; `check` расширят следующие модули),
  `code text null` (уникален в `(tenant_id, kind, code)`), `name jsonb`, `is_system`, `status`,
  `archived_at`.
- **`products`:**
  - `name jsonb`, `inn jsonb null`;
  - `dosage_form`, `dosage`, `manufacturer`, `country` (ISO 3166-1 alpha-2) — `text null`;
  - `unit text not null check (unit in ('pack', 'piece', 'ml'))`;
  - `pieces_per_pack integer ≥ 1`, `sold_by_piece boolean`, `check (not sold_by_piece or pieces_per_pack > 1)`;
  - `is_prescription`, `is_controlled`; `check (not is_controlled or is_prescription)`;
  - `is_price_regulated`, `max_retail_price_per_pack_dirams bigint null > 0`,
    `check (is_price_regulated = (max_retail_price_per_pack_dirams is not null))`;
  - `category_id uuid not null` → `categories`, `markup_bp integer null ≥ 0`,
    `default_min_stock_pieces integer null ≥ 0`;
  - `article text null`, уникальный индекс `(tenant_id, lower(article)) where article is not null`;
  - `status` (`active` / `archived`), `archived_at`, `updated_at`.
  - Индексы: `gin (lower(name->>'ru') gin_trgm_ops)`, то же для `'tj'`; `(tenant_id, lower(inn->>'ru'))`;
    `(tenant_id, category_id)`.
- **`product_barcodes`:** ключ `(tenant_id, barcode)`, `product_id`, индекс `(tenant_id, product_id)`;
  `check (barcode ~ '^[0-9]{8,14}$')`.
- **`store_products`:** ключ `(tenant_id, store_id, product_id)`; `retail_price_per_pack_dirams bigint
  null > 0`, `retail_price_per_piece_dirams bigint null > 0` (сейчас не заполняется),
  `price_version integer ≥ 1`, `price_changed_at`, `price_changed_by` → `employees`,
  `price_source` (`cloud` / `store`), `updated_at`; индекс `(tenant_id, product_id)`.
- **`discount_rules`:** `name jsonb`, `level` (`network` / `store`), `store_scope` (`all` / `list`),
  `check ((level = 'network') = (store_scope = 'all'))`, `valid_from date null`, `valid_to date null`,
  `check (valid_to is null or valid_from is not null and valid_to >= valid_from)`, `status`
  (`active` / `archived`), `archived_at`, `created_by` → `employees`, `updated_at`.
- **`discount_rule_tiers`:** ключ `(tenant_id, rule_id, min_total_dirams)`, `min_total_dirams > 0`,
  `percent_bp between 100 and 10000`.
- **`discount_rule_stores`:** ключ `(tenant_id, rule_id, store_id)`, индекс `(tenant_id, store_id)`.

Деньги — `bigint` в дирамах; проценты — `_bp` (API отдаёт целые проценты: `bp = percent × 100`).
Минимальный остаток хранится в штуках, API отдаёт пачки (`pieces = packs × pieces_per_pack`, обратно —
деление нацело).

## 4. Стартовый каталог (дополнение поправки ADR-0013 от 2026-10-05, п. 6)

- `provision_tenant` получает ещё один параметр `p_catalog_defaults jsonb` —
  `{ categories: [{ id, name: {ru, tj} }], dosageForms: [{ id, code, name: {ru, tj} }] }`; функция
  вставляет категории (`markup_bp` пустой, `pos_sort_order` по порядку) и системные значения
  (`kind = 'dosage_form'`, `is_system = true`) в той же транзакции. Список — константа
  `catalogDefaults` в `libs/shared/domain`; id генерирует `TenantsService` (UUIDv7).
- `pharmacy_provisioner` получает `INSERT` и политику `provisioner_all` на `categories` и
  `dictionary_values`; старая версия функции удаляется, `EXECUTE` — `pharmacy_platform`.
- Миграция добавляет набор уже созданным сетям, у которых нет ни одной категории
  (`set local role pharmacy_provisioner`, как при ролях по умолчанию).
- Категории: «Лекарственные средства», «Витамины и БАД», «Медицинские изделия», «Гигиена и уход»,
  «Детские товары», «Прочее». Формы: таблетки, капсулы, сироп, суспензия, раствор, мазь, крем, гель,
  капли, спрей, порошок, суппозитории, ампулы. Названия TJ — на проверку носителю языка.

## 5. API `catalog` (`apps/api/src/app/catalog`, только `TenantDatabase`)

Каталог общий для сети: охват точек сотрудника на товары и категории не влияет.

| Маршрут | Право | Ответ |
|---|---|---|
| `GET /catalog/products?q=&categoryId=&form=&flag=&status=&limit=&offset=` | `catalog:view` | `CatalogListResponse` |
| `GET /catalog/products/{id}` | `catalog:view` | `CatalogProductCard` |
| `POST /catalog/products` | `catalog:create` | `CatalogProduct` |
| `PUT /catalog/products/{id}` | `catalog:update` | `CatalogProduct` |
| `POST /catalog/products/{id}/status` `{ status: 'active' \| 'archived' }` | `catalog:delete` | `CatalogProduct` |
| `GET /catalog/references` | `catalog:view` | `CatalogReferences` |
| `GET /catalog/categories` | `catalog:view` | `Category[]` |
| `POST /catalog/categories`, `PUT /catalog/categories/{id}` | `catalog:update` | `Category` |
| `POST /catalog/categories/{id}/status` | `catalog:update` | `Category` |
| `GET /settings/markups` | `settings:view` | `CategoryMarkup[]` |
| `PUT /settings/markups` | `settings:update` | `CategoryMarkup[]` |

**Список.**
- `q` — подстрока названия RU/TJ без учёта регистра (`ILIKE` по триграммам) или МНН; строка из
  8–14 цифр ищется ещё и как штрихкод (точное совпадение).
- `flag`: `rx` (рецептурный, не ПКУ), `controlled`, `regulated`, `no_barcode`; `status` по умолчанию
  `active`; сортировка по названию на языке сети, затем `id`; `limit` 1–100 (по умолчанию 20).
- `retailPriceMinor` строки — цена пачки на текущей точке сессии (`currentStoreId`); точки нет или
  цены нет — `null`.
- `kpi`: `products` (активные), `withoutBarcode` (активные без штрихкода), `duplicates` — всегда 0
  до синхронизации.

**Запись товара.**
- Название на языке сети обязательно, каждое — до 200 символов после `trim`; пустой второй язык не
  хранится.
- `categoryId` — активная категория; `form` — активное значение `dosage_form` (сравнение по названию
  на языке сети) или пусто; `unit` — код из списка; `countryCode` — код из `countries` или пусто;
  `inn`, `dosage`, `manufacturer` — до 200 символов.
- `piecesPerPack` 1–10 000; `divisible` только при `piecesPerPack > 1`.
- `prescription`: `none` / `rx` / `controlled` → `is_prescription`, `is_controlled`.
- `maxPriceMinor` — целое > 0 или `null` (`is_price_regulated` выводится); `markupPercent` 0–1000
  или `null`; `minStockPacks` 0–1 000 000.
- Штрихкоды: 8–14 цифр, не больше 20, без повторов в запросе; штрихкод другого товара (в том числе
  архивного) → 409 `barcode_taken` у поля `barcodes`. `PUT` заменяет набор (удалить лишние,
  вставить новые) в той же транзакции; гонку двух товаров ловит первичный ключ (`uniqueConstraint`
  → тот же 409).
- Архивный товар не правится (409 `product_archived`), его штрихкоды остаются за ним — восстановление
  всегда возможно. Архивирование не трогает цены.
- Аудит: `product.created`, `product.updated` (`details.fields` — список изменённых полей),
  `product.status_changed`.

**Категории.**
- Название на языке сети обязательно, до 100 символов; уникально среди категорий сети без учёта
  регистра (сравнение в приложении, `toLocaleLowerCase('ru')`, как у ролей) → 409
  `category_name_taken` у поля.
- Новая категория — в конец `pos_sort_order`.
- Архивировать категорию с активными товарами → 409 `category_in_use`; архивная категория не
  выбирается в товаре, но остаётся у старых.
- `PUT /settings/markups` — наценка 0–1000 % для активных категорий (`null` не принимается, как в
  текущем контракте); неизвестная категория → 400.
- Аудит: `category.created`, `category.updated`, `category.status_changed`, `markups.updated`.

**Справочники** (`GET /catalog/references`): активные категории, формы (названия на языке сети),
единицы, страны (`countries` из `libs/shared/domain`: код и название на языке сессии), до 500
уникальных производителей и МНН из товаров сети.

**Публичный интерфейс модуля.** `CatalogModule` экспортирует `ProductsReader`:
`findForPricing(trx, tenantId, ids)` → `{ id, name, status, piecesPerPack, maxPriceMinor,
markupBp, categoryMarkupBp }[]` и `searchIds(...)` для фильтра списка цен. `pricing` не читает таблицы
каталога напрямую.

## 6. API `pricing` (`apps/api/src/app/pricing`)

Сотрудник видит цены и правила только точек своего охвата; владелец — все активные точки.

| Маршрут | Право | Ответ |
|---|---|---|
| `GET /prices?q=&categoryId=&limit=&offset=` | `pricing:view` | `PriceListResponse` |
| `GET /prices/{productId}` | `pricing:view` | `StorePrice[]` |
| `PUT /prices/{productId}` | `pricing:update-store` или `pricing:update-network` | `PriceRow` |
| `GET /discount-rules` | `discounts:view` | `DiscountRuleDefinition[]` |
| `POST /discount-rules`, `PUT /discount-rules/{id}` | `discounts:manage-store` или `discounts:manage-network` | `DiscountRuleDefinition` |

**Цены.**
- Строки — активные товары (фильтр `q` и `categoryId` — через `ProductsReader`), колонки — активные
  точки охвата. `markupPercent` — наценка товара, иначе категории, иначе `null`. `costMinor` — только
  с `finance:view-cost`, сейчас всегда `null` (закупочных цен до прихода нет). Предупреждения —
  `priceWarnings` из `libs/shared/domain`.
- `PUT`: одна транзакция; 1–200 точек без повторов; товар активный (иначе 404 / 409
  `product_archived`); точка активная. Точка в охвате — нужно `pricing:update-store` или
  `pricing:update-network`; вне охвата — только `pricing:update-network`, иначе 403
  `store_not_in_scope`. `priceMinor` — целое 1–10¹⁰ дирамов.
- Цена выше предельной без `confirmAboveMax` → 422 `above_max_price` у поля `prices`; с
  подтверждением — сохраняется, в ответе предупреждение `above_max`.
- Неизменённая цена пропускается. Изменённая — `insert … on conflict do update`: `price_version + 1`,
  `price_changed_at = now()`, `price_changed_by`, `price_source = 'cloud'`; в журнал —
  `price.changed` (`entityType = 'product'`, `details: { storeId, oldPriceMinor, newPriceMinor }`).
- Снять цену (сделать «не продаётся») — вне объёма.

**Скидочные правила.**
- Видны правила `level = 'network'` и правила, где есть хотя бы одна точка охвата.
- `storeIds: null` — правило сети (`network` / `all`), нужно `discounts:manage-network`. Список точек
  (`store` / `list`) — `discounts:manage-network` или `discounts:manage-store`; со вторым каждая
  точка — в охвате, иначе 403 `store_not_in_scope`. Пустой список → 400.
- Правка проверяет права и на текущий, и на новый охват правила; точки и пороги заменяются набором.
- Название обязательно, до 200 символов (хранится как `{язык сети: name}`); 1–10 порогов, сумма — целое
  > 0 без повторов, процент — целое 1–100; `period`: `from` обязателен, `to ≥ from` или `null`; точки
  существуют и активны.
- Статус (`active` / `scheduled` / `expired`) — `discountRuleStatus` по дате в часовом поясе сети.
  `author` — создатель и название его роли. Архива нет: правило заканчивают датой «по».
- Аудит: `discount_rule.created`, `discount_rule.updated`.

## 7. Контракт (`libs/shared/dto/src/lib/tenant-catalog.ts`, `tenant-owner.ts`)

- `ProductBarcode` → `{ code }` (без `supplierId`, `supplierName`); `CatalogProductInput.barcodes` —
  `Array<{ code: string }>`.
- `CatalogProduct` без `retailPriceMinor`, плюс `status: 'active' | 'archived'`;
  `CatalogListItem.retailPriceMinor: number | null`, плюс `status`.
- `CatalogProductCard` = `CatalogProduct` (без `prices`, `batches`; `ProductBatchRow` удаляется вместе с
  моками карточки — партии вернутся маршрутом склада).
- `CatalogListQuery.status?: 'active' | 'archived'`; `UpdateProductStatusRequest { status }`.
- `CatalogReferences` плюс `units: ProductUnit[]`.
- Новые `Category { id, nameRu, nameTj, markupPercent: number | null, status, products }`,
  `CategoryInput { nameRu, nameTj }`, `UpdateCategoryStatusRequest { status }`.
- `StorePrice.priceMinor: number | null`; `PriceRow.markupPercent: number | null`;
  `PriceRow.costMinor?: number | null`.
- JSDoc маршрутов — коды ошибок раздела 9.

## 8. Web (`apps/web`)

- `REAL_API_ROUTES` (режим `partial`): `catalog.list/get/create/update/status/references`,
  `catalog.categories/createCategory/updateCategory/categoryStatus`, `prices.list/get/update`,
  `discountRules.list/create/update`, `settings.markups/updateMarkups`. Дубли (`catalog.duplicates`,
  `catalog.resolveDuplicate`), конфликты цен и `catalog.article1c` остаются на моках; без моков их
  скрывает `isApiRouteAvailable`, как сейчас.
- В режиме `partial` касса, склад и приход показывают товары моков, каталог — настоящие: ожидаемо до
  переезда склада.
- **Каталог:** фильтр «Активные / Архив»; «—», когда цены на текущей точке нет.
- **Карточка товара:** цены — запросом `prices.get` (блок виден с `pricing:view`); блок партий скрыт
  до склада; «В архив» / «Восстановить» с `catalog:delete`; архивный товар — только просмотр.
- **Форма товара:** без поставщика у штрихкода; обязательное название на языке сети; ошибки у полей
  (`barcode_taken`, `validation_failed` с `errors[]`).
- **Цены и скидки:** `null` → «не продаётся»; подтверждение цены выше предельной — от ответа API.
- **Настройки → «Категории и наценки»:** список категорий с наценкой и числом товаров; добавить,
  переименовать (RU/TJ), архивировать (`catalog:update`); наценки — как сейчас (`settings:update`).
- `withFreshAuth` на этих маршрутах не нужен (не действия над учётными записями).
- Моки — на новый контракт, чтобы полный мок-режим, unit-тесты и web-e2e остались зелёными.
- Тексты RU/TJ.

## 9. Ошибки (RFC 7807)

| Статус | Коды |
|---|---|
| 400 | `validation_failed` с `errors[]` (поля: `nameRu`/`nameTj`, `categoryId`, `form`, `unit`, `countryCode`, `piecesPerPack`, `divisible`, `maxPriceMinor`, `markupPercent`, `minStockPacks`, `barcodes`, `prices`, `storeIds`, `thresholds`, `period`, `name`) |
| 403 | `forbidden` (нет права), `store_not_in_scope` |
| 404 | `not_found` — товар, категория, правило (вне охвата) или точка |
| 409 | `barcode_taken`, `category_name_taken`, `category_in_use`, `product_archived` |
| 422 | `above_max_price` |

## 10. Вне объёма

Импорт товаров; справочник препаратов (`drug_reference`, админка); дубли и конфликты цен офлайн-точек
и синхронизация каталога (ADR-0014); партии и остатки в карточке, черновая цена после прихода,
переопределение минимального остатка точки (склад); своя цена штуки у точки; снятие цены; архив
скидочных правил; артикул 1С (маршрут `catalog.article1c` — с выгрузкой 1С); порядок категорий на
кассе; редактор лекарственных форм; товары и правила для кассы (`catalog.snapshot` — с модулем кассы).

## 11. Документы

ADR-0013 — дополнение поправки 2026-10-05 (стартовый каталог, права `pharmacy_provisioner` на
`categories` и `dictionary_values`) и строка в `APPROVAL.md`; модель данных `02-catalog-prices.md`
(введённые колонки, штрихкод без поставщика, единица — закрытый список, виды справочника);
CLAUDE.md (модули `catalog`, `pricing`; готовые маршруты `web:dev-api`); справочники скилов — если
появятся новые паттерны.

## 12. Проверка

Новые автотесты не пишутся до MVP (решение 2026-10-05); существующие наборы — зелёные
(интеграционные — под новую сигнатуру `provision_tenant`; unit-тесты и web-e2e каталога — под новый
контракт). Ручная проверка:
- миграция на dev-БД, `api:db-types`; новая сеть и старая сеть — стартовые категории и формы;
- curl: товар со штрихкодом; второй товар с тем же штрихкодом → 409; поиск по названию RU и TJ, МНН,
  штрихкоду; фильтры; архив → правка 409 → восстановление; категория с товарами → архив 409;
  наценки;
- curl, цены: владелец задаёт цены трём точкам; заведующий (охват — одна точка, `update-store`) —
  своя точка 200, чужая 403; выше предельной — 422, с подтверждением 200 и `above_max`; повтор той же
  цены не меняет `price_version`; журнал `price.changed`;
- curl, скидки: правило сети владельцем; заведующий — правило своей точки 200, сети 403, чужой точки
  403;
- браузер (`web:dev-api`): категория в настройках, товар через форму, поиск, архив, цены по точкам,
  скидочное правило.
