# Цена и скидка на кассе по правилам (ревью безопасности I2, решение 7.3 А): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сервер не принимает чек с ценой или скидкой не по правилам точки; такой чек уходит в «Требует разбора», где его
может принять заведующий или владелец; чеки с пометками цены, скидки и автора уведомляют владельца.

**Architecture:**
- Проверка — в `ReceiptsService.create` для всех чеков. Признак `origin` (онлайн или из буфера) сервер выводит из момента
  продажи, который задаёт клиент, поэтому на него не опираемся.
- «Онлайн — отклонить, буфер — в карантин» на деле один механизм: ответ 422, а очередь кассы ставит любую 4xx в карантин
  (ADR-0015).
- Цена на момент снимка кассы берётся из журнала `price.changed` (новый порт `PriceChanges` модуля `audit`, по образцу
  `PinSignIns`) через `StorePricesReader`.
- Разбор карантина: повтор с тем же ключом и заголовком `X-Accept-Discrepancy`, права проверяются у сессии запроса.
- Уведомление: новый вид `receipt_discrepancy`, событие, как `negative_stock`.

**Tech Stack:** NestJS, Kysely/`sql`, PostgreSQL (миграция CHECK), Next.js static export (FSD), TanStack Query, IndexedDB-очередь. Новых
зависимостей нет.

**Spec:**
- `docs/architecture/reviews/2026-10-22-security-review.md`: находка I2, решение 7.3 «А» (строка в `APPROVAL.md` на
  `feature/security-review`), отчёт `2026-10-22-security-review/r3-api-surface.md`, I2.
- ADR-0015, «продажа — факт».
- Спецификации `2026-10-13-pos-shift-sale-design.md` (E5, E23) и `2026-10-21-pos-offline-limits-design.md` (P9, P10).

## Решения автора (на утверждение вместе с планом)

| № | Вопрос | Решение |
|---|---|---|
| R1 | Какие чеки проверять | Все, без опоры на `origin`: в чеке из буфера и в онлайн-чеке правила одни. Ответ 422; касса ставит операцию в карантин по своему правилу «4xx → карантин». Это и есть «онлайн-чек отклоняется, буферный — в карантин» |
| R2 | Допустимая цена строки | Равна текущей цене точки или цене точки в момент версии снимка (тогда пометка `price`, как сейчас). Цены упаковки — из записей `price.changed` (точка, товар): каждая цена, действовавшая с T − 60 с до T (запас на запись цен проведением прихода; было 5 с — изменено при выполнении, см. журнал), нет записей — текущая цена. Цена штуки — та же формула `piecePriceMinor` с текущими штук в упаковке, своей ценой штуки и шагом округления. Любая другая цена, выше или ниже, — отказ |
| R3 | Какая версия годится | `T = min(priceListVersion, момент получения)`. Учитывается, если T не раньше `момент продажи − pos_buffer_max_hours`; иначе допустима только текущая цена |
| R4 | Версия от кассы | `priceListVersion` = самая старая версия снимка, по которой оценены строки чека. Строка черновика запоминает версию при добавлении; без неё (черновик старой версии) берётся версия текущего снимка. Контракт API не меняется: уточняется смысл поля (JSDoc) |
| R5 | Допустимая скидка | Без правила — да. С правилом — ступень (`ruleId`, `discountMinSubtotalMinor`, `discountPercent`) совпадает со ступенью правила, действующего в точке на бизнес-дату продажи или на бизнес-дату момента T. Истории правок правил нет — берутся текущие определения. Несуществующее правило — 400 `unknown_discount`, как сейчас (на него ссылается чек). Допустимая, но не лучшая скидка — пометка `discount`, как сейчас: меньшая скидка не ущерб аптеке |
| R6 | Ответ отказа | 422 `price_rules_violated`, ошибки полей: `lines.N.unitPriceMinor: price_not_allowed`, `discountRuleId: discount_not_allowed`. Отказ пишется в журнал действий отдельной транзакцией: `receipt.refused` (id чека, смена, автор, поля и коды) — без данных рецептов |
| R7 | «Принять расхождение» | Заведующий или владелец, вошедший на этой кассе, в «Требует разбора» повторяет операцию с тем же ключом и телом и заголовком `X-Accept-Discrepancy: true`. Сервер принимает, если у сессии запроса (не автора чека) есть права: цена — `pricing:update-network` или `pricing:update-store` с точкой в охвате; скидка — `discounts:manage-network` или `discounts:manage-store` с точкой в охвате. Без прав заголовок не действует: снова 422, очередь не встаёт на паузу. В принятом чеке пометки `price`/`discount`; в аудите `receipt.completed` — `acceptedBy` |
| R8 | Уведомление владельцу | Новый вид `receipt_discrepancy` (событие, 30 дней): точка × бизнес-дата — число чеков с пометкой `price`, `discount` или `author`, полученных после прошлого прохода. Право области — `shifts:view`. Включается и выключается в настройках сети |
| R9 | Касса при отказе | Отдельного диалога нет: чек остаётся на экране без номера, счётчик «Требует разбора» в шапке растёт, причина видна на экране смены. Без вмешательства в запрос отказ онлайн редок (правило скидки изменили между снимком и оплатой) |
| R10 | Документы | Поправка ADR-0015 «2026-10-23: цена и скидка на кассе»; строка E5 спецификации кассы; `CLAUDE.md`: граф модулей (`audit` → `pricing`: `PriceChanges`) и строка о кассе; строка в `APPROVAL.md`. Утверждение плана — утверждение поправки |
| R11 | Остаток риска | Подбор старой цены возможен только среди реальных цен точки за окно `pos_buffer_max_hours`, всегда с пометкой и уведомлением. Легальная продажа отклоняется, если во время перебоя изменили штук в упаковке, шаг округления или правило скидки: её принимают через R7 |

