# ADR-0013: Кросс-тенантный доступ к данным (оператор платформы и фоновые задачи)

- **Статус:** accepted (2026-09-30, архитектор проекта — APPROVAL.md)
- **Дата:** 2026-09-30
- **Авторы:** Zohid Saidov (z.saidov@eskhata.com), команда проекта Pharmacy (текст подготовлен с помощью AI)
- **Принимает:** архитектор проекта (docs/architecture/APPROVAL.md)

## Контекст

Изоляция тенантов уже задана: `tenant_id` в каждой прикладной таблице, `ENABLE` + `FORCE ROW
LEVEL SECURITY`, политика `tenant_id = (select current_setting('app.tenant_id')::uuid)`,
контекст выставляется `set_config('app.tenant_id', $1, true)` первым оператором транзакции
запроса; рантайм-роль `pharmacy_app` — `NOBYPASSRLS`, не владелец; миграции — `pharmacy_owner`
(`docker/postgres/initdb/01-roles-and-schema.sh`, правила `security-rls-basics`,
`security-privileges`, `conn-session-state` скила `postgres-best-practices`). Один API (NestJS)
обслуживает оба продукта и одну БД (ADR-0002). При этом есть легитимные сценарии, которые не
укладываются в «одна транзакция = один тенант из сессии»:

- **админка оператора** (`apps/admin`): реестр тенантов, счета по активным точкам всех тенантов,
  лицензионные ключи офлайн-точек, услуги, статистика, вход «от имени» (ADR-0008, ось E: только просмотр);
- **фоновые задачи**: очередь-таблица `job_queue` / outbox со `SKIP LOCKED` (ADR-0002) с задачами
  всех тенантов; ежемесячное начисление счетов — платформенная задача без тенанта (курсов валют нет — ADR-0016);
- **определение контекста до его появления**: приём синхронизации (тенант и точка — по хешу
  лицензионного ключа, не из тела запроса), вход по паролю (тенант — по коду сети), PIN-вход
  по device-cookie терминала, сессии офлайн-точки в PostgreSQL (ADR-0008: Redis там нет);
- **общие справочники платформы** (справочник препаратов, каталог услуг) — одни на всех тенантов.

Скилы прямо откладывают это решение: «модель ролей воркера — требует ADR», «кросс-тенантные
операции — отдельная роль/путь… требует ADR, `BYPASSRLS` роли API не выдаётся»; ADR-0006 выносит
«кросс-тенантный путь оператора (отдельная роль БД)» в отдельный ADR. Ограничения: 3 тенанта
(×5 — ~15), ~30 точек; касса ≤ 1 сек — политики горячих таблиц должны оставаться одним
равенством по ведущему `tenant_id`; оператор по ТЗ видит данные тенанта только «от имени» с
аудитом; офлайн-точка — та же схема и миграции (PostgreSQL 17 в Docker, образ
`docker/postgres`), один тенант, без Redis и без админки; ORM ещё не выбран (ADR-0006, proposed),
поэтому решение формулируется на уровне SQL (роли, политики, гранты, функции) и контракта
NestJS, а не API конкретной библиотеки. Правила ADR-0011 не затрагиваются: данные остаются в
собственной PostgreSQL, новых интеграций и криптографии нет.

## Рассмотренные варианты

1. **Отдельная роль БД платформы с `BYPASSRLS` + отдельный пул и модуль.** `pharmacy_platform`
   видит все строки всех таблиц, на которые у неё есть `GRANT`. Плюсы: просто; политики горячих
   таблиц не меняются; путь явный (отдельный пул, отдельные учётные данные). Минусы: `BYPASSRLS`
   отключает RLS целиком, а не для нужных таблиц — любой пропущенный `where` в коде админки или
   биллинга читает чеки, сотрудников, журнал ПКУ всех тенантов; появляется второй, **неаудируемый**
   путь к данным тенанта мимо входа «от имени», что противоречит ТЗ; компрометация админки =
   компрометация всех тенантов; прямо противоречит правилу скила. Сужение через гранты помогает
   лишь частично: где грант есть — видно всё.
2. **Та же роль `pharmacy_app` + режим в политиках** (`app.scope = 'platform'`), политика
   `tenant_id = … OR current_setting('app.scope', true) = 'platform'`; подвариант — `SET LOCAL
   ROLE pharmacy_platform` из `pharmacy_app` на том же пуле. Плюсы: один пул, одна строка
   подключения. Минусы: граница изоляции — это значение GUC или членство в роли, которое код
   выставляет сам: одна ошибка (забытый сброс, неверная ветка, `set_config` из непроверенного
   входа) — и транзакция видит всех тенантов; права платформы получает любой код, умеющий
   выполнить SQL под `pharmacy_app`; `OR` в политике **каждой** горячей таблицы усложняет план
   (нужно доказывать `EXPLAIN` под ролью приложения, что индекс по `tenant_id` сохраняется при
   бюджете кассы ≤ 1 сек); все политики становятся сложнее для ревью. Отклонён.
