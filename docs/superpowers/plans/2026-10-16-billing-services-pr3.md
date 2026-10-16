# Биллинг и услуги, PR 3: владелец и печать — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** владелец видит в кабинете оценку текущего месяца, долг, аванс, скидки и свои счета и печатает счёт. Оператор печатает счёт из админки. Владелец получает уведомление о просроченном счёте.

**Architecture:**
- Миграции нет. Всё читается из таблиц PR 1 и PR 2:
  - сеть читает свои `invoices`, `invoice_lines`, `tenant_discounts` и свою строку `tenants`;
  - `platform_settings` — класс shared;
  - вид уведомления `invoice_overdue` уже есть в CHECK.
- Тенантский модуль `app/billing`:
  - маршруты владельца `GET billing` и `GET billing/invoices/{id}` (`billing:view`);
  - порт `OverdueInvoices` для уведомлений (`billing` ← `notifications`).
- Оценка текущего месяца (A19) считается функцией `composeInvoice` из `libs/shared/domain`, как счёт, по продажам с 1-го числа по сегодня. Ничего не пишет.
- Печать:
  - общий лист счёта `InvoiceSheet` и корень печати `SheetPrint` в `libs/ui`, A4 — именованной страницей `@page`;
  - страницы `/billing/invoice?id=` в админке и `/stores/invoice?id=` в кабинете.

**Tech Stack:** NestJS 11, Kysely + pg (RLS, `tenantTransaction`); Next.js static export, TanStack Query, use-intl, `@pharmacy/ui`; Jest.

**Spec:** `docs/superpowers/specs/2026-10-15-billing-services-design.md`. Разделы:
- PR 3 по разделу 13;
- B3, B11, B12, B16; A4, A5, A8, A16, A17 (`invoice_overdue`), A19;
- 6.2 (`GET billing`, `GET billing/invoices/{id}`); 7 (`TenantBilling`, `NotificationKind`);
- 8 (печать в админке), 9 («Оплата», печать, уведомления); 14 (`CLAUDE.md`); 15.

## Global Constraints

**Тесты.**
- Новых автотестов нет: правило проекта «тесты до MVP». Долг перечисляется в описании PR.
- Существующие наборы остаются зелёными: `api`, `admin`, `web`, `shared-dto`, `shared-domain`, `ui`. Тесты, проверяющие прежний контракт, переводятся на новый.
- API проверяется сквозным скриптом на временной базе (Задача 7), экраны — временными экранными тестами (не в PR).

**База.**
- Миграций нет. Если исполнитель решит, что миграция нужна, — сначала ruling, номер больше всех найденных (правило PR 2).
- Миграции не применять к общим базам `pharmacy` и `pharmacy_test`; `api:integration` не запускать.
- Временная база `pharmacy_billing_check` — как в PR 2 (лаунчер scratchpad, скрипт `billing_seed.mjs` для чеков за прошлые месяцы).

**Окружение и git.**
- Только worktree `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/billing-owner` без upstream.
- Коммиты — `git commit --no-gpg-sign`, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prettier — только для файлов, отформатированных на `origin/main`, и для новых.

**Деньги, даты, права.**
- Суммы — целые дирамы; расчёт — только функциями `libs/shared/domain/src/lib/billing.ts`.
- «Сегодня» и просрочка — календарь `Asia/Dushanbe` в SQL, как в PR 2.
- Маршруты владельца — только в облаке (`BillingModule` уже под `ConditionalModule`), право `billing:view` (A16). В тенантском пути — только `tenantTransaction` с фильтром `tenant_id` и RLS.
- Блокировок строки сети в PR 3 нет: владелец только читает.

**Печать (B11).**
- Страница браузера, без PDF на сервере.
- Печатается только лист счёта: корень `.ph-print-root` с модификатором `.ph-print-sheet`.
- A4 с полями `--ph-sheet-margin` (новый токен печати, 15mm); чек кассы не меняется.
- Чёрный по белому, без теней.
- Содержимое листа (A5): реквизиты получателя, плательщик, строки, НДС, итог, срок, назначение платежа. Всё из снимка счёта (`InvoiceDetails`); названия строк — RU-снимок счёта.
- Подписи листа — на языке интерфейса.

## Review Focus

