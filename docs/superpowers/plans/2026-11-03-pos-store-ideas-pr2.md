# QR оплаты банка (PR 2): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** касса показывает QR платёжной ссылки банка на сумму QR-части чека — в окне на кассе и на экране покупателя;
ссылку точки настраивает владелец, её смена пишет аудит и уведомление.

**Architecture:**
- Правила шаблона ссылки и подстановки — одна чистая реализация в `libs/shared/domain` (`payment-qr.ts`): её используют
  API (проверка), web-форма (проверка и «Проверить») и касса (ссылка чека). Последний рубеж — CHECK в БД.
- Настройка хранится колонками `stores`, меняется маршрутом `PUT /stores/{id}/payment-qr` модуля `stores` (свежий вход,
  аудит). Касса получает её в снимке каталога (`PosStoreSettings`), экран покупателя — готовой ссылкой в сообщении
  `BroadcastChannel`.
- Уведомление `payment_qr_changed` — событие из журнала действий: новый читатель `PaymentQrChanges` модуля `audit`
  (`audit` ← `notifications`, как `LoginLocks`).
- Одна миграция. Обмена с банком нет.

**Tech Stack:** NestJS, Kysely `sql`, class-validator, node-pg-migrate (SQL, только Up); Next.js static export, React,
TanStack Query, use-intl; `lean-qr` 2.7.4 через `QrSvg` (ADR-0022). Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-11-03-pos-store-ideas-design.md`, раздел 8 (D36–D42), 9–11, 13; утверждена
2026-11-03. **ADR:** поправка ADR-0022 от 2026-11-03 (QR оплаты на экране) — в этом PR; код пишется только после её
принятия архитектором.

## Уточнения спецификации при планировании

| № | Что нашлось | Решение | Цена ошибки |
|---|---|---|---|
| R1 | D40: отдельного окна оплаты у кассы нет, оплата — в панели чека | Когда QR-часть больше нуля и у точки есть ссылка, в панели чека — кнопка «Показать QR»: окно с крупным QR, получателем и суммой. Экран покупателя показывает QR сам, без кнопки | Кассир с одним монитором нажимает лишнюю кнопку |
| R2 | D37: `{ref}` — «номер чека терминала», но номер чек получает только при проведении (`nextLocalNumber`), а кода точки в снимке нет | `{ref}` = `{код точки}-{следующий номер чека смены}`: номер читается из IndexedDB без резервирования (`peekLocalNumber`); `PosStoreSettings` получает `storeCode` | Две вкладки одного терминала покажут один `{ref}`; ссылка справочная, банк её не проверяет |
| R3 | D38: тело `{ template, recipient } \| null` — JSON-парсер Express (strict) не принимает `null` верхнего уровня | Тело — `{ paymentQr: { template, recipient } \| null }` | Нет |
| R4 | D37: обязателен ли «Получатель» | Шаблон и получатель задаются вместе или оба пусты (CHECK); получатель — 1–100 знаков после обрезки пробелов | Владельцу нужно заполнить ещё одно поле |
| R5 | D38: уведомление — когда и кому | Событие (виден 30 дней, `EVENT_KINDS`), одно на запись журнала `store.payment_qr_changed`, привязано к точке; право области — `stores:view`. Появляется при пересчёте уведомлений (до 5 минут) | Заведующий точки тоже видит уведомление о своей смене ссылки |
| R6 | Раздел 2 спецификации: I6 — только облачные точки | Для точки не в режиме `online` снимок отдаёт `paymentQr: null` | Нет |
| R7 | Снимок каталога хранится в IndexedDB; снимок до выкладки не знает новых полей | `storeCode` и `paymentQr` в коде кассы читаются как `?? null` / `?? ''`: старый снимок — «QR нет» до обновления (`staleTime` 60 с) | Нет |
| R8 | D38: «Проверить» — QR на 1,00 смн | Пробная ссылка — `{amount}` = 100 дирамов, `{ref}` = `{код точки}-TEST`; показывается в форме до сохранения | Нет |
| R9 | D37: где проверяется шаблон | Одна функция `paymentQrTemplateProblem` (domain) в API и форме; CHECK в БД — `https://`, длина ≤ 500, без пробелов и управляющих символов | Нет |
| R10 | D38: снятие ссылки | `paymentQr: null` — тоже изменение: аудит и уведомление. Повтор тех же значений — без аудита и уведомления | Нет |
| R11 | Размер QR на экране — новых значений нет в шкалах | Компонентные токены `--ph-pay-qr-size` (окно кассы) и `--ph-pay-qr-display-size` (экран покупателя) в `libs/ui/src/styles/tokens/components.css` | Размер подбирается на мониторе точки |
| R12 | D37: «карточка точки» — в кабинете это окно `StoreDialog` | В `StoreDialog` у активной точки при `stores:update` — кнопка «QR для оплаты», открывает `PaymentQrDialog` | Нет |
| R13 | Строка stack.md «Банковский эквайринг» меняет принятую архитектуру | Правится в задаче 5 вместе с отметкой о принятии поправки ADR-0022, только после слов архитектора | Нет |