3. **`SECURITY DEFINER`-функции и представления** для строго ограниченных кросс-тенантных
   запросов (агрегаты биллинга, поиск по хешу ключа). Плюсы: точечно — вызывающий получает ровно
   результат функции; легко перечислить и проверить тестом. Минусы: каждая функция — код с
   повышенными правами (обязательны `set search_path = ''`, полные имена, `REVOKE … FROM
   PUBLIC`, так как `EXECUTE` по умолчанию выдаётся `PUBLIC`); при `FORCE RLS` владелец функции
   сам подчиняется политикам — для агрегатов по тенантным таблицам ему нужен `BYPASSRLS` или
   своя политика, т.е. проблема варианта 1 переезжает внутрь функции; агрегат по `receipts` /
   `stock_movements` всех тенантов в онлайн-запросе админки — тяжёлый запрос в общей БД кассы.
   Годится для **узких поисков по точному ключу**, не для отчётов.
4. **Фоновые задачи «по тенанту в цикле»**: воркер получает список активных тенантов и для
   каждого открывает обычную tenant-транзакцию под `pharmacy_app` (`tenant_id` берётся из
   строки очереди или из списка тенантов, никогда из клиента); платформе отдаются только
   заранее посчитанные агрегаты (витрины). Плюсы: обработка данных тенанта всегда идёт под
   RLS; обработчик задачи ничем не отличается от HTTP-запроса; справедливость между тенантами
   («шумный сосед» не забирает всю очередь). Минусы: N коротких транзакций на цикл опроса
   (при ~15 тенантах — пренебрежимо, при сотнях — пересмотреть); данные для админки не
   онлайн, а с задержкой пересчёта; нужны таблицы-витрины и проверка полноты перед
   выставлением счетов.
5. **Отдельный сервис и/или отдельная БД для платформенных данных.** Плюсы: физическая
   изоляция данных оператора. Минусы: это вариант 3 ADR-0002 («два монолита»), уже отклонённый:
   счета, ключи и точки ссылаются на тенантов и точки — нет FK и общей транзакции (выдача ключа
   + аудит), двойная эксплуатация, второй деплой-юнит; кросс-тенантные агрегаты всё равно
   нужно как-то читать из тенантной БД. Отклонён.

Итоговый вариант — **комбинация 4 + узкая часть 3 + отдельная роль из 1, но без `BYPASSRLS`**:
права платформы задаются не обходом RLS, а политиками `TO pharmacy_platform` и грантами только
на платформенные таблицы и явно перечисленные колонки/витрины.

## Решение

**1. Классы таблиц.** Каждая таблица схемы `pharmacy` относится ровно к одному классу; класс
объявляется в манифесте `apps/api/src/core/database/table-classes.ts` в том же MR, что и
миграция, и сверяется тестом с `pg_catalog` в обе стороны. Класс определяется тем, **кто
владеет строками**, а не наличием колонки `tenant_id` (у счёта или ключа она есть как атрибут).

