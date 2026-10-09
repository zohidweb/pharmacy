# Склад и закупки — спецификация

Дата: 2026-10-09. Статус: на утверждении архитектора. Связано: модель данных
`docs/architecture/data-model/03-batches-warehouse.md` и `05-purchasing.md` (одобрены 2026-09-30 / 2026-10-01),
ADR-0002 (границы модулей), ADR-0006 (Kysely, блокировка отдельно от подсчёта), ADR-0014 (офлайн-точка — вне
объёма), ADR-0016 (только TJS), ADR-0018 (права и охват), спецификация `2026-10-07-catalog-pricing-design.md`
(каталог, цены точек, `ProductsReader`).

## 1. Цель и критерии успеха

Товар физически появляется на точке и учитывается партиями: приход от поставщика и ввод начальных остатков
создают партии со сроком и закупочной ценой, остатки выводятся из движений, проведение можно отменить, пока
по партиям не было расхода. Сеть ведёт поставщиков, долг по приходам, оплаты и заказы поставщику. Экраны
«Остатки», «Приход», «Ввод начальных остатков», «Поставщики», «Заказы поставщикам» и блок партий в карточке
товара `apps/web` работают с API в режиме `partial`. На этих партиях дальше строятся касса (FEFO) и расходные
документы.

Успех:
- проведённый приход создаёт партии, движения, цену точки и долг поставщику в одной транзакции; отмена
  проведения — сторно движений и долга, запрещена после расхода по партиям;
- остаток никогда не хранится — только сумма движений; минус запрещён (расходов в этой итерации нет);
- оплата поставщику идемпотентна, распределяется на приходы с самого раннего срока, остаток — предоплата;
- заказ получает статус по проведённым приходам;
- каждое действие — в журнале сети (`audit_log`).

## 2. Решения, принятые при обсуждении (2026-10-09)

| # | Вопрос | Решение |
|---|---|---|
| I1 | Объём склада | Ядро: партии, движения, нумерация, приход, ввод начальных остатков (НО), остатки, партии в карточке. Списание, возврат поставщику, инвентаризация, перемещения — следующими итерациями |
| I2 | Розница из прихода | Цена строки прихода **при проведении сразу становится ценой точки** (как в ТЗ и web). Черновые цены `store_products.draft_*` из модели не вводятся — поправка модели |
| I3 | Начальные остатки | Документ НО на API + простой экран в web (по образцу прихода, без поставщика и накладной); позже его же заполнит импорт |
| I4 | Закупки | Весь модуль: справочник поставщиков, журнал расчётов, оплаты с распределением и предоплатой, заказы с дефицитом |
| I5 | Разбиение | Одна спецификация, **два плана и два PR**: PR-1 «Склад и поставщики» (разделы 3.1, 4, 5.1), PR-2 «Закупки» (3.2, 5.2, 5.3) |
| I6 | Предоплата | По модели (решение 2026-10-01): оплата больше долга допустима, остаток — предоплата; запрет `above_debt` из моков снимается |
| I7 | Юрлицо оплаты | В запрос оплаты добавляется `legalEntityId`; необязателен, если в сети одно активное юрлицо |
| I8 | Дефицит | Расчёт по остаткам отдаёт модуль `inventory` (адрес прежний), чтобы `purchasing` не зависел от склада |

## 3. Схема

Все таблицы — класс `tenant` (манифест `table-classes.ts`): `tenant_id`, составные ключи и ссылки, RLS
`enable` + `force`, `tenant_isolation` для `pharmacy_app`, гранты `SELECT, INSERT, UPDATE, DELETE`; таблицы только
добавления — `SELECT, INSERT`, `REVOKE UPDATE, DELETE` и триггер, запрещающий изменение (как `audit_log`,
`APPEND_ONLY_TABLES`). Колонки — из модели данных, только с потребителем сейчас.

### 3.1 Миграция PR-1 `inventory-core`

- **`suppliers`:** `name text`, `tax_id`, `phone`, `email`, `address`, `bank_details` — `text null`,
  `payment_term_days integer ≥ 0 default 0`, `status` (`active` / `archived`), `archived_at`, `updated_at`.
