# Касса: возвраты покупателей на API — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** возврат покупателя облачной точки на API — поиск чека (по номеру, QR или без чека по товару), возврат строк
с суммой «цена минус доля скидки», деньги теми же способами, товар в партию или автосписание брака и истёкшей
партии, журнал возвратов, политика возвратов сети; экраны «Возврат», «Смена», «Настройки», «Списания» `apps/web` на
API.

**Architecture:** миграция `customer-returns` (три таблицы только для добавления, поправки `stock_movements`,
`documents`, `tenant_settings`, `idempotency_keys`). Новый модуль `returns` (только облако) зависит от `pos`,
`inventory`, `catalog`, `audit`, `auth` через их `exports`: `pos` отдаёт проданный чек (`SoldReceipts`), открытую
смену терминала (`PosShifts`), контекст и идемпотентность; `inventory` — `ReturnStock` (движения возврата и
автосписание) и `Numbering`. Обратная связь без циклов — портами, которые объявляет нижний модуль и заполняет
`returns`: `ShiftReturns` (`pos`: итоги возвратов смены) и `CustomerReturnNumbers` (`inventory`: номер возврата у
автосписания), как `TerminalRevocationChecks`. Сумма возврата — одна функция `libs/shared/domain` на сервере и экране.

**Tech Stack:** NestJS 11, Kysely + pg (CamelCasePlugin), node-pg-migrate SQL (только Up), RLS через
`tenantTransaction`; Next.js static export, TanStack Query; Jest (только `libs/shared/domain`).

**Spec:** `docs/superpowers/specs/2026-10-13-customer-returns-design.md` — R1–R8, E1–E19, поправки 2.1, разделы 3–10.

## Global Constraints

- Тесты отложены до MVP: новые автотесты не пишутся, кроме замены примеров `returnRefund` в
  `libs/shared/domain/src/lib/discount.spec.ts` (Задача 2); существующие наборы (`api`, `api:integration`,
  `shared-dto`, `shared-domain`, `web`, `web-e2e`) остаются зелёными. Проверка API и экранов — живая: curl-скрипт в
  рабочей папке плана по образцу `pos_setup.sh` / `m_api_check.sh` (scratchpad сессии) и браузер (`api-web4210` +
  `web-partial-4210`; порты 4200/4201 не трогать).
