# История смен и закрытие смены с другого компьютера: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** владелец, заведующий и бухгалтер видят историю смен своих точек и Z-отчёты прошлых смен. Заведующий может закрыть
смену сломанной или недоступной кассы с другого компьютера. Продажи этой кассы, которые придут позже, не теряются.

**Architecture:**
- Два маршрута чтения в модуле `pos` — список смен и карточка смены — и один маршрут закрытия с другого компьютера (онлайн, не
  через буфер).
- Смена, закрытая так, помечается `forced`. Поздние операции той же кассы сервер принимает, а не ставит в карантин:
  - чек — с новой пометкой `after_closing`;
  - внесение или изъятие — с признаком `after_closing`;
  - своё закрытие кассы получает сохранённый Z-отчёт.

  Z-отчёт остаётся снимком на момент закрытия.
- В web:
  - страница «Смены» в разделе «Отчёты»: список, карточка, печать Z-отчёта, закрытие с другого компьютера;
  - касса, вернувшаяся после такого закрытия, видит об этом сообщение.

**Tech Stack:** NestJS, Kysely/`sql`, PostgreSQL (миграция), Next.js static export (FSD), TanStack Query, use-intl. Новых
зависимостей нет.

**Spec:**
- `docs/superpowers/specs/2026-10-13-pos-shift-sale-design.md`:
  - раздел 9 «Вне объёма»: «история смен и отчёты»; «закрытие смены сломанного терминала»;
  - решения E5, E6, E13, E14, E24;
  - раздел 4.4.
- `docs/qa/02-granitsy-pilota.md`, раздел 2: «История смен».
- Gap-анализ 2026-10-26 (память `gap-analysis-2026-10-26`): «shift history, past Z-reports, closing a broken terminal's shift».
- ADR-0015 (буфер кассы, карантин), ADR-0018 (каталог прав, спецправа).

## Решения автора (утверждение плана — утверждение поправок спецификации кассы и ADR-0018)

