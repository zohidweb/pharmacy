# Закупки (PR-2) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** оплаты поставщикам с распределением и предоплатой, заказы поставщику со статусами по приходам и
«заполнить по дефициту» — по API; экраны «Поставщики» (оплата) и «Заказы поставщикам» работают с API.

**Architecture:** миграция `purchasing` (оплаты, распределения, заказы, связь прихода с заказом). Модуль
`purchasing` получает оплаты, заказы и экспорт `OrderReceiving`; `inventory` вызывает его при проведении и отмене
прихода и отдаёт дефицит. Строится на слитом PR-1 (`2026-10-09-inventory-core.md`).

**Tech Stack:** как в PR-1.

**Spec:** `docs/superpowers/specs/2026-10-09-inventory-purchasing-design.md` — разделы 3.2, 4.1 (шаг 7 и отмена —
части PR-2), 4.2 (дефицит), 5.2, 5.3, 6–8 (части PR-2), 11.

## Global Constraints

- Все Global Constraints PR-1 в силе.
- Оплата — финансовая операция: `id` (UUIDv7 клиента) — первичный ключ `supplier_payments` и ключ
  идемпотентности; повтор с тем же телом (поставщик, юрлицо, сумма, дата, способ) → тот же ответ, иначе 409
  `idempotency_conflict`; correlation ID — из контекста запроса в аудите.
- Распределение: проведённые приходы «поставщик × юрлицо» с остатком > 0, по `payment_due_date` (пустой — в
  конец), затем `document_date`, затем `number`; остаток оплаты — предоплата; проведённый приход сначала забирает
  предоплаты этого «поставщик × юрлицо» (старые оплаты первыми); отмена прихода удаляет его распределения.
- Заказ: правка только в `draft` (иначе 409 `order_not_editable`); номер `ЗК-<код точки>-<год>-<6 цифр>`, счётчик
  `purchase_order`; статус после приходов — `orderStatusAfterReceipt`.
- Аудит: `supplier.payment`, `payment.allocations_released`, `purchase_order.created`, `purchase_order.updated`,
  `purchase_order.confirmed`.

## Review Focus

1. Два одновременных `POST /suppliers/{id}/payments` с одним `id` → одна оплата, оба ответа одинаковы (Задача 3,
   curl двумя фоновыми запросами; конфликт ключа ловится уникальностью, не 500).
2. Оплата больше долга → предоплата; следующий проведённый приход этого юрлица забирает её, долг = приход −
   предоплата (Задача 3, curl).
3. Отмена проведения оплаченного прихода → распределения сняты, оплата снова предоплата, долг по журналу верный
   (Задача 3, curl).
4. Приход по заказу другого поставщика или точки, по черновику заказа → 422 у `orderId` (Задача 4, curl).
5. Отмена прихода по заказу возвращает статус заказа (`closed` → `partially_received` / `confirmed`) (Задача 4).

---

### Task 1: Схема закупок

**Files:**
- Create: `apps/api/migrations/<Date.now()>_purchasing.sql`
- Modify: `table-classes.ts`, `db.generated.ts`

- [ ] **Step 1: миграция** — раздел 3.2 спецификации (RLS, политики, гранты; индексы `(tenant_id, supplier_id,
  legal_entity_id)` у оплат, `(tenant_id, goods_receipt_document_id)` у распределений, `(tenant_id, store_id,
  status)` у заказов, `(tenant_id, purchase_order_id)` у документов).
- [ ] **Step 2: проверка.** `npx nx run api:migrate && npx nx run api:db-types && npx nx run api:integration` —
  зелёное.
- [ ] **Step 3: коммит** `feat(api): purchasing schema`.