| Класс | Таблицы (иллюстрация, состав — при реализации модулей) | `pharmacy_app` | `pharmacy_platform` |
|---|---|---|---|
| `tenant` — данные тенанта | `products`, `batches`, `stock_movements`, `documents`, `receipts`, `receipt_lines`, `payments`, `shifts`, `employees`, `roles`, `terminals`, `suppliers`, `prices`, `discount_rules`, журнал ПКУ, `audit_log`, `sync_inbox`/`sync_outbox`, ключи идемпотентности, `stores` (создаёт и закрывает владелец сети) | DML по RLS `tenant_isolation TO pharmacy_app` | нет грантов → `42501`; исключение — реестр `stores`: `SELECT` колонок `id, tenant_id, name, mode, status, created_at, closed_at` по политике `FOR SELECT TO pharmacy_platform` и **`UPDATE (mode)`** по политике `FOR UPDATE TO pharmacy_platform` — перевод точки в офлайн (с выдачей лицензионного ключа) делает оператор, с записью в `platform_audit_log` |
| `tenant-export` — витрины, пишет тенант, читает платформа | `store_usage_monthly` (точка × месяц: число чеков, первая/последняя продажа, `computed_at`), `tenant_stats_daily` (счётчики без ПДн и сумм позиций), при необходимости `store_sync_status` | запись по RLS тенанта | только `SELECT` по политике `FOR SELECT TO pharmacy_platform` |
| `platform` — данные оператора (тенант читает **только свои** строки `tenants`, `invoices`, `invoice_lines`, `tenant_services`, `license_keys` — политика «свои строки» `FOR SELECT TO pharmacy_app`, запись — только оператор) | `tenants`, `operators` и их роли, `impersonations`, `license_keys`, `invoices`, `invoice_lines`, `tenant_services`, `platform_audit_log` (append-only, как `audit_log`) | нет прав; точечно — `SELECT` своих строк по политике тенанта, где тенанту нужно видеть своё (`tenants` — своя карточка; `invoices` — если ТЗ показывает счета в кабинете владельца) | DML по политике `TO pharmacy_platform USING (true)` |
| `shared` — общие справочники | `drug_reference` — общий справочник препаратов (названия RU/TJ, МНН, форма, дозировка, производитель, штрихкоды), каталог `services` | `SELECT` всех строк | DML (ведёт оператор платформы) |
| `system` — очередь | `job_queue` (`tenant_id` NULL = платформенная задача) | DML своих строк по RLS тенанта (постановка в outbox, захват, завершение) | `SELECT` всех строк (диагностика); `INSERT/UPDATE` только строк с `tenant_id IS NULL`; перевод `dead → pending` — колонночный `UPDATE` с политикой `USING (status = 'dead') WITH CHECK (status = 'pending')` |

**2. Роли БД** (облако и офлайн-точка одинаково; `BYPASSRLS` — только у суперпользователя
образа, которым приложение не подключается):

| Роль | Атрибуты | Назначение |
|---|---|---|
| `pharmacy_owner` | LOGIN, `NOBYPASSRLS` | владелец схемы, только миграции (без изменений) |
| `pharmacy_app` | LOGIN, `NOBYPASSRLS`, не член других ролей | рантайм tenant-пути: HTTP-запросы клиентского продукта, impersonation-сессии, обработчики задач тенантов |
| `pharmacy_platform` (новая) | LOGIN, `NOBYPASSRLS`, отдельный пароль (`PHARMACY_PLATFORM_PASSWORD`) | рантайм platform-пути: `/api/v1/operator/*`, платформенные задачи, список активных тенантов для воркера |
| `pharmacy_resolver` (новая) | NOLOGIN, `NOBYPASSRLS` | только владелец функций-резолверов; колонночный `SELECT` + политика `FOR SELECT TO pharmacy_resolver` на `tenants`, `license_keys`, `terminals`, таблицу сессий офлайн-точки |
| `pharmacy_readonly` | по необходимости | диагностика с RLS (как в `security-privileges`) |

Правила миграций, вытекающие из модели:

- Политики создаются **с явным `TO <роль>`**, не для `PUBLIC`: тогда политика тенанта не
  вычисляется на соединениях платформы (и не падает на отсутствующем `app.tenant_id`), а
  каждое право видно в `pg_policies`.
- Блок `alter default privileges … grant select, insert, update, delete on tables to
  pharmacy_app` из initdb **убирается**: при нём каждая новая платформенная таблица молча
  получала бы DML для `pharmacy_app`. Гранты выдаются явно в миграции по классу таблицы
  (fail-closed); `alter default privileges … revoke execute on functions from public`.
- Контракт tenant-политики остаётся прежним и fail-closed:
  `using/with check (tenant_id = (select current_setting('app.tenant_id')::uuid))`.

Эскиз (иллюстрация DDL; форма миграций — по ADR-0006):