Вне плана: офлайн-точки (контур sync выключен, решение 7.4), фильтр отчёта по пометкам (r3), лимит выемок (r3, Q3).

## Global Constraints

- Тесты отложены до MVP: проверка — живая (API через curl на синтетической сети, web — в браузере на 4210 с
  `api-oc-4210`). Существующие наборы остаются зелёными.
- Порты 4200/4201 не использовать; `node_modules` не связывать в временные worktree.
- Границы модулей: `pricing` читает журнал только через экспорт `audit` (`PriceChanges`); `pos` читает цены только через
  `StorePricesReader`.
- Деньги — целые дирамы; ПДн и данные рецептов — не в журнал.
- Миграция — SQL node-pg-migrate, только Up; CHECK пересобирается, как в `1792045306882_billing-services.sql`.
- `localStorage`/IndexedDB-запись: новое поле записи очереди необязательное (старые записи без него).
- Коммиты `--no-gpg-sign`, Conventional Commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Корзина открыта, пока менялась цена** (цену изменили, снимок обновился до оплаты). Ожидается: продажа принята по
   цене строки, с пометкой `price`. Проверка — задача 2, w1.
2. **Чек из буфера по цене до изменения** (перебой, за это время цену подняли). Ожидается: принят с пометкой `price`,
   владелец получил уведомление. Проверка — задача 1, a4, и задача 3, n1.
3. **Правило скидки выключили после снимка, чек оплачен по старому снимку.** Ожидается: 422 → карантин → «Принять
   расхождение» заведующим → 201. Проверка — задача 2, w3.
4. **Подделанный запрос** (цена вдвое ниже; `discountPercent: 90` с настоящим id правила). Ожидается: 422 и запись
   `receipt.refused`, остатки и смена не изменились. Проверка — задача 1, a1, a2.
5. **«Принять расхождение» без прав** (кассир). Ожидается: снова 422, очередь не на паузе. С правами (заведующий):
   201, `acceptedBy` в аудите, пометка, уведомление. Проверка — задача 1, a5; задача 2, w2.

---

### Task 1: Сервер — цена и скидка по правилам, отказ, принятие с правами, документы

**Files:**
- Create: `apps/api/src/app/audit/price-changes.ts`; export из `audit.module.ts`.
- Modify: `apps/api/src/app/pricing/store-prices-reader.ts`.
- Create: `apps/api/src/app/pos/receipt-rules.ts` — чистые проверки.
- Modify: `apps/api/src/app/pos/receipts.service.ts`, `receipts.controller.ts`.
- Modify: `libs/shared/dto/src/lib/tenant-pos.ts` — JSDoc `CreateReceiptRequest`: смысл `priceListVersion` (R4),
  коды 422 и заголовок.
- Docs: `docs/architecture/adr/0015-*.md` (поправка), `docs/superpowers/specs/2026-10-13-pos-shift-sale-design.md`
  (E5), `CLAUDE.md` (граф модулей, Conventions «Касса»), `docs/architecture/APPROVAL.md` (строка).

