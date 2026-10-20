# Загрузка данных сети из файла — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** владелец или заведующий загружает из `.xlsx` или `.csv` каталог, начальные остатки точки и поставщиков. Перед
записью видны все ошибки, с ошибками не записывается ничего.

**Architecture:**
- Браузер читает файл своим кодом (`shared/lib/spreadsheet`: zip на `DecompressionStream`, XML на `DOMParser`, CSV).
  Мастер `features/data-import` сопоставляет столбцы и значения и шлёт на API типизированные строки JSON.
- API: у каждой загрузки два маршрута — `…/checks` (сухой прогон) и `POST` с `Idempotency-Key` (та же проверка в
  транзакции и запись).
  - Каждая загрузка живёт в модуле своих данных: `catalog`, `inventory`, `purchasing`.
  - Общий журнал `import_jobs` ведёт `ImportJobs` (`core/imports`, глобальный): очередь загрузок сети, повтор по
    ключу, прошлые загрузки.
- Остатки становятся черновиками НО по 500 строк — через тот же код сохранения, что у ручного НО.

**Tech Stack:** NestJS 11, Kysely + pg (`tenantTransaction`), node-pg-migrate (SQL); Next.js static export, TanStack
Query, use-intl, `@pharmacy/ui`; встроенные API браузера `DecompressionStream`, `DOMParser`, `TextDecoder`.

**Spec:** `docs/superpowers/specs/2026-10-20-data-import-design.md` (утверждена 2026-10-20). Решения F1–F22,
разделы 3 (чтение), 4 (поля), 5 (сервер), 6 (схема), 7 (API), 8 (контракт), 9 (веб), 10 (лента), 11 (журнал),
13 (документы), 14 (проверка).

## Global Constraints

**Тесты.**
- Новых автотестов нет (правило «тесты до MVP»). Долг — в описании PR (спецификация, 14).
- Существующие наборы `api`, `web`, `shared-dto`, `shared-domain`, `shared-util` остаются зелёными.
- Проверка — сквозным скриптом на временной базе, синтетическими файлами в браузере и скриншотами (Задача 10).

**База.**
- Одна миграция. Номер — `Date.now()` при создании. Он должен быть больше всех номеров на `origin/main`, в ветках
  `origin/*`, в основной папке (сейчас максимум `1792495427936_sync-feed-counter` ветки PR 3a синхронизации) и в
  общих базах (`applied_check.mjs`).
- Миграцию не применять к общим базам `pharmacy` и `pharmacy_test`. `api:integration` не запускать.
- Временная база — `pharmacy_import_check`: лаунчер `ops_env2.mjs` (`OPS_DB`), создание как в плане уведомлений,
  удаление — `drop_scratch.mjs`.

**Окружение и git.**
- Только worktree `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/data-import` без upstream. Основная папка
  — только чтение (`git show`, `ls`).
- Коммиты — `git commit --no-gpg-sign` с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prettier — только для новых файлов и файлов, отформатированных на `origin/main`.
- Перед каждым коммитом — `git status`: сгенерированный `apps/web/next-env.d.ts` в коммит не попадает.
- Новых npm-зависимостей нет (F3).

**Правила спецификации (дословно).**
- Лимиты (F19) — в `libs/shared/domain/src/lib/imports.ts`:

  ```ts
  importLimits = {
    fileBytes: 10 * 1024 * 1024,
    rows: 20_000,
    supplierRows: 2_000,
    unpackedBytes: 100 * 1024 * 1024,
    bodyBytes: 10 * 1024 * 1024,
    issues: 1_000,
    documentLines: 500,
  }
  ```

  Клиент ждёт ответа загрузки 120 000 мс.
- Всё или ничего (F7). Ошибка во время загрузки — 422 `import_invalid` без тела ошибок; экран повторяет проверку.
- Права (F14): каталог — `catalog:create`, новые категории — ещё `catalog:update`; остатки — `inventory:create`,
  точка в охвате и `finance:view-cost` (Уточнение У3); поставщики — `purchasing:create`.
- Очередь загрузок сети: `pg_advisory_xact_lock(hashtextextended('imports:' || tenant, 0))`. Строку `tenants` не
  блокировать.
- Многострочные `insert` — пачками по 1 000 строк. Списки значений в запросах — `= any(${list}::text[])`, а не
  `in (…)`: в 20 000 строках может быть до 400 000 штрихкодов, а предел PostgreSQL — 65 535 параметров.
- Нормализация для сравнения наименований и категорий (F9):

  ```ts
  matchKey(s) = s.normalize('NFC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    .toLocaleLowerCase('ru').replace(/ё/g, 'е')
  ```

  Функция — в `libs/shared/util` (`import-keys.ts`), её используют и сервер, и браузер.
- Ничего из ячеек файла не логируется (§11).

**Уточнения спецификации при планировании** (вносятся в спецификацию в Задаче 10 разделом «Уточнения
2026-10-20»):
- **У1.** Повтор ключа с другими строками — 409 `idempotency_conflict`, как у кассы (`PosIdempotency`), а не
  `idempotency_key_reused`.
