# Кабинет владельца, PR 3: прочие расходы — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** владелец раз в месяц вносит прочие расходы сети и точек. В отчёте «Продажи по точкам» он видит расходы
месяца долей по дням периода, изъятия из кассы «на расходы» и чистую прибыль.

**Architecture:**
- Новая таблица `expenses` (класс `tenant`, полный DML). CRUD `GET/POST/PUT/DELETE /expenses` в модуле `reports`
  (спецификация 5.1): контроллер, сервис, репозиторий, каждое изменение пишется в аудит.
- Доля месяца — чистая функция `prorateExpense` в `libs/shared/domain`.
- Изъятия из кассы с причиной `expense` модуль `pos` отдаёт через свой экспорт `SalesFigures`
  (`cashExpensesByStore`).
- «Продажи по точкам» получают колонки `expenses`, `cashExpenses`, `netProfit`, только если у сотрудника есть и
  `finance:view-cost`, и `expenses:view`.
- Web: новый экран «Расходы» (`/expenses`) и три колонки в отчёте.

**Tech Stack:** NestJS 11, class-validator, Kysely + pg (CamelCasePlugin), node-pg-migrate (SQL, только Up), RLS через
`tenantTransaction`; Next.js static export, TanStack Query, React Hook Form + zod, use-intl, `@pharmacy/ui`; Jest.

**Spec:** `docs/superpowers/specs/2026-10-14-owner-cabinet-design.md` — PR 3. Разделы: O4, O5, O9, E16; 3.1 п. 3–4;
4 «PR 3»; 5.1; 5.3 (колонки PR 3); 5.6; 6.6; 7; 8 «PR 3»; 10; 11.

## Global Constraints

**Тесты.**
- Новый автотест один: unit-тест `prorateExpense` в `libs/shared/domain` (спецификация 11). Других новых тестов нет
  (правило «тесты до MVP»).
- Существующие наборы остаются зелёными: `shared-domain`, `api`, `api:integration`, `web`, `web-e2e`, обязательно и
  `npx nx test api`.
- API и экран проверяются вживую: curl-скрипт `oc_expenses.sh` в scratchpad сессии (на основе `pos_setup.sh`) и браузер
  (`api-oc-4210` + `web-partial-4210`).