| № | Вопрос | Решение |
|---|---|---|
| S1 | Список смен | `GET /api/v1/shifts`, право `reports:view`, фильтр охвата точек. Фильтры: `storeId`; `from`, `to` — бизнес-даты открытия `YYYY-MM-DD`, по умолчанию последние 7 дней сети; `status` (`open` \| `closed`, без него — все); `limit` (по умолчанию 20, ≤ 100), `offset`. Сортировка — по `opened_at` от новых. У закрытой смены итоги берутся из сохранённого Z-отчёта, у открытой считаются как на экране смены. Открытых смен столько, сколько касс: считаются по одной |
| S2 | Карточка смены | `GET /api/v1/shifts/{id}`, право `reports:view`, точка в охвате (иначе 404). Содержит: смену (открытая — сейчас, закрытая — из Z-отчёта); точку, кассу и кто закрыл; Z-отчёт закрытой; операции после закрытия; время последней операции кассы; реквизиты для печати — как в снимке кассы (`PosRepository.store`) |
| S3 | Закрытие с другого компьютера | `POST /api/v1/shifts/{id}/forced-closure`. Только онлайн, сессия по паролю (свежий вход ADR-0008 PIN-сессия не даёт — web вместо кнопки подсказывает войти паролем), точка в охвате; смена офлайн-точки — 409 `offline_store_read_only` (её смены — её факты, ADR-0014). Спецправо `shifts:force-close`, `@RequireFreshAuth`, `Idempotency-Key` = `id` тела (область `shift.force-close`). Тело: наличные в ящике (≥ 0), суммы банковского терминала (≥ 0), причина (1–500 символов, обязательна). Смена должна быть открытой, иначе 409 `shift_closed`. Ожидаемые наличные, расхождение и Z-отчёт — как при обычном закрытии (E24). В Z-отчёте `forced: { byName, reason }`, `discrepancyReasonMissing = false`. Отложенные чеки смены удаляются. Аудит `shift.force-closed`. После этого кассу можно отвязать (E14) |
| S4 | Поздние операции | Касса не знает о закрытии, пока не выйдет на связь. Операции её смены, закрытой с другого компьютера, сервер принимает: чек — как факт (K4) с пометкой `after_closing`, со всеми обычными проверками E6, остатки двигаются; внесение и изъятие — с признаком `after_closing`; своё закрытие кассы — 201 и сохранённый Z-отчёт, смена не меняется, аудит `shift.close-superseded` с наличными, которые насчитала касса. Ничего из этого не меняет Z-отчёт: в карточке смены видно «после закрытия: N чеков, сумма, внесения, изъятия». Смена, закрытая обычным порядком, — как раньше: 409 `shift_closed` |
| S5 | Касса после возвращения | Касса запоминает последнюю известную открытую смену. Если сервер отвечает «открытой смены нет», касса спрашивает Z-отчёт этой смены (`GET /shifts/{id}/z-report`, `shifts:view`). Если он `forced`, на экранах «Касса» и «Смена» показывается: «Смена {number} закрыта с другого компьютера: {name}, {time}. Неотправленные продажи дойдут в неё. Откройте новую смену». Сообщение пропадает, когда открыта новая смена |
| S6 | Право | Новое спецправо `shifts:force-close` (поправка ADR-0018): входит в шаблон «Заведующий точкой» и в роль «Владелец» (весь каталог). Существующим ролям не добавляется: так же решено для `employees:manage-peers`, а сетей с реальными данными ещё нет. У кассира права нет |
| S7 | Кто видит историю | `reports:view`: владелец, заведующий, бухгалтер; у каждого — только точки его охвата. Кассир истории не видит: нет ни пункта меню, ни ответа API — 403. Пункт меню «Смены» — в разделе «Отчёты». Маршруты web — `/shifts` и `/shifts/view?id=` |
| S8 | Печать | Z-отчёт закрытой смены печатается из карточки в том же формате, что на кассе. `zReportLines` переезжает из `pages/shift/lib` в `entities/shift/lib`: теперь им пользуются два экрана. В отчёте смены, закрытой с другого компьютера, есть строка «Закрыта с другого компьютера: ФИО · причина» |
| S9 | Схема | Миграция `shift-forced-closure`: `shifts.forced boolean not null default false`, `shifts.forced_reason text` (1–500 при `forced`, `check (forced = (forced_reason is not null))`); `shift_cash_operations.after_closing boolean not null default false`; пометка `after_closing` в CHECK `receipts.discrepancy_kinds`; индекс `shifts_store_opened_idx (tenant_id, store_id, opened_at desc)` для списка |
| S10 | Документы | Поправка спецификации кассы 2026-10-27: раздел «История смен и закрытие с другого компьютера», E5 (`after_closing`), примечания к E6, E13, E14, раздел 9. Поправка ADR-0018 (спецправо). Модель данных 04. Строка в APPROVAL.md. «Границы пилота»: строка «История смен» уходит из раздела 2, поведение — в раздел 3 |
| S11 | Вне плана | Выгрузка истории в Excel (библиотека не выбрана). Правка закрытой смены. Смены офлайн-точки (вне пилота). Отчёт «Кассиры» не меняется. Уведомление о закрытии с другого компьютера не заводится: расхождение наличных уже уведомляет (`shift_discrepancy`) |

## Global Constraints

- Тесты отложены до MVP: проверка — живая. Существующие наборы остаются зелёными. Моки web исчерпывающие (`MockHandlers` —
  все ключи `ApiRouteKey`): новые маршруты получают моки, повторяющие контракт API. Новые маршруты — в `REAL_API_ROUTES`.