## Global Constraints

- Тесты отложены до MVP: без TDD и новых автотестов, существующие наборы остаются зелёными. Тестовый долг — в описании PR
  (раздел 13 спецификации: `payment-qr` — валидация, аудит, свежий вход; подстановки `{amount}` и `{ref}`).
- Полный `npm run check` запускает пользователь. Здесь — проверки задач и живые прогоны.
- Работа — в `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/pilot-payment-qr`; основную папку не трогать.
- Миграция применяется только к копии dev-базы (scratch); dev-базу мигрирует пользователь (`npx nx run api:migrate`).
- Коммиты — `--no-gpg-sign`, Conventional Commits, с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Новые тексты — в RU и TJ одновременно; таджикские — на проверку носителю (строка в PR).
- Только токены `--ph-*` и утилиты Tailwind из них; без hex, `px`, inline-стилей.
- Деньги — целые дирамы. `{amount}` — сомони с точкой и двумя знаками (`12550` → `125.50`) целочисленной арифметикой,
  без `/ 100` с плавающей точкой; на экране — `formatMoney`.
- Шаблон: только `https://`, до 500 знаков, без пробелов и управляющих символов; подстановки — только `{amount}` и
  `{ref}` (до 18 знаков); получатель — до 100 знаков.
- Синтетические данные в моках: ссылка — на `example.com`, никаких реальных счетов и карт.
- После правки `libs/shared/*`: `npx nx run-many -t typecheck -p shared-dto shared-domain --skip-nx-cache`
  (`next build` берёт типы из `dist`).
- Prettier — только на файлах, уже отформатированных на `main`.

## Review Focus

1. Смешанная оплата: QR — часть чека. Сумма в ссылке и на экранах — QR-часть, а не итог чека. При переключении с QR на
   наличные QR исчезает с обоих экранов. Задача 4, шаг 5.
2. Шаблоны на границе правил: `HTTPS://…`, `{AMOUNT}`, `{{amount}}`, `{amount` без закрывающей скобки, ровно 500 знаков,
   пробел в середине, кириллица в домене. API, форма и CHECK отвечают одинаково. Задача 1, шаг 7.
3. Снимок кассы из IndexedDB, записанный до выкладки, — без `storeCode` и `paymentQr`. Касса не падает и QR не
   показывает. Задача 4, шаг 5.
4. Свежий вход истёк, пока владелец правил ссылку: 403 `fresh_auth_required` → пароль → тот же запрос повторяется, ввод
   не теряется. Повтор тех же значений не пишет аудит. Задача 1, шаг 7, и задача 3, шаг 4.
5. Шаблон без `{amount}`: QR без суммы, и оба экрана крупно пишут «Сумма к оплате». Задача 4, шаг 5.

---

### Task 1: Ссылка QR точки — правила, миграция, API, снимок кассы

**Files:**
- Create: `libs/shared/domain/src/lib/payment-qr.ts`; Modify: `libs/shared/domain/src/index.ts`
- Modify: `libs/shared/dto/src/lib/tenant-owner.ts` (`OwnerStore`), `libs/shared/dto/src/lib/tenant-pos.ts`
  (`PosStoreSettings`)
- Create: `apps/api/migrations/1793697600000_store-payment-qr.sql`
- Modify: `apps/api/src/core/database/db.generated.ts` (`Stores`)
- Modify: `apps/api/src/app/stores/{dto/store.dto.ts, stores.repository.ts, stores.service.ts, stores.controller.ts}`
- Modify: `apps/api/src/app/pos/{pos.repository.ts, catalog-snapshot.service.ts}`

