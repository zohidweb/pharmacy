# Точки и юрлица владельца — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** владелец новой сети после активации сам заводит юрлица и точки, и путь «код активации →
пароль → вход → первая точка → главная» идёт по настоящему API.

**Architecture:** новый тенантный модуль `apps/api/src/app/stores` (юрлица и точки, `TenantDatabase`,
RLS, аудит в той же транзакции, идемпотентность создания точки по ключу в строке `stores`). Контракт —
`libs/shared/dto/src/lib/tenant-owner.ts`. `apps/web` получает режим `NEXT_PUBLIC_API_MOCKS=partial`
(как админка), экран «Первый вход» (`/activate`), экран «Первая точка» в потоке входа и общую
фичу формы точки.

**Tech Stack:** NestJS 11, Kysely + pg, node-pg-migrate (SQL, только Up), Next.js static export,
TanStack Query, React Hook Form + zod, use-intl, `libs/ui`.

**Spec:** `docs/superpowers/specs/2026-10-06-owner-stores-design.md` (утверждена архитектором
2026-10-06).

## Global Constraints

- Новые автотесты не пишутся до MVP (решение 2026-10-05); существующие наборы остаются зелёными —
  тесты, проверяющие удалённые поля формы точки, правятся под новый контракт.
- Ни одной новой библиотеки; стек — CLAUDE.md «Fixed technology stack».
- `tenant_id` — во всех запросах; доступ к данным API — только `TenantDatabase` (`tenantTransaction`),
  никаких `PlatformDatabase` в модуле `stores`.
- Код точки: `^[A-Z0-9]{1,8}$` после `trim()` и `toUpperCase()`; ИНН — ровно 9 цифр.
- Длины: название точки и юрлица 1–120; адрес и юр. адрес 1–300; банковские реквизиты ≤ 1000;
  телефон — E.164 (`^\+[1-9][0-9]{7,14}$`); e-mail — формат (`IsEmail`), ≤ 254.
- Коды ошибок: 404 `not_found`; 409 `store_code_taken`, `tax_id_taken`, `store_closed`; 400
  `validation_failed` с `errors[]`.
- Аудит (`AuditService.append`, та же транзакция): `store.created`, `store.updated`,
  `legal-entity.created`, `legal-entity.updated`.
- Маршруты и права: `GET /legal-entities` `stores:view`; `POST /legal-entities` `stores:create`;
  `PATCH /legal-entities/{id}` `stores:update`; `GET /stores` `stores:view`; `POST /stores`
  `stores:create`; `PUT /stores/{id}` `stores:update`.
- `StoresModule` не регистрируется при `STORE_MODE=offline` (`ConditionalModule.registerWhen`).
- Тексты web — RU и TJ (локаль `tg`), идентификаторы и комментарии — английские.
- Коммиты — Conventional Commits; GPG подписывает pinentry (не обходить).
- Перед PR пользователь сам запускает `npm run check`.

## Review Focus

Тестов нет, поэтому эти пункты проверяются живой проверкой задачи-владельца и финальным ревью:

1. Код точки в нижнем регистре или с пробелами (`" dsh1 "`) сохраняется как `DSH1`; второй `dsh1` в
   той же сети → 409 `store_code_taken` (Задача 2, curl).
2. `POST /stores` с новым юрлицом, чей ИНН уже занят, → 409 `tax_id_taken`, и ни юрлицо, ни точка не
   созданы (одна транзакция) (Задача 2, curl).
3. Повтор `POST /stores` с тем же `Idempotency-Key` → 201 с той же точкой, в базе одна точка, в
   `audit_log` одна запись `store.created` (Задача 2, curl).
4. Сотрудник с охватом-списком: `GET /stores` показывает только его точки, `PUT /stores/{id}` чужой
   точки → 404 (Задача 2, curl или чтение кода ревьюером, если нет такого сотрудника).
5. «Первая точка»: точка создана, а выбор рабочей точки упал → повторная отправка той же формы не
   создаёт вторую точку (тот же ключ формы) и завершает вход (Задача 4, чтение кода + живая проверка).

---

### Task 1: Ключ идемпотентности в `stores` и общий разбор нарушений уникальности