- Стенд проверки — копия dev-БД `pharmacy_shift_check`, как у A2:
  - `pg_dump | pg_restore` суперпользователем контейнера, права сохраняются;
  - обёртка в scratchpad меняет имя БД в URL `.env`; режимы `migrate`, `script`, `api`;
  - конфигурация `api-shift-check` (`apps/api/dist/main.js`, env как у `api-oc-4210`, без `STEP_UP_MAX_AGE_SECONDS`);
  - web — `web-partial-4210` на `http://127.0.0.1:4210`.

  Владелец синтетической сети `staff-owner-20007` получает пароль новым кодом активации на копии
  (`create-activation-code.mjs` через обёртку). Касса привязывается на копии. После проверки копию, конфигурацию и обёртку
  удалить. `npx nx run api:db-types` — по копии.
- Redis общий с dev: блокировки и сессии — только у новых синтетических сотрудников (`sh-…`).
- Деньги — целые дирамы; бизнес-дата — в часовом поясе сети (`tenantTimeZone`); `tenant_id` во всех запросах.
- Миграция — SQL, только Up, `set local lock_timeout = '5s'`. CHECK пересобирается, как в
  `1792744644428_login-locked-notification.sql`.
- Prettier — только для файлов, отформатированных на HEAD. Порты 4200/4201 не использовать. Коммиты `--no-gpg-sign`,
  Conventional Commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. TJ-тексты — с отметкой для ревью TJ.

## Review Focus

1. **Продажа на сломанной кассе ушла в буфер, смену закрыли с другого компьютера, связь вернулась.** Ожидается: чек принят,
   остаток списан, в карточке смены — «после закрытия: 1 чек», Z-отчёт не изменился. Проверка — задача 2, f2.
2. **Своё закрытие кассы приходит после закрытия с другого компьютера.** Ожидается: операция не застревает в карантине,
   касса получает Z-отчёт заведующего. Проверка — задача 2, f3; задача 4, w2.
3. **Две попытки закрыть одновременно** (заведующий с другого компьютера и сама касса или два заведующих). Ожидается: одна
   выигрывает, вторая получает 409 или сохранённый Z-отчёт; двух закрытий нет. Проверка — задача 2, f5.
4. **Заведующий одной точки и смена другой.** Ожидается: в списке её нет, карточка — 404, закрытие — 404. Проверка —
   задача 1, h3; задача 2, f6.
5. **Бухгалтер и кассир.** Ожидается: бухгалтер видит историю, но не закрывает (403); кассир не видит ни меню, ни API
   (403). Проверка — задача 1, h3; задача 2, f6.

---

### Task 1: Сервер — список и карточка смены, миграция

**Files:**
- Create: `apps/api/migrations/<Date.now()>_shift-forced-closure.sql` (S9).
- Modify: `apps/api/src/core/database/db.generated.ts` (`npx nx run api:db-types` по копии).
- Modify:
  - `libs/shared/dto/src/lib/tenant-pos.ts` — типы Interfaces ниже, `ZReport.forced?`;
  - `apps/api/src/app/pos/dto/pos.dto.ts` — `ShiftListQueryDto` с class-validator: `IsUUID`, даты `YYYY-MM-DD`, `IsIn`,
    limit 1–100, offset ≥ 0.
- Modify:
  - `apps/api/src/app/pos/shifts.repository.ts` — `list`, `afterClosing`, `lastActivityAt`; `forced` и `forcedReason` в
    `ShiftRow` и `SHIFT`;
  - `shifts.service.ts` — `list`, `details`;
  - `shifts.controller.ts` — маршруты `GET /shifts` и `GET /shifts/:id`, оба после `current`, чтобы `:id` не перехватил
    `current`.