- Nx на Windows: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx …`, по одному проекту (`--parallel=1`); Jest —
  `--testPathPatterns`.
- Ветка `feature/customer-returns` от main `4201e85`. Коммиты подписываются GPG (pinentry, пароль вводит
  пользователь): таймаут — один повтор, потом спросить; подпись не обходится. Не коммитить `package.json`,
  `apps/web/next-env.d.ts`, `.claude/launch.json`, `.claude/agent-memory/`.
- Деньги — integer дирамы. Сумма строки возврата — только `returnLineRefund` (Задача 2): доля скидки накопительно
  `⌈share × возвращено_всего / продано⌉`, к возврату = количество × цена − доля этого возврата (E6, R1).
- `id` возврата = `Idempotency-Key` = UUIDv7 клиента, область `return` (E1); номер `ВЗ-<код точки>-<год>-<6 цифр>`,
  вид счётчика `customer_return` (E2).
- Возврат — только PIN-сессия привязанного терминала с открытой сменой, онлайн (E3, R5); модуль `returns` — только
  облако (`STORE_MODE !== 'offline'`).
- Порядок блокировок возврата: ключ идемпотентности → открытая смена терминала `FOR SHARE` →
  `pg_advisory_xact_lock` по `id` чека (E19) → партии `FOR UPDATE` по возрастанию id → остатки. Закрытие смены уже
  берёт смену `FOR UPDATE` — возврат либо ждёт, либо видит закрытую.
- Таблицы возвратов — только для добавления: гранты `pharmacy_app` SELECT/INSERT, триггер `forbid_mutation`; гранты
  на `receipts` не расширяются.
- Границы модулей: `returns` не читает таблицы `pos`/`inventory`/`catalog` напрямую — только их `exports`; `pos` и
  `inventory` не импортируют `returns` (порты).
- Коды ошибок — раздел 6 спецификации; данные рецепта — не в логах, аудите и текстах ошибок.

## Review Focus

1. Две кассы одновременно возвращают последнюю штуку одной строки → один возврат принят, второй — 409
   `return_exceeds_sold`; взаимной блокировки нет (Задача 5, два фоновых curl).
2. Возврат одновременно с закрытием смены своего терминала → возврат либо вошёл в Z-отчёт (наличные возврата в
   ожидаемых), либо получил 409 `no_open_shift` / `shift_closed` (Задача 5, два фоновых curl).
3. Строка из 3 упаковок по 10,00 с долей скидки 1,00 возвращается тремя возвратами по одной → доли 0,34 / 0,33 / 0,33,
   снято ровно 1,00, сервер и экран дают одни и те же суммы (Задача 2 — тест, Задача 5 — curl).
4. Смешанная оплата с наличными и сдачей (наличными дано 100,00, сдача 30,00, карта 50,00) → наличными к возврату
   не больше 70,00 минус прежние наличные возвраты; превышение по виду — 400 `refund_exceeds_paid` (Задача 5).
5. Возврат вчерашней продажи из закрытой смены → входит в сегодняшнюю открытую смену терминала (её ожидаемые
   наличные, событие `return`), Z-отчёт вчерашней смены не меняется (Задача 5).

---

### Task 1: Схема возвратов

**Files:**
- Create: `apps/api/migrations/<Date.now()>_customer-returns.sql`
- Modify: `apps/api/src/core/database/table-classes.ts`, `apps/api/src/core/database/db.generated.ts`

**Interfaces:**
- Produces: таблицы `customer_returns`, `customer_return_lines`, `customer_return_refunds`; `stock_movements.kind`
  `customer_return`, `source_type` `customer_return`; `documents.write_off_reason` `customer_return_defect` /
  `customer_return_expired`, `documents.source_customer_return_id`; `tenant_settings.customer_return_otc|rx|controlled`;
  `idempotency_keys.scope` `return`; типы Kysely `CustomerReturns`, `CustomerReturnLines`, `CustomerReturnRefunds`.

- [ ] **Step 0: коммит спецификации и плана** — `docs: customer returns — spec and plan`.
- [ ] **Step 1: миграция** — поправки 2.1 спецификации:
  - `customer_returns` (`tenant_id`, `id`, `store_id`, `shift_id`, `terminal_id`, `cashier_id`, `receipt_id`, `number`,
    `returned_at`, `business_date`, `reason` `customer`/`defect`, `found_without_receipt boolean`,
    `discount_returned_dirams ≥ 0`, `refund_dirams ≥ 0`, `correlation_id`, `created_at`); уникальный
    `(tenant_id, store_id, number)`; FK `(tenant_id, store_id, receipt_id) → receipts (tenant_id, store_id, id)`,
    смена, терминал, кассир;
  - `customer_return_lines` (`id`, `customer_return_id`, `receipt_line_id`, `qty_pieces > 0`, `amount_dirams ≥ 0`,
    `discount_share_dirams ≥ 0`, `check (discount_share_dirams <= amount_dirams)`); уникальный
    `(tenant_id, customer_return_id, receipt_line_id)`;
  - `customer_return_refunds` (`id`, `customer_return_id`, `kind` `cash`/`card`/`qr`/`nfc`, `amount_dirams > 0`);
    уникальный `(tenant_id, customer_return_id, kind)`;
  - индексы раздела 3 и FK-индексы; RLS `tenant_isolation` (как `receipts`); гранты `pharmacy_app` SELECT, INSERT;
    триггеры `forbid_mutation` на UPDATE/DELETE и TRUNCATE (как `shift_cash_operations`);
  - `stock_movements`: пересоздать `stock_movements_kind_check` (+ `customer_return`) и
    `stock_movements_source_type_check` (+ `customer_return`);
  - `documents`: `documents_write_off_reason_check` + две причины; колонка `source_customer_return_id uuid` с FK на
    `customer_returns (tenant_id, id)`, индексом и `check (source_customer_return_id is null or type = 'write_off')`;
  - `tenant_settings`: `customer_return_otc boolean not null default true`, `customer_return_rx boolean not null
    default false`, `customer_return_controlled boolean not null default false`;
  - `idempotency_keys`: пересоздать `check` области (+ `return`).
- [ ] **Step 2: манифест** — три таблицы класса `tenant` (только добавление) в `table-classes.ts`.
- [ ] **Step 3: применить и перегенерировать** — `npx nx run api:migrate`, `npx nx run api:db-types`.
  Expected: миграция применена, в `db.generated.ts` появились три таблицы и новые колонки.
- [ ] **Step 4: проверка** — `npx nx run api:integration` (манифест классов и RLS сверяет `catalog.int-spec`).
  Expected: все наборы зелёные.
- [ ] **Step 5: коммит** — `feat(api): customer returns schema`.

### Task 2: Контракт, правило суммы и web на моках

**Files:**
- Modify: `libs/shared/domain/src/lib/discount.ts`, `libs/shared/domain/src/lib/discount.spec.ts`,
  `libs/shared/dto/src/lib/tenant-pos.ts`, `libs/shared/dto/src/lib/tenant-inventory.ts`,
  `libs/shared/dto/src/lib/tenant-owner.ts`, `apps/api/src/app/pos/shift-mapper.ts` (только нули нового поля),
  `apps/web/src/shared/api/routes.ts`, `apps/web/src/pages/returns/lib/refund.ts`,
  `apps/web/src/pages/returns/ui/ReturnsPage.tsx`, `apps/web/src/pages/owner/settings/ui/SettingsPage.tsx`,
  `apps/web/src/pages/shift/ui/ShiftDialogs.tsx`, `apps/web/src/pages/shift/lib/z-report.ts`,
  `apps/web/src/pages/write-offs/ui/WriteOffEditor.tsx` (и список списаний, если показывает причину),
  `apps/web/src/shared/api/mocks/{handlers-pos,db-pos,handlers-owner,db-owner,handlers-stock,db-stock}.ts`,
  `apps/web/src/shared/i18n/messages/{ru,tg}/{returns,core,stock,pos}.json` (ключи по месту),
  `apps/web-e2e/src/support/fake-api.ts`, спеки web, которые ломает контракт.

**Interfaces:**
- Produces (`libs/shared/domain`, заменяет `returnRefund` / `ReturnRefundInput` / `ReturnRefund`):

```ts
export interface ReturnLineRefundInput {
  soldQuantity: number;        // in the sale unit of the line
  unitPriceMinor: number;
  discountShareMinor: number;  // the discount share of the whole line
  returnedQuantity: number;    // by earlier returns
  quantity: number;            // returned now, 1..soldQuantity − returnedQuantity
}
export interface ReturnLineRefund { amountMinor: number; discountMinor: number; refundMinor: number }
export function returnLineRefund(input: ReturnLineRefundInput): ReturnLineRefund;
export function returnRefundTotal(lines: readonly ReturnLineRefundInput[]): ReturnLineRefund; // Σ of the lines
```

- Produces (`libs/shared/dto`) — раздел 5 спецификации:
  - `ReturnableReceipt` = `{ id, number, soldAt, storeName, cashierName, daysLeft, subtotalMinor, discountMinor,
    payments: ReceiptPayment[] /* refundable left by kind */, lines: ReturnableLine[] }`;
  - `ReturnableLine` + `discountShareMinor: number`, `kind: PrescriptionKind`, `customerReturnAllowed: boolean`,
    `batchExpired: boolean`;
  - `CreateReturnRequest` + `foundProductId: string | null`; `CreatedReturn` + `writeOffNumber: string | null`;
  - `SaleSearchItem` + `productId`;
  - `ReturnListItem`: без `method`, + `methods: ReceiptPaymentMethod[]`, `foundWithoutReceipt: boolean`,
    `writeOffId: string | null`, `writeOffNumber: string | null` (`writeOffId` — для ссылки, раздел 7);
  - `ReturnPolicy` = `{ returnWindowDays: number; customerReturns: Record<PrescriptionKind, boolean> }`;
  - `Shift` + `returnsByMethod: Record<ReceiptPaymentMethod, PaymentTotal>`;
  - `WriteOffReason` + `'customer_return_defect' | 'customer_return_expired'`; `WriteOff` и строка списка
    списаний + `customerReturnId: string | null`, `customerReturnNumber: string | null`;
  - `NetworkSettings` без `returnWindowDays`;
  - маршруты web: `receipts.returnable` с query `{ number?: string; id?: string; productId?: string }`,
    `settings.returns` (`GET /settings/returns` → `ReturnPolicy`), `settings.updateReturns` (`PUT`, тело и ответ
    `ReturnPolicy`).

- [ ] **Step 1: тесты правила (RED)** — в `discount.spec.ts` блок `returnRefund` заменить на `returnLineRefund`:
  - `refunds the price less the discount share of the returned goods (R1)`: `{ soldQuantity: 1, unitPriceMinor:
    3000, discountShareMinor: 150, returnedQuantity: 0, quantity: 1 }` → `{ amountMinor: 3000, discountMinor: 150,
    refundMinor: 2850 }`;
  - `takes exactly the line share over partial returns`: `soldQuantity 3, unitPriceMinor 1000, discountShareMinor
    100`, возвраты по 1 при `returnedQuantity` 0, 1, 2 → `discountMinor` 34, 33, 33; `refundMinor` 966, 967, 967;
  - `rounds the refund down, in favour of the pharmacy`: то же, `quantity 2`, `returnedQuantity 0` →
    `{ discountMinor: 67, refundMinor: 1933 }`;
  - `sums the lines of a return`: `returnRefundTotal` двух строк выше (R1 и `quantity 2`) → `{ amountMinor: 5000,
    discountMinor: 217, refundMinor: 4783 }`;
  - `has no discount without a share`: `discountShareMinor 0` → `discountMinor 0`, `refundMinor = amountMinor`.
- [ ] **Step 2: запуск** — `npx nx test shared-domain --testPathPatterns=discount`. Expected: FAIL —
  `returnLineRefund` не экспортирована.
- [ ] **Step 3: функции** — `returnLineRefund`, `returnRefundTotal` в `discount.ts` по формуле Global Constraints;
  `returnRefund` и его типы удалить.
- [ ] **Step 4: запуск** — та же команда. Expected: PASS.
- [ ] **Step 5: контракт** — типы и JSDoc маршрутов (коды раздела 6) в `libs/shared/dto`; в `shift-mapper.ts` —
  `returnsByMethod` из нулей (наполнит Задача 3), чтобы `api` собирался.
- [ ] **Step 6: web на моках:**
  - `refund.ts`: `refundOf(receipt, quantities)` → `returnRefundTotal` по выбранным строкам;
    `refundPayments(refundable, refundMinor)` — по порядку `cash` → `card` → `qr` → `nfc`, не больше остатка вида;
  - `ReturnsPage`: при причине `customer` строки с `customerReturnAllowed = false` недоступны с подсказкой «Возврат по
    желанию покупателя для этого вида товара не принимается»; строки, которые будут списаны (`defect` — все,
    `batchExpired`), с пометкой «будет списан»; предупреждение, если наличных к возврату больше
    `shift.cash.expectedMinor`; продажа из поиска открывается `receipts.returnable` с `{ id, productId }` и
    отправляется с `foundProductId`; сканер: код вида UUID → `id`, иначе `number`; ключ возврата создаётся один раз
    на выбранный чек (state/ref) и повторяется после сетевой ошибки, сбрасывается после успеха или смены чека;
    сообщение `return_window_expired` — без константы `RETURN_WINDOW_DAYS`: срок из `settings.returnWindowDays`
    снимка каталога кассы, без снимка — текст без числа; после успеха — номер ВЗ и номер списания;
  - журнал возвратов: способы списком, пометка «без чека», номер списания — ссылкой на экран списания по
    `writeOffId`;
  - «Настройки сети»: поле срока возврата уходит из формы `NetworkSettings` в блок «Возвраты» (срок 0–365 и три
    переключателя «принимать по желанию покупателя: без рецепта / рецептурные / ПКУ») на `settings.returns` /
    `settings.updateReturns`;
  - «Смена»: в окне закрытия колонка «по системе» и разница терминала = `byMethod − returnsByMethod` вида; печатный
    Z-отчёт — строки способов и строка возвратов как сейчас, сверка терминала — по чистой сумме;
  - «Списания»: причины `customer_return_*` — подписи RU/TJ, в ручном выборе их нет; списание с
    `customerReturnId` — только чтение с текстом «Списано по возврату покупателя ВЗ-…» (как недостача перемещения);
  - моки: политика сети в `db-owner` (по умолчанию `none: true, rx: false, controlled: false`) и обработчики
    `settings.returns*`; `handlers-pos` — правило R1/E6 через `returnLineRefund`, политика, R8 (`productId`), остатки
    оплат по видам, `returnsByMethod` смены, автосписание брака и истёкшей партии в `db-stock` с причиной и ссылкой;
    `fake-api.ts` web-e2e — `returnsByMethod` в сменах.
- [ ] **Step 7: проверка** — `npx nx run-many -t lint test --parallel=1 -p shared-domain shared-dto web`,
  `npx nx fsd web`, `npx nx run-many -t build lint --parallel=1 -p api`. Expected: всё зелёное (спеки web,
  сломанные контрактом, адаптированы, не удалены).
- [ ] **Step 8: коммиты** — `feat(dto): customer returns — refund by the discount share, return policy, returns by
  payment kind` (libs + `shift-mapper.ts`), `feat(web): customer returns on the mocks — refund rule, return policy,
  write-off of defects` (web, web-e2e).

### Task 3: Касса — проданный чек, открытая смена и возвраты в смене

**Files:**
- Create: `apps/api/src/app/pos/shift-returns.ts`, `apps/api/src/app/pos/sold-receipts.ts`,
  `apps/api/src/app/pos/pos-shifts.ts`
- Modify: `apps/api/src/app/pos/idempotency.ts`, `apps/api/src/app/pos/shift-mapper.ts`,
  `apps/api/src/app/pos/shifts.service.ts` (`terminalDiff`), `apps/api/src/app/pos/pos.module.ts`

**Interfaces:**
- Consumes: `Shift.returnsByMethod` (Задача 2).
- Produces:

```ts
// idempotency.ts
export type PosScope = 'receipt' | 'shift.open' | 'shift.cash' | 'shift.close' | 'return';