**Interfaces:**
- Produces (`@pharmacy/shared-domain`):
  ```ts
  export const PAYMENT_QR_TEMPLATE_MAX = 500;
  export const PAYMENT_QR_RECIPIENT_MAX = 100;
  export const PAYMENT_QR_REF_MAX = 18;
  export type PaymentQrTemplateProblem = 'scheme' | 'length' | 'characters' | 'placeholder';
  export function paymentQrTemplateProblem(template: string): PaymentQrTemplateProblem | null;
  export function paymentQrHasAmount(template: string): boolean;
  export function paymentQrAmount(amountMinor: number): string; // 12550 → '125.50', 100 → '1.00'
  export function paymentQrRef(storeCode: string, localNumber: number): string; // 'A1-37'
  export function paymentQrLink(template: string, values: { amountMinor: number; ref: string }): string;
  ```
- Produces (`@pharmacy/shared-dto`):
  ```ts
  export interface PaymentQrSettings { template: string; recipient: string }
  export interface UpdatePaymentQrRequest { paymentQr: PaymentQrSettings | null }
  // OwnerStore.paymentQr: PaymentQrSettings | null
  // PosStoreSettings.storeCode: string; PosStoreSettings.paymentQr: PaymentQrSettings | null
  ```
- Produces (API): `PUT /api/v1/stores/{id}/payment-qr` → 200 `OwnerStore`; 400 `validation_failed` (поля
  `paymentQr.template`, `paymentQr.recipient`), 403 `fresh_auth_required`, 404, 409 `store_closed` / `store_closing`.
  Аудит `store.payment_qr_changed` с `details: { before: PaymentQrSettings | null, after: PaymentQrSettings | null }`.

- [ ] **Step 1: Правила в domain.** `payment-qr.ts` с функциями выше:
  - `scheme` — не начинается с `https://` (регистр важен) или `new URL()` не разбирает строку либо даёт пустой хост;
  - `length` — длиннее 500 знаков;
  - `characters` — есть пробел или управляющий символ (`/[\s\p{Cc}]/u`);
  - `placeholder` — после удаления всех `{amount}` и `{ref}` в строке осталась `{` или `}`.

  Порядок проверок — как в списке. `paymentQrLink` заменяет все вхождения обеих подстановок; `{ref}` обрезается до 18
  знаков. Шапка файла — ссылка на D37 и поправку ADR-0022. Экспорт — из `index.ts`.
- [ ] **Step 2: DTO.** Типы выше. JSDoc: маршрут, права, свежий вход, коды ошибок; у `PosStoreSettings.paymentQr` —
  «null — у точки нет ссылки или точка не облачная (R6)». Затем typecheck библиотек (Global Constraints).
- [ ] **Step 3: Миграция** `1793697600000_store-payment-qr.sql`, в шапке — ссылка на D37, D38 и поправку ADR-0022.
  Начать с `set local lock_timeout = '5s';` (`stores` читает каждый запрос кассы):
  - `stores.payment_qr_template text null` с CHECK: `~ '^https://'`, `char_length <= 500`, `!~ '[[:space:][:cntrl:]]'`;
  - `stores.payment_qr_recipient text null` с CHECK `char_length between 1 and 100`;
  - CHECK `(payment_qr_template is null) = (payment_qr_recipient is null)`;
  - `notifications_kind_check` и `tenant_settings_disabled_notifications_check` — пересобрать по образцу
    `1792744644428_login-locked-notification.sql`, добавив `'payment_qr_changed'`.

  Гранты не нужны: у `pharmacy_app` права на всю таблицу `stores`. Колонки `Stores` в `db.generated.ts` — по алфавиту:
  `paymentQrRecipient: string | null; paymentQrTemplate: string | null;`.
- [ ] **Step 4: Репозиторий и `toOwnerStore`.** В `StoreRow` и выборку `findStore` (и списка точек) — две колонки;
  `toOwnerStore` отдаёт `paymentQr` (оба поля есть — объект, иначе `null`). Новый метод
  `updatePaymentQr(trx: TenantTransaction, tenantId: string, storeId: string, value: PaymentQrSettings | null): Promise<void>`.