```sql
-- initdb (roles; passwords from env, never in migrations)
create role pharmacy_platform login nosuperuser nocreatedb nocreaterole nobypassrls password :'platform_pw';
create role pharmacy_resolver nologin nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema pharmacy to pharmacy_platform, pharmacy_resolver;
grant create on schema pharmacy to pharmacy_resolver;  -- ALTER FUNCTION … OWNER TO requires CREATE on the schema for the new owner
grant pharmacy_resolver to pharmacy_owner;             -- lets migrations SET ROLE / reassign ownership

-- tenant table
create policy tenant_isolation on receipts to pharmacy_app
  using      (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on receipts to pharmacy_app;     -- nothing for pharmacy_platform

-- store registry visible to the operator: selected columns only
create policy platform_registry_read on stores for select to pharmacy_platform using (true);
grant select (id, tenant_id, name, mode, status, created_at, closed_at) on stores to pharmacy_platform;
-- operator switches a store to offline mode (issuing a license key) — one column only
create policy platform_store_mode on stores for update to pharmacy_platform using (true) with check (true);
grant update (mode) on stores to pharmacy_platform;

-- shared drug reference: maintained by the operator, read by every tenant
create policy shared_read on drug_reference for select to pharmacy_app using (true);
create policy platform_all on drug_reference to pharmacy_platform using (true) with check (true);
grant select on drug_reference to pharmacy_app;
grant select, insert, update on drug_reference to pharmacy_platform;
-- tenant products may link to it: products.drug_reference_id uuid null references drug_reference(id)

-- tenant-export: written in tenant context, read by the platform
create policy tenant_isolation on store_usage_monthly to pharmacy_app using (…) with check (…);
create policy platform_read on store_usage_monthly for select to pharmacy_platform using (true);

-- platform table
alter table license_keys enable row level security;
alter table license_keys force row level security;
create policy platform_all on license_keys to pharmacy_platform using (true) with check (true);
create policy resolver_read on license_keys for select to pharmacy_resolver using (true);
grant select, insert, update on license_keys to pharmacy_platform;
grant select (key_hash, tenant_id, store_id, status, valid_until) on license_keys to pharmacy_resolver;

-- pre-context resolver: exact match on a hash, returns ids and status only
create function pharmacy.resolve_license_key(p_key_hash bytea)
returns table (tenant_id uuid, store_id uuid, status text, valid_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select k.tenant_id, k.store_id, k.status, k.valid_until
  from pharmacy.license_keys k
  where k.key_hash = p_key_hash
$$;
alter function pharmacy.resolve_license_key(bytea) owner to pharmacy_resolver;
revoke all on function pharmacy.resolve_license_key(bytea) from public;
grant execute on function pharmacy.resolve_license_key(bytea) to pharmacy_app;
```

**3. Резолверы контекста** — единственный кросс-тенантный путь `pharmacy_app`. Закрытый список
`SECURITY DEFINER`-функций (владелец `pharmacy_resolver`, `stable`, `set search_path = ''`,
полные имена, без динамического SQL, поиск только по точному равенству уникального ключа или
хеша, результат — идентификаторы и статус, никаких списков):
`resolve_tenant_by_code(code)` → `(tenant_id, status)` для входа по паролю;
`resolve_license_key(key_hash)` → `(tenant_id, store_id, status, valid_until)` для
`LicenseKeyGuard` синхронизации; `resolve_terminal(credential_hash)` → `(tenant_id, store_id,
terminal_id, revoked_at)` для device-cookie (ADR-0008, ось C); `resolve_session(token_hash)` —
только для `PgSessionStore` офлайн-точки. Новый резолвер — изменение этого ADR (или новый ADR),
не рядовой MR. Агрегаты биллинга и статистики через `SECURITY DEFINER` **не делаем** (вариант 3
для отчётов отклонён); если витрин не хватит — отдельный ADR.

**4. Фоновые задачи.**

- **Задачи тенантов** (`tenant_id` NOT NULL: `fiscal.send`, `sync.apply`, `export-1c.build`,
  `sync.upload`, пересчёт витрин) — «по тенанту в цикле»: воркер берёт список активных тенантов
  (облако — через `pharmacy_platform` из `tenants`; офлайн-точка — единственный тенант из
  локальной активации), для каждого в `runWithContext({ tenantId, correlationId, jobId })` открывает
  `tenantTransaction` под `pharmacy_app` и захватывает свои задачи `FOR UPDATE SKIP LOCKED`.
  Режимы скила `nestjs-api` сохраняются: эффект только в БД — захват, обработка и `done` в одной
  tenant-транзакции; внешний вызов — короткий захват, вызов вне транзакции, отдельная
  tenant-транзакция `complete`/`fail`. Возврат зависших `processing` — тоже в цикле по тенантам.
- **Платформенные задачи** (`tenant_id` NULL: оркестратор `billing.invoice`)
  — через `platformTransaction` под `pharmacy_platform`.
- **Биллинг**: оркестратор (платформенная задача) для каждого тенанта ставит/выполняет задачу
  пересчёта `store_usage_monthly` в контексте тенанта (активная точка = хотя бы одна продажа в
  месяце — считается из `receipts` под RLS), затем под `pharmacy_platform` проверяет полноту
  (витрина пересчитана для всех активных тенантов после даты отсечки периода) и формирует
  `invoices`. Дата отсечки нужна из-за буфера перебоев связи и поздней досылки чеков.
- **Статистика админки** — только из витрин `tenant-export`, пересчёт по расписанию.