- **У2.** События журнала:
  - каталог — `product.imported`, поставщики — `supplier.imported`. Префиксы `product.` и `supplier.` уже входят в
    группы «Каталог» и «Закупки» (`audit-groups.ts`);
  - остатки — `document.imported` с `details.type = 'opening_balance'`. Событие добавляется в `documentEvents`,
    поэтому попадает в группу «Приход и НО»;
  - каждый черновик НО, как и при ручном создании, ещё пишет `document.created` (общий код сохранения).
- **У3.** Загрузка остатков требует ещё `finance:view-cost` — как ручной НО (`requireCost`, ADR-0018 п. 6): в файле
  закупочные цены.
- **У4.** Комментарий черновиков приходит от клиента на языке интерфейса (`comment`, ≤ 450). Сервер дописывает
  ` (i/n)`, когда черновиков больше одного. Сервер не пишет фраз на одном языке.
- **У5.** Тексты мастера — пространство `dataImport` в группе сообщений `stock` (RU и TG); подписи событий — в
  `auditEvents` (`core.json`).

## Review Focus

1. **Штрихкод из Excel.** 13-значный код в числовой ячейке `.xlsx` сохраняет все цифры. Запись `4,6E+12` в CSV —
   ошибка строки, а не обрезанный код. Проверка — Задачи 7, 10.
2. **Каталог изменился между проверкой и загрузкой.** Другой сотрудник добавил товар с тем же штрихкодом, или
   параллельно идёт вторая загрузка. Ответ — 422 `import_invalid`, не записано ничего; две загрузки выполняются по
   очереди. Проверка — Задачи 4, 10.
3. **Повтор после таймаута «Загрузить».** Тот же ключ даёт тот же итог: ни второго набора товаров, ни второй пачки
   черновиков. Проверка — Задачи 3, 10.
4. **Граница 500 строк и стартовые партии.** 500 строк → один черновик, 501 → два. Пустая серия → «стартовая
   партия». Черновики не проведены. Проверка — Задачи 5, 10.
5. **Заголовок не в первой строке.** Над заголовком строки «Остатки на 01.10.2026». Незнакомые столбцы получают «Не
   загружать». Без обязательного поля дальше пройти нельзя. Проверка — Задачи 8, 10.

---

### Task 1: Контракт, лимиты, маршруты веба

**Files:**
- Create: `libs/shared/dto/src/lib/tenant-imports.ts` (экспорт в `index.ts`), `libs/shared/domain/src/lib/imports.ts`
  (экспорт в `index.ts`), `libs/shared/util/src/lib/import-keys.ts` (экспорт в `index.ts`).
- Modify: `apps/web/src/shared/api/routes.ts`, `client.ts` (`timeoutMs`), `apps/web/src/shared/api/mocks/*` —
  заглушки шести маршрутов для компиляции (`MockHandlers` требует все ключи).

**Interfaces:**
- Produces:
  - Типы §8 спецификации дословно, плюс `comment: string` в `OpeningBalanceImportRequest` (У4).
  - `ImportIssueCode` из §8 и ещё `'barcode_scientific'`, `'invalid'` — только клиентские (ошибки разбора ячейки);
    сервер их не шлёт.
  - `importLimits` (Global Constraints), `matchKey(s: string): string`.
  - Маршруты веба:

    | Ключ | Тип | Путь |
    |---|---|---|
    | `'catalogImports.check'` | `route<CatalogImportCheck, CatalogImportRequest>` | `'POST', '/catalog-imports/checks'` |
    | `'catalogImports.apply'` | `route<CatalogImportResult, CatalogImportRequest>` | `'POST', '/catalog-imports'` |
    | `'openingBalanceImports.check'` / `'.apply'` | так же | `/opening-balance-imports/checks`, `/opening-balance-imports` |
    | `'supplierImports.check'` / `'.apply'` | так же | `/supplier-imports/checks`, `/supplier-imports` |

    Все шесть — в `REAL_API_ROUTES`.
  - `ApiRequestOptions.timeoutMs?: number` — заменяет `REQUEST_TIMEOUT_MS` для одного запроса.

- [ ] **Step 1: Контракт и лимиты** по Interfaces; у типов — комментарии со ссылкой на F-решения.
- [ ] **Step 2: Маршруты, `timeoutMs`, заглушки моков** (бросают `ApiError(501, 'not_implemented')` до Задачи 9).
- [ ] **Step 3: Проверка.** `npx nx run-many -t lint test typecheck -p shared-dto shared-domain shared-util web`.
  Expected: зелёные.
- [ ] **Step 4: Коммит** `feat(dto): data import contracts and limits`.

### Task 2: Миграция `import_jobs`

**Files:**
- Create: `apps/api/migrations/<ms>_import-jobs.sql`.
- Modify:
  - `apps/api/src/core/database/table-classes.ts` (`import_jobs: 'tenant'`), `db.generated.ts`;
  - модель данных `06-sync-audit-billing.md` — строка `import_jobs` по §6 с пометкой «поправка 2026-10-20: без
    `status`/`errors` и уникальности по хэшу; повтор — с предупреждением»;
  - `README.md` модели не меняется: `import_jobs` уже в списке класса `tenant`.