**Окружение Windows.**
- Nx: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx …`, `--parallel=1`.
- `api-oc-4210` раздаёт `dist`: после сборки — перезапуск.
- Скрипты с кавычками пишутся инструментом Write, не heredoc.

**Git.**
- Ветка `feature/owner-cabinet-expenses` создаётся без upstream:
  `git switch -c feature/owner-cabinet-expenses --no-track origin/main`. Upstream `origin/main` уже дважды отправил
  коммиты прямо в `main`.
- Перед первой правкой проверить, что upstream нет: `git rev-parse --abbrev-ref feature/owner-cabinet-expenses@{u}`
  должен выдать ошибку.
- Коммиты — `git commit --no-gpg-sign`, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Не коммитить `package.json`, `apps/web/next-env.d.ts`, `.claude/launch.json`, `.claude/agent-memory/`.

**Запись расхода (E16).**
- Поля: `month` (`YYYY-MM` в API, `date` первого числа в БД), `storeId` (`null` — вся сеть),
  `kind ∈ {rent, salary, utilities, other}`, `amountMinor` (целое 1…10 000 000 000 дирамов), `comment` (≤ 500 символов
  или `null`).
- Месяц — не позже текущего месяца сети, иначе 422 `validation_failed` (`month`, `range`).

**Права.**
- Новый модуль каталога `expenses: ['view', 'create', 'update', 'delete']`.
- Владелец получает права автоматически: системная роль — весь каталог (`principal-loader.ts`). Шаблоны других ролей не
  меняются, миграции прав нет.
- `GET` требует `expenses:view`; `POST` / `PUT` / `DELETE` — `expenses:create` / `update` / `delete`.

**Охват.**
- `storeId` запроса или записи вне охвата — 403 `store_not_in_scope`. Неизвестная или неактивная точка — тоже 403
  `store_not_in_scope`.
- Запись сети (`storeId: null`) читает, создаёт, меняет и удаляет только сотрудник с охватом «вся сеть». Остальным
  такие записи не видны в списке, а изменение — 403 `store_not_in_scope`.
- Неизвестный `id` — 404 `not_found`. PIN-сессия — охват точки терминала.

**Доля месяца.** `prorateExpense(amountMinor, month, from, to)` — это
`amountMinor × дни пересечения [from, to] с месяцем / дни месяца`. Каждая запись округляется отдельно, половина — вверх;
счёт только в целых числах.

**Отчёт «Продажи по точкам».**
- Колонки `expenses`, `cashExpenses`, `netProfit` есть, только если у сотрудника и `finance:view-cost`, и
  `expenses:view`.
- Знаки — как у `returns` и `losses`: расходы отрицательные, `netProfit = margin + expenses + cashExpenses`.
- Расходы сети попадают только в итог и только при охвате «вся сеть» без `storeId`.
- `cashExpenses` — изъятия `kind = 'withdrawal'`, `reason = 'expense'` целиком. Точка — точка смены; дата — бизнес-дата
  `occurred_at` в часовом поясе сети (`tenant_settings.timezone`, по умолчанию `Asia/Dushanbe`). Инкассация
  (`collection`) не входит.

**Аудит.**
- События `expense.created`, `expense.updated`, `expense.deleted`; `entityType: 'expense'`, `storeId` — точка записи.
- `details`: `month`, `expenseKind`, `amountMinor`, `comment`. У `updated` ещё `before` и `after`, у `deleted` —
  `before` (прежние значения).

## Review Focus

1. **Период через границу месяцев** (20.09–10.10). Каждая запись делится по своему месяцу: сентябрь — 11/30, октябрь —
   10/31. Проверка — Задача 1 (unit) и Задача 3 (curl).
2. **Управляющий точки A с `expenses:view`.** Список и отчёт — без записей сети и чужой точки. Создать запись сети и
   записать на точку B — 403. Проверка — Задачи 2, 3 (curl).
3. **Изъятие около полуночи и инкассация.** Изъятие «на расходы» с `occurredAt` в 00:30 по Душанбе (19:30 UTC
   предыдущего дня) попадает в отчёт за сегодня. Инкассация не попадает. Проверка — Задача 3 (curl).
4. **Журнал действий для управляющего с `audit:view` без `expenses:view`.** События расходов своей точки видны, суммы —
   нет: зарплаты и аренда закрыты (E16). Проверка — Задача 2 (curl).
5. **Правка меняет месяц или точку.** Отчёт старого месяца теряет запись, отчёт нового получает. В журнале — прежние и
   новые значения. Проверка — Задачи 2, 3 (curl).

---

### Task 1: Домен и контракт

**Files:**
- Create: `libs/shared/domain/src/lib/expenses.ts`, `libs/shared/domain/src/lib/expenses.spec.ts`
- Modify: `libs/shared/domain/src/index.ts`, `libs/shared/domain/src/lib/permissions.ts`,
  `libs/shared/domain/src/lib/audit-groups.ts`, `libs/shared/dto/src/lib/tenant-owner.ts`

**Interfaces:**
- Produces (domain):
  - `export const expenseKinds = ['rent', 'salary', 'utilities', 'other'] as const`;
  - `export type ExpenseKind = (typeof expenseKinds)[number]`;
  - `prorateExpense(amountMinor: number, month: string /* YYYY-MM */, from: string, to: string /* YYYY-MM-DD */): number`;
  - `daysInMonth(month: string): number`.
- Produces (права): модуль каталога `expenses: ['view', 'create', 'update', 'delete']`.
- Produces (аудит): группа `expense`, последняя в `auditGroups`, правило `{ group: 'expense', prefixes: ['expense.'] }`.
- Produces (DTO, `tenant-owner.ts`):
  - `Expense { id; month: string; storeId: string | null; storeName: string | null; kind: ExpenseKind; amountMinor: number; comment: string | null }`;
  - `CashExpensesOfStore { storeId; storeName; amountMinor; operations: number }`;
  - `ExpenseListResponse { items: Expense[]; totalMinor: number; cashExpenses: CashExpensesOfStore[] }`;
  - `ExpenseQuery { month: string; storeId?: string }`;
  - `CreateExpenseRequest { month; storeId: string | null; kind; amountMinor; comment: string | null }`;
  - `UpdateExpenseRequest = CreateExpenseRequest`.
  - `ExpenseKind` реэкспортируется из domain.

- [ ] **Step 1: Написать `expenses.spec.ts`** (тест `describe('prorateExpense')`, значения из спецификации O5):

```ts
expect(prorateExpense(310_000, '2026-10', '2026-10-01', '2026-10-14')).toBe(140_000); // 14/31
expect(prorateExpense(100, '2026-10', '2026-10-01', '2026-10-14')).toBe(45);          // 45.16
expect(prorateExpense(1, '2026-11', '2026-11-01', '2026-11-15')).toBe(1);             // 0.5 → вверх
expect(prorateExpense(123_457, '2026-10', '2026-09-01', '2026-12-31')).toBe(123_457); // весь месяц
expect(prorateExpense(500, '2026-10', '2026-11-01', '2026-11-30')).toBe(0);           // нет пересечения
expect(prorateExpense(3_000, '2026-09', '2026-09-20', '2026-10-10')).toBe(1_100);     // 11/30
expect(prorateExpense(3_100, '2026-10', '2026-09-20', '2026-10-10')).toBe(1_000);     // 10/31
expect(prorateExpense(2_900, '2028-02', '2028-02-01', '2028-02-10')).toBe(1_000);     // високосный 29 дней
expect(daysInMonth('2026-02')).toBe(28);
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx test shared-domain --testPathPatterns=expenses`
Expected: FAIL — `Cannot find module './expenses'`.

- [ ] **Step 3: Реализовать `expenses.ts`**

Дни пересечения считаются по UTC-датам: `max(from, 1-е число)` … `min(to, последний день)`; при пустом пересечении —
0. Округление в целых: `Math.floor((2 * amountMinor * days + dim) / (2 * dim))`. Добавить экспорт в `index.ts`.

- [ ] **Step 4: Запустить тест**

Run: та же команда.
Expected: PASS 9/9.

- [ ] **Step 5: Права, группа аудита, контракт**

Добавить `expenses` в `moduleActions` после `reports`. Добавить группу `expense` и правило в `audit-groups.ts`. Добавить
типы DTO в `tenant-owner.ts` рядом с отчётами; к комментарию `ReportTable` дописать, что колонки `expenses`,
`cashExpenses` и `netProfit` присутствуют только с `finance:view-cost` и `expenses:view`.

- [ ] **Step 6: Прогнать наборы библиотек**

Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t test lint build -p shared-domain shared-dto --parallel=1`
Expected: зелёные. Если `permissions.spec` или тест групп журнала сверяет полный список — обновить ожидание (ruling в
реестре).