// shift-returns.ts — a port the returns module fills (no pos → returns dependency)
export interface ShiftReturnTotals {
  count: number;
  amountDirams: number;
  byKind: Map<ReceiptPaymentMethod, { count: number; amountDirams: number }>;
  events: ShiftEventRow[];   // kind 'return', reference = ВЗ number, amountDirams negative
}
export type ShiftReturnsSource = (trx: TenantTransaction, tenantId: string, shiftId: string) => Promise<ShiftReturnTotals>;
@Injectable() export class ShiftReturns {
  register(source: ShiftReturnsSource): void;
  totals(trx: TenantTransaction, tenantId: string, shiftId: string): Promise<ShiftReturnTotals>; // zeros when none
}

// sold-receipts.ts
export interface SoldLine {
  id: string; lineNo: number; productId: string; batchId: string;
  saleUnit: 'pack' | 'piece'; piecesPerPack: number; qtyPieces: number;
  unitPriceDirams: number; lineAmountDirams: number; discountShareDirams: number;
  controlled: boolean;       // a controlled_sale_records row exists
}
export interface SoldReceipt {
  id: string; storeId: string; number: string; soldAt: Date; businessDate: string;
  cashierName: string; subtotalDirams: number; discountDirams: number;
  paidByKind: Map<ReceiptPaymentMethod, number>;   // cash — net of change
  lines: SoldLine[];
}
export interface SoldProductLine {
  receiptId: string; receiptNumber: string; soldAt: Date; productId: string;
  saleUnit: 'pack' | 'piece'; quantity: number; amountDirams: number;
}
@Injectable() export class SoldReceipts {
  find(trx: TenantTransaction, tenantId: string, storeId: string, by: { id: string } | { number: string }): Promise<SoldReceipt | null>;
  salesOfProducts(trx: TenantTransaction, tenantId: string, storeId: string, businessDate: string, productIds: readonly string[], limit: number): Promise<SoldProductLine[]>; // newest first
}