**Interfaces:**
- Produces: таблица и индекс §6 спецификации дословно. RLS:

  ```sql
  enable row level security; force row level security;
  create policy tenant_isolation on pharmacy.import_jobs for all to pharmacy_app
    using (tenant_id = (select current_setting('app.tenant_id')::uuid))
    with check (…то же…);
  grant select, insert on pharmacy.import_jobs to pharmacy_app;
  ```

  Шаблон — `sync_changes`.

- [ ] **Step 1: Номер миграции.** Сверка номеров по Global Constraints, найденный максимум — в ledger.
- [ ] **Step 2: Миграция** по Interfaces; в шапке — ссылка на спецификацию (F16).
- [ ] **Step 3: Временная база.** Создать `pharmacy_import_check`, применить все миграции, `kysely-codegen`, затем
  `--verify`.
  Expected: применены все миграции; `--verify` чистый.
- [ ] **Step 4: Модель данных** по Files.
- [ ] **Step 5: Проверка.**
  - `npx tsc -b apps/api/tsconfig.json`;
  - `npm run docs:check`;
  - гранты по `information_schema` на временной базе.

  Expected: у `pharmacy_app` только `SELECT, INSERT`; `relforcerowsecurity = true`.
- [ ] **Step 6: Коммит** `feat(db): import jobs journal`.

### Task 3: Ядро загрузок и лимит тела

**Files:**
- Create: `apps/api/src/core/imports/import-jobs.ts`, `import-issues.ts`, `imports-core.module.ts`, `index.ts`.
- Modify:
  - `apps/api/src/app/app.module.ts` (`ImportsCoreModule` рядом с `SyncCoreModule`);
  - `apps/api/src/common/http/contour.ts` (`isImportPath`);
  - `apps/api/src/main.ts` (третий JSON-парсер);
  - `CLAUDE.md` (граф: `ImportJobs`);
  - ADR-0012 (proposed): в таблицу лимитов — `/api/v1/*-imports*` 10 МБ.

**Interfaces:**
- Produces:
  - `ImportJobs` (`@Injectable`, глобальный модуль), все методы — внутри `TenantTransaction` вызывающего:
    - `lock(trx, tenantId): Promise<void>` — advisory-блокировка из Global Constraints;
    - `replay<T>(trx, tenantId, key: string, hash: Buffer): Promise<T | null>` — `result` строки с этим ключом, если
      хэш совпал; другой хэш — `ProblemException(409, 'idempotency_conflict')`; ключа нет — `null`;
    - `record(trx, job: ImportJobRecord): Promise<void>`, где `ImportJobRecord = { tenantId; id; kind:
      'catalog' | 'opening_balance' | 'suppliers'; storeId: string | null; fileName; hash: Buffer; key; result:
      unknown; createdBy: string }`;
    - `previous(trx, tenantId, kind, storeId: string | null, hash: Buffer): Promise<{ id: string; createdAt:
      string; result: unknown }[]>` — новые сначала.
  - `importHash(rows: unknown): Buffer` — SHA-256 от `canonicalJson(rows)` (`core/sync`, `node:crypto`). Хэшируются
    только строки, без имени файла.
  - `idempotencyKeyOf(header: string | undefined): string` — UUID в нижнем регистре. Пусто или не UUID —
    `FieldProblemException(400, 'validation_failed', [{ field: 'Idempotency-Key', code: 'required' | 'invalid' }])`.
  - `ImportIssues`: `add(issue: ImportIssue)`, `list: ImportIssue[]` (первые `importLimits.issues`, по возрастанию
    `line`), `total: number`, `empty: boolean`.
  - `isImportPath(originalUrl)` — путь `/api/v1/catalog-imports`, `/api/v1/opening-balance-imports`,
    `/api/v1/supplier-imports` с `/checks` или без, query отбрасывается. В `main.ts` — парсер
    `{ limit: importLimits.bodyBytes, type: <isImportPath && application/json> }` между парсером sync и общим.

- [ ] **Step 1: `core/imports`** по Interfaces; `ImportsCoreModule` — `@Global()`, как `SyncCoreModule`.
- [ ] **Step 2: Лимит тела** в `main.ts` и `contour.ts`; комментарий в `main.ts` дополнить строкой про загрузки.
- [ ] **Step 3: Документы.** В граф `CLAUDE.md` — абзац: журнал загрузок из файла `ImportJobs` (`core/imports`,
  глобальный) — его используют `catalog`, `inventory`, `purchasing`. ADR-0012 — строка лимита.
- [ ] **Step 4: Проверка.** `npx nx run-many -t lint test typecheck -p api`; `npm run docs:check`.
  Expected: зелёные (поведение маршрутов проверяется в Задаче 10).
- [ ] **Step 5: Коммит** `feat(api): import jobs core and the body limit of imports`.

### Task 4: Загрузка каталога (API)

**Files:**
- Create:
  - `apps/api/src/app/catalog/dto/catalog-import.dto.ts`;
  - `apps/api/src/app/catalog/product-rules.ts`;
  - `apps/api/src/app/catalog/catalog-import.service.ts`;
  - `apps/api/src/app/catalog/catalog-imports.controller.ts`.
