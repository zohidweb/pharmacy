# Модуль «сети» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Тесты.** По решению пользователя от 2026-10-05 новые тесты до готовности MVP не пишутся. Существующие наборы должны остаться зелёными. Если тест сломался из-за изменения контракта или каталога, его исправляют, а не удаляют. Каталог-тест обязан принять новый класс функций — это правка существующего теста. Что осталось без тестов — в разделе «Долг по тестам».

**Goal:** оператор в админке видит сети и создаёт сеть с владельцем. Он выдаёт владельцу одноразовый код активации и блокирует или разблокирует сеть. Блокировка закрывает все сессии сети.

**Architecture:** модуль `apps/api/src/app/platform/tenants` работает только через `PlatformDatabase`. В тенантные таблицы он пишет единственным путём — через SECURITY DEFINER-функции `provision_tenant` и `issue_owner_code`. Их владелец — новая роль `pharmacy_provisioner`. Блокировку несут колонки `tenants` и флаг `tenant-blocked:<tid>` в хранилище сессий. Админка переходит на API в режиме `NEXT_PUBLIC_API_MOCKS=partial`.

**Tech Stack:** NestJS 11, Kysely + pg (`PlatformDatabase`), node-pg-migrate (только Up), node-redis 6, Next.js static export (`apps/admin`, FSD), TanStack Query.

**Spec:** `docs/superpowers/specs/2026-10-05-tenants-module-design.md`. Утверждена вместе с поправкой ADR-0013 от 2026-10-05.

## Global Constraints

- Ветка `feature/tenants-module`, уже создана, в ней спека. Conventional Commits. Подпись GPG не обходить.
- Платформенный код (`app/platform/**`) не импортирует `TenantDatabase` и не читает тенантные таблицы. В тенантные таблицы он пишет только вызовами двух функций.
- Код активации: 128 бит, формат `activation-code.ts`. Показывается один раз, в БД хранится только SHA-256. Срок — `ACTIVATION_CODE_TTL_HOURS`.
- Мутирующие маршруты требуют `tenants:manage` и `@RequireFreshAuth()`, чтение — `tenants:view`.
- Журнал платформы пишет `tenant.created`, `tenant.owner-code-issued`, `tenant.blocked`, `tenant.unblocked`, без логинов, кодов и причин.
- Docker-контейнеры не создаются. Тома без отдельного «да» пользователя не удаляются. `.env` не читается и не правится.
- Проверки в каждой задаче:
  - для `apps/api`: `npx nx lint api`, `npx tsc -b apps/api/tsconfig.spec.json`, `npx nx test api`;
  - для задачи с БД дополнительно: `api:migrate`, `api:db-types`, `api:integration`;
  - для `apps/admin`: `npx nx lint admin`, `npx nx test admin`, `npx nx fsd admin`, `npx nx build admin`.

## Review Focus

Тестов нет, поэтому эти пункты — для финального ревью и ручной проверки (задача 6):

1. **Функции не меняют существующую сеть.** `provision_tenant` с `id` существующей сети падает. `issue_owner_code` трогает только две колонки кода владельца и не открывает доступ к паролю и данным.
2. **Роль платформы по-прежнему не читает тенантные таблицы.** Каталог-тест это подтверждает, у `pharmacy_resolver` нет прав на запись.
3. **Блокировка действует на следующем запросе.** Живая сессия сотрудника получает 401, и после потери флага в Redis тоже — через `PrincipalLoader`. Вход отклоняется. Разблокировка возвращает вход.
4. **Дубли.** Логин, телефон или e-mail владельца, уже занятые в любой сети, дают `409 login_taken` / `phone_taken` / `email_taken`. Сеть и её строки при этом не создаются.
5. **Режим `partial`.** Готовые маршруты идут в API, остальные — в моки. Режим `true` работает как раньше.

## Решения, принятые при составлении плана

- **P1. Роль на существующих томах.** Роль создаёт `initdb` только на пустом томе. Для существующих dev-томов вместо пересоздания добавляется идемпотентный SQL `docker/postgres/initdb/03-provisioner-role.sql`. Его можно один раз применить суперпользователем: `docker compose … exec postgres psql …`, команду даёт задача 1. Данные не теряются. Запускает пользователь (или я — с его «да»).
- **P2. Кто задаёт имя роли владельца.** Название роли RU/TJ берётся из `ROLE_TEMPLATES.owner` (`libs/shared/domain`) и передаётся в функцию готовым `jsonb`. Функция не знает шаблонов.