**5. Оператор и данные тенанта.** Роль платформы **никогда** не читает сырые тенантные таблицы
(кроме реестра `stores` и витрин). Увидеть или изменить данные тенанта оператор может только
через вход «от имени» (ADR-0008, E2): impersonation-сессия — это обычный tenant-контекст под
`pharmacy_app` с флагом, `actingOperatorId`/`impersonationId` в каждой записи `audit_log`
тенанта; сама выдача (`impersonations`, `platform_audit_log`) пишется платформой. Любое новое
действие админки, которому нужна запись в тенантную таблицу, — через «от имени» или новый ADR.

**6. Офлайн-точка.** Та же схема, миграции, роли и RLS (один код, правило `security-rls-basics`
не меняется). Админка и маршруты `/api/v1/operator/*` не регистрируются. `pharmacy_platform` на
точке используется только модулем `sync` для применения платформенных данных, пришедших из
облака (`drug_reference`, `services`, своя строка `tenants`, статус своего `license_keys`); пароль
генерируется при установке, как и pepper (ADR-0008). Воркер — тот же цикл с одним тенантом.
Пул платформы на точке — 1–2 соединения.

**7. Правило для кода NestJS** (не зависит от ORM: два независимых клиента/пула с разными
строками подключения поддерживают Kysely, Prisma, TypeORM, MikroORM, Drizzle и чистый `pg`):

- `core/database` предоставляет два провайдера с разными пулами: `TenantDatabase.tenantTransaction(work)`
  (роль `pharmacy_app`, `DATABASE_URL`, `application_name=api-tenant`; контракт ADR-0006/скилов
  без изменений) и `PlatformDatabase.platformTransaction(actor, work)` (роль `pharmacy_platform`,
  `PLATFORM_DATABASE_URL`, `application_name=api-platform`, пул 3–5 соединений в облаке).
  `actor` обязателен: `{ kind: 'operator', operatorId }` из операторской сессии или
  `{ kind: 'system', job }`; без него — исключение (fail-closed); actor попадает в
  `platform_audit_log`.
- `PlatformDatabaseModule` **не `@Global`** и импортируется только модулями из
  `apps/api/src/app/platform/**` (реестр тенантов, ключи, счета, услуги, справочник препаратов, режим точки, выдача
  impersonation, оркестратор задач) и `sync` на офлайн-точке. Это видно на ревью по импорту и
  проверяется ESLint `no-restricted-imports` с переопределением по путям в `eslint.config.mjs`
  (модули API — папки одного приложения, поэтому `@nx/enforce-module-boundaries` здесь не
  работает) и архитектурным Jest-тестом, сканирующим `apps/api/src`.
- Контроллеры platform-пути — только под `/api/v1/operator/*`, с `OperatorSessionGuard`
  (cookie `__Host-op_sid` с origin админки, ADR-0008) и `@RequireOperatorPermission`; tenant-сессия
  там не принимается, а tenant-контроллеры не внедряют `PlatformDatabase`.
- `TenantJobRunner.forEachActiveTenant()` / `runAsTenant(tenantId)` — единственный способ
  коду платформы открыть tenant-контекст; доступен только в `platform/jobs/**` и бросает
  исключение, если вызван в контексте HTTP-запроса (оператор не может «перепрыгнуть» в тенанта
  мимо impersonation).
- MR, затрагивающий `app/platform/**`, `core/database/**`, манифест классов, политики
  `TO pharmacy_platform|pharmacy_resolver` или `security definer`, проходит ревью архитектора
  проекта (чек-лист `nestjs-reviewer`).

**8. Тесты изоляции** (обязательный гейт; e2e на реальной PostgreSQL — среда по ADR-0009,
proposed; сами проверки от выбора инструментов не зависят):

- **Каталог** (`pg_catalog`): каждая таблица `pharmacy` есть в манифесте и наоборот; у
  `tenant`/`tenant-export`/`platform`/`system` — `relrowsecurity` и `relforcerowsecurity`;
  `pharmacy_app` не имеет `INSERT/UPDATE/DELETE` на `platform`-таблицах; `pharmacy_platform` не
  имеет привилегий на `tenant`-таблицах, кроме списка колонок `stores`; `select rolname from
  pg_roles where rolbypassrls` — только суперпользователь образа; все `prosecdef`-функции схемы —
  из списка резолверов, владелец `pharmacy_resolver`, `proconfig` содержит `search_path=`, нет
  `EXECUTE` у `PUBLIC`; `pharmacy_app` не член `pharmacy_platform`/`pharmacy_resolver`
  (`pg_has_role`); нет политик `TO public`.