- Modify: `products.service.ts` (правила карточки — из `product-rules.ts`), `catalog.repository.ts` (пакетные
  методы), `catalog.module.ts`.

**Interfaces:**
- Consumes: `ImportJobs`, `ImportIssues`, `importHash`, `idempotencyKeyOf` (Задача 3); `matchKey`, `importLimits`
  (Задача 1).
- Produces:
  - **DTO.**
    - `CatalogImportRowDto implements CatalogImportRow` — пределы как у `CatalogProductInputDto`: строки ≤ 200;
      `category` ≤ 100 (как `CategoryInputDto`); `barcodes` — `ArrayMaxSize(20)`, каждый `/^[0-9]{8,14}$/`;
      `line` — целое ≥ 1.
    - `CatalogImportRequestDto` — `fileName` 1–255 с trim, `rows` 1..`importLimits.rows`.
  - **`product-rules.ts`.**
    - `cardIssues(input: CatalogProductInput-подобные поля, ctx: { language: NameLanguage; forms: ReadonlySet<string>
      }): { field: string; code: string }[]` — без запросов к БД: имя на языке сети `required`, форма из справочника
      `unknown_form`, страна `unknown_country`, `not_divisible`, предел минимального остатка `max`, повтор штрихкода
      в строке `duplicate`.
    - `productValuesOf(input, categoryId: string): ProductValues` — то, что сейчас возвращает `values()`.
    - `ProductsService.values()` берёт обе функции и бросает первую ошибку тем же `invalid(field, code)`: поведение
      формы не меняется.
  - **`CatalogRepository`** (новые методы):
    - `barcodeOwnersOf(trx, tenantId, codes: string[]): Promise<Map<string, { productId: string; name: unknown;
      status: CatalogStatus }>>` — `= any(…)` с `products`;
    - `productNameIndex(trx, tenantId): Promise<{ id: string; name: unknown; dosageForm: string | null; dosage:
      string | null; status: CatalogStatus }[]>` — все товары сети; вызывается, только если есть строки без
      штрихкода;
    - `insertProducts(trx, tenantId, rows: { id: string; values: ProductValues }[])`;
    - `insertBarcodes(trx, tenantId, rows: { productId: string; barcode: string }[])` — отсортированы по `barcode`,
      как в `replaceBarcodes`.
  - **`CatalogImportService`:**
    - `check(request): Promise<CatalogImportCheck>`;
    - `apply(request, key: string): Promise<CatalogImportResult>` — порядок §5:
      1. `lock`;
      2. `replay`;
      3. `lockCategoryNames`;
      4. оценка;
      5. 422 `import_invalid`, если `!issues.empty`;
      6. новые категории (`insertCategory`, имя на языке сети);
      7. `insertProducts`, `insertBarcodes`;
      8. `record` (`kind: 'catalog'`, `result` = ответ);
      9. аудит `product.imported` (`entityType: 'import'`, `entityId: importId`, `details: { fileName, created,
         existing, categoriesCreated }`).
    - Правила оценки — §5 «Каталог» спецификации:
      - категория: активная → id; совпадение только с архивной → `archived_category`; иначе новая или
        `unknown_category`, если нет `catalog:update`; пустая → `required`;
      - штрихкоды: все у одного товара → «уже в каталоге»; ни одного → новый; иначе `barcode_conflict`
        (`detail` — имя товара на языке сети); повтор кода в файле → `duplicate_in_file` у второй строки;
      - строка без штрихкода — ключ `matchKey(имя на языке сети) | matchKey(form) | matchKey(dosage)` против
        `productNameIndex`; повтор ключа в файле → `duplicate_in_file`;
      - `cardIssues` каждой строки — с `line` строки.
  - **`CatalogImportsController`** `@Controller({ path: 'catalog-imports', version: '1' })`:
    - `@Post('checks') @HttpCode(200) @RequirePermission('catalog:create')`;
    - `@Post() @RequirePermission('catalog:create')` с `@Headers('idempotency-key')`.

- [ ] **Step 1: `product-rules.ts`** и перевод `ProductsService.values()` на него.
- [ ] **Step 2: Проверка формы.** `npx nx test api`.
  Expected: набор зелёный — существующие тесты карточки не изменились.
- [ ] **Step 3: DTO, методы репозитория, сервис, контроллер** по Interfaces; регистрация в `catalog.module.ts`.
- [ ] **Step 4: Проверка.** `npx nx run-many -t lint test typecheck -p api`.
  Expected: зелёные.
- [ ] **Step 5: Коммит** `feat(api): catalog import — check and apply`.

### Task 5: Загрузка начальных остатков (API)

**Files:**
- Create: `apps/api/src/app/inventory/dto/opening-balance-import.dto.ts`, `opening-balance-import.service.ts`,
  `opening-balance-imports.controller.ts`.
- Modify:
  - `stock-documents.service.ts` (публичное сохранение черновика в чужой транзакции);
  - `stock.repository.ts` (`hasMovements`);
  - `apps/api/src/app/catalog/products-reader.ts` (поиск для загрузки);
  - `inventory.module.ts`;
  - `libs/shared/domain/src/lib/audit-groups.ts` (`'document.imported'` в `documentEvents`).