- [ ] **Step 7: Commit**

```bash
git add libs/shared/domain libs/shared/dto
git commit --no-gpg-sign -m "feat(domain): expenses — kinds, prorated share of a month, permissions, journal group"
```

---

### Task 2: Таблица `expenses` и API расходов

**Files:**
- Create: `apps/api/migrations/<Date.now()>_expenses.sql`; в `apps/api/src/app/reports/`: `expenses.controller.ts`,
  `expenses.service.ts`, `expenses.repository.ts`, `dto/expenses.dto.ts`, `scope.ts`
- Modify:
  - `apps/api/src/core/database/table-classes.ts`, `apps/api/src/core/database/db.generated.ts` (через `api:db-types`);
  - `apps/api/src/app/reports/{reports.module.ts, reports.service.ts, dashboard.service.ts}`;
  - `apps/api/src/app/pos/sales-figures.ts`;
  - `apps/api/src/app/audit/audit-journal.ts`;
  - `docs/architecture/data-model/01-*.md`, `docs/architecture/data-model/README.md`.

**Interfaces:**
- Consumes: Task 1 — `expenseKinds`, `ExpenseKind`, DTO расходов, права `expenses:*`, группа `expense`.
- Produces:
  - `scopeOf(principal: EmployeePrincipal): 'all' | readonly string[]` в `reports/scope.ts`. Его импортируют
    `reports.service.ts`, `dashboard.service.ts`, `expenses.service.ts`; это закрывает часть минорного замечания M7 PR 2.
  - `SalesFigures.cashExpensesByStore(trx, tenantId, storeIds: readonly string[], from: string, to: string): Promise<{ storeId: string; amountMinor: number; operations: number }[]>`.
  - `ExpensesRepository.ofMonths(trx, tenantId, fromMonth: string, toMonth: string): Promise<{ id; month /* YYYY-MM */; storeId: string | null; kind: ExpenseKind; amountMinor: number; comment: string | null }[]>`
    плюс `find`, `insert`, `update`, `remove` по `id`.
  - `ExpensesService` экспортируется из `ReportsModule` только внутри модуля.