// pos-shifts.ts
@Injectable() export class PosShifts {
  /** The open shift of the terminal, locked FOR SHARE (a closing waits or is seen); null — none. */
  lockOpenShiftOfTerminal(trx: TenantTransaction, tenantId: string, terminalId: string): Promise<{ id: string; storeId: string } | null>;
}
```

  `PosModule.exports`: `[PosContext, PosIdempotency, ShiftReturns, SoldReceipts, PosShifts]`.

- [ ] **Step 1: порт и читатели** — файлы выше; `SoldReceipts.find` — чек точки с строками по `line_no`, оплатами
  (наличные − `change_dirams`) и признаком записи ПКУ; `salesOfProducts` — строки чеков точки за бизнес-дату по
  товарам; `PosShifts` — через `ShiftsRepository.openShiftOfTerminal` + `lockShift(…, 'share')`, статус `open`.
- [ ] **Step 2: смена с возвратами** — `ShiftMapper.view` берёт `ShiftReturns.totals`: `returns` = число и сумма,
  `returnsByMethod` по видам, `cash.returnsMinor` = наличные возвратов, `expectedMinor` − наличные возвратов,
  `revenueMinor` = продажи − возвраты, события возвратов в журнал; закрытие: `terminalDiff` = введённое −
  (`byMethod` − `returnsByMethod`) вида (E13).
- [ ] **Step 3: проверка** — `npx nx run-many -t build lint --parallel=1 -p api`; curl (сервер `api-web4210`):
  открытие смены, продажа, `GET /shifts/current`, закрытие. Expected: суммы смены и Z-отчёта как до изменений,
  `returns` и `returnsByMethod` — нули.
- [ ] **Step 4: коммит** — `feat(api): POS exports for returns — sold receipts, open shift, returns in the shift`.

### Task 4: Склад — товар возврата и автосписание

**Files:**
- Create: `apps/api/src/app/inventory/return-stock.ts`, `apps/api/src/app/inventory/customer-return-numbers.ts`
- Modify: `apps/api/src/app/inventory/numbering.ts`, `apps/api/src/app/inventory/documents.repository.ts`,
  `apps/api/src/app/inventory/write-offs.service.ts`, `apps/api/src/app/inventory/dto/write-offs.dto.ts` (если
  нужно для типов), `apps/api/src/app/inventory/inventory.module.ts`

**Interfaces:**
- Produces:

```ts
// numbering.ts: NumberedKind + 'customer_return', PREFIX.customer_return = 'ВЗ'
// documents.repository.ts: insertMovements sourceType + 'customer_return';
//   insertDocument values + sourceCustomerReturnId?: string | null; DocumentRow + sourceCustomerReturnId