**Interfaces:**
- Consumes: Задача 3; `CatalogRepository.barcodeOwnersOf`, `productNameIndex` (Задача 4) — через `ProductsReader`.
- Produces:
  - **`ProductsReader`:**
    - `importProductsByBarcodes(trx, tenantId, codes: string[]): Promise<Map<string, ImportProduct>>`;
    - `importProductIndex(trx, tenantId): Promise<ImportProduct[]>`;
    - `ImportProduct = { id: string; names: string[]; form: string; dosage: string; status: 'active' | 'archived' }`.
  - **DTO.**
    - `OpeningBalanceImportRowDto` — пределы `StockLineBase`: `batchNumber` ≤ 60 с trim, `expiresOn`
      `IsCalendarDate`, `quantity` 1..`MAX_PACKS`, `costMinor` 0..`MAX_MONEY_MINOR`, `retailPriceMinor` `null` |
      1..`MAX_MONEY_MINOR`; `barcodes` как в каталоге; `name`, `form`, `dosage` ≤ 200.
    - `OpeningBalanceImportRequestDto` — `fileName`, `storeId` (`IsUUID`), `date` (`IsCalendarDate`), `comment`
      (≤ 450, trim), `rows` 1..`importLimits.rows`.
  - **`StockDocumentsService.saveOpeningBalanceDraft(trx, tenantId, input: OpeningBalanceInput): Promise<{ id:
    string; number: string }>`** — `newId()` и существующий `save(…, 'opening_balance', id, null, input)`, затем номер
    документа. Транзакцию не открывает.
  - **`StockRepository.hasMovements(trx, tenantId, storeId): Promise<boolean>`** — `exists` по `stock_movements`.
  - **`OpeningBalanceImportService`:**
    - `check(request): Promise<OpeningBalanceImportCheck>`, `apply(request, key): Promise<OpeningBalanceImportResult>`;
    - сначала `finance:view-cost` (У3) и `StoreAccess.writableStore(trx, tenantId, storeId)` — 409
      `offline_store_read_only`, точка вне охвата — как у ручного НО;
    - поиск товара по F9:
      - по штрихкодам строки; разные товары → `barcode_conflict`;
      - иначе по `matchKey` имени (любой язык) плюс форма и дозировка, если они непусты;
      - 0 → `product_not_found`, > 1 → `product_ambiguous`, архивный → `product_archived`;
    - строки — в черновики по `importLimits.documentLines`, в порядке файла. Строка черновика: `starting:
      batchNumber === ''`. Комментарий — `comment`, плюс ` (i/n)` при n > 1;
    - проверка возвращает `documents = ceil(строк / 500)`, `storeHasStock`, `previousImports` (`ImportJobs.previous`;
      номера документов — из `result.documents`);
    - загрузка — порядок §5: аудит `document.imported`, `details: { type: 'opening_balance', fileName, documents:
      [номера], lines }`, `storeId`;
    - `result` = `{ importId, documents: [{ id, number, lines }] }`.
  - **`OpeningBalanceImportsController`** `opening-balance-imports`, `@RequirePermission('inventory:create')`; вид
    методов — как в Задаче 4.

- [ ] **Step 1: `ProductsReader`, `saveOpeningBalanceDraft`, `hasMovements`, правило журнала** по Interfaces.
- [ ] **Step 2: DTO, сервис, контроллер**; регистрация в `inventory.module.ts`.
- [ ] **Step 3: Проверка.** `npx nx run-many -t lint test typecheck -p api shared-domain`.
  Expected: зелёные.
- [ ] **Step 4: Коммит** `feat(api): opening balance import into drafts of 500 lines`.

### Task 6: Загрузка поставщиков (API)

**Files:**
- Create: `apps/api/src/app/purchasing/dto/supplier-import.dto.ts`, `supplier-import.service.ts`,
  `supplier-imports.controller.ts`.
- Modify: `purchasing.repository.ts`, `suppliers.service.ts` (экспорт `valuesOf`), `purchasing.module.ts`.

**Interfaces:**
- Produces:
  - **DTO.** `SupplierImportRowDto` — пределы `SupplierInputDto` (`name` 1–200 с trim, `taxId`
    `/^([0-9]{9})?$/`, `phone` ≤ 60, `address` ≤ 300, `paymentDelayDays` 0–365) и `line`.
    `SupplierImportRequestDto` — `rows` 1..`importLimits.supplierRows`.
  - **`PurchasingRepository`:**
    - `takenSupplierNames(trx, tenantId, lowerNames: string[]): Promise<Set<string>>` — `lower(name) = any(…)`, любой
      статус (индекс `suppliers_name_uq`);
    - `insertSuppliers(trx, tenantId, rows: { id: string; values: SupplierValues }[])`.
  - **`SupplierImportService`:**
    - `check`, `apply` — порядок §5;
    - совпадение `lower(name)` с существующим → «уже есть»; повтор в файле (`matchKey`) → `duplicate_in_file`;
    - аудит `supplier.imported`, `details: { fileName, created, existing }`.
  - **`SupplierImportsController`** `supplier-imports`, `@RequirePermission('purchasing:create')`.