- [ ] **Step 1: Миграция** (по образцу `1791956981070_owner-cabinet.sql`)

```sql
create table pharmacy.expenses (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  month date not null check (extract(day from month) = 1),
  store_id uuid,
  kind text not null check (kind in ('rent', 'salary', 'utilities', 'other')),
  amount_dirams bigint not null check (amount_dirams > 0),
  comment text check (char_length(comment) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, created_by) references pharmacy.employees (tenant_id, id),
  foreign key (tenant_id, updated_by) references pharmacy.employees (tenant_id, id)
);
```

Добавить:
- индексы `(tenant_id, month)`, `(tenant_id, store_id)`, `(tenant_id, created_by)`, `(tenant_id, updated_by)`;
- `enable` / `force row level security`, политику `tenant_isolation` для `pharmacy_app`;
- `grant select, insert, update, delete … to pharmacy_app`.

В шапке — ссылка на спецификацию (3.1 п. 3, 4 «PR 3»). В `table-classes.ts` — `expenses: 'tenant'`.

- [ ] **Step 2: Применить и перегенерировать типы**

Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run api:migrate`, затем `… npx nx run api:db-types`.
Expected: `Applied 1 migration(s)`; в `db.generated.ts` появляется `Expenses`. Этот сгенерированный файл коммитится.

- [ ] **Step 3: DTO валидации** (`dto/expenses.dto.ts`)

- `ExpenseQueryDto`: `month` — `@Matches(/^\d{4}-(0[1-9]|1[0-2])$/)`, `storeId?` — `@IsUUID()`.
- `ExpenseBodyDto implements CreateExpenseRequest`:
  - `month` — то же правило;
  - `storeId` — `@ValidateIf(v !== null) @IsUUID()`;
  - `kind` — `@IsIn(expenseKinds)`;
  - `amountMinor` — `@IsInt() @Min(1) @Max(10_000_000_000)`;
  - `comment` — trim, пустая строка → `null`, `@MaxLength(500)`.

- [ ] **Step 4: `scope.ts` и изъятия кассы**

1. Вынести `scopeOf` из `reports.service.ts` и `dashboard.service.ts` в `reports/scope.ts`.
2. В `SalesFigures` добавить `cashExpensesByStore`:
   - `shift_cash_operations o join shifts s on (tenant_id, id = o.shift_id)`;
   - условия: `o.kind = 'withdrawal' and o.reason = 'expense'`, `s.store_id = any(storeIds)`;
   - дата: `(o.occurred_at at time zone coalesce((select ts.timezone from pharmacy.tenant_settings ts where ts.tenant_id = …), 'Asia/Dushanbe'))::date between from and to`;
   - группировка `group by s.store_id`: `sum(o.amount_dirams)`, `count(*)`.

- [ ] **Step 5: Репозиторий и сервис расходов**

Сервис открывает `tenantTransaction`, сегодняшнюю дату берёт из `ReportsRepository.context`, а активные точки охвата —
из `ReportsRepository.activeStores`.

- `list(query)`:
  - записи месяца с учётом охвата (раздел «Охват» в Global Constraints) и фильтра `storeId`; запись сети — только при
    `'all'` без `storeId`;
  - `totalMinor` — сумма выданных записей;
  - `cashExpenses` — `cashExpensesByStore` за 1-е … последний день месяца по точкам выборки, с названиями;
  - порядок: сначала «Вся сеть», затем по точке, виду и сумме.
- `create(body)`: проверка месяца и охвата, вставка с `newId()` и `created_by` = сотрудник, аудит
  `expense.created`, ответ — `Expense`.
- `update(id, body)`:
  - охват проверяется и по прежней, и по новой точке записи;
  - запись `updated_by` и `updated_at = now()`;
  - аудит `expense.updated` с `before` / `after` и плоскими полями «после».
- `remove(id)`: удаление, аудит `expense.deleted` с `before` и плоскими полями прежней записи; ответ 204.

- [ ] **Step 6: Контроллер** `@Controller({ path: 'expenses', version: '1' })`

- `@Get()` — `expenses:view`;
- `@Post()` — `expenses:create`;
- `@Put(':id')` — `expenses:update` (`ParseUUIDPipe`);
- `@Delete(':id')` — `expenses:delete`, `@HttpCode(204)`.

Подключить в `ReportsModule` (`controllers`, `providers`).

- [ ] **Step 7: Журнал действий** (`audit-journal.ts`)

- Строковые параметры: `expenseKind` (по `CODE`) и `month` (`/^\d{4}-\d{2}$/`).
- Суммы группы `expense` скрываются без `expenses:view`, по тому же правилу, что `COST_GROUPS` без
  `finance:view-cost`.

- [ ] **Step 8: Документы**

- Модель данных 01: раздел таблицы `expenses` (поля, ограничения, индексы, класс `tenant`, полный DML).
- README модели: строка в списке классов.

- [ ] **Step 9: Сборка и наборы**

Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t build lint test -p api --parallel=1`, затем
`… npx nx run api:integration`.
Expected: зелёные. `catalog.int-spec` видит полный DML на `expenses`.