- **`document_counters`:** ключ `(tenant_id, store_id, kind, year)`, `last_number bigint ≥ 0`.
- **`documents`:** `store_id`, `type` (`goods_receipt` / `opening_balance`; `check` расширят следующие типы),
  `number`, `document_date date`, `status` (`draft` / `posted`), `created_by`, `posted_by`, `posted_at`,
  `unposted_by`, `unposted_at`, `comment text null`, `total_dirams bigint null ≥ 0`, `supplier_id null`,
  `supplier_invoice_number text null`, `supplier_invoice_date date null`, `payment_due_date date null`,
  `updated_at`. Уникальность `(tenant_id, store_id, type, number)`; `check (type <> 'goods_receipt' or supplier_id
  is not null)`; `check ((status = 'posted') = (posted_at is not null))`. Индексы `(tenant_id, store_id, type,
  document_date)`, `(tenant_id, supplier_id)`.
- **`batches`:** `store_id`, `product_id`, `expiry_date date`, `lot_number text null`,
  `purchase_price_per_pack_dirams bigint ≥ 0`, `cost_per_piece_dirams bigint ≥ 0`, `supplier_id null`,
  `origin` (`goods_receipt` / `opening_balance`; `check` расширят), `source_document_id`, `is_starting boolean`.
  Индексы `(tenant_id, store_id, product_id, expiry_date)`, `(tenant_id, store_id, expiry_date)`.
- **`goods_receipt_lines`:** `document_id`, `line_no`, `product_id`, `qty_pieces > 0`, `expiry_date`, `lot_number`,
  `purchase_price_per_pack_dirams ≥ 0`, `retail_price_draft_dirams > 0`, `batch_id null`.
- **`opening_balance_lines`:** `document_id`, `line_no`, `product_id`, `qty_pieces > 0`, `expiry_date`,
  `lot_number`, `purchase_price_per_pack_dirams ≥ 0`, `retail_price_draft_dirams null > 0`, `supplier_id null`,
  `is_starting boolean`, `batch_id null`.
- **`stock_movements`** (только добавление, секции по месяцам `recorded_at`, ключ `(tenant_id, id, recorded_at)`):
  `store_id`, `batch_id`, `qty_delta_pieces ≠ 0`, `kind` (`goods_receipt`, `opening_balance`, `reversal`, `sale`
  — последний для будущей кассы и проверки отмены), `source_type` (`document`), `source_id`, `source_line_id`,
  `business_date`, `origin` (`local`), `reverses_movement_id null`. Индексы `(tenant_id, store_id, batch_id)
  include (qty_delta_pieces)`, `(tenant_id, source_id)`, `(tenant_id, store_id, business_date)`. Секции —
  помесячно с 2026-10 по 2028-12 (UTC), без DEFAULT; дальше — плановая задача (вне объёма). Внешних ключей на
  секционированную таблицу нет (README модели).
- **`supplier_ledger_entries`** (только добавление): `supplier_id`, `legal_entity_id`, `kind` (`goods_receipt`,
  `payment`, `reversal`), `amount_dirams ≠ 0`, `due_date null`, `source_type` (`document` / `payment`),
  `source_id`, `business_date`, `recorded_by`, `recorded_at`. Индекс `(tenant_id, supplier_id, legal_entity_id)`.

### 3.2 Миграция PR-2 `purchasing`

- **`supplier_payments`:** `id` — ключ идемпотентности (UUIDv7 клиента), `supplier_id`, `legal_entity_id`,
  `amount_dirams > 0`, `paid_on date`, `method` (`cash` / `bank_transfer`), `comment text null`, `created_by`.
- **`supplier_payment_allocations`:** ключ `(tenant_id, payment_id, goods_receipt_document_id)`,
  `amount_dirams > 0`. Не только добавление: отмена проведения прихода удаляет его распределения.
- **`purchase_orders`:** `store_id`, `supplier_id`, `number`, `order_date`, `expected_date null`, `status`
  (`draft` / `confirmed` / `partially_received` / `closed`), `created_by`, `confirmed_by`, `confirmed_at`,
  `comment`, `updated_at`; номер уникален в `(tenant_id, store_id, number)`.
- **`purchase_order_lines`:** `order_id`, `line_no`, `product_id`, `qty_ordered_pieces > 0`,
  `price_per_pack_dirams ≥ 0`.
- **`documents.purchase_order_id null`**, **`goods_receipt_lines.purchase_order_line_id null`**,
  **`goods_receipt_lines.order_price_per_pack_dirams null`**.

## 4. Модуль `inventory` (PR-1; `apps/api/src/app/inventory`, только облако)