**Interfaces — Produces:**
```ts
export interface ShiftListQuery { storeId?: string; from?: string; to?: string; status?: ShiftStatus; limit?: number; offset?: number }
export interface ShiftListItem {
  id: string; number: string; storeId: string; storeName: string; terminalName: string; status: ShiftStatus;
  openedAt: string; openedByName: string; closedAt: string | null; closedByName: string | null;
  /** closed from another computer (S3) */ forced: boolean;
  receipts: number; revenueMinor: number;
  /** counted − expected of a closed shift; null while open */ discrepancyMinor: number | null;
  discrepancyReceipts: number; reasonMissing: boolean;
  /** receipts accepted after a forced closing (S4) */ afterClosingReceipts: number;
}
export interface ShiftListResponse { items: ShiftListItem[]; total: number; limit: number; offset: number }
export interface ShiftAfterClosing { receipts: number; revenueMinor: number; cashInMinor: number; cashOutMinor: number }
export interface ShiftDetails {
  shift: Shift; storeName: string; terminalName: string; closedByName: string | null;
  zReport: ZReport | null; afterClosing: ShiftAfterClosing;
  /** the last receipt or cash operation of the shift received from its till */ lastActivityAt: string | null;
  print: { storeName: string; storeAddress: string; taxId: string };
}
// ZReport:
forced?: { byName: string; reason: string };
```
Репозиторий:
- `list(trx, tenantId, scope: 'all' | readonly string[], filter): Promise<{ rows: ShiftListRow[]; total: number }>`;
- `afterClosing(trx, tenantId, shiftId): Promise<ShiftAfterClosing>`;
- `lastActivityAt(trx, tenantId, shiftId): Promise<Date | null>`.

- [ ] **Step 1: Миграция** (S9) на копии: обёртка `migrate`; затем `npx nx run api:db-types` по копии →
  `db.generated.ts` с новыми столбцами.
- [ ] **Step 2: DTO и `ShiftListQueryDto`.**
- [ ] **Step 3: Репозиторий и сервис.**
  - Даты по умолчанию — `to` = сегодня сети, `from` = `to` − 6 дней. Бизнес-дата открытия —
    `(opened_at at time zone tenantTimeZone)::date`.
  - Закрытая смена: `receipts`, `revenueMinor`, `discrepancyReceipts` — из `z_report->'shift'`; `discrepancyMinor`,
    `reasonMissing` — из `z_report`.
  - Открытая смена: `ShiftMapper.view`.
  - `afterClosingReceipts` — чеки смены с пометкой `after_closing`.
  - Карточка закрытой смены: `shift` = `zReport.shift`.
- [ ] **Step 4: Наборы.** `npx nx run-many -t lint test -p api shared-dto`, `npx nx run api:typecheck` → зелёные.
- [ ] **Step 5: Живая проверка** (стенд из Global Constraints):
  - h1 — владелец, `GET /api/v1/shifts`: смены синтетической сети за 7 дней. У закрытых итоги совпадают с их Z-отчётом.
    Фильтры `status=open`, `storeId`, `from/to` сужают список; `limit=1&offset=1` — вторая страница.
  - h2 — `GET /api/v1/shifts/{id}`:
    - закрытая смена: `zReport`, `print` с адресом и ИНН точки;
    - открытая: живые итоги и `lastActivityAt`.
  - h3 — заведующий точки A, смена точки B: в списке её нет, карточка — 404. Бухгалтер — 200. Кассир по PIN — 403.
- [ ] **Step 6: Commit** `feat(api): shift history — a list of the shifts of the scope and a shift card with its Z-report`.

### Task 2: Сервер — закрытие с другого компьютера и поздние операции, документы

**Files:**
- Modify:
  - `libs/shared/domain/src/lib/permissions.ts` — `shifts:force-close` в `specialPermissions`;
  - `role-templates.ts` — в шаблон `manager`.
- Modify: `libs/shared/dto/src/lib/tenant-pos.ts` — `ForceCloseShiftRequest`; `apps/api/src/app/pos/dto/pos.dto.ts` —
  `ForceCloseShiftDto`.
- Modify:
  - `shifts.controller.ts` — `POST :id/forced-closure`, `@RequireFreshAuth()`, без `@BufferedOperation`;
  - `shifts.service.ts` — `forceClose`; поздние операции в `cashMovement` и `close`;
  - `receipts.service.ts` — принятие чека закрытой с другого компьютера смены;
  - `receipts.repository.ts` — пометка `after_closing`;
  - `shifts.repository.ts` — `closeShift` с `forced`, `forcedReason`; `insertCashOperation` с `afterClosing`.