- [ ] **Step 5: Сервис и контроллер.**
  - `UpdatePaymentQrDto`: `paymentQr` — `null` или вложенный объект (`ValidateIf(o => o.paymentQr !== null)`,
    `ValidateNested`, `Type`); `template` — `IsString`, `MaxLength(500)`; `recipient` — `IsString`.
  - `StoresService.updatePaymentQr(id: string, request: UpdatePaymentQrRequest): Promise<OwnerStore>` — по образцу
    `update`:
    - охват → 404;
    - `closed` → 409 `store_closed`, `closing` → 409 `store_closing`;
    - `paymentQrTemplateProblem` → `FieldProblemException(400, 'validation_failed', [{ field: 'paymentQr.template', code: <problem> }])`;
    - получатель обрезается, пустой или длиннее 100 → поле `paymentQr.recipient`, код `required` / `length`;
    - запись, аудит `store.payment_qr_changed` только при изменении (R10), ответ — `read`.
  - Контроллер: `@RequirePermission('stores:update') @RequireFreshAuth() @Put(':id/payment-qr')`, `ParseUUIDPipe`;
    JSDoc с кодами ответа.
- [ ] **Step 6: Снимок кассы.** `PosStore` (`pos.repository.ts`) читает две колонки. `catalog-snapshot.service.ts`:
  `settings.storeCode = store.code`, `settings.paymentQr` — объект для облачной точки с обоими полями, иначе `null` (R6).
- [ ] **Step 7: Проверка.**
  - Run: `npx nx run-many -t typecheck lint -p api shared-dto shared-domain` и `npx nx build api`. Expected: без ошибок.
  - Миграция — на копии dev-базы (scratch). Затем `npx nx run api:db-types-verify` против копии. Expected: типы
    совпадают.
  - Живой прогон API на копии (задача 5, шаг 3): 200, повтор без аудита, 400 для каждой строки Review Focus 2, 403 без
    свежего входа, снимок с `paymentQr`.
- [ ] **Step 8: Commit** — `feat(stores): the payment QR link of a store, set with a fresh sign-in and audited`.

### Task 2: Уведомление `payment_qr_changed`

**Files:**
- Create: `apps/api/src/app/audit/payment-qr-changes.ts`; Modify: `apps/api/src/app/audit/audit.module.ts`
- Modify: `apps/api/src/app/notifications/{notification-kinds.ts, notifications-refresh.ts}`
- Modify: `apps/api/src/app/stores/{dto/settings.dto.ts, settings.service.ts}`
- Modify: `libs/shared/dto/src/lib/tenant-home.ts` (`NotificationKind`)
- Modify: `apps/web/src/entities/reminder/model/use-reminder-text.ts`, `apps/web/src/pages/owner/settings/ui/SettingsPage.tsx`,
  `apps/web/src/shared/api/mocks/{db-owner.ts, transport.ts}`, `apps/web/src/shared/i18n/messages/{ru,tg}/{core,owner}.json`

**Interfaces:**
- Consumes: аудит `store.payment_qr_changed` (задача 1).
- Produces (API, модуль `audit`):
  ```ts
  export interface PaymentQrChange { auditId: string; storeId: string; storeName: string; employeeName: string | null }
  @Injectable() export class PaymentQrChanges {
    changedSince(trx: TenantTransaction, tenantId: string, after: Date): Promise<PaymentQrChange[]>;
  }
  ```

- [ ] **Step 1: Читатель журнала.** `PaymentQrChanges.changedSince` — SQL тегом `sql`, как в `login-locks.ts`: записи
  `action = 'store.payment_qr_changed'` после `after` по `audit_log_recorded_idx`. `left join` к `stores` и `employees` —
  с `tenant_id = a.tenant_id`. Зарегистрировать в `providers` и `exports` `AuditModule`, с комментарием.
- [ ] **Step 2: Вид уведомления.**
  - `NotificationKind` получает `'payment_qr_changed'`, с JSDoc: событие, точка, `storeName`, `employeeName`, `stores:view`.
  - `NOTIFICATION_KINDS`, `EVENT_KINDS`; `KIND_PERMISSION.payment_qr_changed = 'stores:view'`.
  - Блок в `notifications-refresh.ts` по образцу `login_locked`: `dedupeKey: payment_qr_changed:${auditId}`,
    `storeId`, `entityType: 'store'`, `entityId: storeId`, `params: { storeName, employeeName }`. Без `reopenGrown`.
  - Список и поле `payment_qr_changed` в `settings.dto.ts` и `settings.service.ts`.