**Interfaces — Produces:**
- `PriceChanges.oldPricesAfter(trx, tenantId, storeId, productIds: readonly string[], after: Date): Promise<Map<string, number | null>>`.
  Для товара с записью `price.changed` (`entity_type = 'product'`, `store_id` точки, `recorded_at > after`) возвращает
  `oldPriceMinor` самой ранней такой записи. Индекс — `audit_log_entity_idx`.
- `StorePricesReader.packPricesAt(trx, tenantId, storeId, productIds, at: Date): Promise<Map<string, number>>`. Цена
  упаковки в момент `at − PRICE_HISTORY_SKEW_MS` (5 000): из `oldPricesAfter`, иначе текущая. Товара нет в карте —
  цены тогда не было.
- `receipt-rules.ts`:
  - `priceErrors(lines: Array<{ unitPriceMinor: number; allowed: ReadonlyArray<number | null> }>): FieldError[]`;
  - `discountError(body, tiers: ActiveTier[]): FieldError | null`.
- Ответ: `FieldProblemException(422, 'price_rules_violated', errors)`. Заголовок `x-accept-discrepancy`: значение
  `true`.

- [ ] **Step 1:** `PriceChanges` (`sql` по `audit_log`, как `PinSignIns`); `packPricesAt`; `receipt-rules.ts` (R2, R5, R6).
- [ ] **Step 2:** `ReceiptsService.create(body, key, sentAt, acceptDiscrepancy: boolean)`:
  - момент T по R3;
  - допустимые цены строки: текущая и цена в момент T (та же формула, что `now`);
  - ступени правил на две бизнес-даты (`activeTiers`);
  - ошибки без принятия → 422.

  Принятие (R7): права по `getPrincipal()`, охват точки; `acceptedBy` в `details` аудита. Отказ (R6): исключение
  перехватывается вне транзакции чека, `receipt.refused` пишется в новой `tenantTransaction`, затем исключение
  пробрасывается. Контроллер читает `@Headers('x-accept-discrepancy')`.
- [ ] **Step 3:** Документы (R10), JSDoc DTO.
- [ ] **Step 4: Живая проверка** (`api-oc-4210`, сеть `sl_pos`: кассир по PIN в банке cookie терминала, владелец и
  заведующий — паролем; правило скидки из двух ступеней создаётся владельцем):
  - a1 — цена строки вдвое ниже текущей → 422 `price_rules_violated` (`lines.0.unitPriceMinor`), чек не создан, остаток
    тот же, в журнале `receipt.refused`;
  - a2 — `discountPercent: 90` с id и порогом настоящей ступени → 422 (`discountRuleId: discount_not_allowed`);
  - a3 — текущая цена и лучшая ступень → 201, без пометок;
  - a4 — версия T до изменения цены владельцем, цена строки = прежняя → 201, пометка `price`; та же цена с T старше
    `pos_buffer_max_hours` → 422;
  - a5 — a1 повторно с заголовком: сессия кассира → 422; сессия заведующего → 201, пометка `price`, `acceptedBy` в
    `receipt.completed`.
- [ ] **Step 5:** `npx nx run-many -t lint test -p api shared-dto`; `npx nx run api:typecheck`.
  Commit: `fix(api): the POS accepts a price or a discount only by the rules of the store (security review I2)`.

### Task 2: Касса — версия строки, «Принять расхождение»

**Files:**
- Modify:
  - `apps/web/src/features/pos/model/receipt.ts` — `DraftLine.priceVersion?: number` и `AddOptions.priceVersion?: number`;
    `addProduct` пишет её в новую строку и в строку, к которой прибавляет количество, если там её ещё нет;
  - `apps/web/src/features/pos/model/pay.ts` — `priceListVersion` по R4;
  - каждый вызов `addProduct` на странице кассы (скан, поиск, карточка, возобновление отложенного) передаёт
    `priceVersion: snapshot.version`.
- Modify:
  - `apps/web/src/shared/lib/offline-queue/db.ts` — `OutboxRecord.acceptDiscrepancy?: boolean`;
  - `queue.ts` — `retry(id, options?: { acceptDiscrepancy?: boolean })`;
  - `operations.ts` — заголовок для чека.
- Modify:
  - `apps/web/src/pages/shift/ui/ShiftPage.tsx` — кнопка в строке карантина, если `lastError.code` равен
    `price_rules_violated` и у сессии есть право по R7 (`can`);
  - i18n ru/tg: `core.json` `errors.price_rules_violated`, `pos.json` `shift.quarantine.accept`.

**Interfaces:**
- Consumes: 422 `price_rules_violated`, заголовок `X-Accept-Discrepancy: true` (Task 1).
- Produces: `OfflineQueue.retry(id: string, options?: { acceptDiscrepancy?: boolean }): Promise<void>`.