// return-stock.ts
export interface ReturnedBatchLine {
  lineId: string;            // customer_return_lines.id — source_line_id of the movements
  batchId: string; productId: string; qtyPieces: number; unit: 'pack' | 'piece';
  writeOff: boolean;         // defect, or the batch expired (E9)
}
export interface ReturnStockInput {
  tenantId: string; storeId: string; employeeId: string; businessDate: string;
  customerReturnId: string; customerReturnNumber: string;
  writeOffReason: 'customer_return_defect' | 'customer_return_expired';
  lines: readonly ReturnedBatchLine[];
}
@Injectable() export class ReturnStock {
  /** Lot number and expiry of the batches of the store. */
  batches(trx: TenantTransaction, tenantId: string, storeId: string, batchIds: readonly string[]): Promise<Map<string, { lotNumber: string | null; expiryDate: string }>>;
  /** The store for a return dated `businessDate`: 422 `period_closed` in the closed period (E11). */
  storeForReturn(trx: TenantTransaction, tenantId: string, storeId: string, businessDate: string): Promise<{ id: string; code: string }>;
  /** `customer_return` movements, then one posted write-off of the `writeOff` lines (E9). */
  receive(trx: TenantTransaction, input: ReturnStockInput): Promise<{ writeOffId: string | null; writeOffNumber: string | null }>;
}