**Files:**
- Create: `apps/api/migrations/<Date.now()>_store-idempotency-key.sql`
- Create: `apps/api/src/core/database/unique-violation.ts`
- Modify: `apps/api/src/core/database/index.ts` (экспорт)
- Modify: `apps/api/src/app/platform/tenants/tenants.service.ts` (убрать локальную `uniqueConstraint`, импорт из `core/database`)
- Modify: `apps/api/src/core/database/db.generated.ts` (перегенерация)
- Modify: `docs/architecture/data-model/01-platform-org.md` (колонка `idempotency_key` в `stores`)

**Interfaces:**
- Produces: колонка `stores.idempotency_key uuid null` (Kysely: `idempotencyKey: string | null`),
  индекс `stores_idempotency_key_uq` на `(tenant_id, idempotency_key) where idempotency_key is not
  null`; `uniqueConstraint(error: unknown): string | null` — имя нарушенного уникального ограничения
  (`23505`) или `null`; `isUniqueViolation(error: unknown): boolean` остаётся в `terminals`.

- [ ] **Step 1:** миграция: `alter table pharmacy.stores add column idempotency_key uuid;` и `create
  unique index stores_idempotency_key_uq on pharmacy.stores (tenant_id, idempotency_key) where
  idempotency_key is not null;` с комментарием-шапкой (спецификация, §4).
- [ ] **Step 2:** перенести `uniqueConstraint` из `tenants.service.ts` в
  `core/database/unique-violation.ts` без изменения поведения, экспортировать из `core/database/index.ts`,
  в `tenants.service.ts` импортировать из `'../../../core/database'` (не глубокий импорт —
  `architecture.spec.ts`).
- [ ] **Step 3:** `npx nx run api:migrate`, затем `npx nx run api:db-types`.
  Expected: миграция применена; в `db.generated.ts` у `Stores` появилось `idempotencyKey`.
- [ ] **Step 4:** строка `idempotency_key` в таблице `stores` модели данных: «UUID ключа повтора
  создания точки (заголовок `Idempotency-Key`); уникален в сети, если задан».
- [ ] **Step 5:** `npx nx run-many -t typecheck lint test -p api` и `npx nx run api:integration`.
  Expected: всё зелёное (интеграция — 158/158).
- [ ] **Step 6:** commit `feat(api): store idempotency key; shared unique-constraint helper`.

### Task 2: Модуль `stores` в API и контракт

**Files:**
- Modify: `libs/shared/dto/src/lib/tenant-owner.ts` (типы точки и юрлица по спецификации §5)
- Create: `apps/api/src/app/stores/stores.module.ts`
- Create: `apps/api/src/app/stores/legal-entities.controller.ts`
- Create: `apps/api/src/app/stores/stores.controller.ts`
- Create: `apps/api/src/app/stores/stores.service.ts`
- Create: `apps/api/src/app/stores/legal-entities.service.ts`
- Create: `apps/api/src/app/stores/stores.repository.ts`
- Create: `apps/api/src/app/stores/dto/store.dto.ts`
- Modify: `apps/api/src/app/app.module.ts` (регистрация через `ConditionalModule.registerWhen(StoresModule, env => env.STORE_MODE !== 'offline')`)

**Interfaces:**
- Consumes: `idempotencyKey` и `uniqueConstraint` (Задача 1); `requirePrincipal()`
  (`common/context/request-context`); `RequirePermission` (`app/auth/decorators`); `AuditService`
  (`AuditModule`); `TenantDatabase.tenantTransaction`; `ProblemException`,
  `FieldProblemException`; `newId()` (`core/database`).
- Produces (`@pharmacy/shared-dto`): `StoreKind`, `LegalEntity`, `LegalEntityInput`,
  `LegalEntitiesResponse`, `OwnerStore`, `CreateStoreRequest`, `UpdateStoreRequest`,
  `StoresOverview` — ровно как в спецификации §5. Удаляются `StoreInput`, `StoreReceiptSettings`,
  `StoresOverview.lastImpersonation`.
- Produces (HTTP): маршруты и коды из Global Constraints; заголовок `Idempotency-Key` у `POST
  /stores` (UUID, регистр не важен; не UUID → 400 `validation_failed`).

Решения, которые задача фиксирует:
- `OwnerStore.mode`: `online` → `cloud`, `offline` / `offline_pending` → `offline` (как
  `tenants.repository`); `status`: `closed` → `closed`, `mode = offline_pending` → `pending`, иначе
  `active`. `paidUntil`, `licenseValidUntil`, `closedOn` (кроме закрытых — `closed_at::date`),
  `stockMovedTo` — `null`, `receiptsThisMonth` — `0`.