- [ ] **Step 10: Живая проверка `oc_expenses.sh` (часть API)**

Перезапустить `api-oc-4210`. Сценарий на `pos_setup.sh` — владелец, управляющий точки A, точки A и B. Ожидаемое:
- владелец: `POST` аренды A за октябрь 3 100,00 — 201; зарплата сети — 201; коммуналка B — 201;
- `GET ?month=2026-10`: три записи, сумма верна;
- управляющий без `expenses:view` — 403;
- роль управляющего с `expenses:view` и `audit:view` (Review Focus 2, 4):
  - `GET` — только запись A;
  - `POST` с `storeId: null` — 403, с точкой B — 403, `PUT` записи B — 403;
  - журнал показывает событие расхода A без `amountMinor`;
- ошибки:
  - `amountMinor: 0` — 400 (`amountMinor`), `kind: 'foo'` — 400, `month: '2026-13'` — 400;
  - следующий месяц — 422 (`month`, `range`);
  - неизвестный `id` — 404;
- `PUT` аренды A с переносом на сентябрь — журнал владельца показывает `before` (октябрь) и `after` (сентябрь)
  (Review Focus 5); `DELETE` — 204, событие `expense.deleted`.

- [ ] **Step 11: Commit**

```bash
git add apps/api/migrations apps/api/src docs/architecture/data-model
git commit --no-gpg-sign -m "feat(api): expenses of the network and the stores — table, CRUD, journal, cash withdrawals for expenses"
```

---

### Task 3: Расходы в «Продажах по точкам»

**Files:**
- Modify: `apps/api/src/app/reports/report-builders.ts`, `apps/api/src/app/reports/reports.service.ts`

**Interfaces:**
- Consumes: Task 1 — `prorateExpense`; Task 2 — `ExpensesRepository.ofMonths`, `SalesFigures.cashExpensesByStore`,
  `scopeOf`.
- Produces: `build.salesByStore(stores, sales, refunds, losses, canSeeCost, expenses: StoreExpenses | null)`, где
  `StoreExpenses = { byStore: ReadonlyMap<string, number>; networkMinor: number; cash: readonly { storeId: string; amountMinor: number }[] }`.
  `null` означает, что колонок расходов нет.

- [ ] **Step 1: Сборщик таблицы**

При `expenses !== null` (а значит и `canSeeCost`) после `marginPercent` идут колонки `expenses`, `cashExpenses`,
`netProfit` (`money`):
- строка точки: `expenses = −byStore`, `cashExpenses = −cash`, `netProfit = margin + expenses + cashExpenses`;
- итог: `expenses` = сумма строк − `networkMinor`; `cashExpenses` = сумма строк; `netProfit` = итог `margin` + итог
  `expenses` + итог `cashExpenses`.