- **Поведение** (тенанты A и B): под `pharmacy_app` с контекстом A чтение/`UPDATE` строк B — 0
  строк, `INSERT` с `tenant_id` B — ошибка `WITH CHECK`, без контекста — ошибка; под
  `pharmacy_platform` `select … from receipts` → `42501`, недоступная колонка `stores` → `42501`,
  реестр `stores` и витрины — видны; резолвер по хешу ключа B возвращает только B, по неверному
  — пусто; задача тенанта B обрабатывается в контексте B (проверка `audit_log.tenant_id`), а
  обработчик не видит строк A; переиспользование соединения — для обоих пулов.
- **Архитектура** (unit, без БД): `PlatformDatabase` и `TenantJobRunner` внедряются только в
  разрешённых путях; каждый контроллер `/operator/*` защищён `OperatorSessionGuard`;
  `runAsTenant` в HTTP-контексте бросает исключение.
- **Impersonation** (e2e): сессия «от имени» видит только данные выбранного тенанта, записи
  аудита несут `acting_operator_id`.

## Последствия

- Положительные:
  - `BYPASSRLS` нет ни у одной рантайм-роли; данные тенанта читаются только под RLS в
    контексте одного тенанта — в том числе фоновыми задачами и биллингом;
  - оператор получает ровно то, что перечислено в схеме: реестр тенантов/точек, ключи, счета,
    витрины без ПДн; всё прочее — только «от имени» с аудитом, как требует ТЗ;
  - политики горячих таблиц кассы не меняются — одно равенство по `tenant_id`, бюджет ≤ 1 сек
    не затрагивается;
  - кросс-тенантные возможности видны на ревью и проверяемы машинно: отдельный пул и учётные
    данные, путь в коде, манифест классов, `pg_policies`, закрытый список резолверов;
  - цикл по тенантам даёт справедливую обработку очереди между тенантами;
  - решение не зависит от выбора ORM (ADR-0006) и одинаково для облака и офлайн-точки.
- **Отрицательные (обязательно):**
  - две новые роли, второй пул, второй секрет БД (`PHARMACY_PLATFORM_PASSWORD`) в облаке и на
    каждой офлайн-точке; бюджет соединений (`conn-limits`) пересчитать с учётом пула платформы;
  - убранные default privileges означают явные гранты в каждой миграции — больше ручного DDL
    и цена ошибки (смягчается тестом каталога, но ревью миграций тяжелее);
  - политики `TO <роль>` и колонночные гранты — более многословная схема; `select *` под
    `pharmacy_platform` на `stores` падает, запросы пишутся по колонкам;
  - резолверы — код с повышенными правами: ошибка в одном из них (например, поиск не по
    точному равенству) — кросс-тенантная утечка; тонкости владения (`grant create on schema`
    роли `pharmacy_resolver`, членство `pharmacy_owner`) усложняют initdb и миграции;
  - данные админки не онлайн: статистика и биллинг зависят от пересчёта витрин; нужны
    расписание, дата отсечки периода, проверка полноты перед счетами и повторный пересчёт при
    поздней досылке чеков — это новые задачи, таблицы и тесты;
  - цикл по тенантам — N транзакций на каждый опрос очереди; при росте за ~сотню тенантов
    нужен пересмотр (например, захват задач платформой с последующей обработкой в контексте
    тенанта);
  - поддержка медленнее: любой взгляд оператора в данные тенанта — через impersonation
    (ADR-0008 ещё `proposed`, до его принятия данные тенанта в админке недоступны вовсе);
  - защита от использования `PlatformDatabase` вне разрешённых модулей — соглашение,
    проверяемое ESLint и тестом, а не граница Nx-проектов; внутри `platform/**` код с пулом
    платформы по-прежнему может ошибиться в пределах платформенных таблиц;
  - initdb выполняется только на пустом томе: существующие dev/test-тома потребуют
    пересоздания или ручного создания ролей; модель расходится с текущими формулировками
    скилов и CLAUDE.md («API подключается ТОЛЬКО ролью `pharmacy_app`») до их обновления;
  - до перевода в `accepted` модули `platform/*`, биллинг, воркер очередей и `LicenseKeyGuard`
    реализовывать нельзя — это путь волн 1–3.