---

### Task 1: Роль, миграция, функции, каталог

**Files:**
- Modify: `docker/postgres/initdb/01-roles.sh`, `02-database.sql`.
- Create: `docker/postgres/initdb/03-provisioner-role.sql` — идемпотентный: `do $$ … if not exists …`.
- Create: `apps/api/migrations/<ts>_tenant-provisioning.sql`.
- Modify: `apps/api/src/core/database/table-classes.ts`, `catalog.int-spec.ts`, `db.generated.ts`.

**Interfaces:**
- Produces: колонки `tenants`:
  - `city text not null default ''`;
  - `owner_full_name`, `owner_login`, `owner_phone`, `owner_email`;
  - `blocked_at`, `blocked_by`, `block_reason`;
  - `check (blocked_* заданы вместе ⇔ status = 'blocked')`.
- Produces: функции `pharmacy.provision_tenant(...)` и `pharmacy.issue_owner_code(...) returns boolean`. Сигнатуры — §5 спеки.
- Produces: `PROVISIONING_FUNCTIONS = ['provision_tenant', 'issue_owner_code']` в `table-classes.ts`.

- [ ] **Step 1:** Роль `pharmacy_provisioner nologin …`, `grant pharmacy_provisioner to pharmacy_owner`, на схему — `usage` и `create`. Права те же, что у `pharmacy_resolver`: в `01-roles.sh`, `02-database.sql` и в `03-provisioner-role.sql` для существующих томов.
- [ ] **Step 2:** Попросить пользователя применить `03-provisioner-role.sql` к dev-кластеру. Команда — `docker compose --project-name pharmacy-dev … exec -T postgres psql -U "$POSTGRES_SUPERUSER" -d pharmacy -f -` с этим файлом. Тестовая база живёт в том же кластере, роли кластерные. Expected: роль существует.
- [ ] **Step 3:** Миграция. Сначала колонки `tenants`. Затем права `pharmacy_provisioner`: `INSERT` на 5 таблиц, `UPDATE` трёх колонок `employee_credentials`, `SELECT` колонок для проверок. Затем политики RLS `TO pharmacy_provisioner`: `for insert with check (true)`, для `select`/`update` — по `tenant_id = p_tenant_id` невозможно, поэтому `using (true)`, ограничение держится правами колонок и телом функции. Затем две функции: `plpgsql`, `security definer`, `set search_path = ''`, `alter … owner to pharmacy_provisioner`, `revoke all … from public`, `grant execute … to pharmacy_platform`. `provision_tenant` нормализует `lower()` логина и e-mail.
- [ ] **Step 4:** Каталог-тест. Проверка «security definer = ровно резолверы» становится «= резолверы ∪ функции создания, у каждой свой владелец». Добавить нарушение «запись у `pharmacy_resolver`». Нарушения собираются в список, как в остальных проверках.
- [ ] **Step 5:** `api:migrate`, `api:db-types`, `api:integration`, `lint`, `tsc`, `nx test api`. Expected: всё зелёное.
- [ ] **Step 6:** Commit `feat(api): tenant provisioning functions and the pharmacy_provisioner role (ADR-0013)`.

### Task 2: Флаг блокировки сети в сессиях

**Files:**
- Modify: `apps/api/src/core/sessions/{session-store.ts, redis-session-store.ts, pg-session-store.ts}`.
- Modify: `apps/api/src/common/middleware/session.middleware.ts`, `apps/api/src/app/auth/principal-loader.ts`.
- Modify: фейки `SessionStore` в существующих spec.

**Interfaces:**
- Produces: `SessionLookup.tenantBlocked: boolean`.
- Produces: `SessionStore.markTenantBlocked(tenantId): Promise<void>` и `clearTenantBlocked(tenantId): Promise<void>`. Redis: ключ `tenant-blocked:<tid>`, без TTL. PostgreSQL: no-op, статус читается из `tenants.status` в `lookup`.
- Produces: `PrincipalSnapshot.tenantStatus: string`.

