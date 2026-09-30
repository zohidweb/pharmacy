# 3. Партии и склад

Соглашения — в [README](README.md). `tenant_id`, `(tenant_id, id)` и `created_at` в списках колонок не повторяются. Все количества — в штуках (`_pieces`), деньги — в дирамах.

```mermaid
erDiagram
  stores ||--o{ batches : "own batches (D2)"
  products ||--o{ batches : ""
  batches ||--o{ batches : "source_batch_id"
  stores ||--o{ documents : ""
  documents ||--o{ goods_receipt_lines : ""
  documents ||--o{ opening_balance_lines : ""
  documents ||--o{ transfer_lines : ""
  documents ||--o{ transfer_request_lines : ""
  documents ||--o{ write_off_lines : ""
  documents ||--o{ inventory_lines : ""
  documents ||--o{ supplier_return_lines : ""
  batches ||--o{ stock_movements : "qty = sum"
```

## `batches` — партия (класс `tenant`, D2)

Партия принадлежит одной точке. **Количества в партии нет**: остаток = `sum(stock_movements.qty_delta_pieces)`. Синхронизация: партии офлайн-точки — точка → облако, внутри операций. Облако создаёт партии офлайн-точки только из этих операций.

| Колонка | Тип | Правило |
|---|---|---|
| `store_id`, `product_id` | uuid | |
| `expiry_date` | date | |
| `lot_number` | text null | Серия |
| `purchase_price_per_pack_dirams` | bigint ≥ 0 | |
| `cost_per_piece_dirams` | bigint ≥ 0 | `ceil(purchase / pieces_per_pack)` на момент создания |
| `supplier_id` | uuid null | |
| `origin` | text | `goods_receipt` / `opening_balance` / `transfer` / `inventory_surplus` |
| `source_document_id` | uuid | Создавший документ |
| `source_batch_id` | uuid null | Исходная партия отправителя (`origin = 'transfer'`) |
| `is_starting` | boolean | «Стартовая партия» без разбивки (КП 3.4) |
| `negative_flagged_at` | timestamptz null | Ушла в минус после синхронизации — нужна инвентаризация (БЛ W3-03) |

Индексы:
- `(tenant_id, store_id, product_id, expiry_date)` — FEFO на кассе и выбор партии;
- `(tenant_id, store_id, expiry_date)` — напоминания о сроках.

## `documents` — шапка складского документа (класс `tenant`, D1)

Синхронизация: проведённые документы офлайн-точки — точка → облако (`document.posted`); черновики не синхронизируются. Входящие перемещения на офлайн-точку — облако → точка («в пути»). Складские документы офлайн-точки из облака создавать нельзя (ADR-0014).

| Колонка | Тип | Правило |
|---|---|---|
| `store_id` | uuid | Точка документа (для перемещения — отправитель) |
| `type` | text | `goods_receipt`, `opening_balance`, `transfer`, `transfer_request`, `write_off`, `inventory`, `supplier_return` |
| `number` | text | Уникален в `(tenant_id, store_id, type, number)`; из `document_counters` |
| `document_date` | date | Дата документа; можно задним числом (КП 3.5) |
| `status` | text | См. «Статусы» ниже |
| `created_by`, `posted_by`, `posted_at` | | |
| `unposted_by`, `unposted_at` | null | Последняя отмена проведения |
| `comment` | text null | |
| `total_dirams` | bigint null | Сумма документа при проведении (приход, возврат поставщику) |
| **Приход, возврат поставщику** | | |
| `supplier_id` | uuid null | Обязателен для `goods_receipt`, `supplier_return` |
| `supplier_invoice_number`, `supplier_invoice_date` | text / date null | Один приход = одна накладная |
| `payment_due_date` | date null | Срок оплаты: дата накладной + отсрочка поставщика |
| `purchase_order_id` | uuid null | → `purchase_orders` |
| `source_document_id` | uuid null | Возврат поставщику → исходный приход (необязательно) |
| `claim_text` | text null | Претензия поставщику |
| **Перемещение, заявка** | | |
| `destination_store_id` | uuid null | Обязателен для `transfer`, `transfer_request`; ≠ `store_id` |
| `request_document_id` | uuid null | Перемещение по заявке |
| `dispatched_at`, `received_at`, `received_by` | null | |
| **Инвентаризация** | | |
| `inventory_scope` | text null | `all` / `category` / `selected` |
| `inventory_category_id` | uuid null | |
| `inventory_started_at` | timestamptz null | Момент снимка учётных остатков; касса продолжает работать |
| `updated_at` | | |