- Что обновить после перевода в `accepted` (в рамках этого ADR файлы не правятся):
  - `CLAUDE.md` (раздел Containers: роли рантайма `pharmacy_app` + `pharmacy_platform`, правило
    `PlatformDatabase`) и `docs/architecture/generated/CLAUDE.pharmacy-app.md`;
  - `docker/postgres/initdb/01-roles-and-schema.sh` (роли `pharmacy_platform`,
    `pharmacy_resolver`, удаление default privileges для `pharmacy_app`, `revoke execute on
    functions from public`); `docker/compose.yml` (`PLATFORM_DATABASE_URL`,
    `PHARMACY_PLATFORM_PASSWORD`), `docker/env/*.env.example`;
  - `eslint.config.mjs` — `no-restricted-imports` для `core/database/platform*`;
  - скил `postgres-best-practices`: `SKILL.md` (блок «Не решено» — модель ролей),
    `rules/security-rls-basics.md` (нюанс «Админка оператора» → ссылка на ADR-0013, политики
    `TO`), `rules/security-privileges.md` (таблица ролей, явные гранты),
    `rules/lock-skip-locked.md` («модель ролей воркера — требует ADR» → цикл по тенантам),
    `rules/conn-pooling.md` / `rules/conn-limits.md` (второй пул);
  - скил `nestjs-api`: `reference/nestjs-config-data-access.md` (`PlatformDatabase`, пример
    политики привести к fail-closed `current_setting('app.tenant_id')` без `missing_ok`, как в
    `security-rls-basics`), `reference/nestjs-messaging-basics.md` (захват в цикле по тенантам,
    `enqueuePlatform`), `reference/nestjs-security-auth.md` (резолверы для кода сети, ключа,
    терминала, `PgSessionStore`; раздел оператора), `reference/nestjs-resilience-context.md`
    (контекст задачи, запрет `runAsTenant` в HTTP), `reference/nestjs-review-checklist.md`,
    `reference/nestjs-testing-integration-patterns.md` (тесты каталога и поведения);
  - `docs/architecture/c4/container.md` (легенда API: два пути доступа к БД) и
    `docs/architecture/glossary.md` (термины «платформенные данные», «витрина тенанта»);
  - ADR-0006 — открытый вопрос о кросс-тенантном пути закрыть ссылкой на этот ADR.

Решено архитектором проекта 2026-09-30:

1. Владелец тенанта видит свои счета, подключённые услуги и лицензионные ключи своих точек —
   только чтение (`SELECT` своих строк для `pharmacy_app`); меняет их только оператор.
2. Каталог — **общий справочник препаратов платформы** (`drug_reference`, класс `shared`, ведёт
   оператор) + собственные карточки тенанта (`products`, класс `tenant`) со ссылкой на справочник;
   цены, партии и остатки — всегда тенантные.
3. Курсов валют нет — торговля только в сомони (ADR-0016); `exchange_rates` и задача загрузки
   курсов НБТ исключены.
4. Точки создаёт и закрывает владелец сети (`stores` — тенантная таблица); перевод в офлайн-режим
   и выдачу лицензионного ключа делает оператор (`UPDATE (mode)` для `pharmacy_platform`).
5. Витрины пересчитываются ночью; дата отсечки периода — 3-е число следующего месяца (запас на
   позднюю досылку чеков из буфера перебоев); значения — параметры, меняются без нового ADR.
6. Граница платформенного кода — ESLint `no-restricted-imports` + архитектурный тест; вынос в
   Nx-библиотеку `scope:platform` — при росте платформенного кода, без нового ADR.

## Поправка 2026-10-02

Фиксирует решения, принятые архитектором при утверждении модели данных (2026-09-30 / 2026-10-01,
`docs/architecture/data-model/`). Решение ADR не меняется.

1. **Классы новых таблиц** (полный список — индекс классов в `data-model/README.md`, источник
   истины в коде — `apps/api/src/core/database/table-classes.ts`):
   - `legal_entities` — `tenant` (юрлица сети ведёт владелец);
   - `service_requests` — `tenant-export` (заявку на услугу пишет тенант, видит оператор;
     подключение — запись оператора в `tenant_services`);
   - `store_billing` — `platform` («оплачено до» по точке ведёт оператор; поэтому поле не в
     `stores`, которую пишет владелец сети).
2. `docs/architecture/generated/CLAUDE.pharmacy-app.md` из списка «Что обновить» — исторический
   артефакт, не меняется; действующие правила — корневой `CLAUDE.md` (обновлён).

## Поправка 2026-10-02 (аутентификация)

Фиксирует решения архитектора, принятые при проектировании аутентификации `apps/api`
(`docs/superpowers/specs/2026-10-02-auth-design.md`, R2) вместе с поправкой ADR-0008 от той же
даты. Решение ADR не меняется; закрытый список резолверов (раздел 3) читается так:

1. **`resolve_login(kind text, value text)` → `(tenant_id, employee_id, tenant_status)` вместо
   `resolve_tenant_by_code(code)`.** `kind` — `login` / `phone` / `email`, `value` —
   нормализованный идентификатор (`lower()` логина и e-mail, телефон в E.164). Поиск по точному
   равенству глобально уникального ключа; результат — идентификаторы и статус сети, без списков.
   Для вызова `pharmacy_app` нужен только единственный `tenant_id` — поэтому уникальность
   идентификаторов глобальная (ADR-0008, поправка 2026-10-02). Правила резолверов раздела 3
   (владелец `pharmacy_resolver`, `stable`, `set search_path = ''`, `EXECUTE` только
   `pharmacy_app`, нет у `PUBLIC`) и тест каталога (раздел 8) не меняются.