// customer-return-numbers.ts — a port the returns module fills
export type CustomerReturnNumbersLookup = (trx: TenantTransaction, tenantId: string, ids: readonly string[]) => Promise<Map<string, string>>;
@Injectable() export class CustomerReturnNumbers {
  register(lookup: CustomerReturnNumbersLookup): void;
  numbers(trx: TenantTransaction, tenantId: string, ids: readonly string[]): Promise<Map<string, string>>; // empty when none
}
```

  `InventoryModule.exports`: `[Numbering, PosStock, ReturnStock, CustomerReturnNumbers]`.

- [ ] **Step 1: `ReturnStock`** — `storeForReturn` через `InventoryRepository.store` и `checkDocumentDate(…,
  { backdating: false })`; `receive`: партии `FOR UPDATE` по возрастанию id (`DocumentsRepository.lockBatches`),
  движения `customer_return` (+штуки, `source_type 'customer_return'`, `source_id` = возврат, `source_line_id` =
  строка возврата, бизнес-дата возврата); если есть строки `writeOff` — по образцу
  `TransferPosting.writeOffShortage`: номер СП, документ `write_off` с `writeOffReason` и
  `sourceCustomerReturnId`, комментарий = номер возврата, строки через `WriteOffsRepository.replaceLines`, движения
  `write_off` (−штуки), `markPosted`, аудит `document.posted` (`reason`, `customerReturn`). Заморозка
  инвентаризации и проверка минуса не применяются (E10).
- [ ] **Step 2: списания** — `notFromTransfer` дополняется: `sourceCustomerReturnId` не `null` → 409
  `write_off_from_return` (правка, проведение, отмена, удаление); `WRITE_OFF_REASONS` ручного списания без
  `customer_return_*`; `WriteOff` и строка списка: `customerReturnId` = `sourceCustomerReturnId`,
  `customerReturnNumber` — через `CustomerReturnNumbers.numbers`.
- [ ] **Step 3: проверка** — `npx nx run-many -t build lint --parallel=1 -p api`; curl: ручное списание создаётся и
  проводится как раньше, причина `customer_return_defect` в ручном списании — 400.
- [ ] **Step 4: коммит** — `feat(api): stock of customer returns — back to the batch, write-off of defects and
  expired batches`.

### Task 5: Модуль возвратов

**Files:**
- Create: `apps/api/src/app/returns/{returns.repository.ts, return-policy.service.ts, return-policy.controller.ts,
  returnable.service.ts, returns.service.ts, returns.controller.ts, returnable.controller.ts, dto/returns.dto.ts}`
- Modify: `apps/api/src/app/returns/returns.module.ts`, `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `PosContext`, `PosIdempotency` (`'return'`), `ShiftReturns`, `SoldReceipts`, `PosShifts` (Задача 3);
  `ReturnStock`, `CustomerReturnNumbers`, `Numbering` (Задача 4); `ProductsReader.listForPos` (вид `prescription`,
  название) и `ProductsReader.searchIds` (`catalog`); `AuditService`; `returnLineRefund`, `returnRefundTotal`
  (Задача 2).