- [ ] **Step 3: Web.**
  - `reminderIcon.payment_qr_changed = 'qr-code'`, `reminderTone` — `'warning'`.
  - `NOTIFICATIONS` настроек — после `login_locked`.
  - Моки: `transport.ts` — `'stores:view'`, `db-owner.ts` — `payment_qr_changed: true`.
  - Тексты RU и TJ:
    - `reminder.payment_qr_changed.title`: «{store}: изменена ссылка QR оплаты»;
    - `reminder.payment_qr_changed.detail`: «Изменил {employee} · если вы не ждали изменения, проверьте ссылку в карточке
      точки»;
    - `auditEvents.store_payment_qr_changed`: «Ссылка QR оплаты изменена»;
    - `owner.json` настроек уведомлений: заголовок «Ссылка QR оплаты», подсказка «Кто-то изменил или убрал ссылку, по
      которой покупатели платят по QR».
- [ ] **Step 4: Проверка.** Run: `npx nx run-many -t typecheck lint test -p api web shared-dto` и `npx nx fsd web`.
  Expected: без ошибок, `messages.spec.ts` зелёный. Живой прогон — задача 5, шаг 3: уведомление после изменения ссылки.
- [ ] **Step 5: Commit** — `feat(notifications): the owner is told when the payment QR link of a store changes`.

### Task 3: «QR для оплаты» в кабинете владельца

**Files:**
- Create: `apps/web/src/pages/owner/stores/ui/PaymentQrDialog.tsx`
- Modify: `apps/web/src/pages/owner/stores/ui/StoreDialogs.tsx` (`StoreDialog`), `StoresPage.tsx`
- Modify: `apps/web/src/shared/api/routes.ts`, `client.ts` (`REAL_API_ROUTES`), `mocks/handlers-owner.ts` и данные точек
  моков
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/owner.json` (`ownerStores.paymentQr.*`)

**Interfaces:**
- Consumes: domain-функции и DTO задачи 1.
- Produces (web): маршрут `'stores.paymentQr': route<OwnerStore, UpdatePaymentQrRequest, { id: string }>('PUT', ({ id }) => `/stores/${id}/payment-qr`)`.

- [ ] **Step 1: Маршрут и мок.** Маршрут выше и строка в `REAL_API_ROUTES`. Обработчик мока — как `stores.update`:
  проверка правом `stores:update`, правила `paymentQrTemplateProblem` (400 с полем), запись в точку моков. У всех точек
  моков `paymentQr: null`, кроме точки терминала моков: `https://pay.example.com/qr?sum={amount}&ref={ref}`, получатель
  «ООО «Шифо» (демо)».
- [ ] **Step 2: `PaymentQrDialog`** (`store: OwnerStore; onClose: () => void`):
  - поля «Ссылка для оплаты» (`TextField`, `inputMode="url"`) и «Получатель»;
  - под полем ссылки — ошибка по `paymentQrTemplateProblem` (тексты `problems.<problem>`) и подсказка D42: «Ссылку
    выдаёт банк для приёма оплаты на расчётный счёт юрлица точки. Не указывайте личную карту. За содержимое ссылки
    отвечает владелец сети»;
  - если в ссылке нет `{amount}` — подсказка «Без {amount} покупатель вводит сумму сам»;
  - «Проверить» показывает `QrSvg` пробной ссылки (R8) с подписью «QR на 1,00 смн — отсканируйте приложением банка до
    сохранения»;
  - «Сохранить» — `withFreshAuth(() => apiRequest('stores.paymentQr', …))`. При успехе — инвалидация
    `['stores', 'overview']`, тост «Ссылка QR сохранена», закрытие окна;
  - «Убрать QR» (если ссылка была) — тот же запрос с `paymentQr: null`, тост «QR оплаты убран»;
  - ошибки полей API — у полей, прочие — `Alert`.