`check`: обязательные поля по `type`.

**Статусы:**
- **Обычный документ** (`goods_receipt`, `opening_balance`, `write_off`, `inventory`, `supplier_return`): `draft` → `posted`; отмена проведения — снова `draft`.
- **Перемещение:** `draft` → `in_transit` (отправлено: у отправителя сразу −N) → `received` (у получателя + факт).
- **Заявка:** `draft` → `sent` → `in_progress` → `partial` / `done` / `rejected`. На остатки не влияет.

## Строки документов

Ключ каждой — `(tenant_id, id)`. Ссылка на шапку — `(tenant_id, document_id)` с проверкой типа документа в приложении. Колонка `line_no` — порядок строк.

| Таблица | Колонки |
|---|---|
| `goods_receipt_lines` | `product_id`, `qty_pieces > 0`, `expiry_date`, `lot_number`, `purchase_price_per_pack_dirams`, `order_price_per_pack_dirams null` (для предупреждения «цена отличается от заказа»), `purchase_order_line_id null`, `batch_id` (создаётся при первом проведении, при повторном — та же), `retail_price_draft_dirams null` |
| `opening_balance_lines` | `product_id`, `qty_pieces > 0`, `expiry_date`, `purchase_price_per_pack_dirams`, `supplier_id null`, `batch_id`, `is_starting` |
| `transfer_lines` | `source_batch_id`, `qty_sent_pieces > 0`, `qty_received_pieces null` (при приёмке), `target_batch_id null` (партия получателя, D2), `discrepancy_resolution null` — `write_off` / `resend` |
| `transfer_request_lines` | `product_id`, `qty_requested_pieces > 0`. Выполненное количество — по связанным перемещениям |
| `write_off_lines` | `batch_id`, `qty_pieces > 0`, `reason_code` (из `dictionary_values`, `write_off_reason`) |
| `inventory_lines` | `product_id`, `batch_id null` (пусто — излишек без партии), `book_qty_pieces` (на момент начала), `counted_qty_pieces`, `sold_since_start_pieces` (при проведении), `surplus_batch_id null` |
| `supplier_return_lines` | `batch_id`, `qty_pieces > 0`, `amount_dirams` |

## `stock_movements` — движение остатка (класс `tenant`, только добавление)

Месячные секции по `recorded_at`, ключ `(tenant_id, id, recorded_at)`.

| Колонка | Тип | Правило |
|---|---|---|
| `store_id`, `batch_id` | uuid | Точка партии |
| `qty_delta_pieces` | integer ≠ 0 | + приход, − расход |
| `kind` | text | `goods_receipt`, `opening_balance`, `transfer_out`, `transfer_in`, `write_off`, `inventory_gain`, `inventory_loss`, `supplier_return`, `sale`, `customer_return`, `reversal` |
| `source_type` | text | `document` / `receipt` / `customer_return` |
| `source_id`, `source_line_id` | uuid | Документ, чек или возврат и строка |
| `business_date` | date | Дата документа или продажи (для отчётов «на дату» и ПКУ) |
| `recorded_at` | timestamptz | Время записи |
| `origin` | text | `local` / `cloud_snapshot` (переносящие движения флеш-комплекта, ADR-0014 §4) |
| `reverses_movement_id` | uuid null | Для `reversal`; ссылку проверяет приложение (секционированная таблица) |

Индексы: `(tenant_id, store_id, batch_id) include (qty_delta_pieces)` — остаток партии без чтения таблицы; `(tenant_id, source_id)`; `(tenant_id, store_id, business_date)`.

Правила:
- **Операция и её движения** — одна транзакция.
- **Блокировка отдельно от подсчёта:** партии блокируются `FOR UPDATE` одним оператором, остаток считается следующим (ADR-0006 п. 2).
- **Минус запрещён** при продаже, отправке, списании и возврате поставщику. Исключение — факты офлайн-точки: облако их принимает и помечает партию `negative_flagged_at`.
- **Отмена проведения** — движения `reversal` с противоположным знаком. Отмена запрещена, если по партиям документа есть движения позже его проведения (БЛ 6.2).

## `document_counters` — нумерация (класс `tenant`)

Ключ `(tenant_id, store_id, kind)`, колонки `prefix`, `last_number bigint`. `kind` — типы документов плюс `receipt`, `customer_return`, `z_report`, `purchase_order`. Номер берётся `UPDATE … RETURNING` в транзакции документа.

Офлайн-точка нумерует свои документы сама, облако её счётчики не трогает, поэтому номера не пересекаются.
