# Счётчики в меню — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** у пунктов меню «Остатки», «Перемещения и заявки» и «Цены и скидки» стоят числа работы рабочей точки. Клик открывает экран с фильтром: «Надо заказать», «К приёмке», «Только с проблемами».

**Architecture:**
- **Маршрут счётчиков.** Один маршрут `GET /nav-counters` в модуле `reports` складывает три числа из экспортов:
  - `inventory` — `StockAlerts.lowStock` и `transfersInTransit`;
  - `pricing` — новый `PriceProblems`.
- **Правило проблем цен** — в модуле `pricing`. Остатки точки он получает через новый порт `StockedProducts`, который заполняет `inventory` (по образцу `PurchasePrices`). Новая пометка `no_price` попадает в `priceWarnings` домена.
- **Фильтры экранов:**
  - новый маршрут `GET /stock/reorder` (тот же расчёт `lowStock`, построчно);
  - новый фильтр `problems` у `GET /prices`;
  - фильтр «К приёмке» — на клиенте.

**Tech Stack:** NestJS 11, Kysely + pg (CamelCasePlugin), RLS через `tenantTransaction`; Next.js static export, TanStack Query, use-intl, `@pharmacy/ui` (`CountBadge`); Jest (только существующие наборы).

**Spec:** `docs/superpowers/specs/2026-10-15-nav-counters-design.md` — решения N1–N4, E1–E11, разделы 5–10.

## Global Constraints

**Тесты.**
- Новых автотестов нет (правило «тесты до MVP»). Существующие наборы остаются зелёными: `shared-*`, `api`, `api:integration`, `web`, `web-e2e`, обязательно и `npx nx test api`.
- Проверка живая: curl-скрипт `nc_check.sh` в scratchpad (на `pos_setup.sh`) и браузер (`api-oc-4210` + `web-partial-4210`).