Без права набор колонок не меняется.

- [ ] **Step 2: Сервис отчётов** (`sales_by_store`)

1. Вычислить `canSeeExpenses = canSeeCost && hasPermissions(principal.permissions, 'expenses:view')`.
2. Прочитать записи `ofMonths(from[0..7], to[0..7])`.
3. Каждую запись точки выборки посчитать через `prorateExpense(amount, month, from, to)` и сложить по точке.
4. Записи сети войдут в `networkMinor`, только когда `scopeOf(principal) === 'all'` и в запросе нет `storeId`.
5. `cash` — `cashExpensesByStore(trx, tenantId, storeIds, from, to)`.

`scopeOf` в `body()` доступен через `principal`.

- [ ] **Step 3: Сборка, наборы**

Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t build lint test -p api --parallel=1`.
Expected: зелёные.

- [ ] **Step 4: Живая проверка `oc_expenses.sh` (часть отчёта)**

Перезапустить API. Сценарий: аренда A за октябрь 3 100,00, зарплата сети за октябрь 6 200,00, коммуналка A за сентябрь
3 000,00.

Изъятия:
- изъятие «на расходы» 50,00 в смене A с `occurredAt` = 19:30 UTC вчера (00:30 сегодня по Душанбе);
- инкассация 70,00;
- изъятие «на расходы» 20,00 в смене B.

Отчёт `sales_by_store` (владелец):
- `?from=2026-10-01&to=2026-10-14`:
  - A: `expenses` = −1 400,00 (14/31), `cashExpenses` = −50,00 (только изъятие «на расходы»), `netProfit` =
    `margin` − 1 450,00;
  - B: `cashExpenses` = −20,00;
  - итог `expenses` = −1 400,00 − 2 800,00 (сеть, 14/31).
- `?from=2026-09-20&to=2026-10-10`: A `expenses` = −(1 100,00 + 1 000,00) (Review Focus 1).
- `?from=сегодня&to=сегодня`: A `cashExpenses` = −50,00 (Review Focus 3).
- `storeId=A`: итог без доли сети.

Права:
- роль без `expenses:view`, но с `finance:view-cost` — колонок расходов нет, остальные колонки есть;
- управляющий A с `expenses:view` и `finance:view-cost` — строка A, итог без сети.

Перенос записи (Review Focus 5): после `PUT` аренды A на сентябрь отчёт за 1–14.10 её не содержит, а отчёт за 20.09–10.10
содержит её долю 11/30.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app/reports
git commit --no-gpg-sign -m "feat(api): net profit in «Продажи по точкам» — expenses by days, cash withdrawals for expenses"
```

---

### Task 4: Web — экран «Расходы» и колонки отчёта

**Files:**
- Create:
  - `apps/web/app/(shell)/expenses/page.tsx` — одна строка реэкспорта;
  - `apps/web/src/pages/owner/expenses/index.ts`;
  - `apps/web/src/pages/owner/expenses/ui/ExpensesPage.tsx`;
  - `apps/web/src/pages/owner/expenses/ui/ExpenseDialog.tsx`.
- Modify:
  - `apps/web/src/shared/config/routes.ts`, `apps/web/src/widgets/app-shell/config/navigation.ts`;
  - `apps/web/src/shared/api/{routes.ts, client.ts}`, `apps/web/src/shared/api/mocks/handlers-owner.ts`;
  - `apps/web/src/pages/owner/reports/ui/ReportsPage.tsx`;
  - `apps/web/src/entities/audit-entry/model/use-audit-entry-text.ts`;
  - `apps/web/src/shared/i18n/messages/{ru,tg}/{core,owner}.json`;
  - метки модулей прав в `apps/admin` (найти по `"notifications": "Уведомления"`), если там перечислен каталог;
  - `CLAUDE.md`.

**Interfaces:**
- Consumes: Task 1 — DTO, `ExpenseKind`; Task 2 — маршруты `GET/POST /expenses`, `PUT/DELETE /expenses/{id}`;
  Task 3 — колонки `expenses`, `cashExpenses`, `netProfit`.