Охват: сотрудник видит и пишет документы только точек своего охвата (иначе 403 `store_not_in_scope`); запись по
точке не в режиме `online` — 409 `offline_store_read_only` (ADR-0014: документы офлайн-точки создаёт она сама).
Закупочные цены и суммы — только с `finance:view-cost` (поля отсутствуют).

### 4.1 Приход (`goods_receipt`) и НО (`opening_balance`)

| Маршрут | Право |
|---|---|
| `GET /goods-receipts?storeId&status&supplierId&limit&offset` (KPI: проведено за месяц, сумма, черновики) | `inventory:view` |
| `GET /goods-receipts/{id}` | `inventory:view` + `finance:view-cost` |
| `POST /goods-receipts` — черновик, номер сразу | `inventory:create` |
| `PUT /goods-receipts/{id}` — только черновик | `inventory:update` |
| `POST /goods-receipts/{id}/posting` | `inventory:post` |
| `POST /goods-receipts/{id}/unposting` | `inventory:unpost` |
| `GET /stock-documents/{goods-receipts\|opening-balances}/{id}/unposting-check` | `inventory:unpost` |
| `/opening-balances…` — те же шесть маршрутов | те же |

**Черновик.** Строки: товар (активный), серия до 60 символов, срок, упаковки 1–100 000, закупочная цена упаковки
0–10¹⁰, розничная цена упаковки 1–10¹⁰ (у НО — необязательна), у НО ещё «стартовая партия». Шапка прихода:
поставщик (активный), точка, дата, номер накладной до 60 символов, срок оплаты (по умолчанию дата +
`payment_term_days`). Сохранение заменяет строки целиком (партий у черновика нет; у строк после отмены проведения
партия сохраняется, пока строка не изменена — сравнение по товару, сроку, серии и цене). Не больше 500 строк.

**Проведение** — одна транзакция:
1. шапка `FOR UPDATE`; не черновик → 409 `document_posted`;
2. проверки (422 `validation_failed` с полями): есть строки; у прихода — номер накладной; дата не в будущем, не
   раньше бизнес-даты − `backdating_max_days`, позже `legal_entities.closed_until` юрлица точки (иначе 422
   `period_closed`); товары активны (иначе 409 `product_archived` у строки);
3. партии для строк без партии: `cost_per_piece = ceil(цена упаковки / штук в упаковке)`, `origin` по типу;
4. движения `+qty_pieces` (`qty_pieces = упаковки × штук`), `business_date` = дата документа;
5. цены точки: строки с розницей, отличной от текущей, — через `StorePriceWriter` модуля `pricing` (право
   `pricing:update-store`/`update-network` на точку, иначе 403 `forbidden`; выше предельной — 422
   `above_max_price` у строки; `price_version + 1`, `price.changed` с `source: document`);
6. `total_dirams` = Σ упаковок × закупочная цена;
7. у прихода — `SupplierLedger.receiptPosted` (запись `goods_receipt` на сумму со сроком оплаты, юрлицо точки) и
   в PR-2 — распределение предоплаты и статус заказа;
8. статус `posted`, `posted_by/at`, аудит `document.posted`.

**Отмена проведения:** партии документа `FOR UPDATE` (одним оператором), затем проверка: есть движения по ним,
кроме движений этого документа и их сторно, → 409 `unpost_blocked` (то же отдаёт `unposting-check` с
`blockers`). Иначе: движения `reversal` с обратным знаком и `reverses_movement_id`; у прихода — запись `reversal`
в журнал, в PR-2 — снятие распределений оплат (аудит) и пересчёт заказа; статус `draft`, `unposted_by/at`,
`posted_*` очищаются; аудит `document.unposted`. Цены точки не откатываются.

**Нумерация:** `INSERT … ON CONFLICT DO UPDATE … RETURNING` в `document_counters`, год — по дате документа;
формат `ПР-<код точки>-<год>-<6 цифр>`, `НО-…`.

### 4.2 Остатки

- **`GET /stock?storeId&q&state&sort&direction&limit&offset`** (`inventory:view`): строка на партию с ненулевым
  остатком в точках охвата (или указанной) + строка «нет в наличии» для активного товара с ценой на точке без
  остатка. Остаток — сумма движений партии; состояние — `stockState`: «мало» — остаток товара на точке ниже
  `default_min_stock_pieces`, «истекает» — срок ≤ бизнес-дата + `expiry_reminder_days`. `counts` — по точкам
  охвата. Поиск — как в каталоге (название, МНН, штрихкод); сортировка — товар, срок, количество, цена.