- [ ] **Step 1:** Redis `lookup` читает `tenant-blocked:<tid>` одним `MGET` вместе с сессией и версией прав. `PgSessionStore.lookup` берёт `tenants.status` тем же запросом.
- [ ] **Step 2:** Middleware: при `tenantBlocked` — `destroyAllFor(tid, eid)`, затем гость. `PrincipalLoader.reload` читает `tenants.status`. Если статус не `active`, middleware при перечитывании действует так же, как для неактивного сотрудника.
- [ ] **Step 3:** Фейки и ожидания существующих тестов под новое поле. `lint`, `tsc`, `nx test api`, `api:integration`. Expected: зелёное.
- [ ] **Step 4:** Commit `feat(api): a blocked tenant ends its sessions on the next request`.

### Task 3: Контракты

**Files:**
- Modify: `libs/shared/dto/src/lib/platform-tenants.ts`, `apps/admin/src/shared/api/routes.ts`, моки админки (`mocks/transport.ts`, `db*.ts`) — под новые пути и форму.

**Interfaces:**
- Produces: `CreateTenantRequest = { name; city; inn; owner: TenantOwner }`. Убираются `firstStore`, `paidUntil`, `pricePerStoreMinor`, а также `LicenseTerm`, если он больше нигде не используется. `IssueOwnerCodeResponse { activationCode: string }`.
- Produces: маршруты админки `tenants.*` с путями `/operator/tenants…`, новый `tenants.ownerCode` — `POST /operator/tenants/{id}/owner-activation-codes`.

- [ ] **Step 1:** DTO. Комментарии путей обновить на `/operator/tenants`.
- [ ] **Step 2:** Маршруты и моки админки. Мок `tenants.create` отвечает новой формой, мок `ownerCode` — новым кодом.
- [ ] **Step 3:** Проверки `shared-dto`, `lint admin`, `test admin` (тесты мастера поправить под форму без точки и биллинга), `build admin`. Expected: зелёное.
- [ ] **Step 4:** Commit `refactor(dto): tenant contracts without first store and billing; operator paths`.

### Task 4: API модуля «сети»

**Files:**
- Create: `apps/api/src/app/platform/tenants/{tenants.module.ts, tenants.controller.ts, tenants.service.ts, tenants.repository.ts, dto/tenant.dto.ts}`.
- Modify: `apps/api/src/app/app.module.ts` — регистрация через `ConditionalModule`, как `OperatorAuthModule`: в офлайн-режиме модуля нет.

**Interfaces:**
- Consumes: Task 1 (функции, колонки), Task 2 (`markTenantBlocked` / `clearTenantBlocked`), `PlatformDatabase`, `PlatformAuditService`, `generateActivationCode`, `hashActivationCode`, `normalizeIdentifier`, `ROLE_TEMPLATES`.
- Produces: маршруты §3 спеки.

- [ ] **Step 1:** Репозиторий на `PlatformDatabase`.
  - Список: фильтр, поиск `ilike` по названию, городу, ИНН, контакту владельца; сортировка; limit/offset (20 по умолчанию, не больше 100); счётчики по фильтрам.
  - Карточка, точки (колонки реестра `stores`).
  - Вызовы функций через `sql`.
  - Блокировка: `UPDATE tenants … where status = 'active' returning`; разблокировка — то же наоборот.
- [ ] **Step 2:** Сервис.
  - Создание. Нормализация владельца: логин и e-mail — `lower`, телефон — E.164 через `normalizeIdentifier`; логин не должен разбираться как телефон или e-mail, иначе 400. Затем генерация id (UUIDv7), кода сети `t-…` (до 3 попыток), кода активации. После этого `provision_tenant`. Нарушение уникального индекса → `409` по имени индекса. Аудит `tenant.created`. Ответ `{ id, activationCode }`.
  - Новый код: `issue_owner_code`, `false` → `409 tenant_blocked` или `404 not_found` по статусу сети; аудит.
  - Блокировка и разблокировка по §6 спеки: после коммита флаг, повтор уже заблокированной сети ставит флаг и отвечает `409`.
  - `actor` транзакций — `{ kind: 'operator', operatorId }` из `requireOperator()`.