1. **Оценка месяца на границах.**
   - Нет оценки: 1-е число без продаж, точка без продаж в месяце, сеть без точек.
   - Точка, закрытая 10-го, — 10 дней.
   - Первая продажа сегодня — 1 день.
   - Склад и офлайн-точка не считаются.
   - Ожидание — те же формулы, что у счёта.
   - Проверка — Задачи 2, 7.
2. **Просрочка как состояние.**
   - Уведомление появляется со следующего дня после срока.
   - Снимается, когда счёт оплачен; возвращается после отмены платежа (при следующем обновлении уведомлений).
   - Не появляется, если вид отключён в настройках сети.
   - Видят его только сотрудники с `billing:view`.
   - Проверка — Задачи 3, 7.
3. **Чужой счёт и права.** `GET billing/invoices/{id}` счёта другой сети — 404 (RLS). Без `billing:view` — 403. Проверка — Задача 7.
4. **Печать длинного счёта.**
   - Двадцать точек и длинное название услуги переносятся.
   - Строка не рвётся между страницами.
   - На бумагу попадает только лист, без меню и шапки приложения.
   - Проверка — Задачи 4, 5, 6 (предпросмотр печати Chrome и временный экранный тест).
5. **Таджикский интерфейс.** Подписи листа и раздела «Оплата» — по-таджикски; строки счёта — RU-снимок; суммы и даты — в формате `@pharmacy/shared-util`. Проверка — Задачи 5, 6.

---

### Task 1: Контракт

**Files:**
- Modify:
  - `libs/shared/dto/src/lib/tenant-owner.ts`;
  - `libs/shared/dto/src/lib/tenant-home.ts`.
- Минимальные правки компиляции API:
  - `apps/api/src/app/stores/stores.service.ts` — убрать `paidUntil`;
  - карты видов уведомлений в `apps/api/src/app/notifications/notification-kinds.ts`;
  - `stores/dto/settings.dto.ts`, `stores/settings.service.ts` — как сделал PR 1 для `service_decided`.

**Interfaces:**
- Produces (`tenant-owner.ts`):
  - `OwnerStore.paidUntil` — удалить (B12).
  - `TenantInvoice { id; number; period; totalMinor; paidMinor; remainingMinor; status: InvoiceStatus; overdue: boolean; dueOn; paidOn: string | null }`.
    `TenantInvoiceStatus` — удалить, статус — `InvoiceStatus` из `platform-tenants.ts`.
  - `TenantBillingEstimate { period; through: string; pricePerStoreMinor; vatRatePercent; discountBp: number | null; lines: Array<Omit<InvoiceLine, 'id'>>; netMinor; vatMinor; totalMinor }` — оценка месяца `period` по `through` включительно (A19).
  - `TenantBilling { estimate: TenantBillingEstimate; debtMinor; overdueDebtMinor; advanceMinor; discounts: Array<{ percentBp: number; fromMonth: string; toMonth: string }>; invoices: TenantInvoice[] }`.
    `discounts` — текущая и будущие (`toMonth` ≥ текущего месяца), по `fromMonth`.
  - `GET billing/invoices/{id}` отдаёт `InvoiceDetails` из `platform-billing.ts`.
- Produces (`tenant-home.ts`):
  - `NotificationKind` += `'invoice_overdue'` — счёт сети просрочен (состояние, A17);
  - параметры: `documentNumber` (номер счёта), `amountMinor` (остаток), `dueDate`; новых полей `ReminderParams` нет.

- [ ] **Step 1: Контракт** по Interfaces.
- [ ] **Step 2: Компиляция API.**
  - `invoice_overdue` в `NOTIFICATION_KINDS`, но не в `EVENT_KINDS`;
  - `KIND_PERMISSION.invoice_overdue = 'billing:view'`;
  - переключатель настроек;
  - `paidUntil` у точек убран.
- [ ] **Step 3: Проверка.** `npx tsc -b apps/api/tsconfig.json`; `npx nx run-many -t lint test typecheck -p shared-dto shared-domain`. Админка и веб компилируются снова после Задач 5 и 6.
- [ ] **Step 4: Коммит** `feat(dto): owner billing and the invoice_overdue notification`.

### Task 2: «Оплата» владельца на API

**Files:**
- Create в `apps/api/src/app/billing/`:
  - `owner-billing.repository.ts`, `owner-billing.service.ts`, `owner-billing.controller.ts`.
- Modify:
  - `store-usage.repository.ts` (чтение месяца без записи);
  - `billing.module.ts`.