- **`GET /stores/{storeId}/stock-products?query&limit`** (`inventory:view`): активные товары для строк
  документов с партиями точки по сроку (FEFO) и ценой точки.
- **`GET /stock/products/{productId}/batches`** (`inventory:view`) — новый: партии товара с ненулевым
  остатком по точкам охвата, для карточки товара.
- **`GET /purchase-orders/deficit?storeId&supplierId`** (PR-2; `purchasing:view` + `finance:view-cost`): товары
  точки ниже минимального остатка, количество — `deficitQuantity`, расход за 30 дней — движения `sale`, цена —
  последняя закупка у поставщика, иначе любая, иначе 0.

### 4.3 Публичные интерфейсы

- `inventory` импортирует `CatalogModule` (`ProductsReader`, расширяется чтением товаров для строк),
  `PricingModule` (новый экспорт `StorePriceWriter.applyFromDocument(trx, …)`) и `PurchasingModule`
  (`SuppliersReader`, `SupplierLedger`, в PR-2 — `OrderReceiving`). Обратных зависимостей нет.

## 5. Модуль `purchasing` (`apps/api/src/app/purchasing`, только облако)

### 5.1 Поставщики и журнал расчётов (PR-1)

| Маршрут | Право |
|---|---|
| `GET /suppliers/options` | `inventory:view` |
| `GET /suppliers?limit&offset` | `purchasing:view` (суммы — с `finance:view-cost`) |
| `GET /suppliers/{id}` — приходы, журнал расчётов | `purchasing:view` + `finance:view-cost` |
| `POST /suppliers`, `PUT /suppliers/{id}` | `purchasing:create` / `purchasing:update` |

- Название 1–200 символов, уникально в сети без учёта регистра (409 `supplier_name_taken`); ИНН — 9 цифр или
  пусто; отсрочка 0–365 дней. Аудит `supplier.created`, `supplier.updated`.
- Долг поставщика = сумма журнала по всем юрлицам; остаток по приходу = сумма − распределённые оплаты; просрочка
  — остаток > 0 и срок < бизнес-дата сети; `nextDueOn`, `overdueDays`, `debtState`.
- `SupplierLedger.receiptPosted / receiptUnposted(trx, …)` — экспорт для `inventory`.

### 5.2 Оплаты (PR-2)

`POST /suppliers/{id}/payments` (`purchasing:post` + `finance:view-cost`) — финансовая операция:
- `id` (UUIDv7) — ключ: повтор с тем же телом → тот же ответ, с другим → 409 `idempotency_conflict`;
- `amountMinor` 1–10¹⁰, `date` не в будущем, `method` `cash` / `bank` (в БД `bank_transfer`), `comment` ≤ 500,
  `legalEntityId` — обязателен при нескольких активных юрлицах сети;
- запись `payment` (−сумма) в журнал; распределение на проведённые приходы этого «поставщик × юрлицо» с
  непогашенным остатком по возрастанию срока оплаты, затем даты; нераспределённое — предоплата, её
  распределяет следующий проведённый приход (шаг 7 проведения);
- аудит `supplier.payment` (без реквизитов счёта).

### 5.3 Заказы поставщику (PR-2)

| Маршрут | Право |
|---|---|
| `GET /purchase-orders?status&supplierId&storeId&limit&offset` (KPI) | `purchasing:view` |
| `GET /purchase-orders/{id}` | `purchasing:view` + `finance:view-cost` |
| `POST /purchase-orders`, `PUT /purchase-orders/{id}` — только черновик | `purchasing:create` / `purchasing:update` + `finance:view-cost` |
| `POST /purchase-orders/{id}/confirmation` | `purchasing:post` |
| `GET /purchase-orders/open?supplierId` | `inventory:view` |

- Номер `ЗК-<код точки>-<год>-<6 цифр>`; строки — товар (активный, без повторов), упаковки 1–100 000, цена 0–10¹⁰;
  1–500 строк.
- Приход по заказу (`orderId`): тот же поставщик и точка, заказ `confirmed` / `partially_received`, иначе 422
  у поля; строки прихода связываются со строкой заказа по товару, цена заказа — в строке прихода.