- `GET /stores`: охват `'all'` — все точки сети; список — только `principal.storeScope`; порядок:
  `status = 'active'` первыми, затем `name`.
- `LegalEntity.stores` — число точек юрлица (любой статус).
- `defaults` в `GET /legal-entities`: `tenants.name` и `tenants.billing_tax_id` своей сети.
- Нарушения уникальности → коды: `stores_tenant_id_code_key` (имя ограничения `unique (tenant_id,
  code)` — сверить в `pg_constraint` перед кодом) → `store_code_taken` (поле `code`);
  `legal_entities_tax_id_active_uq` → `tax_id_taken` (поле `taxId` или `newLegalEntity.taxId`);
  `stores_idempotency_key_uq` → перечитать точку по ключу и вернуть её.
- Идемпотентность: до вставки — поиск точки по `(tenant, key)`; найдена → вернуть её без записи.
  Гонка → уникальный индекс → тот же ответ.
- `PUT /stores/{id}` закрытой точки → 409 `store_closed`; юрлицо — только активное юрлицо сети (иначе
  404).
- Нормализация: `trim()` строк, код — `toUpperCase()`, пустые `phone`/`email`/`bankDetails` → `null`.

- [ ] **Step 1:** контракт в `tenant-owner.ts` (спецификация §5, JSDoc с маршрутом и кодами ошибок у
  каждого запроса, как в `platform-tenants.ts`). Web на этом шаге не компилируется — чинит
  Задача 3; в этой задаче проверяются только `shared-dto` и `api`.
- [ ] **Step 2:** DTO class-validator в `dto/store.dto.ts`: `LegalEntityInputDto`,
  `CreateStoreDto` (`@ValidateNested` для `newLegalEntity`; проверка «ровно одно из двух» — в сервисе
  через `FieldProblemException(400, 'validation_failed', [{ field: 'legalEntityId', code:
  'exactly_one' }])`), `UpdateStoreDto`, `UpdateLegalEntityDto` (все поля `LegalEntityInput`,
  необязательные). Ограничения — из Global Constraints.
- [ ] **Step 3:** репозиторий и сервисы с правилами выше; контроллеры с правами из Global Constraints;
  `POST` отвечают 201, `PUT`/`PATCH` — 200. Аудит: `entityType` `'store'` / `'legal-entity'`,
  `details` — изменённые поля без адресов.
- [ ] **Step 4:** `npx nx run-many -t typecheck lint test build -p api shared-dto` и `npx nx run
  api:integration`.
  Expected: всё зелёное.
- [ ] **Step 5: живая проверка curl** (API `api-test-cookies` из `.claude/launch.json`; синтетическая
  сеть через `POST /operator/tenants`, активация владельца, вход; скрипт — в scratchpad, тело запросов
  с кириллицей — `--data-binary @file`):
  - `GET /legal-entities` → `items: []`, `defaults` с названием и ИНН сети;
  - `POST /stores` с `newLegalEntity` и кодом `" dsh1 "` → 201, `code: "DSH1"`, `mode: "cloud"`;
  - повтор с тем же `Idempotency-Key` → 201, тот же `id`; в базе одна точка;
  - вторая точка с кодом `dsh1` → 409 `store_code_taken`;
  - `POST /stores` с `newLegalEntity` и ИНН первого юрлица → 409 `tax_id_taken`, новых строк нет;
  - `POST /stores` с `legalEntityId` → 201; `PUT /stores/{id}` → 200; `PATCH /legal-entities/{id}` →
    200;
  - `audit_log` сети: `legal-entity.created`, `store.created` ×2, `store.updated`,
    `legal-entity.updated`;
  - `GET /sessions/current` владельца показывает обе точки; `PUT /sessions/current/store` → 200;
  - `GET /operator/tenants/{id}/stores` в контуре оператора показывает обе точки.
  Expected: все ответы как указано.
- [ ] **Step 6:** commit `feat(api): stores module — legal entities and stores of the owner`.

### Task 3: Web на новом контракте точек (моки, маршруты, форма, страница «Точки»)