**Окружение Windows.**
- Nx: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx …`, `--parallel=1`.
- После правки контракта: `npx tsc -b libs/shared/dto/tsconfig.lib.json libs/shared/domain/tsconfig.lib.json --force`.
- `api-oc-4210` раздаёт `dist`: после сборки — перезапуск.
- Скрипты с кавычками пишутся инструментом Write.

**Git.**
- Ветка `feature/nav-counters` без upstream: `git switch -c feature/nav-counters --no-track origin/main`; `git rev-parse --abbrev-ref feature/nav-counters@{u}` должна выдать ошибку.
- Коммиты — `--no-gpg-sign`, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Не коммитить `package.json`, `apps/web/next-env.d.ts`, `.claude/launch.json`, `.claude/agent-memory/`.

**Права (E1).** Счётчик есть, только если есть право: `lowStock` — `inventory:view`; `incomingTransfers` — `inventory:receive`; `priceProblems` — `pricing:view`. Нет права — поля нет в ответе.

**Точки (E2).**
- `storeId` — точка охвата; иначе 403 `store_not_in_scope`.
- Без `storeId` — все активные точки охвата. PIN-сессия — всегда точка терминала.
- Web передаёт рабочую точку сессии.

**`lowStock` (E3).** Сумма `StockAlerts.lowStock(...).positions`: ассортимент (остаток или цена), активный товар с `default_min_stock_pieces > 0`, остаток ниже минимума, ноль включён.

**`incomingTransfers` (E4).** Перемещения `in_transit` с получателем из выборки, перемещения закрытия включены. Заявки не считаются.

**`priceProblems` (E5).**
- Считаются только аптеки (`kind = 'pharmacy'`).
- Единица счёта — пары «активный товар × аптека» хотя бы с одной проблемой:
  - `above_max` — цена > `max_price`;
  - `below_cost` — `warnBelowCost` сети включён, у сотрудника `finance:view-cost`, цена < последней закупочной цены упаковки;
  - `no_price` — остаток > 0 и нет цены.

**Вид (E10).**
- `CountBadge` с тоном `primary` у остатков и перемещений, `danger` у цен.
- 0 — значка нет; больше 99 — «99+»; у значка подпись для экранного диктора.

**Свежесть (E9, E11).**
- Ключ `['nav-counters', storeId]`, `refetchInterval: 60_000` (только при видимой вкладке).
- Запрос делает меню, а оно скрыто в полноэкранной кассе.
- Ошибка запроса не показывается.

## Review Focus

1. **Числа значка и экрана расходятся.** «Остатки» = числу строк «Надо заказать» за рабочую точку. «Цены» = числу товаров в фильтре «Только с проблемами» за неё же: по одной строке на товар, а при одной точке пара «товар × точка» и есть товар. Проверка — Задача 4 (curl и браузер).
2. **Рабочая точка — склад.** Значка «Цены» нет, пометок «Нет цены» в колонке склада нет. «Остатки» и «Перемещения» на складе есть. Проверка — Задача 3 (curl).
3. **Сотрудник без `finance:view-cost`.** Цена ниже закупочной не считается и не показывается, а выше предельной и «нет цены» — считаются. Проверка — Задача 3 (curl).
4. **Свежесть после собственных действий.** После приёмки перемещения, изменения цены и проведения прихода значок меняется сразу, без минуты ожидания. Проверка — Задача 4 (браузер).
5. **PIN-сессия кассира.** Только числа точки терминала и только по её правам. Чужая `storeId` — 403. Проверка — Задача 3 (curl).

---

### Task 1: Контракт, домен и web на моках

**Files:**
- Modify: `libs/shared/domain/src/lib/stock-pricing.ts`, `libs/shared/dto/src/lib/{tenant-catalog.ts, tenant-inventory.ts, tenant-home.ts}`
- Modify: `apps/api/src/app/pricing/prices.service.ts` (вызов нового `priceWarnings`)
- Modify: `apps/web/src/shared/api/{routes.ts, mocks/*}`, `apps/web/src/widgets/app-shell/{config/navigation.ts, ui/Sidebar.tsx}`
- Modify: `apps/web/src/pages/{stock,transfers,pricing}/ui/*`, `apps/web/src/shared/i18n/messages/{ru,tg}/*.json`

**Interfaces:**
- Produces (domain):
  - `PriceWarning = 'above_max' | 'below_cost' | 'no_price'`;
  - `priceWarnings(input: { priceMinor: number | null; costMinor?: number | null; maxPriceMinor: number | null; inStock?: boolean }): PriceWarning[]` — `no_price` при `priceMinor === null && inStock`; при `priceMinor === null` других пометок нет.
- Produces (DTO):
  - `NavCounters { lowStock?: number; incomingTransfers?: number; priceProblems?: number }`, `NavCountersQuery { storeId?: string }` — в `tenant-home.ts`;
  - `ReorderLine { storeId; storeName; productId; productName; stockPieces: number; minPieces: number; shortagePieces: number; piecesPerPack: number }`, `ReorderQuery { storeId?: string }` — в `tenant-inventory.ts`;
  - `PriceListQuery` + `problems?: boolean`, `storeId?: string`.
- Produces (маршруты клиента):
  - `'navCounters.get': route<NavCounters, undefined, undefined, NavCountersQuery>('GET', () => '/nav-counters')`;
  - `'stock.reorder': route<ReorderLine[], undefined, undefined, ReorderQuery>('GET', () => '/stock/reorder')`;
  - `prices.list` с новыми полями запроса.

- [ ] **Step 1: Домен и контракт**

Типы и функция выше. В `prices.service.ts` `priceWarnings` вызывается для каждой ячейки, в том числе без цены, с `inStock: false` — порт подключится в Задаче 2. Пересобрать декларации библиотек.

- [ ] **Step 2: Меню**

1. В `NavItem` добавить поле `counter?: { key: keyof NavCounters; tone: 'primary' | 'danger'; href: (storeId: string) => string }`:
   - «Остатки» — `lowStock`, `primary`, `/stock?view=reorder&storeId=…`;
   - «Перемещения и заявки» — `incomingTransfers`, `primary`, `/transfers?incoming=1`;
   - «Цены и скидки» — `priceProblems`, `danger`, `/pricing?problems=1&storeId=…`.
2. `Sidebar` делает запрос `useQuery(['nav-counters', storeId])`:
   - `storeId` — `session.currentStoreId`;
   - `refetchInterval: 60_000`;
   - `enabled` — маршрут доступен (`isApiRouteAvailable('navCounters.get')`) и сессия есть.
3. При числе > 0 рядом с пунктом — `CountBadge`, а ссылка пункта ведёт на `href`.

- [ ] **Step 3: Экраны**

- **Остатки.** Чип «Надо заказать» (`view=reorder`) с таблицей `stock.reorder`: товар, точка (если точек выборки больше одной), остаток, минимум, не хватает — в упаковках и штуках. При открытии `view` и `storeId` читаются из адреса (`useSearchParams` внутри `Suspense`).
- **Перемещения.** Фильтр «К приёмке» (`incoming=1`): перемещения `in_transit` с `toStoreId` рабочей точки; фильтр на клиенте по `transfers.overview`.
- **Цены.**
  - Чип «Только с проблемами» (`problems=1`, `storeId`) передаёт параметры в `prices.list`.
  - Пометка `no_price` в ячейке без цены: «Нет цены — касса не продаст».

- [ ] **Step 4: Моки**

- `navCounters.get` — по данным моков: минимумы `stockState` / `minStock`, перемещения в пути к точке, ячейки с пометками.
- `stock.reorder`.
- `prices.list` с `problems`.

- [ ] **Step 5: i18n RU/TJ**

- Подписи значков: «{count} товаров мало на складе», «{count} перемещений ждут приёмки», «{count} товаров с проблемой цены».
- Чипы «Надо заказать», «К приёмке», «Только с проблемами».
- Колонки таблицы «Надо заказать».
- Пометка `no_price`.

- [ ] **Step 6: Наборы**

Run: `NX_ISOLATE_PLUGINS=false NX_DAEMON=false npx nx run-many -t lint test build fsd -p web --parallel=1` и `… -t build lint test -p api shared-domain shared-dto`.
Expected: зелёные. Спеки, которые сверяют меню или цены целиком, адаптировать (ruling в реестре).

- [ ] **Step 7: Commit**

```bash
git add libs/shared apps/web/src apps/web/specs apps/api/src/app/pricing/prices.service.ts
git commit --no-gpg-sign -m "feat(web): menu counters and their filters on the mocks — reorder, incoming transfers, price problems"
```

---

### Task 2: «Надо заказать», порт остатков и проблемы цен в API

**Files:**
- Modify: `apps/api/src/app/inventory/{stock-alerts.ts, stock.service.ts, stock.controller.ts, dto/stock.dto.ts, inventory.module.ts}`
- Create: `apps/api/src/app/inventory/stocked-products-source.ts`
- Create: `apps/api/src/app/pricing/stocked-products.ts`, `apps/api/src/app/pricing/price-problems.ts`
- Modify: `apps/api/src/app/pricing/{prices.service.ts, pricing.repository.ts, pricing.module.ts, dto/prices.dto.ts}`, `apps/api/src/app/catalog/{products-reader.ts, catalog.repository.ts}` (фильтр по id)

**Interfaces:**
- Consumes: Task 1 — `priceWarnings`, `ReorderLine`, `PriceListQuery`.
- Produces:
  - `StockAlerts.lowStockLines(trx, tenantId, storeIds?): Promise<{ storeId: string; productId: string; qtyPieces: number; minPieces: number }[]>`; `lowStock` = их подсчёт по точке (одно правило);
  - `GET /stock/reorder?storeId=` (`inventory:view`, охват → 403) → `ReorderLine[]`, сортировка по точке, затем по названию;
  - `StockedProducts` (порт `pricing`, экспорт): `register(source)`, `stockedAt(trx, tenantId, storeIds): Promise<Set<string>>` — ключи `${storeId}/${productId}` с остатком > 0; источник регистрирует `inventory` (`StockedProductsSource`, `OnModuleInit`);
  - `PriceProblems` (экспорт `pricing`):
    - `count(trx, tenantId, pharmacyIds: readonly string[], canSeeCost: boolean): Promise<number>`;
    - `productIds(trx, tenantId, pharmacyIds, canSeeCost): Promise<string[]>`;
  - `PricingRepository.activeStores` отдаёт `kind`;
  - `ProductsReader.listForPricing(…, { …, productIds?: readonly string[] })`.

- [ ] **Step 1: «Надо заказать»**

`lowStockLines` — тело нынешнего `lowStock` без свёртки. `StockService.reorder(query)`:
- названия и `piecesPerPack` — через `ProductsReader.findForStock`;
- точки — активные охвата, отфильтрованные по `storeId`;
- `shortagePieces = minPieces − qtyPieces`.

- [ ] **Step 2: Порт и проблемы цен**

1. **`StockedProducts`** — по образцу `PurchasePrices`. Без источника возвращает пустое множество.
2. **`PriceProblems`.** Пары: цены аптек (`store_products`) ∪ остатки (`stockedAt`). Для каждой пары — `priceWarnings` с параметрами:
   - `costMinor` — только при `canSeeCost && warnBelowCost`, из `PurchasePrices`;
   - `maxPriceMinor` — товара;
   - `inStock` — из порта.

   Учитываются активные товары; пара с хотя бы одной пометкой засчитывается один раз.
3. **`prices.service`.**
   - `rows` передаёт `inStock` из порта, но только для аптек, поэтому у склада пометки `no_price` нет.
   - `list` с `problems` берёт `productIds` и передаёт их в `listForPricing`. Проблемы ищутся в аптеке `storeId` (она должна быть в охвате, иначе 403), а без неё — во всех аптеках охвата.

- [ ] **Step 3: Сборка, наборы, живая проверка `nc_check.sh` (часть 1)**

Run: build/lint/test api, `api:integration`, перезапуск `api-oc-4210`.

Сценарий на `pos_setup.sh`:
- у товара Q минимум 5 упаковок при остатке 3 → в `GET /stock/reorder?storeId=A` строка Q с нехваткой 2 уп.;
- закончившийся товар с минимумом → тоже строка;
- цена выше предельной у K → `prices?problems=true&storeId=A` содержит K;
- товар на остатке без цены → строка с `no_price`;
- цена ниже закупочной: с включённой настройкой и правом — есть, без права — нет;
- склад W в охвате: у его колонки нет `no_price`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src
git commit --no-gpg-sign -m "feat(api): reorder list, stocked products port and price problems"
```

---

### Task 3: `GET /nav-counters`

**Files:**
- Create: `apps/api/src/app/reports/nav-counters.controller.ts`, `apps/api/src/app/reports/nav-counters.service.ts`, `apps/api/src/app/reports/dto/nav-counters.dto.ts`
- Modify: `apps/api/src/app/reports/{reports.module.ts, reports.repository.ts}`

**Interfaces:**
- Consumes: Task 2 — `PriceProblems.count`; `StockAlerts.lowStock`, `transfersInTransit`.
- Produces: `GET /api/v1/nav-counters?storeId=` → `NavCounters` (`@Authenticated()`, поля по правам).

- [ ] **Step 1: Сервис и контроллер**

1. **Точки.** `scopeOf(principal)` из `reports/scope.ts`. `storeId` вне охвата → 403 `store_not_in_scope`. Дальше — `activeStores` охвата, отфильтрованные по `storeId`.
2. **Числа:**
   - `lowStock` — сумма `positions`;
   - `incomingTransfers` — `transfersInTransit(trx, tenantId, storeIds).length`;
   - `priceProblems` — `PriceProblems.count` по аптекам выборки (`kind === 'pharmacy'`), где `canSeeCost` — `finance:view-cost`.
3. **Модуль.** `ReportsModule` импортирует `PricingModule`.

- [ ] **Step 2: Сборка, наборы, живая проверка `nc_check.sh` (часть 2)**

Run: build/lint/test api, `api:integration`, перезапуск.
- **Владелец, точка A:**
  - `lowStock` = числу строк `stock/reorder?storeId=A` и плитке главной у управляющего одной точки A;
  - перемещение B → A в пути: у A `incomingTransfers` 1, у B 0; после приёмки — 0;
  - `priceProblems` = числу товаров `prices?problems=true&storeId=A`; товар с двумя проблемами — 1 (RF1).
- **Склад W** (RF2): поля `priceProblems` = 0.
- **Роль без `finance:view-cost`** (RF3): ниже закупочной не считается.
- **Роль без `pricing:view`:** поля нет.
- **Кассир по PIN** (RF5): только точка терминала; `incomingTransfers` нет без `inventory:receive`; чужая `storeId` — 403.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src
git commit --no-gpg-sign -m "feat(api): menu counters of the working store"
```

---

### Task 4: Web на API и документы

**Files:**
- Modify: `apps/web/src/shared/api/client.ts`, мутации, после которых меняются числа (`apps/web/src/pages/{transfers,pricing,goods-receipts,write-offs,stock-counts,supplier-returns,opening-balances}`)
- Modify: `CLAUDE.md`, `docs/architecture/APPROVAL.md`

**Interfaces:**
- Consumes: Tasks 1–3.

- [ ] **Step 1: `REAL_API_ROUTES` и инвалидация**

1. В `REAL_API_ROUTES` добавить `navCounters.get` и `stock.reorder`.
2. Ключ `['nav-counters']` инвалидируется в `onSuccess` после:
   - приёмки перемещения;
   - изменения цен;
   - проведения прихода, списания, инвентаризации, возврата поставщику и начальных остатков.

- [ ] **Step 2: Документы**

- CLAUDE.md:
  - граф модулей: `pricing` получает остатки через порт `StockedProducts`, который заполняет `inventory`; `inventory`, `pricing` ← `reports` (`StockAlerts`, `PriceProblems`);
  - `web:dev-api` + «счётчики меню».
- APPROVAL.md — строка утверждения спецификации.

- [ ] **Step 3: Наборы**

Run: web lint/test/build/fsd, `web-e2e`.
Expected: зелёные.

- [ ] **Step 4: Браузер (`web-partial-4210`, владелец сценария)**

- Значки у трёх пунктов: синие, красный; при нуле значка нет.
- «Остатки» → «Надо заказать», число строк = значку (RF1); «Перемещения» → «К приёмке»; «Цены» → «Только с проблемами» с пометкой «Нет цены».
- Приёмка перемещения и изменение цены — значок меняется сразу (RF4).
- Смена рабочей точки на склад — значка «Цены» нет.
- Пометки «Демо-данные» нет.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src CLAUDE.md docs
git commit --no-gpg-sign -m "feat(web): menu counters on the API"
```