- Produces: маршруты раздела 4.1 спецификации; `ReturnsRepository` регистрирует источник `ShiftReturns` и поиск
  `CustomerReturnNumbers` в `onModuleInit`.

- [ ] **Step 1: DTO и репозиторий** — `CreateReturnDto` (наследует `PosOperationContextDto`; `receiptId`, `shiftId`
  UUID; `lines` 1–100 `{ lineId UUID, quantity int ≥ 1 }`; `reason` `customer`/`defect`; `refunds` 1–4
  `ReceiptPaymentDto`; `refundMinor` int ≥ 0; `foundProductId` UUID или `null`), `ReturnableQueryDto`
  (`number` | `id`, `productId?`), `SalesSearchQueryDto` (`query` ≥ 2, `date` YYYY-MM-DD), `ReturnListQueryDto`
  (`storeId?`, `reason?`, limit/offset), `ReturnPolicyDto` (`returnWindowDays` 0–365, три boolean).
  `ReturnsRepository`: политика и срок (`tenant_settings`), бизнес-дата «сегодня» в часовом поясе сети, уже
  возвращённое по строкам чека (штуки) и по видам оплаты, вставка возврата, строк и способов, журнал, итоги смены
  для `ShiftReturns`, номера для `CustomerReturnNumbers`.
- [ ] **Step 2: настройки** — `GET/PUT /settings/returns` (`settings:view` / `settings:update`), аудит
  `settings.returns-updated` со старым и новым значением.
- [ ] **Step 3: чек для возврата и поиск** — `GET /receipts/returnable` (`returns:create`; с `productId` —
  ещё `returns:without-receipt`): `SoldReceipts.find` по точке сессии (охват `PosContext.inScope`), 404, срок E4
  (422 `return_window_expired`), строки (с `productId` — только этого товара, R8) с количеством в единице продажи,
  возвращённым, долей скидки, видом (E8), `customerReturnAllowed`, `batchExpired` (`expiryDate` < сегодня), номером
  партии; `payments` — остаток к возврату по виду (E7); `daysLeft`. `GET /returns/sales-search`
  (`returns:without-receipt`): `searchIds` → `salesOfProducts` за `date` своей точки, в пределах срока, ≤ 50.
- [ ] **Step 4: возврат** — `POST /returns` (`returns:create`), по шагам 4.3 спецификации и порядку блокировок
  Global Constraints: `PosIdempotency.replay` до проверок сессии (повтор после закрытия смены — первый ответ),
  `checkHeader`, `terminalSession` и совпадение `storeId`/`terminalId`/`employeeId` (409 `wrong_terminal`),
  `PosContext.cloudStore`, `PosIdempotency.run(…, 'return', …, 201)`; `PosShifts.lockOpenShiftOfTerminal` и
  `shiftId` (409 `no_open_shift`); `pg_advisory_xact_lock` по `id` чека; чек, срок, строки (400 `unknown_line` /
  `duplicate`, 409 `return_exceeds_sold` с `errors[]`; количество — в единице продажи строки, штуки = количество ×
  `piecesPerPack` строки у упаковок, E5), `foundProductId` (право, R8 `other_product`), политика и
  `pos:sell-controlled` (E8), сумма через `returnLineRefund` (400 `total_mismatch`), способы E7 (400
  `refund_exceeds_paid` / `unknown_method` / `total_mismatch` на `refunds`), `ReturnStock.storeForReturn`, номер
  ВЗ, вставки, `ReturnStock.receive` (`writeOff` — причина `defect` или истёкшая партия; причина автосписания
  `customer_return_defect` при `defect`, иначе `customer_return_expired`), аудит `return.completed`. Ответ 201
  `CreatedReturn`.