**Interfaces:**
- Produces:
  - `StoreUsageRepository.activity(trx, tenantId, month: 'YYYY-MM-01', through: 'YYYY-MM-DD'): Promise<Array<{ storeId; name; firstSaleEver; closedOn: string | null }>>`. Тот же отбор, что `refresh` (облачные аптеки, `receipts_store_date_idx`, `closed_on` в часовом поясе сети), продажи — по `through` включительно; без записи.
  - `GET billing` → `TenantBilling` (`billing:view`). Расчёт (A19):
    - `composeInvoice`: период — текущий месяц по Душанбе;
    - тариф и ставка — из `platform_settings`;
    - скидка — действующая на месяц из `tenant_discounts`;
    - точки — из `activity`, `closedOn` = min(дата закрытия, сегодня);
    - услуги — `provided`, `provided_on` ≤ сегодня, без действующей строки счёта.
  - Долг, просрочка, аванс — из своих `invoices` и `tenants.billing_advance_dirams`. Счета — новые первыми.
  - `GET billing/invoices/{id}` → `InvoiceDetails` (`billing:view`): только действующие строки; 404 — нет такого счёта у сети (RLS и фильтр `tenant_id`).
  - Маппинг строки в `InvoiceDetails` — свой в тенантском модуле: платформенный `toInvoiceItem` импортировать нельзя (граница модулей).

- [ ] **Step 1: `activity` и репозиторий владельца.**
- [ ] **Step 2: Сервис и контроллер** (`@Controller({ path: 'billing', version: '1' })`, комментарии с кодами ответов).
- [ ] **Step 3: Проверка.** `npx tsc -b apps/api/tsconfig.json`, `npx nx run-many -t lint test -p api`.
- [ ] **Step 4: Коммит** `feat(api): the owner's billing — estimate of the month, debt, advance, discounts and invoices`.

### Task 3: Уведомление о просрочке

**Files:**
- Create: `apps/api/src/app/billing/overdue-invoices.ts` — порт `OverdueInvoices`.
- Modify:
  - `billing.module.ts` (export);
  - `apps/api/src/app/notifications/notifications-refresh.ts`, `notifications.service.ts`;
  - `CLAUDE.md` (граф модулей).

**Interfaces:**
- Produces: `OverdueInvoices.list(trx: TenantTransaction, tenantId: string): Promise<Array<{ id; number; remainingMinor; dueOn }>>` — счета сети с остатком и `due_on` < сегодня (Душанбе).
- Обновление уведомлений — блок `if (enabled('invoice_overdue'))`:
  - через `state(…)`: `dedupeKey` `invoice_overdue:<id>`, `storeId: null`, `entityType: 'invoice'`;
  - `params { documentNumber, amountMinor, dueDate }`;
  - оплаченный счёт снимается (`resolveMissing`).
- `NotificationsService.toNotification`: `amountMinor` у `invoice_overdue` видит обладатель `billing:view` (без `finance:view-cost`).
- `CLAUDE.md`: строка графа `billing` ← `notifications` дополняется `OverdueInvoices`.

- [ ] **Step 1: Порт, блок обновления, видимость суммы.**
- [ ] **Step 2: Проверка.** `npx tsc -b apps/api/tsconfig.json`, `npx nx run-many -t lint test -p api`, `node tools/scripts/check-docs.mjs`.
- [ ] **Step 3: Коммит** `feat(api): invoice_overdue — the owner sees an overdue invoice until it is paid`.

### Task 4: Лист счёта и печать A4 в `libs/ui`

**Files:**
- Create:
  - `libs/ui/src/lib/print/InvoiceSheet.tsx`;
  - `libs/ui/src/lib/print/SheetPrint.tsx`;
  - экспорт в `libs/ui/src/index.ts`.
- Modify:
  - `libs/ui/src/styles/print.css`;
  - токены печати (`libs/ui/src/styles/tokens/print.css` или файл, где лежат `--ph-receipt-*`).