- Docs:
  - спецификация кассы (S10);
  - поправка ADR-0018 «2026-10-27: закрытие смены с другого компьютера»;
  - `docs/architecture/data-model/04-*.md`;
  - `docs/architecture/APPROVAL.md`.

**Interfaces:**
- Consumes: столбцы задачи 1, `ZReport.forced`.
- Produces:
  ```ts
  export interface ForceCloseShiftRequest {
    id: string; actualCashMinor: number;
    terminalTotals: Record<Exclude<ReceiptPaymentMethod, 'cash'>, number>;
    reason: string;
  }
  ```
  `POST /api/v1/shifts/{id}/forced-closure` → 201 `ZReport` (с `forced`). Ошибки: 403 `fresh_auth_required` / `forbidden`;
  404 `not_found` (нет смены или вне охвата); 409 `shift_closed`, `idempotency_conflict`; 400 `validation_failed`.
- Shift lock: у `ShiftsService.lockOpenShift(trx, tenantId, shiftId, terminalId, mode)` появляется шестой параметр
  `late: 'refuse' | 'accept-forced' = 'refuse'`. При `accept-forced` закрытая смена своей кассы с `forced = true`
  возвращается, а не даёт 409 `shift_closed`; вызывающий проверяет `shift.status`.

- [ ] **Step 1: Право и DTO.**
- [ ] **Step 2: `forceClose(shiftId, body, key)`.**
  - Порядок: идемпотентность (повтор — сохранённый ответ); смена в охвате `requirePrincipal()` (иначе 404);
    `lockShift(..., 'update')`; открыта, иначе 409 `shift_closed`.
  - Расчёт — как в `close` (E24): автор — сотрудник сессии, момент — сейчас.
  - `closeShift` с `forced: true`, `forcedReason`; удаление отложенных чеков; аудит `shift.force-closed` (`number`,
    `terminalId`, `expectedMinor`, `actualCashMinor`, `discrepancyMinor`, `reason`).
  - Общее с `close` (расчёт Z-отчёта) выносится в приватную функцию сервиса — без копии.
- [ ] **Step 3: Поздние операции (S4).**
  - Чек: `lockOpenShift(..., 'share', 'accept-forced')`; если смена закрыта с другого компьютера — пометка `after_closing`.
  - Внесение и изъятие: так же, `after_closing = true`, в итоги закрытой смены не входят.
  - Своё закрытие кассы закрытой с другого компьютера смены: 201 и `zReport` строки. Ключ идемпотентности сохраняется
    (повтор — тот же ответ). Аудит `shift.close-superseded` (`number`, `actualCashMinor` кассы).
  - Итоги `ShiftMapper.view` и `totals` не учитывают операции `after_closing`. Их считает `afterClosing` из задачи 1.
- [ ] **Step 4: Документы** (S10).
- [ ] **Step 5: Наборы.** `npx nx run-many -t lint test -p api shared-dto shared-domain`, `npx nx run api:typecheck` →
  зелёные.