- [ ] **Step 3: Кнопка в `StoreDialog`.** У активной точки при `canEdit` — `Button variant="secondary" iconStart="qr-code"`
  «QR для оплаты» в `actions`, рядом с «Закрыть точку». `StoresTab` хранит `paymentQr: OwnerStore | null` и открывает
  окно, как `closing`. Под формой — строка состояния: «QR оплаты: {recipient}» или «QR оплаты не настроен».
- [ ] **Step 4: Проверка.**
  - Run: `npx nx run-many -t typecheck lint -p web` и `npx nx fsd web`. Expected: без ошибок.
  - Живой прогон на моках: «Проверить» рисует QR; плохие шаблоны Review Focus 2 показывают ошибку поля до запроса;
    сохранение и снятие обновляют строку состояния.
- [ ] **Step 5: Commit** — `feat(web): the payment QR link in the owner's store card`.

### Task 4: QR на кассе и экране покупателя

**Files:**
- Modify: `apps/web/src/shared/lib/offline-queue/receipt-seq.ts` (+ экспорт)
- Create: `apps/web/src/features/pos/model/payment-qr.ts`, `apps/web/src/features/pos/ui/PaymentQrDialog.tsx`
- Modify: `apps/web/src/features/pos/ui/CartPanel.tsx`, `apps/web/src/features/pos/index.ts`,
  `apps/web/src/pages/pos/till/ui/PosPage.tsx`
- Modify: `apps/web/src/shared/lib/customer-display/protocol.ts`, `apps/web/src/features/pos/model/customer-display.ts`,
  `apps/web/src/pages/pos/customer-display/ui/CustomerDisplayPage.tsx`
- Modify: `libs/ui/src/styles/tokens/components.css`; `apps/web/src/shared/i18n/messages/{ru,tg}/pos.json`
- Modify: `apps/web/src/shared/api/mocks/fixtures-pos.ts` (`storeSettings`), `handlers-pos.ts`

**Interfaces:**
- Consumes: `paymentQrLink`, `paymentQrRef`, `paymentQrHasAmount` (задача 1); `PosStoreSettings.storeCode`, `paymentQr`.
- Produces:
  ```ts
  // shared/lib/offline-queue
  export function peekLocalNumber(db: PosDb, shiftId: string): Promise<number>; // следующий номер, без записи
  // shared/lib/customer-display
  export interface DisplayQr { link: string; recipient: string; amountMinor: number; withAmount: boolean }
  // DisplayState 'receipt' → payment: { …; qr: DisplayQr | null } | null
  // features/pos
  export function usePaymentQr(c: {
    db: PosDb | null; shiftId: string | null; settings: PosStoreSettings | undefined; qrMinor: number;
  }): DisplayQr | null;
  // CustomerDisplayInput.qr: DisplayQr | null; CartPanelProps.paymentQr: DisplayQr | null
  ```

- [ ] **Step 1: Номер для `{ref}`.** `peekLocalNumber` — чтение счётчика `seqKey(shiftId)` в транзакции `readonly`:
  `min(текущий + 1, MAX_LOCAL_NUMBER)`, без записи (R2).
- [ ] **Step 2: `usePaymentQr`.** Возвращает `null`, если нет `db`, `shiftId`, `settings?.paymentQr` (R7) или
  `qrMinor === 0`. Иначе читает `peekLocalNumber` в эффекте (при смене смены и когда QR-часть появилась) и собирает
  `DisplayQr`: `link = paymentQrLink(template, { amountMinor: qrMinor, ref: paymentQrRef(settings.storeCode ?? '', n) })`,
  `withAmount = paymentQrHasAmount(template)`. Пока номер не прочитан — `null`.
- [ ] **Step 3: Касса.**
  - `PosPage`: `qrMinor = draft.nonCash.qr`; `usePaymentQr({ db: runtime?.db ?? null, shiftId, settings: snapshot?.settings, qrMinor })`.
    Результат передаётся в `CartPanel` и `useCustomerDisplay`.
  - `CartPanel`: при `paymentQr` — кнопка «Показать QR» (`iconStart="qr-code"`, высота кассы) под способами оплаты.
  - `PaymentQrDialog` (`qr: DisplayQr; onClose`), размер `md`:
    - `QrSvg` шириной `w-(--ph-pay-qr-size)` на белой подложке `bg-surface`;
    - получатель; сумма `formatMoney(amountMinor)`, при `!withAmount` — крупно «Сумма к оплате: …»;
    - подсказка «Нажмите «Оплатить», когда увидите платёж в приложении банка».
  - Токены (R11): `--ph-pay-qr-size: 18rem; --ph-pay-qr-display-size: min(60vh, 32rem);` в `components.css`, с
    комментарием.