- [ ] **Step 5: журнал** — `GET /returns` (`returns:view`): точки охвата (PIN — своя), фильтры, новые первыми;
  `summary` = название товара первой строки и ` +N` при нескольких строках; способы, кассир, «без чека», списание.
- [ ] **Step 6: модуль** — `ReturnsModule` импортирует `AuditModule`, `AuthModule`, `CatalogModule`,
  `InventoryModule`, `PosModule`; в `app.module.ts` — `ConditionalModule.registerWhen(ReturnsModule, env =>
  env.STORE_MODE !== 'offline')` с комментарием, как у `PosModule`.
- [ ] **Step 7: сборка** — `npx nx run-many -t build lint --parallel=1 -p api`. Expected: зелёное.
- [ ] **Step 8: живая проверка** — curl-скрипт `rt_check.sh` в рабочей папке плана, все пункты раздела 10
  спецификации (curl) и Review Focus 1–5 (параллельные — фоновыми curl). Expected: каждый пункт — ожидаемый
  статус и суммы; повтор с тем же ключом — тот же номер ВЗ.
- [ ] **Step 9: регрессия** — `npx nx run api:integration`. Expected: зелёное.
- [ ] **Step 10: коммит** — `feat(api): customer returns — lookup, search without a receipt, return, journal, return
  policy`.

### Task 6: Web на API

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES`), `apps/web/src/shared/api/error-message.ts`,
  `apps/web/src/shared/i18n/messages/{ru,tg}/*.json` (тексты кодов)

**Interfaces:**
- Consumes: маршруты Задачи 5, контракт Задачи 2.

- [ ] **Step 1: маршруты** — в `REAL_API_ROUTES`: `receipts.returnable`, `returns.salesSearch`, `returns.create`,
  `returns.list`, `settings.returns`, `settings.updateReturns`.
- [ ] **Step 2: тексты кодов** — `return_window_expired`, `return_not_allowed` (вид закрыт / `other_product`),
  `return_exceeds_sold`, `refund_exceeds_paid`, `write_off_from_return`, `period_closed`, `no_open_shift`,
  `wrong_terminal` — понятным текстом RU/TJ.
- [ ] **Step 3: браузер (`partial`)** — сценарии раздела 10 спецификации (браузер): вход по PIN → смена → продажа со
  скидкой → возврат части по номеру чека → сумма и ВЗ → смена с возвратом и ожидаемыми наличными; возврат брака →
  списание на экране списаний только для чтения; поиск без чека у заведующего (только строки найденного товара);
  переключатели политики в настройках меняют доступность строк. Expected: как в спецификации, консоль без ошибок.
- [ ] **Step 4: проверка** — `npx nx run-many -t lint test --parallel=1 -p web`, `npx nx fsd web`,
  `npx nx e2e web-e2e`. Expected: зелёное.
- [ ] **Step 5: коммит** — `feat(web): customer returns on the API`.

### Task 7: Документы

**Files:**
- Modify: `docs/architecture/data-model/04-pos.md`, `03-batches-warehouse.md`, `06-sync-audit-billing.md`,
  `01-platform-org.md`, `docs/architecture/APPROVAL.md`, `CLAUDE.md`,
  `docs/superpowers/specs/2026-10-13-customer-returns-design.md` (статус)

- [ ] **Step 1: модель данных** — `04`: раздел `customer_returns` по поправкам 2.1 (п. 1–4) с пометкой «Введено
  миграцией `customer-returns`», правило суммы E6 и автосписание брака R2; `03`: движение и источник
  `customer_return`, системные причины списания, `source_customer_return_id`; `06`: область `return`; `01`: три поля
  политики в `tenant_settings`.
- [ ] **Step 2: APPROVAL.md** — строка 2026-10-13: спецификация возвратов покупателей и поправки модели 2.1 утверждены
  архитектором. Статус спецификации — «утверждена архитектором 2026-10-13».
- [ ] **Step 3: CLAUDE.md** — `web:dev-api`: «…, касса и смена, возвраты покупателей»; офлайн-точка: модули
  `stores`, …, `pos`, `returns` — только облако; граф модулей: `pos` ← `returns`, `inventory` ← `returns`
  (`SoldReceipts`, `PosShifts`, `ReturnStock`; порты `ShiftReturns`, `CustomerReturnNumbers`).
- [ ] **Step 4: коммит** — `docs: customer returns — data model, approval, CLAUDE.md`.