- [ ] **Step 1:** Версия строки и `priceListVersion` (R4).
- [ ] **Step 2:** Очередь и заголовок; кнопка и тексты. RU: «Цена или скидка не по правилам точки» и «Принять
  расхождение». TJ — перевод, отметка для ревью TJ в описании PR.
- [ ] **Step 3: Живая проверка** (web dev 4210 + `api-oc-4210`, касса привязана, смена открыта):
  - w1 — товар в корзине → владелец меняет цену → снимок обновлён (фокус окна или перезагрузка без оплаты) → «Оплатить»
    → 201, пометка `price`;
  - w2 — в IndexedDB состояние черновика: цена строки вдвое ниже → «Оплатить» → карантин с причиной. Кассир не видит
    кнопку. Заведующий по PIN: «Принять расхождение» → 201, карантин пуст;
  - w3 — правило скидки выключено после снимка → оплата по старому снимку → карантин → заведующий принимает.
- [ ] **Step 4:** `npx nx run-many -t lint test fsd build -p web`.
  Commit: `fix(web): the POS sends the snapshot version of its lines; a manager accepts a refused sale (security review I2)`.

### Task 3: Уведомление владельцу о чеках с пометками

**Files:**
- Create: `apps/api/migrations/<ts>_receipt-discrepancy-notification.sql` — CHECK `notifications_kind_check` и
  `tenant_settings_disabled_notifications_check` с `receipt_discrepancy`.
- Modify:
  - `libs/shared/dto/src/lib/tenant-owner.ts` (и `tenant-home.ts`, если там тот же список) — вид в объединении;
  - `apps/api/src/app/notifications/notification-kinds.ts` — список, событие, право `shifts:view`;
  - `apps/api/src/app/stores/settings.service.ts` — список видов.
- Modify:
  - `apps/api/src/app/pos/pos-alerts.ts` — `discrepanciesByDay(trx, tenantId, after: Date): Promise<ReceiptDiscrepanciesOfDay[]>`
    (`storeId`, `businessDate`, `receipts` — чеки дня с пометкой `price`, `discount` или `author`);
  - `notifications-refresh.ts` — upsert, `dedupeKey: receipt_discrepancy:<store>:<date>`.
- Modify:
  - web `entities/reminder/model/use-reminder-text.ts` (иконка, тон `warning`);
  - `pages/owner/settings/ui/SettingsPage.tsx`;
  - i18n ru/tg `core.json` (`title`/`detail`), `owner.json` (настройка);
  - моки, где перечислены виды.

**Interfaces:**
- Consumes: пометки `price`/`discount`/`author` в `receipts.discrepancy_kinds` (Task 1).

- [ ] **Step 1:** Миграция, DTO, API (R8). RU: заголовок «{receipts, plural, one {# чек} few {# чека} other {# чеков}} с
  расхождением цены, скидки или автора», детали «{store} · проверьте смену и Z-отчёт»; в настройках — «Расхождения в
  чеках».
- [ ] **Step 2:** Web: настройка и текст.
- [ ] **Step 3: Живая проверка:**
  - миграция применена (`npx nx run api:migrate`), `api:db-types-verify` зелёный;
  - n1 — после a4/a5 или w1/w2 владелец видит уведомление по точке и дню;
  - n2 — вид выключен в настройках → новых нет.
- [ ] **Step 4:** `npx nx run-many -t lint test -p api web shared-dto`; `npx nx fsd web`.
  Commit: `feat: the owner is notified of receipts with price, discount or author marks (security review I2)`.
  Пользователь — `npm run check`.

## Изменения при выполнении (журнал `.superpowers/sdd/2026-10-23-security-pos-price-rules/progress.md`)

- R2: окно истории цен — минута до версии снимка и сама версия (любая цена окна), не 5 с.
- R5: процент не выше ступени (меньший — пометка, не отказ).
- R7: «Принять расхождение» — на экране смены PIN-сессии; согласие только для одной отправки, начатой щелчком, не
  хранится в записи буфера; кнопка — при правах на вид отказа (цена, скидка); в карантине видны строки и скидка отказа.
  Под терминалом права берутся у сессии запроса (`TerminalContext.sessionPrincipal`).
- R8: в число входят и отклонённые продажи (`receipt.refused`); выросшее после прочтения число снова непрочитанное.
- Касса запоминает версию снимка вместе с товаром при скане, а не при добавлении строки.
