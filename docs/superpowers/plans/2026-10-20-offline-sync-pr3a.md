# Офлайн-точка, PR 3a — лента «облако → точка»: ядро, каталог, цены, скидки: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** точка по своему ключу получает `GET /api/v1/sync/changes` — изменения справочников сети с номерами ленты. В 3a это товары со штрихкодами, категории, цены своей точки и правила скидок. Номер изменению присваивается при чтении (E5), так что курсор не теряет поздно закоммиченное.

**Architecture:**
- Таблица `sync_changes`: строка — «сущность X изменилась», без содержимого.
- Писатели вызывают порт ядра `SyncChanges.record(trx, …)` в своей транзакции (E4).
- Чтение ленты:
  - под `pg_advisory_xact_lock('sync-feed', сеть)` нумерует ненумерованные строки, удаляет строки старше окна и сдвигает горизонт;
  - отдаёт страницу сущностей с текущим состоянием, которое читают **источники ленты** модулей-владельцев (реестр `SyncFeedSources` в `core/sync`, как `SyncAppliers`).
- Содержимое сущности — строки её таблиц (camelCase, как пишет облако): точка в PR 4 делает upsert по `id` в те же таблицы (E27).

**Tech Stack:** NestJS 11, Kysely + pg, node-pg-migrate SQL. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-16-offline-sync-design.md`: E4, E5, E12 (лента не выдаётся по отозванному / истёкшему ключу), E21, E22, раздел 5.1; модель данных 06. Основа — ADR-0014 §3 с уточнением E5.

**PR 3 разбит на четыре** (договорённость о небольших PR):
- 3a — этот;
- 3b — роли, сотрудники, поставщики, настройки и политика возвратов, юрлица и точки, заказы;
- 3c — `transfer_in_transit`, `transfer_result`, конфликты, заявки на перемещение;
- 3d — снимки `GET /sync/snapshots/{dataset}`.

## Global Constraints

- Тесты отложены до MVP — живая проверка (curl с ключом точки); существующие наборы зелёные.
- Окружение Windows, prettier только на изменённые файлы, ветка `feature/offline-sync-pr3a` (`--no-track origin/main`), план — первым коммитом.
- Номер миграции — текущее время в мс, после `1792470159132`; правило cr-N3 для изменений больших таблиц.
- Лента пишется всегда, а не только при наличии офлайн-точек (E4). `record` — одна вставка, без чтения.
- Номер ленты (`change_seq`) даёт только чтение, под advisory-lock сети. Писатель номер не получает (E5).
- Окно ленты — `feed_window_days` платформы (90, E13). Курсор меньше горизонта — 410 `resync_required`.
- Лента выдаётся только при статусе ключа `active` / `expiring`. При `revoked`, `expired`, `store_closed`, `tenant_blocked` — 403 `feed_closed`: приём операций ещё работает, лента нет (E12).
- Содержимое — строки таблиц с `bigint` → `number` (деньги — целые дирамы, в пределах safe int) и `timestamptz` → ISO. Учётные данные сотрудников в ленту не идут (E21, ADR-0008) — касается 3b.

## Review Focus

1. **Писатель закоммитил позже, чем чтение ленты пронумеровало более новые строки.**
   - Ожидается: его изменение получает номер больше курсора и приходит следующим чтением — курсор его не пропускает (инвариант ADR §3).
   - Проверка — Задача 4, шаг f3.
2. **Сущность менялась много раз между чтениями.**
   - Ожидается: в странице она одна, с текущим состоянием и последним номером.
   - Проверка — Задача 4, шаг f2.
3. **Изменение цены другой точки.**
   - Ожидается: в ленте этой точки его нет. Изменение сети (товар) видно всем точкам.
   - Проверка — Задача 4, шаг f4.
4. **Удалённая сущность** (правило скидки, если его удаляют, а не архивируют).
   - Ожидается: `op: 'delete'`, `data: null` — точка архивирует.
   - Проверка — Задача 4, шаг f5.
5. **Ключ отозван (льготный срок) или курсор старше окна.**
   - Ожидается: операции принимаются, лента — 403 `feed_closed`; курсор старше горизонта — 410 `resync_required`.
   - Проверка — Задача 4, шаги f6, f7.

---

### Task 1: Таблица ленты, контракты, порт ядра

**Files:**
- Create: `apps/api/migrations/<ms>_sync-changes.sql`.
- Modify: `db.generated.ts` (`api:db-types`), `table-classes.ts`, `libs/shared/dto/src/lib/sync-protocol.ts`.
- Create: `apps/api/src/core/sync/feed.ts`.
- Modify: `apps/api/src/core/sync/index.ts`, `sync-core.module.ts` (providers и exports `SyncChanges`, `SyncFeedSources`).
- Modify: модель данных 06.

**Interfaces — Produces:**
- **Миграция:**
  - `create sequence pharmacy.sync_change_seq`.
  - Таблица `sync_changes`:
    - `tenant_id`, `id uuid` (UUIDv7 писателя — порядок нумерации);
    - `change_seq bigint null`; `scope_store_id uuid null` FK → `stores`;
    - `entity_type text` — check по списку `SyncEntityType`; `entity_id uuid`; `changed_at timestamptz default now()`;
    - ключ `(tenant_id, id)`.
  - Индексы `sync_changes`:
    - уникальный `(tenant_id, change_seq) where change_seq is not null`;
    - `(tenant_id, id) where change_seq is null`;
    - `(tenant_id, scope_store_id)`.
  - Таблица `sync_feed_state (tenant_id primary key, horizon_seq bigint not null default 0, updated_at)`.
  - Обе таблицы — класс `tenant`, FORCE RLS, полный DML для `pharmacy_app`; `grant usage, select on sequence pharmacy.sync_change_seq to pharmacy_app`.
  - Колонки `op` нет: удаление определяется при чтении — нет строки, значит tombstone. Модель 06 поправляется.
- **DTO:**
  - `SyncEntityType`: `'product' | 'category' | 'store_price' | 'discount_rule' | 'role' | 'employee' | 'supplier' | 'tenant_settings' | 'return_policy' | 'legal_entity' | 'store' | 'transfer_in_transit' | 'transfer_result' | 'purchase_order' | 'transfer_request' | 'price_conflict' | 'duplicate_conflict'`;
  - `SyncEntityData = Record<string, Array<Record<string, unknown>>>` — имя таблицы camelCase → строки;
  - `SyncChange { seq: number; entityType: SyncEntityType; entityId: string; scopeStoreId: string | null; op: 'upsert' | 'delete'; data: SyncEntityData | null }`;
  - `SyncChangesResponse { changes: SyncChange[]; cursor: number; hasMore: boolean }`.
- **`core/sync/feed.ts`:**
  - `SyncChanges.record(trx, c: { tenantId: string; entityType: SyncEntityType; entityId: string; scopeStoreId?: string | null }): Promise<void>` — вставка строки с `newId()`;
  - `FeedSource { entityTypes: readonly SyncEntityType[]; read(trx, tenantId, storeId, ids: readonly string[], entityType): Promise<Map<string, SyncEntityData>> }` — нет ключа в Map → удалено;
  - `SyncFeedSources.register / sourceOf(type)`;
  - `feedRow(row): Record<string, unknown>` — `bigint` → `number` (вне safe int — ошибка), `Date` → ISO.

- [ ] **Step 1:** миграция, `api:migrate`, `api:db-types`, `table-classes`.
  Expected: применена; `SyncChanges`, `SyncFeedState` в типах.
- [ ] **Step 2:** контракты; ядро; модель 06.
- [ ] **Step 3:** `nx run-many -t lint build -p shared-dto api`; `api:integration` (каталог таблиц).
  Expected: exit 0, 158/158.
  Commit: `feat(db): the change feed of offline stores — table, contracts, core port`.

### Task 2: Чтение ленты — `GET /sync/changes`

**Files:**
- Create: `apps/api/src/app/sync/sync-feed.service.ts`.
- Modify: `sync-receive.controller.ts` (маршрут), `sync.module.ts`, `libs/shared/dto` (query DTO, если нужен).

**Interfaces:**
- Consumes: Задача 1; `SyncStoreParam` / `LicenseKeyGuard` (PR 1).
- Produces: `GET /api/v1/sync/changes?cursor=<int ≥ 0>&limit=<1…1000, по умолчанию 500>` → `SyncChangesResponse`.

- [ ] **Step 1: `SyncFeedService.changes(store: SyncStore, cursor: number | null, limit: number)`** в tenant-транзакции сети ключа:
  1. Статус ключа не `active` / `expiring` → 403 `feed_closed`. `cursor` не задан → 410 `resync_required`: нужен снимок (3d).
  2. `pg_advisory_xact_lock(hashtext('sync-feed'), hashtext(tenantId))`.
  3. **Нумерация** — один запрос:

     ```sql
     update pharmacy.sync_changes c set change_seq = s.seq
     from (select id, nextval('pharmacy.sync_change_seq') as seq
           from (select id from pharmacy.sync_changes
                 where tenant_id = $1 and change_seq is null order by id) o) s
     where c.tenant_id = $1 and c.id = s.id
     ```

  4. **Окно:** удалить нумерованные строки с `changed_at < now() − feed_window_days`; горизонт = `greatest(horizon, max(удалённых change_seq))` (upsert `sync_feed_state`).
  5. `cursor < horizon` → 410 `resync_required`.
  6. **Страница:**

     ```sql
     select entity_type, entity_id, max(change_seq) seq, scope_store_id
     from pharmacy.sync_changes
     where tenant_id = $1 and change_seq > $cursor
       and (scope_store_id is null or scope_store_id = $store)
     group by entity_type, entity_id, scope_store_id
     order by seq limit $limit + 1
     ```

  7. **Состояние:** по типам — `sourceOf(type).read(…)`.
     - Есть данные → `upsert` с `data`; нет → `delete` с `data: null`.
     - Тип без источника — ошибка конфигурации (500, в логе тип), не молчаливый пропуск.
  8. `cursor` ответа = `seq` последнего элемента страницы, иначе прежний курсор; `hasMore` = была строка `limit + 1`.
- [ ] **Step 2:** маршрут в контроллере контура (`@Public` + `LicenseKeyGuard`, как остальные); заголовок `Pharmacy-License-Status` — как у других ответов sync.
- [ ] **Step 3:** `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): the change feed read by offline stores — sequencing at read, window, pages`.

### Task 3: Источники и писатели — товары, категории, цены, скидки

**Files:**
- Create: `apps/api/src/app/catalog/catalog-feed.ts`, `apps/api/src/app/pricing/pricing-feed.ts`.
- Modify:
  - `products.service.ts`, `categories.service.ts`, `catalog-facts.ts`;
  - `store-price-writer.ts`, `local-price-rule.ts`, `discount-rules.service.ts`, `store-discount-detachment.ts`;
  - модули (providers).

**Interfaces:**
- Consumes: `SyncChanges`, `SyncFeedSources`, `feedRow` (Задача 1).
- Produces — источники:
  - **`product`** → `{ products: [строка], productBarcodes: [строки] }`;
  - **`category`** → `{ categories: [строка] }`;
  - **`store_price`** (`entity_id` = товар, область = точка) → `{ storeProducts: [строка (точка, товар)] }`. Читает строку точки запроса — область уже отфильтрована страницей;
  - **`discount_rule`** → `{ discountRules, discountRuleTiers, discountRuleStores }`.

- [ ] **Step 1: Источники** `CatalogFeed` (`product`, `category`) и `PricingFeed` (`store_price`, `discount_rule`). Регистрация в конструкторе, чтение пачкой по `ids` (`where id in`), строки через `feedRow`.
- [ ] **Step 2: Писатели** — `record` в транзакции записи. Найти **все** пути записи этих таблиц: `grep` по `products`, `productBarcodes`, `categories`, `storeProducts`, `discountRules` и их SQL-именам.

  Минимум:
  - **`product`:** `ProductsService` create / update / setStatus, наценки товара; `CatalogFacts` (товар точки; при `merge` — L и X: штрихкоды X изменились).
  - **`category`:** `CategoriesService` create / update / status / наценки.
  - **`store_price`:**
    - `StorePriceWriter.set` и `copyIfMissing` (область — точка цены);
    - `LocalPriceRule` при применении. Точка узнаёт версию, которую её цена получила в облаке, — это закрывает вопрос ревью PR 2a I2 о версии.
  - **`discount_rule`:** `DiscountRulesService` create / update / archive / delete; `StoreDiscountDetachment`.
- [ ] **Step 3:** `npx tsc --noEmit -p apps/api/tsconfig.app.json`.
  Expected: без вывода.
  Commit: `feat(api): products, categories, store prices and discount rules in the change feed`.

### Task 4: Живая проверка, документы, наборы

**Files:**
- Modify: `CLAUDE.md` (граф: `catalog`, `pricing` пишут ленту через `SyncChanges` и отдают источники в `SyncFeedSources`), спецификация, раздел 13, модель 06.
- Scratchpad: `os_feed.sh`.

- [ ] **Step 1:** сборка, перезапуск `api-oc-4210`.
- [ ] **Step 2: Живые сценарии** (точки A — офлайн с ключом, B — облачная):

  | Шаг | Операция | Ожидается |
  |---|---|---|
  | f1 | `GET /sync/changes` без курсора; с `cursor=0` | 410 `resync_required`; страница с товарами, категорией и ценами A сети `pos_setup.sh` |
  | f2 | владелец трижды меняет товар Q, затем чтение с курсором f1 | Q один раз, текущее название, `seq` > курсора |
  | f3 | вторым соединением: открыть транзакцию, `record` товара PR, не коммитить; чтение (нумерует другие); коммит; чтение | PR приходит во втором чтении с номером больше курсора первого |
  | f4 | цена Q у B; цена Q у A | в ленте A только цена A; изменение товара — у обеих |
  | f5 | правило скидки: создать, затем удалить (или архивировать — что умеет сервис) | `upsert`, затем `delete` / `upsert` со статусом `archived` |
  | f6 | ключ A отозван (`revoked`) | `POST /sync/operations` принимается; `GET /sync/changes` — 403 `feed_closed` |
  | f7 | `update sync_feed_state set horizon_seq = курсор + 100`; чтение со старым курсором | 410 `resync_required` |
  | f8 | `limit=2` | `hasMore: true`, следующая страница с курсора продолжает без пропусков |

- [ ] **Step 3: Наборы:** `run-many lint test build -p shared-dto shared-domain api`; `api:integration`; `api:db-types-verify`.
  Expected: exit 0.
- [ ] **Step 4: Коммит:** `docs: offline sync PR 3a — module graph, data model, spec decisions`.