**Interfaces:**
- Produces:
  - `InvoiceSheet(props: InvoiceSheetProps)` — документ счёта для экрана и печати; все значения уже отформатированы приложением, `libs/ui` не знает DTO и денег:
    ```ts
    interface InvoiceSheetProps {
      title: string;                      // «Счёт № … от …»
      parties: Array<{ label: string; lines: string[] }>; // получатель, плательщик
      columns: { line: string; detail: string; amount: string };
      rows: Array<{ line: string; detail: string; amount: string }>;
      totals: Array<{ label: string; value: string; strong?: boolean }>;
      notes: Array<{ label: string; value: string }>; // срок оплаты, назначение платежа
    }
    ```
  - `SheetPrint({ children })` — portal в `document.body` с `className="ph-print-root ph-print-sheet"`, как `ReceiptPrint`.
- CSS:
  - `@page sheet { size: A4; margin: var(--ph-sheet-margin) }` — если `var()` в `@page` не применяется, литерал с `ignore-design`;
  - `.ph-print-root.ph-print-sheet { page: sheet; inline-size: auto; padding-inline: 0; font-family: var(--ph-font-sans); … }`;
  - строки таблицы — `break-inside: avoid`.
- Стили листа на экране — утилиты по токенам `--ph-*`, без произвольных значений (ADR-0007).

- [ ] **Step 1: Компоненты и CSS.**
- [ ] **Step 2: Проверка.** `npx nx run-many -t lint test typecheck -p ui`; аудит-команды скила `ui-standards-tokens` по новым файлам.
- [ ] **Step 3: Коммит** `feat(ui): an A4 invoice sheet and its print root`.

### Task 5: Печать счёта в админке

**Files:**
- Create:
  - `apps/admin/app/(shell)/billing/invoice/page.tsx` (реэкспорт);
  - `apps/admin/src/pages/invoice-print/` (FSD-срез: `index.ts`, `ui/InvoicePrintPage.tsx`).
- Modify:
  - `apps/admin/src/shared/config/routes.ts` (`invoicePrint(id)`);
  - `apps/admin/src/pages/billing/ui/InvoiceDialogs.tsx` (кнопка «Печать»);
  - `ru.json`, `tg.json`.

**Interfaces:**
- Consumes: `InvoiceSheet`, `SheetPrint`; маршрут `invoices.get`.
- Страница:
  - `id` из query;
  - `QueryState`; маппинг `InvoiceDetails` → `InvoiceSheetProps`, суммы и даты — `@pharmacy/shared-util`;
  - лист на экране, кнопка «Печать» (`window.print()`), «Назад к счетам».
- В карточке счёта — ссылка «Печать» на страницу.

- [ ] **Step 1: Страница, маршрут, кнопка, тексты RU/TJ.**
- [ ] **Step 2: Проверка.**
  - `npx tsc -p apps/admin/tsconfig.json --noEmit` (buildinfo отложить);
  - `npx nx run-many -t lint test fsd -p admin`;
  - временный экранный тест: лист с реквизитами, итогом и назначением; корень `.ph-print-sheet` в `document.body`.
- [ ] **Step 3: Коммит** `feat(admin): a print page of an invoice`.

### Task 6: «Оплата» и печать в кабинете владельца

**Files:**
- Create:
  - `apps/web/app/(shell)/stores/invoice/page.tsx`;
  - `apps/web/src/pages/owner/invoice-print/` (`index.ts`, `ui/InvoicePrintPage.tsx`).
- Modify:
  - `apps/web/src/pages/owner/stores/ui/StoresPage.tsx` (вкладка «Оплата», колонка срока без «оплачено до»);
  - `StoreDialogs.tsx` (без `paidUntil`).
- Маршруты и клиент:
  - `apps/web/src/shared/config/routes.ts` (`invoicePrint(id)`);
  - `apps/web/src/shared/api/routes.ts` (`billing.get` → новый `TenantBilling`, новый `billing.invoice`);
  - `client.ts` (`REAL_API_ROUTES` += `billing.get`, `billing.invoice`).
- Моки:
  - `mocks/db-owner.ts` — счета в новой форме, скидки, аванс, `paidUntil` убрать;
  - `mocks/handlers-owner.ts` — `billing.get` и `billing.invoice`: оценка — `composeInvoice` по точкам моков, как API;
  - `mocks/db.ts` — посев уведомления `invoice_overdue`;
  - `mocks/transport.ts` — `KIND_PERMISSION.invoice_overdue = 'billing:view'`.
- Уведомление:
  - `entities/reminder/model/use-reminder-text.ts` — иконка, тон, значения;
  - `pages/owner/settings/ui/SettingsPage.tsx` — переключатель `invoice_overdue`.