2. **`resolve_session(token_hash)` не нужен.** Сессия офлайн-точки ищется по `jti` под RLS: JWT
   (ADR-0008, поправка 2026-10-02) несёт `tid`, `PgSessionStore` открывает `withTenant(tid)` и
   читает `sessions` по ключу `(tenant_id, jti)`. Из списка резолверов исключается.
3. Остальные резолверы (`resolve_license_key`, `resolve_terminal`) без изменений.

## Поправка 2026-10-05 (создание сети оператором)

Утверждено архитектором проекта 2026-10-05.

Модуль «сети» админки (`docs/superpowers/specs/2026-10-05-tenants-module-design.md`). Оператор
создаёт сеть с владельцем и выдаёт владельцу одноразовый код активации, но не читает и не меняет
данные сети (ADR-0008, поправка 2026-10-05). Владелец — строки тенантных таблиц, к которым у
`pharmacy_platform` нет прав.

1. **Функции создания сети** — новый закрытый класс SECURITY DEFINER-функций рядом с резолверами
   (раздел 3):
   - `provision_tenant(...)` — создаёт новую сеть целиком: `tenants`, `tenant_settings`, роль
     владельца из шаблона, сотрудника-владельца и хеш его кода активации; существующую сеть не
     меняет (конфликт ключа — ошибка);
   - `issue_owner_code(tenant_id, code_hash, expires_at, operator_id, audit_id, correlation_id)` —
     пишет только хеш и срок кода владельцу активной сети и запись `owner.activation-code-issued` в
     `audit_log` сети (оператор — `acting_operator_id`; дополнено 2026-10-06, ADR-0008 поправка
     2026-10-05 п. 7).
   Правила как у резолверов: `security definer`, `set search_path = ''`, на входе только
   идентификаторы и фиксированные поля, ничего не возвращают из тенантных таблиц, `revoke all from
   public`, `EXECUTE` только `pharmacy_platform`.
2. **Роль `pharmacy_provisioner`** (NOLOGIN) — владелец функций создания сети: `INSERT` на
   `tenants`, `tenant_settings`, `roles`, `employees`, `employee_credentials`, `UPDATE` только
   колонок кода в `employee_credentials`, `INSERT` в `audit_log` (append-only), `SELECT` колонок
   для проверок (в том числе `tenant_settings.timezone` для бизнес-даты), политики RLS `TO
   pharmacy_provisioner`. `pharmacy_resolver` остаётся только для чтения — функции записи ему не
   передаются. Роль создаётся `initdb` (у `pharmacy_owner` нет `CREATEROLE`).
3. **Тест каталога** (раздел 8): функции создания сети — ровно закрытый список
   (`PROVISIONING_FUNCTIONS` в `table-classes.ts`), владелец `pharmacy_provisioner`, `search_path`
   закреплён, нет `EXECUTE` у `PUBLIC` и `pharmacy_app`; у `pharmacy_resolver` нет прав на запись.
4. **Контакт владельца в `tenants`** (`owner_full_name`, `owner_login`, `owner_phone`,
   `owner_email`) — платформенные колонки (контакт сети для платформы, как реквизиты для счёта),
   их пишет `provision_tenant`; чтение `employees` платформой по-прежнему запрещено.
5. Блокировка сети — платформенные колонки `tenants` (`status`, `blocked_at`, `blocked_by`,
   `block_reason`), права `pharmacy_platform` (`UPDATE` своей таблицы) достаточно; сессии сети
   закрываются флагом в хранилище сессий (спецификация, раздел 6), без доступа к тенантным данным.
6. **Роли по умолчанию (дополнение 2026-10-06, утверждено архитектором 2026-10-07; спецификация
   2026-10-06-staff-design).** `provision_tenant` вместе с ролью «Владелец» создаёт три обычные роли
   сети — «Заведующий точкой», «Фармацевт-кассир», «Бухгалтер» — с правами по умолчанию из
   `roleTemplates` (`libs/shared/domain`), переданными приложением одним параметром `jsonb`; связи с
   шаблоном у них нет (`template_key` пустой), сеть меняет их как любые свои роли (ADR-0018, п. 2).
   `pharmacy_provisioner` получает `INSERT` в `role_permissions` (политика RLS для своей роли); сети,
   созданные раньше, получают роли миграцией.