- Produces: маршруты API-клиента `expenses.list` (query `ExpenseQuery`), `expenses.create`, `expenses.update`
  (`{ id }`), `expenses.delete` (`{ id }`, ответ без тела). Все четыре добавляются в `REAL_API_ROUTES`.

- [ ] **Step 1: Маршруты, моки, навигация**

- `routes.expenses = () => '/expenses'`.
- Пункт `{ route: 'expenses', icon: 'wallet', permission: 'expenses:view', ready: true }` в разделе `reporting` после
  `reports`.
- Четыре маршрута клиента.
- Моки: список в памяти с правилами охвата и ошибками 403/404/422, как у сервера. В мок `sales_by_store` добавить три
  колонки, когда у демо-сессии есть оба права.

- [ ] **Step 2: Экран**

Состав экрана:
- заголовок «Расходы»;
- месяц: кнопки «‹» / «›» и подпись «Октябрь 2026». Следующий месяц после текущего недоступен; выбранный месяц — в query
  `?month=YYYY-MM`;
- фильтр точки (`Select`: «Все точки» + точки сессии);
- `DataTable`: «Точка» («Вся сеть» для `null`), «Вид», «Сумма, с», «Комментарий», действия «Изменить» / «Удалить» по
  правам. Итог — `totalMinor`;
- карточка «Расходы из кассы»: точка, сумма, число изъятий — только чтение. Подсказка: «Изъятия кассира с причиной «На
  расходы» — вносить их второй раз не нужно».

Окно `ExpenseDialog` (React Hook Form + zod):
- поля: месяц, точка (вариант «Вся сеть» только при `session.scope === 'network'`), вид, сумма (`parseMoneyToMinor`),
  комментарий;
- ошибки сервера раскладываются в поля;
- кнопка недоступна во время отправки.

Удаление — `Dialog` с подтверждением. После изменения инвалидировать `['expenses']` и `['reports']`.

- [ ] **Step 3: Отчёт и журнал**

- `ReportsPage`: для `sales_by_store` с колонкой `expenses` выводить пометку «Расходы всей сети входят только в итог».
- `use-audit-entry-text`: в `SHOWN_PARAMS` добавить `expenseKind` (текст из `expenseKinds`) и `month`.

- [ ] **Step 4: i18n RU/TJ**

- `core.json`:
  - пункт меню `expenses` — «Расходы»;
  - `auditGroups.expense` — «Расходы»;
  - `auditEvents.expense_created` / `expense_updated` / `expense_deleted` — «Расход добавлен» / «изменён» / «удалён»;
  - `auditParams.expenseKind` — «Вид», `auditParams.month` — «Месяц»;
  - `expenseKinds` — «Аренда», «Зарплата», «Коммунальные услуги», «Прочее».
- `owner.json`:
  - тексты экрана;
  - `reports.columns.expenses` — «Расходы, с», `cashExpenses` — «Расходы из кассы, с», `netProfit` — «Чистая прибыль, с»;
  - метка модуля прав `expenses` — «Расходы».
- TJ — те же ключи; `messages.spec` сверяет набор ключей.

- [ ] **Step 5: CLAUDE.md**

В список `web:dev-api` дописать «расходы». В граф модулей дописать: `reports` читает расходы сам и получает изъятия
кассы через `SalesFigures`.

- [ ] **Step 6: Наборы web**

Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t lint test build fsd -p web admin --parallel=1`, затем
`… npx nx e2e web-e2e`.
Expected: зелёные. Тесты оболочки, которые считают пункты меню владельца, обновить (ruling в реестре).

- [ ] **Step 7: Браузер (`web-partial-4210`, владелец сценария Task 3)**

- «Расходы»: октябрь — три записи и сумма; «Расходы из кассы» — A 50,00 (1), B 20,00 (1).
- Добавить, изменить и удалить запись — таблица и отчёт обновились.
- «Отчёты» → «Продажи по точкам» за 1–14.10 — колонки и числа Task 3, пометка о расходах сети.
- Под управляющим без `expenses:view` пункта меню нет и колонок нет.
- Пометки «Демо-данные» на экране нет.

- [ ] **Step 8: Commit**

```bash
git add apps/web apps/admin CLAUDE.md
git commit --no-gpg-sign -m "feat(web): expenses screen and net profit in the reports on the API"
```