- [ ] **Step 6: Живая проверка** (касса T1 на копии — привязка через `POST /terminals` с device-cookie, кассир `sh-cash` по
  PIN, заведующий `sh-mgr` по паролю):
  - f1 — T1 открывает смену и продаёт 2 чека. `sh-mgr` с другого компьютера: закрытие без свежего входа → 403
    `fresh_auth_required`. После подтверждения пароля → 201, в Z-отчёте `forced` с причиной; отложенный чек T1 удалён;
    T1 после этого отвязывается (E14).
  - f2 — чек T1 с `shiftId` закрытой смены, `occurredAt` до закрытия (досылка буфера) → 201, `discrepancies` ≥ 1. В
    карточке `afterClosing.receipts = 1`, остаток партии уменьшился, Z-отчёт прежний.
  - f3:
    - внесение T1 в ту же смену → 201, в карточке `afterClosing.cashInMinor`;
    - закрытие T1 (`POST /shifts/{id}/closure`) → 201 с Z-отчётом заведующего, в журнале `shift.close-superseded`;
    - повтор с тем же ключом → тот же ответ.
  - f4 — смена, закрытая обычным порядком: поздний чек → 409 `shift_closed`, как раньше.
  - f5 — два одновременных `forced-closure` с разными ключами → одно 201, другое 409 `shift_closed`. Закрытие
    заведующего и закрытие T1 одновременно → одно закрытие; T1 получает Z-отчёт заведующего или свой.
  - f6 — кассир по PIN → 403; заведующий точки A, смена точки B → 404; бухгалтер → 403.
  - f7 — повтор с тем же ключом → тот же Z-отчёт.
- [ ] **Step 7: Commit** `feat(api): a manager closes the shift of a broken till from another computer; its late sales are kept`.

### Task 3: Web — страница «Смены»: список, карточка, печать, закрытие с другого компьютера

**Files:**
- Move: `apps/web/src/pages/shift/lib/z-report.ts` → `apps/web/src/entities/shift/lib/z-report.ts`. Экспорт из
  `entities/shift/index.ts`; `ShiftPage` импортирует оттуда. В `ZReportLabels` добавляется `forced`: строка
  «Закрыта с другого компьютера: {name} · {reason}».
- Create:
  - `apps/web/src/pages/shift-history/` — срез FSD: `index.ts`, `ui/ShiftHistoryPage.tsx` (список, фильтры, пагинация),
    `ui/ShiftCardPage.tsx` (карточка, печать Z-отчёта, закрытие с другого компьютера);
  - маршруты `apps/web/app/(shell)/shifts/page.tsx` и `shifts/view/page.tsx` — реэкспорт;
  - `features/force-close-shift/` — диалог: наличные, банковский терминал по видам (по умолчанию — системные суммы),
    причина; `withFreshAuth`; `Idempotency-Key` из `uuid` v7; предупреждение «последняя операция кассы: {time};
    операции, которые касса не отправила, дойдут в эту смену после закрытия».
- Modify:
  - `shared/api/routes.ts` — `shifts.list`, `shifts.details`, `shifts.forceClose`; `client.ts` — в `REAL_API_ROUTES`;
  - моки `handlers-pos.ts` — по мок-смене;
  - `shared/config/routes.ts` — `shiftHistory: '/shifts'`, `shiftCard(id)`;
  - `widgets/app-shell/config/navigation.ts` — `shiftHistory` в разделе `reporting`, право `reports:view`, значок `clock`;
  - i18n ru/tg (`core.json` — меню, `pos.json` или `owner.json` — по соседству со строками отчётов).

**Interfaces:**
- Consumes: маршруты задач 1 и 2 (`ShiftListResponse`, `ShiftDetails`, `ForceCloseShiftRequest`, `ZReport.forced`).
- Produces: `zReportLines(report, settings, labels, cols, preliminary?)` из `@/entities/shift`.

- [ ] **Step 1: Перенос `zReportLines` и строка `forced`.**
- [ ] **Step 2: Маршруты, моки, меню.**
- [ ] **Step 3: Список.**
  - Колонки: номер; точка; касса; открыта (кто, когда); закрыта (кто, когда, метка «с другого компьютера»); чеков;
    выручка; расхождение наличных; пометки («причина не указана», «после закрытия N»).
  - Фильтры: точка (охват), период, статус. По 20 на страницу.
  - Строка открывает карточку.
- [ ] **Step 4: Карточка.**
  - Итоги как на экране смены, способы оплаты, наличные, журнал событий.
  - У закрытой — Z-отчёт с предпросмотром и печатью 80/58 мм и блок «после закрытия».
  - У открытой — кнопка «Закрыть с другого компьютера», при праве `shifts:force-close`.