### Task 2: Контракт и моки

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-purchasing.ts` (`SupplierPaymentRequest.legalEntityId?: string`),
  `apps/web/src/shared/api/mocks/handlers-purchasing.ts` (предоплата вместо `above_debt`, юрлицо)

- [ ] **Step 1: контракт и моки.**
- [ ] **Step 2: проверка.** `npx tsc -b libs/shared/domain libs/shared/dto && npx tsc --noEmit -p
  apps/web/tsconfig.json && npx nx run-many -t lint test --parallel=1 -p shared-dto web` — зелёное.
- [ ] **Step 3: коммит** `feat(dto): supplier payment with a legal entity`.

### Task 3: Оплаты и распределение

**Files:**
- Create: `apps/api/src/app/purchasing/{payments.service, allocation}.ts`
- Modify: `suppliers.controller.ts` (`POST /suppliers/{id}/payments`), `supplier-ledger.ts`, `purchasing.repository.ts`,
  `suppliers.service.ts` (долг и журнал с оплатами), `dto/purchasing.dto.ts`

**Interfaces:**
- Produces: `SupplierLedger.receiptPosted` дополнительно распределяет предоплаты на приход;
  `SupplierLedger.receiptUnposted` дополнительно снимает распределения прихода (аудит
  `payment.allocations_released`). Сигнатуры PR-1 не меняются.

- [ ] **Step 1: DTO** — раздел 5.2 (сумма 1–10¹⁰, дата не в будущем, `method` `cash`/`bank`, комментарий ≤ 500).
- [ ] **Step 2: оплата** — юрлицо (обязательно при нескольких активных, иначе единственное; чужое → 404),
  идемпотентность (`insert … on conflict (tenant_id, id) do nothing` + сравнение тела), запись `payment`,
  распределение, аудит; ответ — `SupplierLedgerEntry` оплаты (как в моках).
- [ ] **Step 3: долг и карточка** — остаток прихода = сумма − распределения; журнал с оплатами.
- [ ] **Step 4: проверка.** curl по 11 (PR-2, оплаты) + Review Focus 1–3;
  `npx nx run-many -t build typecheck lint -p api --parallel=1`.
- [ ] **Step 5: коммит** `feat(api): supplier payments with allocation and prepayment`.

### Task 4: Заказы и дефицит

**Files:**
- Create: `apps/api/src/app/purchasing/{purchase-orders.service, purchase-orders.controller, order-receiving}.ts`
- Create: `apps/api/src/app/inventory/deficit.controller.ts` (+ метод в `stock.service.ts`)
- Modify: `apps/api/src/app/inventory/{goods-receipts.service, posting}.ts` (заказ в приходе), `purchasing.module.ts`
  (`exports` + `OrderReceiving`)

**Interfaces:**
- Produces:
  ```ts
  class OrderReceiving {
    /** 422 validation_failed at orderId unless confirmed/partially_received with the same supplier and store. */
    linesFor(trx: TenantTransaction, tenantId: string, orderId: string, supplierId: string, storeId: string):
      Promise<Map<string /* productId */, { lineId: string; pricePerPackDirams: number }>>;
    refreshStatus(trx: TenantTransaction, tenantId: string, orderId: string): Promise<void>;
  }
  ```
- Consumes (`inventory`): `linesFor` при сохранении черновика прихода с `orderId`; `refreshStatus` после
  проведения и отмены.

- [ ] **Step 1: заказы** — маршруты 5.3; KPI по статусам; `open` для прихода; аудит.
- [ ] **Step 2: приход по заказу** — `documents.purchase_order_id`, `purchase_order_line_id` и цена заказа в
  строках; `orderNumber`, `orderPriceMinor` в ответах прихода.
- [ ] **Step 3: дефицит** — раздел 4.2 (`deficitQuantity`, движения `sale` за 30 дней по бизнес-дате, цена).
- [ ] **Step 4: проверка.** curl по 11 (PR-2, заказы) + Review Focus 4–5;
  `npx nx run-many -t build typecheck lint -p api --parallel=1`.
- [ ] **Step 5: коммит** `feat(api): purchase orders, receipts by order, deficit`.

### Task 5: Web — закупки на API

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES` + `purchaseOrders.*`, `suppliers.pay`),
  `pages/suppliers/ui/SupplierDialogs.tsx` (юрлицо при нескольких, без запрета «больше долга»),
  `pages/orders/ui/*.tsx`, редактор прихода (заказ), i18n `ru`/`tg`

- [ ] **Step 1: маршруты и экраны.**
- [ ] **Step 2: проверка.** Браузер: оплата (повтор не дублирует), заказ → подтверждение → приход по заказу →
  статус; дефицит. `npx nx run-many -t build && npx nx run-many -t typecheck lint test fsd --parallel=1 -p web`,
  `npx nx e2e web-e2e` — зелёные.
- [ ] **Step 3: коммит** `feat(web): supplier payments and purchase orders on the API`.

### Task 6: Документы

- [ ] **Step 1: правки** — модель `05` (введено миграцией `purchasing`, юрлицо оплаты, порядок распределения),
  CLAUDE.md (`web:dev-api`).
- [ ] **Step 2: коммит** `docs: purchasing — data model, CLAUDE.md`.