- Статус после проведения и отмены прихода — `orderStatusAfterReceipt` по полученным упаковкам проведённых
  приходов; `receivedPercent`.
- Аудит `purchase_order.created / updated / confirmed`.

## 6. Контракт (`libs/shared/dto`)

- `tenant-inventory.ts`: `StockRow.retailPriceMinor`, `StockProductOption.retailPriceMinor` и `markupPercent` →
  `number | null`; `ProductBatchRow` (снова) для `GET /stock/products/{id}/batches`; новые `OpeningBalance`,
  `OpeningBalanceLine`, `OpeningBalanceInput`, `OpeningBalanceListItem`, `OpeningBalanceListResponse`;
  `StockDocumentKind` + `'opening-balances'`.
- `tenant-purchasing.ts` (PR-2): `SupplierPaymentRequest.legalEntityId?: string`.
- JSDoc маршрутов — коды раздела 7.

## 7. Ошибки (RFC 7807)

| Статус | Коды |
|---|---|
| 400 | `validation_failed` с `errors[]` |
| 403 | `forbidden`, `store_not_in_scope` |
| 404 | `not_found` |
| 409 | `document_posted`, `unpost_blocked`, `offline_store_read_only`, `product_archived`, `supplier_name_taken`, `idempotency_conflict`, `order_not_editable` |
| 422 | `validation_failed` (неполный документ при проведении), `period_closed`, `above_max_price` |

## 8. Web (`apps/web`)

- `REAL_API_ROUTES`: PR-1 — `stock.list`, `stock.products`, `stock.productBatches`, `suppliers.options/list/get/
  create/update`, `goodsReceipts.*`, `openingBalances.*`, `documents.unpostCheck` (только виды `goods-receipts`
  и `opening-balances` — правило по параметрам маршрута в `partialTransport`); PR-2 — `purchaseOrders.*`,
  `suppliers.pay`. Списания, возвраты поставщику, инвентаризация, перемещения и касса — на моках.
- Экраны: «Остатки», «Приход» (предупреждение «выше предельной» до проведения, ошибки у строк), новый «Ввод
  начальных остатков» (список и редактор, пункт меню «Склад», `inventory:view`), блок партий в карточке товара,
  «Поставщики» (PR-2: оплата с выбором юрлица, без запрета «больше долга»), «Заказы поставщикам» (PR-2).
- Моки — на новый контракт; полный мок-режим, unit-тесты и web-e2e — зелёные. Тексты RU/TJ.

## 9. Вне объёма

Списание, возврат поставщику (уменьшение долга), инвентаризация, перемещения и заявки; продажи кассы;
офлайн-точка и синхронизация документов; переопределение минимального остатка точки; начальный долг поставщику;
ручное распределение оплат; плановая задача секций `stock_movements`; установка `closed_until` (только проверка);
удаление черновиков и заказов; отправка заказа поставщику (только печать).

## 10. Документы

Модель данных `03` и `05` (введённые колонки по миграциям, I2 — поправка модели, секции до 2028-12, серия и
розница в НО, юрлицо оплаты, дефицит в `inventory`); CLAUDE.md (модули `inventory`, `purchasing` — облако;
маршруты `web:dev-api`; граф зависимостей модулей); справочник скила `nestjs-api` (блокировка партий отдельно от
подсчёта, движения только добавлением).

## 11. Проверка

Новые автотесты не пишутся до MVP (решение 2026-10-05); существующие — зелёные (интеграционные — под манифест,
append-only и секции). Ручная проверка:
- PR-1, curl: нумерация; черновик → проведение (партия, остаток, цена точки, журнал расчётов); два одновременных
  проведения → 200 + 409 `document_posted`; отмена; отмена после более позднего движения (`sale`, вставленного
  ролью приложения) → 409 `unpost_blocked`; дата в будущем / раньше окна → 422; чужая точка 403; офлайн-точка
  409; НО без долга; остатки с состояниями; партии в карточке; журнал сети;
- PR-2, curl: оплата — повтор с тем же `id`, конфликт; распределение по сроку; предоплата забирается следующим
  приходом; отмена прихода освобождает распределения; заказ — подтверждение, приход по заказу → частично /
  закрыт, отмена возвращает статус; дефицит;
- браузер (`web:dev-api`) для каждого PR; `npm run check` и web-e2e — перед каждым PR.