- [ ] **Step 1: DTO, репозиторий, сервис, контроллер**; регистрация в модуле.
- [ ] **Step 2: Проверка.** `npx nx run-many -t lint test typecheck build -p api`.
  Expected: зелёные; сборка api проходит.
- [ ] **Step 3: Коммит** `feat(api): supplier import`.

### Task 7: Чтение `.xlsx` и `.csv` в браузере

**Files:**
- Create: `apps/web/src/shared/lib/spreadsheet/zip.ts`, `xlsx.ts`, `csv.ts`, `dates.ts`, `index.ts`.
- Modify:
  - ADR-0015 — раздел «Поправка 2026-10-20 (загрузка данных из файла)»: «свои» дополняются чтением таблиц; варианты
    и доводы — §3.1 спецификации; статус поправки — утверждена 2026-10-20;
  - `CLAUDE.md`, строка «Фронтенд-библиотеки»: «свои: API-клиент, Service Worker, сканер, чтение xlsx/csv».

**Interfaces:**
- Produces:
  - Типы `Cell`, `Workbook` — §3.2 спецификации дословно; `Sheet = Workbook['sheets'][number]`.
  - `readSpreadsheet(file: File): Promise<Workbook>`. По первым байтам:
    - `PK\x03\x04` — `.xlsx`;
    - `D0 CF 11 E0` — `SpreadsheetError('legacy_or_encrypted')`;
    - иначе — CSV.

    Файл больше `importLimits.fileBytes` — `'too_large'`; нет листов или нет строк — `'empty'`; больше
    `importLimits.rows` строк данных — `'too_many_rows'`; битый zip или XML, zip64, шифрование, неизвестный метод
    сжатия — `'corrupt'`; zip без `xl/workbook.xml` (`.ods` и прочее) — `'unsupported'`.
  - `class SpreadsheetError extends Error { code: 'too_large' | 'legacy_or_encrypted' | 'unsupported' | 'corrupt' |
    'empty' | 'too_many_rows' }`.
  - `excelSerialToDate(serial: number, date1904: boolean): string | null` — `YYYY-MM-DD`:
    - система 1900 с ошибкой Excel 29.02.1900 — серийные ≥ 61 сдвигаются на день;
    - для `date1904` к серийному прибавляется 1462;
    - дробная часть (время) отбрасывается;
    - вне 1900–9999 — `null`.
  - Правила разбора — §3.2–3.4 спецификации:
    - распаковка — `new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw')))` с подсчётом
      байтов через `TransformStream`; больше `importLimits.unpackedBytes` — `'corrupt'`;
    - XML — `new DOMParser().parseFromString(text, 'application/xml')`, `parsererror` — `'corrupt'`;
    - элементы ищутся `getElementsByTagNameNS('*', localName)`.

- [ ] **Step 1: `zip.ts`, `xlsx.ts`, `csv.ts`, `dates.ts`, `index.ts`** по Interfaces.
- [ ] **Step 2: Синтетические файлы.** Скрипт `scratchpad/make_sheets.py` (`zipfile`) собирает:
  - `.xlsx` с общими и встроенными строками, форматированным текстом, числом `4600000000017`, датой `46000`,
    `date1904`, ячейками без `r`, вторым и скрытым листом;
  - zip-бомбу (лист > 100 МБ после распаковки);
  - CSV: UTF-8 с BOM, UTF-8 без BOM, cp1251; разделители `;` `,` и табуляция; кавычки с переносом; `4,6E+12`.

  Только синтетические данные.
- [ ] **Step 3: Проверка.** `npx nx run-many -t lint typecheck fsd -p web`. Чтение синтетических файлов проверяется
  в Задаче 10 через мастер: отдельной страницы для проверки нет.
  Expected: зелёные.
- [ ] **Step 4: Документы** по Files; `npm run docs:check`.
- [ ] **Step 5: Коммит** `feat(web): read xlsx and csv in the browser without libraries`.

### Task 8: Мастер загрузки и страница