- Тексты: `core.json`, `owner.json` RU/TJ.
- Тесты веба, проверяющие прежний `billing.get` и `paidUntil`; фейковый `/api/v1` в `apps/web-e2e` — если отдаёт `billing` или `paidUntil` точек, привести к новому контракту.

**Interfaces:**
- Consumes: `TenantBilling`, `InvoiceDetails`; `InvoiceSheet`, `SheetPrint`.
- Вкладка «Оплата» (раздел 9):
  - карточка оценки — строки точек (дни, тариф, скидка), услуги, НДС, итог, подпись «оценка, окончательная сумма — в счёте»;
  - долг, просрочено, аванс; скидки со сроками;
  - история счетов: номер, период, итог, оплачено, остаток, срок, дата полной оплаты, статус с пометкой просрочки, «Печать».
- Страница печати — как в админке, «Назад к оплате».

- [ ] **Step 1: Маршруты, моки, вкладка, печать, уведомление, тексты.**
- [ ] **Step 2: Тесты веба** — перевести на новый контракт.
- [ ] **Step 3: Временные экранные тесты** (не в PR):
  - оценка с точкой, закрытой в месяце;
  - печать листа владельца;
  - текст уведомления о просрочке;
  - axe на вкладке «Оплата».
- [ ] **Step 4: Проверка.**
  - `npx tsc -p apps/web/tsconfig.json --noEmit` и то же для admin;
  - `npx nx run-many -t lint test fsd -p web admin`.
- [ ] **Step 5: Коммит** `feat(web): the owner's billing, invoice print and the overdue notification`.

### Task 7: Сквозная проверка, документы, PR

- [ ] **Step 1: Сборка и запуск.** `npx nx build api`, `nx sync:check`; API против свежей временной базы (`STEP_UP_MAX_AGE_SECONDS=8`).
- [ ] **Step 2: Сценарий** (печатает OK/FAIL). Данные — сценарии PR 2 (счета, платежи), плюс чеки текущего месяца SQL-вставкой.
  - **Оценка:**
    - точка A с продажами в этом месяце и первой продажей раньше — дни с 1-го по сегодня;
    - точка, закрытая в этом месяце, — дни по дату закрытия;
    - склад не считается;
    - скидка текущего месяца;
    - услуга, оказанная в этом месяце и ещё не выставленная.
    
    Expected: суммы равны `composeInvoice`, посчитанному в скрипте по тем же данным.
  - **Долг и аванс** равны значениям списка сетей у оператора.
  - **Счёт владельца:** `GET billing/invoices/{id}` своего — снимок и строки как у оператора; чужого — 404; без `billing:view` (роль без права) — 403.
  - **Просрочка:**
    - срок счёта переносится в прошлое (SQL);
    - уведомление `invoice_overdue` с номером, остатком и сроком;
    - платёж на остаток → после обновления снято (SQL `notification_refresh` сдвигается, чтобы обновление не ждало 5 минут);
    - отмена платежа → появляется снова;
    - отключённый вид — не появляется.
  - **Изоляция:** второй владелец не видит счетов и уведомлений первой сети.
- [ ] **Step 3: Печать.** Предпросмотр печати Chrome на страницах админки и кабинета: только лист A4, длинное название переносится. Скриншоты — в описание PR.
- [ ] **Step 4: Полная проверка.**
  - `tsc` для api, admin, web;
  - `npx nx run-many -t lint test typecheck fsd -p api admin web ui shared-dto shared-domain`;
  - `node tools/scripts/check-docs.mjs`.
- [ ] **Step 5: AI-ревью.**
  - `nestjs-reviewer`, `ui-standards-expert` (печать, токены, доступность), итоговое ревью ветки.
  - Ревьюеры только читают: не пишут файлы и agent-memory.
  - Исправить существенное.
- [ ] **Step 6: Описание PR** `.superpowers/pr-billing-owner.md`:
  - что сделано, как проверено;
  - долг по тестам;
  - просьба прогнать `api:migrate`, `api:db-types-verify`, `api:integration`, api-e2e, web-e2e.
- [ ] **Step 7: Отправка.**
  - удалить временную базу;
  - `git push -u origin feature/billing-owner:feature/billing-owner`;
  - проверить upstream и `origin/main`;
  - ссылка, заголовок, файл пользователю; ledger и память.