- [ ] **Step 4: Экран покупателя.** `displayStateOf` кладёт `qr` в `payment` (блок оплаты начат — QR-часть больше нуля).
  `CustomerDisplayPage` в блоке оплаты при `payment.qr`:
  - QR шириной `w-(--ph-pay-qr-display-size)` на `bg-surface`;
  - получатель;
  - «К оплате по QR: {amount}», при `!withAmount` — «Сумма к оплате: {amount}» крупнее;
  - строки чека остаются, блок QR — справа от итогов.

  Тексты `pos.customerDisplay.qr*` и `pos.paymentQr.*` — RU и TJ. Моки: `storeSettings` получает `storeCode` и
  `paymentQr` (для точки терминала — ссылка задачи 3).
- [ ] **Step 5: Проверка.**
  - Run: `npx nx run-many -t typecheck lint test -p web`, `npx nx fsd web` и `npx nx build web`. Expected: без ошибок.
  - Живой прогон на моках, две вкладки:
    - «QR» на всю сумму: кнопка и окно на кассе, QR на экране покупателя, ссылка с `sum=…` и `ref=…`;
    - смешанная оплата: сумма — QR-часть;
    - переход на наличные: QR пропадает;
    - «Спасибо» без QR;
    - шаблон без `{amount}`;
    - снимок без `paymentQr`: удалить поле из сохранённого снимка → QR нет, ошибок консоли нет.
  - Строка, которую получает `QrSvg`, равна ожидаемой ссылке (декодера в проекте нет). Сканирование приложением
    банка — на оборудовании пилота (раздел 13 спецификации), строка в PR.
- [ ] **Step 6: Commit** — `feat(web): the payment QR of the receipt on the POS and the customer display`.

### Task 5: Документы и живой прогон API

**Files:**
- Modify: `docs/architecture/glossary.md`, `docs/architecture/data-model/01-platform-org.md`, `CLAUDE.md` (границы
  модулей), `docs/qa/02-granitsy-pilota.md`, `docs/architecture/stack.md`, `docs/architecture/adr/0022-shtrihkody-i-qr.md`,
  `docs/architecture/APPROVAL.md`

- [ ] **Step 1: Документы.**
  - Глоссарий: строка «QR оплаты» (payment QR) — QR платёжной ссылки банка точки на сумму QR-части чека, на кассе и
    экране покупателя. Без обмена с банком: оплату подтверждает кассир.
  - Модель данных: две колонки `stores` с CHECK; `payment_qr_changed` в списке `disabled_notifications`.
  - CLAUDE.md: `audit` ← `notifications` — добавить `PaymentQrChanges`, рядом с `LoginLocks`.
  - `docs/qa`: шаги проверки QR оплаты (настройка, «Проверить», касса, экран покупателя, уведомление).
- [ ] **Step 2: После принятия поправки** (R13): статус поправки ADR-0022 — «Утверждена архитектором <дата>»,
  строка в APPROVAL.md, строка stack.md «Банковский эквайринг» — «касса может показывать QR платёжной ссылки банка;
  обмена с банком нет».
- [ ] **Step 3: Живой прогон API на копии dev-базы** (сборка API ветки, `PORT=3005`, `DATABASE_URL` копии,
  `APP_ENV=test`, `AUTH_TEST_COOKIES=true`). Вход владельца копии — код активации скриптом
  `create-activation-code.mjs` на копии, пароль — тестовый, в чат не выводится. Запросы `curl`:
  - 200 и строка `store.payment_qr_changed`; повтор тех же значений — без новой строки;
  - 400 по Review Focus 2; `paymentQr: null` — 200 и аудит;
  - через `STEP_UP_MAX_AGE_SECONDS=60` после минуты — 403 `fresh_auth_required`;
  - снимок кассы с `storeCode` и `paymentQr`;
  - `GET /notifications` — `payment_qr_changed` у точки.

  Копию удалить после прогона.
- [ ] **Step 4: Commit** — `docs: the payment QR in the glossary, data model, CLAUDE.md and the QA guide`.