**Files:**
- Create:
  - `apps/web/src/features/data-import/model/fields.ts`, `values.ts`, `mapping.ts`, `build.ts`, `kinds.ts`,
    `csv-out.ts`;
  - `apps/web/src/features/data-import/ui/DataImportWizard.tsx`, `FileStep.tsx`, `ColumnsStep.tsx`,
    `ValuesStep.tsx`, `CheckStep.tsx`, `DoneStep.tsx`;
  - `apps/web/src/features/data-import/index.ts`;
  - `apps/web/src/pages/data-import/ui/DataImportPage.tsx`, `apps/web/src/pages/data-import/index.ts`;
  - `apps/web/app/(shell)/imports/page.tsx`.
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/stock.json` (`dataImport`), `{ru,tg}/core.json` (`auditEvents`:
  `product_imported`, `supplier_imported`, `document_imported`).

**Interfaces:**
- Consumes: Задачи 1, 7.
- Produces:
  - `ImportKindKey = 'catalog' | 'opening-balances' | 'suppliers'` — значение `?kind=`.
  - **`fields.ts`:**
    - `FieldDef { key: string; required: 'yes' | 'one-of' | 'no'; multiple?: boolean; synonyms: string[] }`;
    - `kindFields: Record<ImportKindKey, FieldDef[]>` — поля и синонимы таблиц §4 спецификации;
    - ключи полей совпадают с полями строк контракта, `barcodes` — `multiple: true`;
    - синонимы — после `normalizeHeader`.
  - **`mapping.ts`:**
    - `normalizeHeader(s): string` — `matchKey`, затем удаляются `. № % ,` и лишние пробелы;
    - `detectHeaderRow(rows: Cell[][], kind): number` — первая строка с ≥ 2 узнанными полями, иначе первая непустая;
    - `suggestMapping(headers: string[], kind): (string | null)[]` — поле не повторяется, кроме `multiple`.
  - **`values.ts`.** Разбор ячейки:

    ```ts
    type Parsed<T> = { ok: true; value: T } | { ok: false; code: ImportIssueCode }
    ```

    - `parseText(cell, max)`;
    - `parseBarcodes(cell)` — разделители `,` `;` `/` и перенос строки, пробелы внутри убираются; `/[eE][+-]?\d/` →
      `barcode_scientific`;
    - `parseInteger(cell, min, max)`;
    - `parseMoney(cell)` — через `parseMoneyToMinor(cell.text)`;
    - `parseBoolean(cell)`, `parseUnit(cell)`, `parsePrescription(cell)`, `parseCountry(cell)` — через `countries`
      из `@pharmacy/shared-domain` или код ISO;
    - `parseMarkup(cell)`;
    - `parseExpiry(cell, date1904)` — F11; `ММ.ГГГГ` → последний день месяца.
  - **`build.ts`.** `buildRequest(kind, sheet, headerRow, mapping, extras): { request; clientIssues: ImportIssue[];
    warnings: ImportIssue[]; skippedZero: number }`:
    - строки с количеством 0 пропускаются и считаются;
    - строки с ошибками разбора не попадают в `rows`, но дают `clientIssues`;
    - `extras` — для каталога: замены категорий и форм и категория по умолчанию; для остатков: `storeId`, `date`,
      `comment`;
    - `fileName` — `file.name`.
  - **`kinds.ts`** — на вид: маршруты `check` / `apply`, поля, ключи текстов, путь «Открыть …» после загрузки.
  - **`csv-out.ts`:**
    - `templateCsv(kind, label: (key) => string): Blob` — UTF-8 с BOM, `;`, одна строка заголовков;
    - `issuesCsv(issues, columnOf: (field) => string, message: (issue) => string): Blob`.
  - **`DataImportWizard`** `{ kind: ImportKindKey; stores: Array<{ id: string; name: string }>; canCreateCategories:
    boolean }` — шаги §9 спецификации:
    - «Проверить» — `apiRequest(<ключ check из kinds.ts>, { body, timeoutMs: 120_000 })`;
    - «Загрузить» — `apiRequest(<ключ apply>, { body, idempotencyKey, timeoutMs: 120_000 })`, где `idempotencyKey
      = uuidv7()` (`@pharmacy/shared-util`) — создаётся при успешной проверке и сбрасывается при шаге назад;
    - 422 `import_invalid` → повторная проверка;
    - 413 и `timeout` → сообщение `dataImport.errors.tooLarge` / `timeout`.
  - **`DataImportPage`:**
    - читает `kind` через `useSearchParams`; неизвестный вид — текст «не найдено»;
    - права: каталог `catalog:create`; остатки — `useStockAccess()` (`canCreate && canSeeCost`, `writableStores`);
      поставщики `purchasing:create`; без права — сообщение;
    - `WithMessages groups={['stock', 'purchasing']}`.
  - **Тексты.** Ключи RU и TG совпадают (`messages.spec.ts`). Сообщения ошибок — по `ImportIssueCode` и кодам
    `SpreadsheetError`.

- [ ] **Step 1: Модель** (`fields`, `mapping`, `values`, `build`, `kinds`, `csv-out`) по Interfaces.
- [ ] **Step 2: Мастер и страница**; разметка — `@pharmacy/ui` и токены `--ph-*`; таблицы прокручиваются внутри
  карточек; без горизонтальной прокрутки на 1280×800.
- [ ] **Step 3: Тексты** RU и TG (`dataImport`, три `auditEvents`).
- [ ] **Step 4: Проверка.** `npx nx run-many -t lint test typecheck fsd -p web`.
  Expected: зелёные; Steiger без замечаний; паритет ключей сообщений — зелёный.
- [ ] **Step 5: Коммит** `feat(web): data import wizard`.

### Task 9: Входы, моки, кнопка 1С

**Files:**
- Modify:
  - `apps/web/src/pages/catalog/ui/CatalogPage.tsx`, `opening-balances/ui/OpeningBalancesPage.tsx`,
    `suppliers/ui/SuppliersPage.tsx`;
  - `owner/reports/ui/ReportsPage.tsx`;
  - тексты `purchasing.json` (`products.import` → «Загрузить из файла», ключ `importPending` удаляется) и `stock.json`
    (`openingBalances.import`, `suppliers.import`);
  - моки: `apps/web/src/shared/api/mocks/handlers-catalog.ts`, `handlers-stock.ts`, `handlers-purchasing.ts`.

**Interfaces:**
- Produces:
  - **Кнопки** «Загрузить из файла» (`variant="secondary"`, `iconStart="download"` — как у нынешней кнопки каталога;
    иконки `upload` в ките нет):
    - ведут на `/imports?kind=…`;
    - видны при праве и `isApiRouteAvailable('<kind>.apply')`;
    - для остатков — `access.canCreate && access.canSeeCost`.
  - **F22:** кнопка 1С показывается только при `can(session, 'export-1c:view') && isApiRouteAvailable(
    'export1c.preview')`.
  - **Моки** — по смыслу API (F7–F10, проверки прав `context(…)`):
    - каталог: штрихкоды мокового каталога → «уже в каталоге»; незнакомые категории создаются в моковой базе;
    - остатки: черновики НО в моковой базе по 500 строк;
    - поставщики: совпадение названия без регистра.

    Ключ идемпотентности в моках не хранится.

- [ ] **Step 1: Кнопки, F22, тексты.**
- [ ] **Step 2: Моки** вместо заглушек Задачи 1.
- [ ] **Step 3: Проверка.** `npx nx run-many -t lint test typecheck fsd build -p web`.
  Expected: зелёные; сборка web проходит.
- [ ] **Step 4: Коммит** `feat(web): data import entry points and mocks; hide the 1C export until it is on the API`.

### Task 10: Сквозная проверка и документы

**Files:**
- Create (scratchpad, не в git): `import_live.mjs` на `billing_pr2_lib.mjs` (оператор, сеть, владелец, точки);
  синтетические файлы Задачи 7.
- Modify: спецификация — раздел «Уточнения 2026-10-20» (У1–У5 из Global Constraints); `CLAUDE.md` — список готовых
  маршрутов `web:dev-api` («загрузка из файла: каталог, начальные остатки, поставщики»).

- [ ] **Step 1: API против временной базы.** Собранный API (`ops_env2.mjs`, `OPS_DB=pharmacy_import_check`); скрипт
  проверяет все пункты §14 спецификации «Собранный API».
  - Каталог:
    - новые, известные, архивные;
    - `barcode_conflict`, `duplicate_in_file`;
    - новые категории — у владельца и у сотрудника с ролью без `catalog:update`;
    - одна плохая строка из 1 000 — в базе ничего не прибавилось;
    - повтор ключа — тот же ответ; тот же ключ с другими строками — 409 `idempotency_conflict`;
    - две загрузки сразу — по очереди;
    - товар добавлен формой между проверкой и загрузкой — 422 `import_invalid`.
  - Остатки:
    - 500 и 501 строка → 1 и 2 черновика со статусом `draft`;
    - пустая серия → стартовая партия;
    - `storeHasStock`, `previousImports`;
    - офлайн-точка — 409; без `finance:view-cost` — 403.
  - Поставщики: совпадение без регистра, ИНН.
  - Тело 10 МБ — проходит (не 413), 10 МБ + 1 КБ — 413.
  - `import_jobs` чужой сети не видна (`pharmacy_app` с чужим `app.tenant_id`).
  - Аудит: три события в своих группах журнала.

  Expected: `ALL OK`.
- [ ] **Step 2: Быстродействие.** 20 000 строк каталога: проверка и загрузка — время в ledger.
  Expected: проверка ≤ 10 с, загрузка ≤ 30 с; иначе — найти медленный запрос до продолжения.
- [ ] **Step 3: Чтение файлов и экраны.**
  - Сборка web в режиме API (`NEXT_PUBLIC_API_MOCKS=partial`) через прокси на этот API — как в плане уведомлений;
    после — пересборка без `NEXT_PUBLIC_API_MOCKS` и `--skip-nx-cache`.
  - Мастер трёх видов на синтетических файлах Задачи 7: каждый случай Review Focus 1 и 5, zip-бомба, cp1251.
  - 1280×800, RU и TJ: кнопки входа на трёх страницах, кнопка 1С скрыта.

  Expected: значения ячеек совпадают с ожидаемыми; скриншоты — в ledger.
- [ ] **Step 4: Документы** по Files; `npm run docs:check`; `npx nx sync:check`.
- [ ] **Step 5: Итоговая проверка.** `npx nx run-many -t lint test typecheck fsd build -p api web shared-dto
  shared-domain shared-util`.
  Expected: зелёные.
- [ ] **Step 6: Коммит** `docs: data import — clarifications and dev-api routes`.
- [ ] **Step 7: Ревью ветки** — агенты `nestjs-reviewer` и `postgresql-database-reviewer`, только чтение.
  Существенные замечания исправляются: каждое сначала воспроизводится. Мелкие — в ledger и в «Отложено» описания PR.
- [ ] **Step 8: Временная база** удаляется (`drop_scratch.mjs pharmacy_import_check`).
- [ ] **Step 9: Описание PR** (`.superpowers/pr-data-import.md`): что сделано, как проверено, порядок миграций
  относительно PR 3a синхронизации и правило ленты (§10 спецификации), отложенное, долг по тестам. Push
  `git push -u origin feature/data-import:feature/data-import`, ссылка сравнения — пользователю.
