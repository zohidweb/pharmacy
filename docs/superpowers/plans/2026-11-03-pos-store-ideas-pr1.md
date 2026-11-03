# Экран покупателя, товар по штрихкоду и история цен (PR 1): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** покупатель видит чек на втором мониторе; товар с незнакомым штрихкодом заводится прямо из прихода и начальных
остатков; у товара есть история цен по точкам.

**Architecture:**
- Экран покупателя — статическая страница `apps/web` без запросов. Касса шлёт ей состояние чека через
  `BroadcastChannel`; протокол лежит в `shared/lib/customer-display`, издатель — в срезе `features/pos`.
- Товар по штрихкоду: форма каталога переезжает в срез `features/product-form`. `ProductSearch` получает обратный вызов
  `onCreate`. Окно создания собирают слои выше — виджет прихода и страница начальных остатков: фича не импортирует фичу.
- История цен: новый маршрут API `GET /prices/{id}/history` читает `price.changed` журнала действий через читателя
  модуля `audit`. В web — срез `features/price-history`.
- Миграций нет.

**Tech Stack:** NestJS, Kysely `sql`, class-validator; Next.js static export, React, TanStack Query, use-intl,
`BroadcastChannel` и Fullscreen API браузера. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-11-03-pos-store-ideas-design.md`, разделы 3–5 (D1–D17), 9, 11, 13; утверждена
2026-11-03.

## Уточнения спецификации при планировании

| № | Что нашлось | Решение | Цена ошибки |
|---|---|---|---|
| R1 | D5: поля `draft.language` нет — чек печатается на языке интерфейса кассы (`locale`) | Состояние экрана несёт `locale`; экран вызывает `setLocale`, если язык другой | Экран на другом языке до следующего сообщения |
| R2 | D15: `offline_store` — значение колонки `audit_log.source`, а не `details.source` | `audit_log.source = 'offline_store'` → «На точке»; иначе по `details.source`: `prices` → «Вручную», `document` → по типу документа, `transfer` → «Перемещение» | Неверная подпись источника |
| R3 | D15: страницы документа по id нет (`routes`) | Номер документа без ссылки; `document.id` в ответе оставлен для будущей ссылки | Лишний переход к документу вручную |
| R4 | D1: корневой `ServiceWorker` на любом маршруте спрашивает публичный `deployment.get` | Страница экрана сама ничего не запрашивает; общий запрос остаётся | Нет |
| R5 | D9: `ProductSearch` есть ещё в заказах, инвентаризации и заявках на перемещение | Кнопка создания — только при переданном `onCreate`: в `GoodsReceiptEditor` и `OpeningBalanceEditor` | Нет |
| R6 | D3: у кассы нет отдельного шага оплаты | Блок оплаты на экране — когда есть безналичная часть или введено «Получено» | Блок появляется чуть позже, чем покупатель достаёт деньги |
| R7 | D7: отдельное сообщение `idle` не нужно | Ожидание — состояние `screen: 'idle'`; его шлёт касса без смены, при уходе со страницы кассы (размонтирование) и при выходе | Нет |
| R8 | D5: масштаб шрифта кассира (A−/A+) хранится по origin и применяется корнем приложения | Применяется и к экрану покупателя; своих кнопок у экрана нет | Крупнее или мельче задуманного |
| R9 | D11: язык сети по умолчанию web не знает | Название из запроса кладётся в поле языка интерфейса (`ru` → `nameRu`, `tg` → `nameTj`); без названия на языке сети API ответит `required` у поля, форма это уже показывает | Лишнее поле для заполнения |

## Global Constraints

- Тесты отложены до MVP: без TDD и новых автотестов, существующие наборы остаются зелёными. Тестовый долг — в описании PR
  (раздел 13 спецификации).
- Полный `npm run check` запускает пользователь. Здесь — проверки задач ниже и живой прогон.
- Работа — в `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/pilot-pos-ideas`; основную папку не трогать.
- Коммиты — `--no-gpg-sign`, Conventional Commits, с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Новые тексты — в RU и TJ одновременно (тест `messages.spec.ts` сверяет ключи). Таджикские — на проверку носителю
  (строка в PR).
- Только токены `--ph-*` и утилиты Tailwind из них; без hex, `px`, inline-стилей.
- Деньги — целые дирамы, на экране — `formatMoney`. Процент изменения цены — только для отображения.
- `next build` проверяет типы по `libs/*/dist`: после правки `libs/shared/dto` выполнить
  `npx nx run-many -t typecheck -p shared-dto shared-domain shared-util ui --skip-nx-cache`.
- Prettier — только на файлах, которые уже отформатированы на `main` (`npx prettier --check <файл>` до правки).
- Живые проверки браузером — на `http://127.0.0.1:<порт>`, не `localhost`: куки `localhost` общие с параллельными
  сессиями (память «Parallel sessions share env»).

## Review Focus

1. Второе окно экрана открыто раньше кассы или перезагружено посреди чека. Экран показывает текущий чек (ответ на
   `hello`), а не пустоту — задача 4, шаг 6.
2. Две кассы в одном браузере (две вкладки с разными терминалами) не видят чеков друг друга: имя канала — с id
   терминала. Задача 4, шаг 6.
3. После оплаты касса очищает чек, и экран не прыгает сразу в «ожидание». Сначала «Спасибо» на 10 с; новая строка чека
   прерывает его. Задача 4, шаг 6.
4. Запрос из поиска документа — цифры не 8–14 знаков (например `123`). Это не штрихкод: создание с названием `123`, а
   не со штрихкодом. Задача 3, шаг 5.
5. Точка вне охвата в `storeId` истории — 403 `store_not_in_scope`, а не пустой список; товар другой сети — 404. Задача 1,
   шаг 5.

---

### Task 1: История цен — API

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-catalog.ts` (раздел prices)
- Create: `apps/api/src/app/audit/price-history.ts`
- Modify: `apps/api/src/app/audit/audit.module.ts`
- Modify: `apps/api/src/app/pricing/dto/pricing.dto.ts`, `apps/api/src/app/pricing/prices.service.ts`,
  `apps/api/src/app/pricing/prices.controller.ts`

**Interfaces:**
- Produces (`@pharmacy/shared-dto`):
  ```ts
  export type PriceKind = 'retail' | 'wholesale'; // 'wholesale' приходит с I4
  export type PriceChangeSource = 'manual' | 'document' | 'transfer' | 'offline_store';
  export interface PriceHistoryQuery { storeId?: string; limit?: number; offset?: number }
  export interface PriceHistoryEntry {
    id: string; // id записи журнала
    at: string; // ISO
    storeId: string;
    storeName: string;
    kind: PriceKind;
    oldPriceMinor: number | null; // null — цены не было
    newPriceMinor: number;
    source: PriceChangeSource;
    document: { id: string; type: string; number: string } | null; // documents.type как есть
    author: { name: string } | null;
  }
  ```
  Ответ — `Page<PriceHistoryEntry>`.
- Produces (API): `GET /api/v1/prices/{productId}/history?storeId=&limit=&offset=`.

- [ ] **Step 1: DTO.** Типы выше — в `tenant-catalog.ts` после `UpdatePricesRequest`, с JSDoc маршрута (`pricing:view`;
  403 `store_not_in_scope`; 404). Затем typecheck библиотек (Global Constraints).

- [ ] **Step 2: `PriceHistory` в модуле `audit`.**
  `page(trx: TenantTransaction, c: { tenantId: string; productId: string; storeIds: readonly string[] | null; limit: number; offset: number }): Promise<Page<PriceHistoryEntry>>`.
  - SQL через тег `sql`, как в `price-changes.ts`: `audit_log a` с условиями
    `a.tenant_id`, `a.entity_type = 'product'`, `a.entity_id`, `a.action = 'price.changed'` и, при `storeIds`,
    `a.store_id = any(…)`.
  - `left join` к `stores` (имя точки), `employees` (`full_name`) и `documents` (по `(a.details ->> 'documentId')::uuid`).
    Каждое соединение — с `tenant_id = a.tenant_id`. Имена колонок сверить с `db.generated.ts`.
  - Порядок — `a.recorded_at desc, a.id desc`; `limit` и `offset`. `total` — отдельный `count(*)` с теми же условиями.
  - `kind` — всегда `'retail'`. `source` — по R2.
  - Деньги из `details` — `Number(...)`, как в `PriceChanges`.
  - Шапка файла — комментарий в духе `price-changes.ts`: что читает, по какому индексу (`audit_log_entity_idx`), почему
    полная история.
  - Зарегистрировать в `providers` и `exports` `AuditModule`, с комментарием рядом с `PriceChanges`.

- [ ] **Step 3: DTO запроса.** `PriceHistoryQueryDto` в `pricing.dto.ts` — по образцу `PriceListQueryDto`:
  - `storeId?` — `IsUUID`;
  - `limit?` — целое 1–100, по умолчанию 50;
  - `offset?` — целое ≥ 0, по умолчанию 0.

- [ ] **Step 4: Сервис и контроллер.**
  - `PricesService.history(productId: string, query: PriceHistoryQuery): Promise<Page<PriceHistoryEntry>>`:
    - товар — через `findForPricing`, как в `ofProduct`; нет — `notFound()`;
    - `storeId` вне ограниченного охвата — `ProblemException(403, 'store_not_in_scope')`;
    - без `storeId` — `storeIds = null` при охвате `all`, иначе список охвата; пустой охват — пустая страница.
  - Контроллер: `@RequirePermission('pricing:view') @Get(':productId/history')` с `ParseUUIDPipe` и
    `PriceHistoryQueryDto`.

- [ ] **Step 5: Проверка.**
  - Run: `npx nx run-many -t typecheck lint -p api shared-dto` и `npx nx build api`.
    Expected: без ошибок.
  - Живой прогон на dev-api (Task 5): 403 для чужой точки и 404 для чужого товара (Review Focus 5).

- [ ] **Step 6: Commit** — `feat(pricing): price history of a product from the audit log`.

### Task 2: История цен — web

**Files:**
- Modify: `apps/web/src/shared/api/routes.ts`, `apps/web/src/shared/api/client.ts` (список маршрутов API),
  `apps/web/src/shared/api/mocks/handlers-catalog.ts`
- Create: `apps/web/src/features/price-history/index.ts`, `…/ui/PriceHistoryDialog.tsx`, `…/ui/PriceHistoryButton.tsx`
- Modify: `apps/web/src/pages/pricing/ui/PricingPage.tsx` (столбец `actions`), `apps/web/src/pages/catalog/ui/ProductPage.tsx`
  (`ProductPrices`)
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/purchasing.json` (`pricing.history.*`)

**Interfaces:**
- Consumes: Task 1 — `PriceHistoryEntry`, `PriceHistoryQuery`, `Page`.
- Produces:
  - маршрут клиента `'prices.history'`: `route<Page<PriceHistoryEntry>, undefined, { productId: string }, PriceHistoryQuery>('GET', …/history)`;
  - `PriceHistoryButton({ productId, productName, stores }: { productId: string; productName: string; stores: ReadonlyArray<{ id: string; name: string }> })`.

- [ ] **Step 1: Маршрут.**
  - `'prices.history'` — в `routes.ts` после `'prices.get'` и в список маршрутов API в `client.ts`.
  - Обработчик моков: по одной записи `manual` на каждую точку с ценой товара в моках — `oldPriceMinor: null`,
    `newPriceMinor` = цена, автор — владелец моков. Фильтр `storeId`, страница по `limit`/`offset`.

- [ ] **Step 2: Окно истории.**
  - Заголовок — «История цен — {товар}».
  - Выбор точки: «Все точки» и точки из `stores`. По умолчанию — текущая точка сессии, если она есть в `stores`, иначе
    «Все точки».
  - Данные — `useInfiniteQuery` страницами по 50, «Показать ещё», пока загружено меньше `total`.
  - Столбцы:
    - «Дата» (`formatDateTime`);
    - «Точка» — только при «Все точки»;
    - «Было» — `formatMoney` или «—»;
    - «Стало»;
    - «Изменение» — `Intl.NumberFormat` локали со знаком и одной цифрой после запятой, «—» без старой цены;
    - «Кто» — имя или «—»;
    - «Источник»: «Вручную»; «Приход № {n}» для `goods_receipt`; «Начальные остатки № {n}» для `opening_balance`;
      «Перемещение № {n}»; «Документ № {n}» для прочих типов; «На точке».
  - Пусто — `EmptyState` «Цена не менялась».
  - Ошибка — через `QueryState` / `useApiErrorMessage`, как на странице цен.
  - Окно — `Dialog` размера `lg`. Столбца «Вид» пока нет: все записи — розница (появится с I4).

- [ ] **Step 3: Кнопки.**
  - `PriceHistoryButton` — `IconButton` с иконкой `clock` и подписью «История цен» (aria-label); открывает окно.
  - На странице цен — в ячейке `actions` рядом с «Изменить». Видна всем, кто видит страницу; `stores` — из
    `PriceListResponse.stores`.
  - В карточке товара — `actions` у `CardHeader` блока «Цены по точкам»; `stores` — из ответа `prices.get`.

- [ ] **Step 4: Тексты** `pricing.history.*` в RU и TJ.

- [ ] **Step 5: Проверка.**
  - Run: `npx nx run-many -t typecheck lint -p web` и `npx nx fsd web`.
    Expected: без новых ошибок (у Steiger — только прежние предупреждения).
  - На моках (`ui-web-mocks`, `127.0.0.1:4212`): окно открывается с обеих страниц, переключается точка.

- [ ] **Step 6: Commit** — `feat(web): price history dialog on the prices page and the product card`.

### Task 3: «Завести товар» по незнакомому штрихкоду

**Files:**
- Move: `apps/web/src/pages/catalog/ui/ProductForm.tsx` → `apps/web/src/features/product-form/ui/ProductForm.tsx`
  (`git mv`)
- Create: `apps/web/src/features/product-form/index.ts`, `…/model/references.ts`, `…/ui/CreateProductDialog.tsx`
- Modify: `apps/web/src/pages/catalog/ui/CatalogPage.tsx`, `apps/web/src/pages/catalog/ui/ProductPage.tsx` (импорты)
- Modify: `apps/web/src/features/stock-document/ui/ProductSearch.tsx`
- Modify: `apps/web/src/widgets/goods-receipt-editor/ui/GoodsReceiptEditor.tsx`,
  `apps/web/src/pages/opening-balances/ui/OpeningBalanceEditor.tsx`
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/stock.json` (`stockDocs.search.*`),
  `{ru,tg}/purchasing.json` (`products.createFromSearch.*`), `{ru,tg}/pos.json` (`unknownBarcode`)

**Interfaces:**
- Produces (`@/features/product-form`):
  - всё, что экспортировал `ProductForm.tsx`: `ProductForm`, `ProductDraft`, `emptyDraft`, `draftOf`, `draftProblems`,
    `inputOf`, `shownAtFields`;
  - `useCatalogReferences` — переносится из `CatalogPage.tsx` в `model/references.ts`;
  - `type ProductSeed = { barcode: string } | { name: string }`;
  - `CreateProductDialog({ seed, storeId, onCreated, onClose }: { seed: ProductSeed; storeId: string; onCreated: (product: StockProductOption) => void; onClose: () => void })`.
- Produces (`ProductSearch`): новый необязательный проп
  `create?: { allowed: boolean; onCreate: (seed: ProductSeed) => void }`. Фича не импортирует фичу, поэтому
  `features/stock-document` объявляет свой `ProductSeed` того же вида и экспортирует его. Виджет прихода и страница
  остатков передают семя из `onCreate` в `CreateProductDialog`: типы совпадают структурно.

- [ ] **Step 1: Переезд формы.**
  - `git mv` файла и перенос `useCatalogReferences`.
  - `index.ts` экспортирует список из Interfaces.
  - Импорты `CatalogPage` и `ProductPage` — из `@/features/product-form`. Поведение каталога не меняется.

- [ ] **Step 2: `ProductSearch`.**
  - При переданном `create`, запросе от 2 знаков, загрузке без ошибки и пустом результате вместо «Ничего не найдено»
    показывается:
    - запрос `^\d{8,14}$` — «Товара со штрихкодом {code} нет в каталоге»;
    - иначе — «Товара «{query}» нет в каталоге».
  - Ниже: при `allowed` — кнопка «Завести товар» (`onCreate` с `{ barcode }` или `{ name }`), без него — текст
    «Попросите заведующего завести товар в каталоге».
  - Без `create` — как сейчас.

- [ ] **Step 3: `CreateProductDialog`.**
  - Сам оборачивается в `<WithMessages groups={['purchasing']}>`: страницы прихода и остатков грузят только `stock`.
  - Справочники — `useCatalogReferences`; до загрузки — спиннер.
  - Черновик — `emptyDraft(refs)` с семенем: `{ barcode }` → `barcodes: [{ code }]`; `{ name }` → по R9. Фокус — на
    первом пустом обязательном поле (название).
  - Сохранение — как в `NewProductDialog` (`catalog.create`, `apiFieldErrors`, `shownAtFields`), затем
    `invalidateQueries({ queryKey: ['catalog'] })`.
  - Затем `apiRequest('stock.products', { params: { storeId }, query: { query: <штрихкод или название>, limit: 50 } })`:
    найденный по `id` товар → `onCreated(option)` и закрытие. Не найден — `Alert` «Товар заведён. Найдите его в поиске,
    чтобы добавить строку» и одна кнопка «Закрыть».
  - Подпись окна — «Новый товар», подсказка — «Товар появится в каталоге сети и сразу встанет строкой документа».

- [ ] **Step 4: Подключение.**
  - `GoodsReceiptEditor` и `OpeningBalanceEditor`:
    - `create={{ allowed: canWrite(session, 'catalog:create'), onCreate: setSeed }}`;
    - `{seed && <CreateProductDialog seed={seed} storeId={draft.storeId} onCreated={addProduct} onClose={() => setSeed(null)} />}`;
    - `addProduct` — их существующая функция выбора из поиска.
  - Касса: текст `pos.unknownBarcode` дополняется «Заведите товар в каталоге или при приходе.» (RU и TJ).

- [ ] **Step 5: Проверка.**
  - Run: `npx nx run-many -t typecheck lint -p web` и `npx nx fsd web`. Expected: без новых ошибок.
  - На моках: приход → скан `4600000000017` → «Завести товар» → сохранить → строка с этим товаром.
  - Запрос `123` даёт название, а не штрихкод (Review Focus 4).
  - Без `catalog:create` (роль кассира в моках) — подсказка.
  - Начальные остатки — то же.
  - Каталог: «Новый товар» и карточка работают как раньше.

- [ ] **Step 6: Commit** — `feat(web): create a product from an unknown barcode in goods receipts and opening balances`.

### Task 4: Экран покупателя

**Files:**
- Create: `apps/web/src/shared/lib/customer-display/{index.ts,protocol.ts}`
- Create: `apps/web/src/features/pos/model/customer-display.ts`, `apps/web/src/features/pos/ui/CustomerDisplayButton.tsx`
  (экспорт из `features/pos/index.ts`)
- Create: `apps/web/src/pages/customer-display/{index.ts,ui/CustomerDisplayPage.tsx}`,
  `apps/web/app/customer-display/page.tsx`
- Modify: `apps/web/src/shared/config/routes.ts`, `apps/web/src/pages/pos/ui/PosPage.tsx`
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/pos.json` (`pos.customerDisplay.*`)

**Interfaces:**
- Produces (`@/shared/lib/customer-display`):
  ```ts
  export interface DisplayLine { key: string; name: string; unit: SaleUnit; quantity: number; unitPriceMinor: number; amountMinor: number }
  export interface DisplayPayment { method: ReceiptPaymentMethod; amountMinor: number }
  interface Base { storeName: string | null; locale: Locale }
  export type DisplayState =
    | (Base & { screen: 'idle' })
    | (Base & { screen: 'receipt'; lines: DisplayLine[]; changedKey: string | null; subtotalMinor: number;
        discountPercent: number; discountMinor: number; totalMinor: number;
        payment: { payments: DisplayPayment[]; tenderedMinor: number | null; changeMinor: number } | null })
    | (Base & { screen: 'done'; totalMinor: number; changeMinor: number });
  export type DisplayMessage = { v: 1; kind: 'state'; state: DisplayState } | { v: 1; kind: 'hello' };
  export function openDisplayChannel(terminalId: string): BroadcastChannel | null; // имя `ph-customer-display:${terminalId}`; null без BroadcastChannel
  export function isDisplayMessage(data: unknown): data is DisplayMessage; // v === 1 и известный kind
  export const displaySupported: () => boolean;
  ```
- Produces (`features/pos`):
  - `useCustomerDisplay(c: { terminalId: string | null; storeName: string | null; locale: Locale; draft: ReceiptDraft; rules: readonly DiscountRule[]; done: { totalMinor: number; changeMinor: number } | null; active: boolean }): void`;
  - `CustomerDisplayButton({ terminalId, onBlocked }: { terminalId: string; onBlocked: () => void })`.
- Produces: `routes.customerDisplay(terminalId: string)` → `/customer-display?terminal=<id>`.

- [ ] **Step 1: Протокол** — по Interfaces. Без логики React. Сообщения с другим `v` и неизвестным `kind` отбрасываются.

- [ ] **Step 2: Издатель `useCustomerDisplay`.**
  - Канал — пока смонтирована касса и есть `terminalId`.
  - Состояние:
    - `active` ложно (нет смены или касса заблокирована) → `idle`;
    - строки есть → `receipt`. Итоги — `totals`, оплата — `paymentState`. `payment` по R6: при `nonCashMinor > 0` или
      `cashTenderedMinor !== null`, иначе `null`. `changedKey` — ключ новой строки или строки с изменённым количеством
      по сравнению с прошлым состоянием;
    - строк нет и есть `done` → `done`;
    - иначе `idle`.
  - Отправка — не чаще раза в кадр (`requestAnimationFrame`).
  - На `hello` — текущее состояние.
  - При размонтировании — `idle` и `close()`.
  - В сообщение не попадают партии, сроки, закупочные цены и данные ПКУ (D4): `DisplayLine` содержит только поля выше.

- [ ] **Step 3: Касса.**
  - `PosPage` вызывает `useCustomerDisplay`:
    - `terminalId: session?.terminalId ?? null`;
    - `storeName: snapshot?.settings.storeName ?? null`;
    - `locale` — текущий; `draft`; `rules: snapshot?.discountRules ?? []`;
    - `done: printed ? { totalMinor: printed.request.totalMinor, changeMinor: printed.request.changeMinor } : null`;
    - `active: Boolean(openShift) && !locked`.
  - `CustomerDisplayButton` — в `actions` шапки, перед «Отложенные», только при `terminalId` и `displaySupported()`.
    Открывает `window.open(routes.customerDisplay(id), 'ph-customer-display', 'popup')`; `null` (окно заблокировано) →
    `onBlocked` → уведомление кассы «Браузер не дал открыть окно. Разрешите всплывающие окна для этого сайта».

- [ ] **Step 4: Страница экрана.**
  - `CustomerDisplayPage`:
    - `terminal` — из `useSearchParams` внутри `<Suspense>`, как `ProductPage`; без него — «Откройте экран покупателя
      кнопкой на кассе»;
    - `<WithMessages groups={['pos']}>`;
    - канал открывается, сразу отправляется `hello`; язык — по R1.
  - Состояния D3: «Добро пожаловать» с названием точки; чек (строки, «уп.» / «шт.», подсветка `changedKey`, подытог,
    «Скидка {percent} %», крупно «К оплате»; блок оплаты — способы и суммы, «Получено», «Сдача»); «Спасибо за покупку!»
    с суммой и сдачей.
  - Через 10 с после `done` без новых сообщений — `idle`. Новое состояние `receipt` прерывает таймер.
  - Полный экран: до `document.fullscreenElement` поверх — кнопка «Коснитесь, чтобы развернуть»
    (`document.documentElement.requestFullscreen()`; отказ — кнопка скрывается).
  - Вёрстка — без оболочки и меню, на весь экран, крупная типографика из существующей шкалы (`text-xl` … `text-3xl`),
    поверхности — семантические токены. Строки прокручиваются внутри, итог всегда виден.
  - `apps/web/app/customer-display/page.tsx` — реэкспорт страницы, как `app/login/page.tsx`.

- [ ] **Step 5: Тексты** `pos.customerDisplay.*` (RU и TJ), `routes.customerDisplay`.

- [ ] **Step 6: Проверка.**
  - Run: `npx nx run-many -t typecheck lint -p web`, `npx nx fsd web`, `npx nx build web`.
    Expected: без новых ошибок; в `apps/web/out/` есть `customer-display.html` (или `customer-display/index.html`).
  - На моках, два окна (`127.0.0.1:4212`):
    - чек → изменение количества (подсветка) → «Карта» на часть → «Оплатить» → «Спасибо» 10 с → ожидание;
    - перезагрузка окна экрана посреди чека и экран, открытый до кассы, показывают текущий чек (Review Focus 1);
    - новая строка во время «Спасибо» сразу показывает чек (Review Focus 3);
    - ПКУ в чеке — без данных рецепта.
  - Вторая вкладка с другим `terminal` в адресе не получает сообщений (Review Focus 2).
  - Переключение языка кассы меняет язык экрана.
  - 1280×800 и масштаб 125 %.

- [ ] **Step 7: Commit** — `feat(web): customer display window fed by the POS over BroadcastChannel`.

### Task 5: Документы и живой прогон на API

**Files:**
- Modify: `docs/architecture/glossary.md` — «Экран покупателя» (customer display): второе окно кассы для покупателя,
  только показ, без данных ПКУ и закупочных цен.
- Modify: `CLAUDE.md` — в абзаце о границах модулей к `PriceChanges` добавить: «историю цен товара (`GET
  /prices/{id}/history`) `pricing` читает у `audit` (`PriceHistory`)».
- Modify: `docs/qa` — руководство тестировщика с разделом о кассе (найти по «касс»):
  - экран покупателя: кнопка, разрешение всплывающих окон, второй монитор, ярлык Chrome из D6;
  - «Завести товар» в приходе;
  - история цен.
  Также строки этих возможностей в «Границах пилота», если они там перечислены.
- Modify: `apps/web/README.md`, если в нём есть список маршрутов вне оболочки.

- [ ] **Step 1: Документы** — по списку выше.

- [ ] **Step 2: Живой прогон на API.**
  - API из этой папки на свободном порту против dev-БД (миграций в PR нет); web — `dev-api` на
    `127.0.0.1:<порт>`.
  - Изменить цену товара на точке и провести приход с новой ценой. В истории видны «Вручную» и «Приход № …» с автором.
  - `storeId` чужой точки — 403 `store_not_in_scope`; чужой товар — 404 (Review Focus 5).
  - Касса под PIN с привязанным терминалом: экран покупателя, как в задаче 4.
  - Скан незнакомого кода в приходе: товар создаётся в dev-БД и встаёт строкой.

- [ ] **Step 3: Итог.**
  - Run: `npx nx run-many -t typecheck lint test -p web api shared-dto` и `npx nx fsd web`. Expected: зелёные, в том
    числе `messages.spec.ts` — ключи RU и TJ совпадают.
  - Полный `npm run check` — пользователь.

- [ ] **Step 4: Commit** — `docs: customer display, product from a barcode and price history in the glossary, CLAUDE.md
  and the QA guide`.