- [ ] **Step 5: Тексты RU, TJ.** RU:
  - меню «Смены»;
  - кнопка «Закрыть с другого компьютера»;
  - диалог — «Закрыть смену кассы {terminal}», «Наличные в ящике», «Причина (обязательно)»;
  - предупреждение — «Последняя операция кассы: {time}. Операции, которые касса не успела отправить, дойдут в эту смену
    после закрытия и в Z-отчёт не войдут»;
  - метка «с другого компьютера»;
  - блок «После закрытия: {receipts} чеков на {amount}, внесения {in}, изъятия {out}».
- [ ] **Step 6: Наборы.** `npx nx run-many -t lint test fsd -p web`, `npx nx fsd web` → зелёные.
- [ ] **Step 7: Живая проверка** (web 4210 + `api-shift-check`):
  - w1 — владелец: «Отчёты» → «Смены», фильтры, карточка закрытой смены, печать Z (предпросмотр). У кассира пункта нет.
  - w2 — заведующий на компьютере без кассы: открытая смена T1 → «Закрыть с другого компьютера». Пароль не вводился
    давно — окно подтверждения, затем 201. Карточка — «закрыта с другого компьютера», Z с причиной.
  - w3 — без причины кнопка неактивна; наличные < 0 не принимаются.
- [ ] **Step 8: Commit** `feat(web): shift history — the shifts of the scope, a shift card with its Z-report, closing from another computer`.

### Task 4: Web — касса узнаёт о закрытии с другого компьютера; документы QA

**Files:**
- Modify:
  - `apps/web/src/shared/lib/terminal-cache` — `rememberClosedElsewhere(store, shiftId)`, `closedElsewhere(store)`,
    `forgetClosedElsewhere(store)`;
  - `entities/shift/api/use-current-shift.ts` — при 404 и запомненной смене кладёт её id в `closedElsewhere`;
  - `entities/shift/api/use-closed-elsewhere.ts` — `useClosedElsewhere(storeId)` → `ZReport | null`: по id спрашивает
    `shifts.zReport` и отдаёт отчёт только с `forced`; когда открыта новая смена, `forgetClosedElsewhere`.
- Modify: `pages/pos/ui/PosPage.tsx`, `pages/shift/ui/ShiftPage.tsx` — `Alert` с текстом S5; i18n ru/tg (`pos.json`).
- Docs: `docs/qa/02-granitsy-pilota.md` — строка «История смен» уходит из раздела 2; в разделе 3 — «Смены»: история —
  в «Отчёты → Смены», закрытие с другого компьютера, поздние продажи.

**Interfaces:**
- Consumes: `ZReport.forced` (задача 1), поведение S4 (задача 2).
- Produces: `useClosedElsewhere(storeId: string | null): ZReport | null`.

- [ ] **Step 1: Кэш терминала и хуки.**
- [ ] **Step 2: Сообщение на «Кассе» и «Смене».**
  - RU: «Смена {number} закрыта с другого компьютера: {name}, {time}. Неотправленные продажи дойдут в неё. Откройте
    новую смену».
  - TJ — перевод с отметкой для ревью.
- [ ] **Step 3: Документ QA.**
- [ ] **Step 4: Наборы.** `npx nx run-many -t lint test fsd -p web` → зелёные.
- [ ] **Step 5: Живая проверка:**
  - w1 — касса T1 в браузере 4210 (кассир по PIN, смена открыта). API для неё «сломан» — DevTools offline или фильтр
    запросов. Продажа уходит в буфер. Заведующий закрывает смену с другого компьютера (curl или второй профиль).
  - w2 — связь T1 вернулась:
    - буфер досылает чек (201, `after_closing`);
    - на «Кассе» — сообщение S5;
    - «Открыть смену» открывает новую, сообщение пропадает;
    - очередь пуста, карантина нет.
- [ ] **Step 6: Commit** `feat(web): a till learns that its shift was closed from another computer; QA boundaries`.