**Files:**
- Modify: `apps/web/src/shared/api/routes.ts` (`stores.create: route<OwnerStore, CreateStoreRequest>`,
  `stores.update: route<OwnerStore, UpdateStoreRequest, { id: string }>`, новые
  `legalEntities.list` `GET /legal-entities`, `legalEntities.create` `POST /legal-entities`,
  `legalEntities.update` `PATCH /legal-entities/{id}`, `activations.create` `POST /activations` →
  `void`)
- Modify: `apps/web/src/shared/api/mocks/{db-owner.ts, owner-stores.ts, handlers-owner.ts}` (точки по
  новому контракту, юрлица, `defaults`, 409 `store_code_taken` / `tax_id_taken`, идемпотентность по
  ключу; `activations.create` → 204 для синтетического логина)
- Create: `apps/web/src/features/store-form/{index.ts, model/store-form-schema.ts, ui/StoreForm.tsx}`
- Modify: `apps/web/src/pages/owner/stores/ui/{StoresPage.tsx, StoreDialogs.tsx}`
- Modify: `apps/web/src/shared/api/error-message.ts` (известные коды `store_code_taken`,
  `tax_id_taken`, `store_closed`, `invalid_code`, `password_policy`)
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/owner.json`, `.../core.json` (тексты формы и
  ошибок)
- Modify: `apps/web/specs/owner.spec.tsx` (тесты `StoresPage` под новую форму), прочие спеки, если
  ломаются

**Interfaces:**
- Consumes: контракт Задачи 2.
- Produces: `StoreForm` (`features/store-form`):
  `StoreForm({ store, onSaved, submitLabel }: { store: OwnerStore | null; onSaved: (store: OwnerStore)
  => void; submitLabel: string })` — сама загружает `legalEntities.list`, держит один
  `Idempotency-Key` на смонтированную форму (`useState(() => crypto.randomUUID())`), при создании
  вызывает `stores.create`, при правке — `stores.update`; конфликты `store_code_taken` /
  `tax_id_taken` показывает у полей. Юрлицо: `Select` из активных юрлиц + пункт «Новое юрлицо…»;
  при пустом списке сразу открыт блок нового юрлица, заполненный `defaults`. Код и тип — только при
  создании (при правке показываются только для чтения).

- [ ] **Step 1:** маршруты и моки. Мок-точки демо-сети получают коды и юрлица (два синтетических
  юрлица, ИНН из 9 цифр), закрытая и ожидающая точки сохраняются; создание в моках — сразу `active`,
  `cloud`.
- [ ] **Step 2:** `features/store-form` (React Hook Form + zod, правила из Global Constraints;
  сообщения zod — ключи i18n, как в `apps/admin/.../create-tenant-schema.ts`).
- [ ] **Step 3:** страница «Точки»: колонки — название, код, тип, юрлицо, режим, статус; диалог —
  `StoreForm`; кнопка «Закрыть точку» и её диалог — только при `isApiRouteAvailable('stores.close')`
  (появляется в Задаче 4; до этого — всегда видна).
- [ ] **Step 4:** тексты RU/TJ; правка `owner.spec.tsx` (создание точки: юрлицо из списка, код,
  тип; проверка, что новая точка в списке `active`).
- [ ] **Step 5:** `npx nx run-many -t typecheck lint test fsd build -p web shared-dto` и `npx nx e2e
  web-e2e`.
  Expected: всё зелёное.
- [ ] **Step 6:** commit `feat(web): stores and legal entities on the new contract`.

### Task 4: Режим `partial` в web, «Первый вход», «Первая точка»

**Files:**
- Modify: `apps/web/src/shared/api/{client.ts, index.ts}` (`REAL_API_ROUTES`, `partialTransport`,
  `apiMocksMode`, `isApiRouteAvailable` — по образцу `apps/admin/src/shared/api`)
- Modify: `apps/web/src/app/bootstrap/AppProviders.tsx` (в `partial` — `partialTransport(mocks)`)
- Modify: `apps/web/src/shared/api/mocks/session.ts` (в `partial` без своей мок-сессии моки работают от
  демо-сессии владельца `firuz` на `store-1`)
- Modify: `apps/web/package.json` (цель `dev-api`: `next dev -p 4200`, `NEXT_PUBLIC_API_MOCKS=partial`,
  `continuous: true`, как `admin:dev-api`)
- Modify: `.claude/launch.json` (конфигурация `web-partial` → `npx nx run web:dev-api`, порт 4200)
- Create: `apps/web/src/pages/activate/{index.ts, ui/ActivatePage.tsx}`, `apps/web/app/activate/page.tsx`
- Modify: `apps/web/src/shared/config/routes.ts` (`activate: () => '/activate'`, `login(login?)` с
  query `login`)
- Modify: `apps/web/src/pages/login/ui/LoginPage.tsx` (ссылка «Первый вход по коду активации»,
  логин из query; шаг «Первая точка»)
- Create: `apps/web/src/pages/login/ui/FirstStoreStep.tsx`
- Modify: `apps/web/src/shared/i18n/messages/{ru,tg}/core.json` (тексты `auth.activate.*`,
  `auth.firstStore.*`)
- Modify: `apps/web/specs/auth.spec.tsx`, если ломается

**Interfaces:**
- Consumes: `StoreForm` и маршруты Задачи 3; `useSelectStore` (`features/select-store`).
- Produces: `REAL_API_ROUTES` — маршруты web, которые реализует API (сверить с контроллерами
  `apps/api/src/app/{auth,terminals,stores}`): `sessions.create`, `sessions.current`,
  `sessions.selectStore`, `sessions.delete`, `activations.create`, `me.get`, `me.update`,
  `me.changePassword`, `me.changePin`, `me.terminals`, `terminals.current`, `terminals.unbind`,
  `terminalSessions.create`, `stores.overview`, `stores.create`, `stores.update`,
  `legalEntities.list`, `legalEntities.create`, `legalEntities.update`. (`terminals.list` — `GET
  /terminals` — в API нет, остаётся на моках; привязки терминала в маршрутах web нет.)

Решения:
- «Первая точка» показывается, когда `session.stores.length === 0`: с `stores:create` —
  `StoreForm` (`store = null`), после `onSaved` — `useSelectStore().mutate(store.id)` и переход на
  `landingRoute`; ошибка выбора точки — сообщение и кнопка «Повторить выбор», форма не
  пересоздаётся (ключ сохраняется). Без права — существующее предупреждение `noStores` и кнопка
  «Выйти» (`sessions.delete`).
- «Первый вход»: поля логин, код, пароль, повтор пароля (совпадение — zod); `activations.create` →
  `router.replace(routes.login(login))`; `invalid_code` — «Код неверный или истёк — попросите новый у
  оператора платформы»; `password_policy` — текст политики; `login_locked` — общий текст блокировки.
- Демо-сессия моков в `partial` — только чтение мок-данных для экранов на моках; она не влияет на
  настоящую сессию и не используется в режимах `true` и тестах.

- [ ] **Step 1:** режим `partial` (клиент, провайдеры, демо-сессия моков, цель `dev-api`, launch).
- [ ] **Step 2:** «Первый вход» и ссылка со страницы входа.
- [ ] **Step 3:** «Первая точка» в `LoginPage`.
- [ ] **Step 4:** тексты RU/TJ; `npx nx run-many -t typecheck lint test fsd build -p web` и `npx nx e2e
  web-e2e`.
  Expected: всё зелёное.
- [ ] **Step 5: живая проверка** (API `api-test-cookies`, `admin-partial`, `web-partial`): оператор
  создаёт сеть → владелец на `/activate` задаёт пароль → вход → «Первая точка» → главная (демо-данные
  моков, без цикла входа) → «Точки»: первая точка из API, вторая с новым юрлицом → карточка сети в
  админке показывает обе точки. Скриншот «Точек».
  Expected: путь проходит без ошибок в консоли.
- [ ] **Step 6:** commit `feat(web): partial API mode, first sign-in by code and the first store`.

### Task 5: Документы

**Files:**
- Modify: `CLAUDE.md` (модуль `stores` в `apps/api`; `npx nx run web:dev-api` в «Build / test / lint»)
- Modify: `.claude/skills/nestjs-api/reference/nestjs-config-data-access.md` (модуль точек:
  идемпотентность ключом в строке, разбор `uniqueConstraint`)
- Modify: `.claude/skills/react-dev/SKILL.md` (раздел о моках API: режимы `true` / `partial` / выкл.,
  `REAL_API_ROUTES`, демо-сессия моков в `partial`)

- [ ] **Step 1:** правки документов.
- [ ] **Step 2:** commit `docs: owner stores module and web partial mode`.