- [ ] **Step 3:** Контроллер и DTO с `class-validator` по §8 спеки: ИНН `^\d{9}$`, название и город 1–120, причина 5–500.
- [ ] **Step 4:** `lint`, `tsc`, `nx test api`, `nx build api`. Запуск API (`api-test-cookies`) и проверка через curl оператором `smoke-operator-2@pharmacy.test`:
  - создание → 201 и код;
  - активация владельца по коду → 204, вход владельца → 201;
  - блокировка → `/me` владельца 401, вход 401;
  - разблокировка → вход 201;
  - дубль логина → 409;
  - новый код → старый код 401.

  Expected: так и есть.
- [ ] **Step 5:** Commit `feat(api): tenants module — list, card, create with owner code, block and unblock`.

### Task 5: Админка на API

**Files:**
- Modify: `apps/admin/src/shared/api/{index.ts, client.ts}`, `apps/admin/src/app/bootstrap/AppProviders.tsx`, `mocks/transport.ts`.
- Modify: `apps/admin/src/pages/{companies, company, company-create}/ui/*`, `apps/admin/src/shared/i18n/messages/{ru,tg}.json`.
- Modify: `apps/admin/.env.example` (если есть) или README админки.

**Interfaces:**
- Produces: `apiMocksMode: 'all' | 'partial' | 'off'` из `NEXT_PUBLIC_API_MOCKS` (`true` → `all`, `partial`, иначе `off`).
- Produces: `REAL_API_ROUTES` — `operator.sessions.*` и `tenants.list | get | stores | create | ownerCode | block | unblock`. В режиме `partial` транспорт отправляет эти маршруты в `fetch`, остальные — в мок.

- [ ] **Step 1:** Гибридный транспорт и выбор режима в `AppProviders`.
- [ ] **Step 2:** «Новая компания». Мастер из одного шага «Компания и владелец». После создания — экран с кодом: группы по 4 символа, кнопка «Скопировать», текст «код показывается один раз, передайте владельцу», ссылка на карточку.
- [ ] **Step 3:** «Компания». Поля из `TenantDetails` без биллинга; блоки биллинга скрываются, когда `paidUntil === null` и `monthlyChargeMinor === 0`. Вкладка «Точки» — из API. Кнопка «Новый код владельцу» с подтверждением и тем же экраном показа кода. Блокировка и разблокировка — уже есть (`BlockTenant`). Остальные вкладки — на моках.
- [ ] **Step 4:** «Компании». Список из API. Колонки биллинга показывают «—», пока нет данных.
- [ ] **Step 5:** i18n RU/TJ для новых строк: TJ помечается к проверке носителем, как в прошлых PR.
- [ ] **Step 6:** `lint admin`, `test admin` (поправить затронутые спеки), `fsd admin`, `build admin`. Expected: зелёное.
- [ ] **Step 7:** Commit `feat(admin): tenants screens on the API (partial mocks mode)`.

### Task 6: Документы и ручная проверка

**Files:**
- Modify: `CLAUDE.md` (роль `pharmacy_provisioner`, команда для существующих томов, режим `partial`), `docs/architecture/data-model/01-platform-org.md` (колонки `tenants`), `.claude/skills/nestjs-api/reference/nestjs-security-auth.md` и `nestjs-config-data-access.md` (функции создания сети).
- Create: `docs/superpowers/plans/2026-10-05-tenants-module-smoke.md`.

- [ ] **Step 1:** Документы; `npm run docs:check`. Expected: `✔`.
- [ ] **Step 2:** Сценарий ручной проверки: Review Focus 1–5 и сквозной путь в админке (`NEXT_PUBLIC_API_MOCKS=partial npx nx dev admin` + API).
- [ ] **Step 3:** Commit `docs: tenants module`.

## Долг по тестам (после MVP)

- **Интеграционные:**
  - `provision_tenant` — создаёт ровно нужные строки, падает на существующей сети и на дублях, ничего не оставляет при ошибке;
  - `issue_owner_code` — только колонки кода, блокированная сеть → `false`;
  - каталог — права `pharmacy_provisioner`.
- **unit:** сервис сетей (маппинг ошибок уникальности, генерация кода сети, повтор блокировки); гибридный транспорт админки.
- **e2e:** создание → активация → вход → блокировка → 401 → разблокировка.
