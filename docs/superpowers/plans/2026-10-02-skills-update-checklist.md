# Чек-лист обновления документации и скилов по accepted ADR и модели данных

Дата проверки: 2026-10-02. Репозиторий не менялся. Номера строк — на момент проверки (ветка main).
Статусы: DONE — уже отражает решение; PARTIAL — частично; TODO — остался устаревший текст или пункта нет.
Источники: ADR-0006/0007/0008/0009/0013/0014/0015/0016/0017/0018 (блоки «После перевода в accepted обновить»),
data-model/README.md («Что уточнить в ADR»), plans/2026-09-30-data-layer-followups.md, сверка с кодом
(`apps/api/src/core/database/*`, миграция `1790829987726_org-foundation.sql`, `docker/postgres/initdb`, `.env.example`).

Общие наблюдения (применимо ко многим файлам .claude/):
- Реальные имена в коде: `TenantDatabase.withTenant(tenantId, trx => …)` и `TenantDatabase.tenantTransaction(trx => …)`
  (`apps/api/src/core/database/tenant-database.ts:50,67`), тип `TenantTransaction = Transaction<DB>` (Kysely),
  `PlatformDatabase.platformTransaction(actor, trx => …)` (`core/database/platform/platform-database.ts:64`),
  `newId()` = UUIDv7 (`core/database/ids.ts`), корень схемы — `apps/api/src/app/<module>/` (не `src/modules/`).
  В скилах везде `DatabaseService`, `Tx`, `tx.query(sql, params)`, `apps/api/src/modules/*`, `core/database/database.service`.
- Алиасы библиотек: реально `@pharmacy/shared-dto`, `@pharmacy/shared-util` (tsconfig/package name); в 13 файлах скилов —
  `@pharmacy/shared/dto` (косметика, в нескольких местах есть оговорка «сверить с tsconfig.base.json»).
- Модель из миграции: PK тенантных таблиц `(tenant_id, id)`, FK составные `(tenant_id, x_id)`, `id uuid` без default (UUIDv7 из приложения),
  политики `for all to pharmacy_app using/with check (tenant_id = …)`, гранты явные, default privileges для `pharmacy_app` нет.
- «CI пока не выбран» — устарело после ADR-0009 (GitHub Actions выбран; workflow-файлов ещё нет, пока — ручной `npm run check`).
  Встречается в: nestjs-api/SKILL.md:42,82; agents/nestjs-api.md:57; commands/scaffold-nestjs-api.md:56;
  nestjs-rest-workflow.md:63; nestjs-security-scanning.md:3; nestjs-testing-ci-troubleshooting.md:1,30; nestjs-templates-infrastructure.md:5; CLAUDE.md:213.

---------------------------------------------------------------------------------------------------

## 1. CLAUDE.md

- [DONE] Таблица стека «Доступ к данным / миграции» (Kysely + pg, node-pg-migrate), раздел «Ещё не решено» только ADR-0012 — ADR-0006, ADR-0007 — CLAUDE.md:43, :49-50.
- [DONE] Таблица стека «UI и стили» (Tailwind v4 + libs/ui) — ADR-0007 — CLAUDE.md:42; строка скилов «Tailwind-утилиты (ADR-0007)».
- [DONE] Node 22 LTS (≥ 22.20) / 24 LTS, scrypt, cookie-сессии (Redis; офлайн — PostgreSQL) — ADR-0008 — CLAUDE.md:38, :46.
- [PARTIAL] Redis-клиент `redis` (node-redis) не назван: строка «Кэш / сессии | Redis | ADR-0001» (CLAUDE.md:36) — ADR-0008 («stack.md, CLAUDE.md … Redis-клиент `redis`»). В package.json клиента пока нет (это код, не документация).
- [DONE] Containers: роли `pharmacy_owner/app/platform/resolver`, `DATABASE_URL`/`PLATFORM_DATABASE_URL`, сервис `migrate`, правило `PlatformDatabase` (только `app/platform/**`, `app/sync/**`) — ADR-0013, ADR-0006 — CLAUDE.md:124-126, :228-236.
- [DONE] Единственная валюта TJS, Integrations — три системы — ADR-0016 — CLAUDE.md:119, :186-195.
- [DONE] «Project structure» с FSD (`app/`, пустая `pages/`, `src/{app,pages,widgets,features,entities,shared}`), таргет `fsd` — ADR-0017 — CLAUDE.md:64-71, build-блок.
- [DONE] Строка «Авторизация» (RBAC, каталог прав, охват точек, запрет эскалации) — ADR-0018 — CLAUDE.md (таблица стека, 7-я строка).
- [PARTIAL] Conventions, «Next.js»: осталась только старая фраза «касса офлайн-устойчива — буфер перебоев связи как очередь операций в браузере с идемпотентной досылкой» (CLAUDE.md:133-135). Нужно добавить: маршруты-экраны + query-параметры (static export), тонкий API-клиент поверх `libs/shared-dto` (`import type`), буфер outbox-first (IndexedDB через `idb`), Service Worker только в облачной сборке web — ADR-0015.
- [TODO] Правило «складские операции офлайн-точки проводятся только на точке; операция синхронизации пишется в outbox в той же транзакции, что и факт» — в Conventions его нет (поиск «офлайн» даёт только Docker/Integrations) — ADR-0014.
- [PARTIAL] «`build` — ручной quality gate, пока CI не выбран через ADR» (CLAUDE.md:213) — CI выбран (ADR-0009, таблица стека :47). Переформулировать: «пока workflow-файлы не созданы» (раздел CI/CD это уже говорит).
- [TODO] Подсказка про диагностику упавшей миграции: `npm run stack -- <env> logs migrate` — followups.md (Task 8 minor); в CLAUDE.md не найдено.
- [TODO] Заметка про пароли в URL compose (ручные `@ / :` ломают строку; `stack init` даёт base64url) — followups.md (Task 8 minor); не найдено ни в CLAUDE.md, ни в `.env.example`.
- [SKIP] `docs/architecture/generated/CLAUDE.pharmacy-app.md` (ADR-0013 просит обновить) — исторический артефакт, не менять (ADR-0016:60, CLAUDE.md «Architecture references»). Противоречие в тексте ADR-0013 — см. раздел 12.

## 2. docs/architecture/stack.md

- [DONE] Строка «Доступ к данным / миграции» (Kysely + pg, node-pg-migrate) — ADR-0006 — stack.md:59.
- [DONE] Строка «UI и стили» — ADR-0007 — stack.md:58. «Тесты и CI» — ADR-0009 — stack.md:57. «Фронтенд-библиотеки», «Архитектура фронтенда» — ADR-0015/0017 — stack.md:56-57.
- [DONE] Валюта только TJS в «Ограничения», НБТ убран из раздела 4, вопрос № 12 оставлен открытым — ADR-0016 — stack.md:20, :96.
- [DONE] Вопрос № 11 закрыт — ADR-0018 — stack.md:95.
- [TODO] Нет строки «Авторизация» (RBAC, динамические роли, каталог `модуль:действие`, охват точек) в таблице раздела 3 — ADR-0018 («CLAUDE.md и stack.md — строка «Авторизация»»). Сейчас авторизация упомянута только внутри строки «Аутентификация» (stack.md:53: «мультитенантные кастомные роли «модуль × действие × охват точек»»).
- [TODO] Backend/Runtime: нет версии Node.js 22 LTS (≥ 22.20) / 24 LTS и Redis-клиента `redis` — ADR-0008. Строка «Backend | NestJS (Node.js, TypeScript)» (stack.md:48) и «Кэш | Redis» (stack.md:51) без этого.
- [PARTIAL] Строка «Аутентификация» (stack.md:53): «реализация — ADR-0008» без решения (scrypt из `node:crypto`, cookie-сессии на одном origin, device-cookie терминала, офлайн — PostgreSQL-сессии). Аналогично раздел 2 «Как аутентифицируются пользователи?» (stack.md:29) — ADR-0008.
- [TODO] Открытый вопрос № 8 «Хранилище секретов» (stack.md:92) — дополнить pepper (256 бит на развёртывание, переменные окружения) — ADR-0008.
- [PARTIAL] Раздел 4, «Синхронизация офлайн-точек»: есть интервал и ссылка (ADR-0014) в колонке SLA; нет «JSON + gzip, батчи (≤ 500 операций / ≤ 2 МБ)», идемпотентный outbox→inbox + лента изменений — ADR-0014 — stack.md:71-72 (строка «Синхронизация»).
- [PARTIAL] Таблица стека, колонка «Кэш» (stack.md:51): «Сессии и PIN-сессии… » — добавить, что на офлайн-точке сессии в PostgreSQL (`PgSessionStore`) — ADR-0008/0013.

## 3. docs/architecture/glossary.md (33 строки)

- [DONE] «Терминал», «PIN-сессия» — ADR-0008 («уже добавлены») — glossary.md:25-26.
- [DONE] «Партия»: закупочная цена в TJS (дирамы, ADR-0016), без курса — glossary.md:15.
- [TODO] «Вход от имени» (impersonation) — ADR-0008. Есть только упоминание в «Оператор платформы» (:12) и «Аудит».
- [TODO] «Право» (permission, `модуль:действие`), «Охват точек» (store scope); уточнить «Роль» — ADR-0018. Сейчас «Роль | Набор прав «модуль × действие × охват точек»; базовые + кастомные» (glossary.md:11) противоречит ADR-0018 (динамические роли тенанта; охват точек — у сотрудника).
- [TODO] «Платформенные данные» (platform data), «Витрина тенанта» (tenant export) — ADR-0013. Не найдено.
- [TODO] Термины синхронизации: операция синхронизации (sync operation), лента изменений (change feed), курсор, карантин (quarantine), сверка остатков (stock checkpoint), переносящее движение, режим точки `offline-pending` — ADR-0014. Сейчас только «Очередь синхронизации», «Конфликт синхронизации», «Лицензионный ключ» (glossary.md:28-29); в «Точка» режим «облачная / офлайн» без `offline-pending`.
- [TODO] «Юрлицо сети» (legal entity), «Бизнес-дата» (business date), «Счётчик номеров» (document counter) — data-model/README.md («Глоссарий»); не найдено.

## 4. docs/architecture/c4/container.md и container.mmd (PNG img/container.png — перегенерация вручную отдельным шагом)

- [DONE] Убрана внешняя система НБТ и связи (в .md/.mmd нет «НБТ»/«курс») — ADR-0016.
- [TODO] Контейнер `web`: упомянуть Service Worker и IndexedDB-буфер с идемпотентной досылкой; в легенде «Буфер перебоев связи» — ссылка на ADR-0015. Сейчас (container.md:14, :58-60): «локальная очередь операций в браузере», «локальное хранилище браузера» — ADR-0015.
- [TODO] Легенда API: два пути доступа к БД (`pharmacy_app` tenant-путь и `pharmacy_platform` platform-путь, резолверы SECURITY DEFINER); на диаграмме одна связь `Rel(api, db, "SQL")` (container.md:36) — ADR-0013.
- [TODO] Эндпоинты `/api/v1/sync/*`, таблицы `sync_outbox` / `sync_inbox` / `sync_changes`, секвенсор ленты, ключ в env-файле точки, режим `offline-pending`, флеш-комплект с переносящими движениями — ADR-0014. Сейчас (container.md:24, :57): «очередь синхронизации — таблица в PostgreSQL», «Rel(lapi, api, "Синхронизация")» без деталей.
- [PARTIAL] Redis-строка (container.md:18, :65) верна для облака; добавить, что сессии офлайн-точки — PostgreSQL (ADR-0008).
- Заметка: после правок .md/.mmd нужно вручную перегенерировать `img/container.png` (puppeteer-config.json в c4/).

## 5. docs/architecture/c4/deployment.md и deployment.mmd (PNG img/deployment.png — вручную)

- [TODO] Требования к reverse proxy: заголовки кэша (`/_next/static/*` immutable, HTML no-cache), `sw.js` без кэша, `try_files` для маршрутов-экранов — согласовать с ADR-0012 (proposed) — ADR-0015. В deployment.md:9 proxy описан одной строкой «Отдаёт статику web/admin, проксирует /api».
- [TODO] ADR-0014: канал/ключ в env, режим `offline-pending`, флеш-комплект с переносящими движениями, облако принимает ≥ 2 предыдущих версий протокола (deployment.md:29-35 говорит лишь «преобразование на лету»).
- [PARTIAL] Отдельный compose-профиль офлайн-точки (без Redis, `STORE_MODE=offline`, `SYNC_BASE_URL`) — ADR-0014 (раздел `docker/`); файла `docker/compose.offline.yml` нет (есть compose.yml/dev/test/prod).

## 6. docs/architecture/c4/context.md и context.mmd

- [DONE] НБТ убран — ADR-0016 (нет совпадений); интервал синхронизации по ADR-0014 — context.md:39.
- Других обязательных правок нет. PNG `img/context.png` — проверить, что перегенерирован после правки ADR-0016 (git: `a05b28e`).

## 7. docs/architecture/adr/0006-orm-i-migracii.md

- [TODO] Имя в правиле 1: «`DatabaseService.withTenant(tenantId, fn)`» (ADR-0006:72) — в коде `TenantDatabase.withTenant` / `tenantTransaction`; выровнять (источник — реальный код, ADR-0013:227 уже говорит `TenantDatabase`).
- [TODO] ADR-0013: «ADR-0006 — открытый вопрос о кросс-тенантном пути закрыть ссылкой на ADR-0013» — в ADR-0006 нет ни одного упоминания 0013/«кросс-тенант».

## 8. docs/architecture/adr/0008-realizaciya-autentifikacii.md

- [TODO] ADR-0018: ссылки на «рабочие обозначения» прав заменить ссылкой на каталог ADR-0018 — ADR-0008:13 («`pos:terminal-bind`, `platform:impersonate` — рабочие обозначения»).

## 9. docs/architecture/adr/0009-instrumenty-testirovaniya-i-porogi-kachestva.md

- [TODO] ADR-0009:75 «`createDatabaseServiceMock()`» — после выравнивания имени слоя данных (TenantDatabase) переименовать (косметика, связано с п.7).
- [DONE] ADR-0016: пометка «курсов НБТ нет» — ADR-0009:47, :194.

## 10. docs/architecture/adr/0013-krosstenantnyj-dostup.md (data-model/README «Что уточнить»)

- [TODO] В список классов таблиц добавить `service_requests` (tenant-export), `store_billing` (platform), `legal_entities` (tenant) — data-model/README.md:99; в ADR-0013:96-100 (таблица классов) их нет.

## 11. docs/architecture/adr/0014-protokol-sinhronizacii.md (data-model/README «Что уточнить»)

- [TODO] Лента облако → точка: добавить `drug_reference` и `services` (ADR-0013 п. 6), `dictionary_values`, `payment_methods`, `legal_entities`, `categories`, `tenant_settings` — ADR-0014:113 (строка владельца «Облако…» их не содержит).
- [PARTIAL] «Долг поставщику по приходу офлайн-точки заводит облако при применении `document.posted`» — общая фраза есть (ADR-0014:191 «производные облачные данные (долг поставщику по приходу…)»), явного правила для `document.posted` нет.
- [TODO] Заказы, оплаты поставщикам и заявки на перемещение ведутся только в облаке — не найдено.
- [TODO] Отмены проведения среди операций синхронизации нет — на офлайн-точке запрещена до уточнения — не найдено (список типов ADR-0014:177-183 без отмены; запрета нет).
- [TODO] `return.completed` включает автоматическое списание просроченного возвращённого товара — ADR-0014:178 (только перечень типов).
- [TODO] Пометка «курсов нет по ADR-0016» — НЕ требуется: курсы в ленте в ADR-0014 не упоминаются (проверено grep) — DONE по существу.

## 12. Новый ADR «хранение файлов» (фото и сканы рецептов ПКУ) — ФАЙЛА НЕТ

- [TODO] Создать ADR (после 0018 следующий номер — 0019): где хранятся (PostgreSQL или хранилище объектов), офлайн-точка, шифрование ПДн, удаление по сроку; до его accepted `controlled_sale_records.prescription_file_id` не заполняется — data-model/README.md:100, 04-pos.md:119.

## 13. docs/superpowers/plans/2026-09-30-data-layer-followups.md (только документационные пункты)

- [TODO] «FORCE RLS binds pharmacy_owner (backfills need context) — document in migration guide» (followups.md:64) — «migration guide» в репозитории не существует (docs/guides/ — шаблоны ai-project-start, не руководство по миграциям). Нужен раздел в `.claude/skills/postgres-best-practices` (новое правило/SKILL) или отдельный документ; см. также п. 23.
- [TODO] CLAUDE.md: `logs migrate` и заметка про пароли в compose-URL — см. раздел 1.
- [TODO] Правка README data-model: «непустой объект; строки и непустые значения проверяет приложение» (followups «Ruling Task 4») — проверить `docs/architecture/data-model/01-platform-org.md`/README; коммит `4eaaf05` («align the multilingual name check») говорит, что сделано — считать DONE после выборочной проверки.

## 14. .claude/skills/nestjs-api/SKILL.md

- [TODO] ADR-0006: строка «ORM/слой доступа к данным и инструмент миграций» в «Требует ADR…» (SKILL.md:32-33) → решено (Kysely + pg, node-pg-migrate); «ADR-0008, proposed» (:34) → accepted, scrypt; «транспорт идентификатора сессии… протокол привязки терминала… вход оператора» (:35-36) — решено ADR-0008.
- [TODO] «Что адаптировано относительно оригинала (… Prisma 7 …)»: «слой данных ORM-независимый» (:27) → Kysely поверх pg (ADR-0006).
- [TODO] Key Patterns «Data access»: «`DatabaseService.tenantTransaction(tx => …)`» (:92) → `TenantDatabase.withTenant/tenantTransaction(trx => …)`; «Migrations | Версионированные, инструмент по ADR» (:102) → node-pg-migrate, только Up, `.sql`; «Auth» (:96) — cookie-сессии, scrypt.
- [TODO] «Common Commands»: «Команды миграций появятся после ADR» (:160) → `npx nx run api:migrate`, `api:integration`, `api:db-types` / `db-types-verify` (CLAUDE.md:101-103); `docker compose -f docker/compose.dev.yml` (:157) → `npm run dev:deps`.
- [TODO] Documentation Sources: строка Prisma (:169) удалить → Kysely / node-pg-migrate docs; Hard Prohibitions «`prisma db push`» (:198), «`ORM/migration tool without ADR`» (:192), «`tx` … ORM raw queries» (:201-202), добавить: `sql.raw/sql.lit` с входными данными, обращение к корневому `db` внутри `trx` — ADR-0006 (чек-лист ревью).
- [TODO] Reference table (:111) «Prisma — вариант А» → убрать; «Process» шаг 4 путь `apps/api/src/modules/<module>/…` (:72-74) → `apps/api/src/app/<module>/…`; «Modules: `apps/api/src/modules/*`» (:89).
- [TODO] «CI пока не выбран» (:42, :82) → GitHub Actions по ADR-0009.
- [TODO] ADR-0018: «Auth»/Process (:96, :78) — каталог прав `модуль:действие`, `@RequirePermission`, запрет эскалации, охват; ADR-0015: тест соответствия `ApiRoutes`, политика бизнес-конфликтов досылки (sale = fact), совместимость API на одну версию фронтенда, `newId()` (UUIDv7) — не найдено.
- [TODO] ADR-0014: `sync.apply` выполняется в запросе (не воркером); `LicenseKeyGuard` формат ключа — см. messaging/auth.
- [DONE] ADR-0016: «Единственная валюта — сомони…» (:49, :195).

## 15. nestjs-api/reference/nestjs-config-data-access.md (самый большой объём — переписать)

- [TODO] Шапка «ORM и инструмент миграций НЕ выбраны… Prisma — вариант А» (:5-8) → Kysely + pg (ADR-0006).
- [TODO] Контракт слоя п.1 «`DatabaseService`» (:12) и раздел «DatabaseService (пример на `pg`)» (:39-96, `Tx`, `tx.query`, `Pool`, `connect/BEGIN/COMMIT`) → `TenantDatabase.withTenant` (транзакция Kysely, первым оператором `set_config('app.tenant_id'…)`, `statement_timeout`, `lock_timeout`, `connectionTimeoutMillis`), `PlatformDatabase.platformTransaction` (ADR-0013); сервисы получают `Transaction<DB>`, не корневой `Kysely<DB>`.
- [TODO] Репозиторий-пример с `tx.query('SELECT … WHERE tenant_id = $1', [tx.tenantId])` (:124-151) и чек-транзакция (:158-193, `tx.query`, `FOR UPDATE` + `SUM` отдельным вызовом) → Kysely-запросы (`forUpdate()`, `onConflict(…).doNothing().returning()`); правило «блокировка отдельно от подсчёта» (ADR-0006 п.2) — не сформулировано.
- [TODO] «Кросс-тенантные операции оператора… зафиксировать в ADR до реализации» (:100-102) → ссылка на ADR-0013 (`PlatformDatabase`, `pharmacy_platform`, резолверы).
- [PARTIAL] RLS-блок (:104-120): политика уже с `TO pharmacy_app` и без `missing_ok` — DONE; но «(черновик ADR-0013)» (:117) → «ADR-0013 accepted»; `BYPASSRLS` — ок.
- [TODO] «Деньги и количества»: «Драйвер `pg` отдаёт `int8` строкой — конвертировать утилитой» (:224-226) → type parser пула `int8 → BigInt`, `date → строка` и `kysely-codegen typeMapping` (ADR-0006 п.3); сериализация `bigint` в DTO явно.
- [TODO] Типы: `kysely-codegen --camel-case`, `--verify`; CamelCasePlugin, алиасы в `sql` в snake_case (ADR-0006 п.4-5) — не найдено.
- [TODO] «Миграции» (:248-258) «Инструмент — по ADR»; «`synchronize: true`, `prisma db push`» → node-pg-migrate, `.sql` только Up, `CREATE INDEX CONCURRENTLY` отдельной `.mjs` с `pgm.noTransaction()`, применение ролью `pharmacy_owner` отдельным шагом, expand/contract (ADR-0006 п.7-8); раздел «Вариант А: Prisma 7» (:262-280) удалить; `P2002` (:220).
- [TODO] Append-only пример (:233-243, `REVOKE … FROM pharmacy_app` + `forbid_mutation`) — сверить с `exact set` грантов по классам таблиц (followups: TRUNCATE/REFERENCES/TRIGGER, exact-set test).

## 16. nestjs-api/reference/nestjs-security-auth.md (переписать под ADR-0008, 0013, 0014, 0018)

- [TODO] Блок «Требует accepted ADR… (ADR-0008, сейчас proposed… кандидаты — Argon2id, scrypt, bcrypt)» (:9-17) → ссылка на ADR-0008 и фиксированные решения; «Argon2PasswordHasher, ScryptPasswordHasher… только после ADR» (:41).
- [TODO] Добавить `NodeScryptPasswordHasher` (PHC, HMAC-pepper, версия pepper, `needsRehash`, `timingSafeEqual`, фиктивный хеш; самопроверка тест-вектором RFC 7914) — ADR-0008.
- [TODO] `SessionStore` на API `ioredis` (`.set(…,'EX',…)`, `.sadd`, `.smembers`) (:73-107) и оговорка «с клиентом `redis` вызовы отличаются» (:111) → node-redis 6 (`multi().set(k,v,{EX})`, `sAdd`, `sMembers`); добавить `PgSessionStore` для офлайн-точки.
- [TODO] `SessionData` (:53-63): добавить `authMethod` (`password|pin|impersonation`), `authenticatedAt` (step-up), `impersonationId`; `roleVersion` → `permissions_version` (ADR-0018).
- [TODO] Login-контроллер (:126) `res.cookie('sid', …, { path: '/api' })` несовместим с префиксом `__Host-` → `__Host-sid`, `Path=/`, имя из конфига (офлайн — `sid`); `extractSessionToken` — только cookie; добавить CSRF-guard (Fetch Metadata + `Origin` + `application/json`).
- [TODO] Раздел PIN (:151-160): device-cookie `__Host-term`, поля `terminals` (`bound_by`, `bound_at`, `last_seen_at`), счётчик по терминалу, step-up; «PIN_MAX_ATTEMPTS» 3 неудачи по умолчанию (ADR-0008 «Решено» п.3; сейчас в config-basics 5).
- [TODO] Модель (:21-27): `roles | tenant_id (NULL — базовая роль платформы)`, `employee_store_scopes` — не соответствует ADR-0018 и миграции (`roles.tenant_id NOT NULL`, `is_owner`, `role_permissions`, `employee_stores`, `employee_credentials`); добавить `PermissionsGuard`, `@RequirePermission` по каталогу `модуль:действие`, охват, запрет эскалации — ADR-0018. Сейчас `@RequirePermission(module, action)` + `has(\`${module}:${action}\`)` (:169-231) — частично совпадает, но без каталога/escalation/`permissions_version`.
- [TODO] «Синхронизация — лицензионный ключ» (:237-244) и «Оператор платформы» (:246-250, «Механика — ADR до реализации») → резолверы SECURITY DEFINER (код сети, ключ, терминал), `LicenseKeyGuard` формат ключа и статусы лицензии (ADR-0014, ADR-0013); impersonation: таблица `impersonations`, handoff-код, абсолютный TTL, read-only-guard, `acting_operator_id`/`impersonation_id` в аудите (ADR-0008); офлайн-точка: локальные учётные данные, одноразовый код первого входа.

## 17. nestjs-api/reference/nestjs-config-npm-ts.md

- [TODO] Таблица зависимостей: «Redis-клиент (`ioredis` **или** `redis`)… выбрать один» (:32) → `redis` (node-redis); «`pg` / ORM… требует ADR (ORM не выбран)» (:33) → `kysely`, `pg`, `node-pg-migrate`, `kysely-codegen` (точные версии, ADR-0006 п.9); «библиотека хеширования… ADR-0008, proposed» (:34) → scrypt из `node:crypto`.
- [TODO] «Не добавлять: … `uuid` (есть `crypto.randomUUID()`)» (:41-42) → `uuid` (v7) нужен для `newId()` (ADR-0014 §2, ADR-0015; в коде `core/database/ids.ts` уже `import { v7 } from 'uuid'`); `axios` — только `api-e2e` (ADR-0015).

## 18. nestjs-api/reference/nestjs-conventions.md

- [TODO] «Не выбрано (требует ADR): ORM/слой доступа, инструмент миграций, … библиотека хеширования паролей» (:14-15) → решено; «Миграции… (инструмент — первым ADR разработки)» (:61).
- [TODO] Раскладка (:19-32): `modules/` → `app/<module>/`, `config/` в `app/config/`, `core/database` (TenantDatabase, platform/), `auth/` — сверить с реальным деревом (`apps/api/src/{app,common,core}`); `DatabaseService.tenantTransaction()` (:26, :52) → `TenantDatabase`.

## 19. nestjs-api/reference/nestjs-config-basics.md

- [TODO] `.env.example` (:168): `DATABASE_URL=postgresql://pharmacy:<password>@localhost:5432/pharmacy`, `database.config.ts (DATABASE_URL, размер пула)` (:157) → роли `pharmacy_app`/`pharmacy_platform`/`pharmacy_owner`: `DATABASE_URL`, `PLATFORM_DATABASE_URL`, `MIGRATION_DATABASE_URL`, таймауты `DB_STATEMENT_TIMEOUT_MS`/`DB_LOCK_TIMEOUT_MS` (см. корневой `.env.example`); `PIN_MAX_ATTEMPTS=5` (:179) → 3 по ADR-0008.

## 20. nestjs-api/reference/nestjs-messaging-basics.md

- [TODO] ADR-0013: «Таблица системная: захват… без тенант-контекста (отдельная роль/политика)» (:57) и порт `enqueuePlatform`, `claim(queue,limit,worker)` → цикл «по тенанту» (`SKIP LOCKED` под RLS тенанта, N транзакций), `pharmacy_platform` только для `tenant_id IS NULL` задач; «DDL иллюстративный — инструмент миграций — первым ADR» (:28).
- [TODO] ADR-0014: очередь `sync.apply` в таблице «Где применяется» (:21) — `sync.apply` выполняется в запросе (не воркером); `Tx`/`DatabaseService` (:63, :101) → `TenantTransaction`.

## 21. nestjs-api/reference/nestjs-resilience-context.md

- [TODO] ADR-0013: контекст задачи, запрет `runAsTenant` в HTTP (раздел :87-100 «job → runWithContext») — не описано; `tx: Tx` / `tx.query` в примере аудита (:72-74).
- [TODO] ADR-0014: `LicenseKeyGuard` как источник `tenantId/storeId` (:15) — уточнить резолвер SECURITY DEFINER.

## 22. nestjs-api/reference/nestjs-review-checklist.md

- [TODO] ADR-0018: пункты «эндпоинт без права; отсутствие проверки охвата; утечка полей себестоимости» — есть общие (:45-46, «`@RequirePermission` либо `@Public()`»), нет escalation и себестоимости — PARTIAL.
- [TODO] ADR-0006: «обращение к `db` при наличии `trx`», «`sql.raw`/`sql.lit` со входными данными», «`db.tenantTransaction()` — `tx.tenantId`» (:19, :102) → TenantDatabase; «ORM/мигратор без accepted ADR» (:37) уточнить.
- [TODO] ADR-0008: «Пароли/PIN — только через `PasswordHasher` (реализация по ADR)» (:47) → scrypt + pepper.

## 23. Тестовые файлы nestjs-api/reference (ADR-0009, ADR-0006)

- nestjs-testing-integration-setup.md: [TODO] баннер «Testcontainers — «согласовать»» (:1), вариант B (:22) → «отложен до CI/CD, ADR-0009», комментарий Variant B (:57), фейк-сервер ККМ в globalSetup; «Драйвер… согласовать» (:76) → закрывает ADR-0006 (`pg`).
- nestjs-testing-unit-mocks.md: [TODO] `@golevelup/ts-jest` — «согласовать» (:84) → не используется; `nock` (:132) → не используется; предохранитель `fetch` в setupFiles; мок `DatabaseService`/`Tx` (:7-17, :192).
- nestjs-real-world-issues.md: [TODO] раздел `createMock<T>()` (:155-161) пометить «не используется по ADR-0009» или удалить; `DatabaseService` (:20, :84, :91).
- nestjs-testing-unit-controllers.md: [TODO] баннер (:1), faker «согласовать» (:54) → не используется, `libs/shared/testing` (:57) → решено (ADR-0009).
- nestjs-testing-ci-troubleshooting.md: [TODO] таблица/пример `coverageThreshold` «стартовое предложение» 90/90/80 и каталоги `./src/modules/…` (:7-24) → дифференцированные пороги ADR-0009; инструмент нагрузки «autocannon, k6 и т.п.» (:105) → autocannon, профиль, p97.5.
- nestjs-testing-unit-basics.md: [TODO] `coverageThreshold` и «стартовое предложение» (:38-46); `DatabaseService` mock (:50-92).
- nestjs-debugging-performance.md: [TODO] таблица бюджетов p95 150/300 мс (:11-12) → 100/200/300 мс, p99, условия замера; «инструмент нагрузки пока не выбран — вводится через ADR» (:106) → autocannon.
- nestjs-testing-integration-patterns.md: [TODO] ADR-0013 — тесты каталога (`catalog.int-spec`) и поведения; нет упоминания (файл использует `randomUUID`, `loginAs`).

## 24. Прочие nestjs-api/reference (идиома `DatabaseService`/`Tx` и «ORM не выбран»)

Все пункты — [TODO] ADR-0006 (замена идиомы `DatabaseService.tenantTransaction(tx => tx.query(sql))` на `TenantDatabase` + Kysely; пути `modules/` → `app/`):
- index.md:10 — «`DatabaseService.tenantTransaction`».
- nestjs-templates-core.md:170-184 — `DatabaseService` в `CoreModule` (providers/exports) → `TenantDatabase`, `PlatformDatabase` (`DatabaseModule`).
- nestjs-templates-features.md:157-223 — сервис каталога на `DatabaseService`/`tx.query`.
- nestjs-enterprise-infrastructure.md:53-63 — health `DatabaseService.ping()`.
- nestjs-rest-services.md:13-16, :150, :189 — `db.tenantTransaction`.
- nestjs-rest-workflow.md:43-44 — «принимает `Tx`»; :63 «CI пока не выбран».
- nestjs-rest-dto-pagination.md:17 «int8 arrives from pg as string» (→ `bigint` по ADR-0006 п.3), :99-115 `tx.query`.
- nestjs-decision-trees.md:22-23 «bcrypt/argon2 → … ADR-0008 (сейчас proposed)», :32 «Не выбрано проектом (ORM, миграции, Fastify, Tailwind/UI-библиотеки)», :61, :87.
- nestjs-debugging-logging.md:41 `pickFefo(tx: Tx…)`, :58 «Слой доступа к данным (ORM) ещё не выбран — … логирование SQL» → логирование Kysely с маскированием tenant_id/ПДн (ADR-0006 «Отрицательные»); баннер :1 «Prisma query logging удалены».
- nestjs-debugging-context-di.md:1, :30 — баннер про Prisma, `set_config` пример (ок, но привести к `TenantDatabase`).
- nestjs-debugging-production.md:74 `DatabaseService`, :42-47 запросы по `sync_inbox` → `sync_store_state` (ADR-0014).
- nestjs-rate-limiting.md:75 — трекер синхронизации по `keyId` (ADR-0014): сейчас «по лицензионному ключу точки» — PARTIAL.
- nestjs-resilience-circuit-breaker.md:208 «tenantTransaction, read-only»; ADR-0016 — пример клиента НБТ уже заменён адаптером фискализации — DONE (НБТ в файле нет).
- nestjs-security-validation-logging.md:88-91 — пример `tx.query` SQL-инъекции/параметризации → Kysely `sql` тег; :103 «не выбрана» (библиотека хеширования) → scrypt.
- nestjs-templates-infrastructure.md:5 «CI … пока не выбраны», :92 «docker/compose.offline.yml» (файла нет; профиль офлайн-точки — ADR-0014); нет сервиса `migrate`/роли `pharmacy_owner`.
- nestjs-security-scanning.md:3 «CI/CD пока не выбран».
- nestjs-observability.md, nestjs-enterprise-patterns.md — «не выбраны» про логирование/мониторинг — корректно (ADR нет), не менять.

## 25. .claude/skills/postgres-best-practices/SKILL.md

- [TODO] Блок «Не решено → требует ADR» (SKILL.md:39-47): ORM/слой доступа «Prisma, TypeORM, Drizzle, Kysely…» и драйвер (:43), инструмент миграций (:45) → решено (Kysely + pg, node-pg-migrate); «Модель ролей для кросс-тенантных путей (биллинг оператора, воркер очередей всех тенантов)» (:47) → ADR-0013 (`pharmacy_platform`, `pharmacy_resolver`); оставить нерешённым только PgBouncer/кэш остатков.
- [TODO] Пример `withTenantTx(db: Db, …)` с интерфейсами `Db`/`Tx` «не выбор библиотеки» (:172-190) → `TenantDatabase.withTenant` (ADR-0006).
- [TODO] «Интеграция с NestJS»: «Слой доступа (выбирается ADR)» (:162) → TenantDatabase; кросс-тенантный путь — ссылка на ADR-0013.
- [TODO] followups: «FORCE RLS binds pharmacy_owner (backfills need context)» — добавить правило для миграций с backfill (нужен `set_config('app.tenant_id')` или `SET ROLE`), т.к. «migration guide» отсутствует.

## 26. postgres-best-practices/rules/*

- security-rls-basics.md:
  - [TODO] политики без `TO <роль>` (:59, :77 `create policy tenant_isolation on receipts …`) → `for all to pharmacy_app` (ADR-0013, фактическая миграция :234-258).
  - [TODO] «Админка оператора («вход от имени») … решение требует ADR» (:103-105) → ссылка на ADR-0013 (платформенный путь `pharmacy_platform`, impersonation только через tenant-сессию).
  - [PARTIAL] `receipts (id uuid primary key, tenant_id …, unique (tenant_id, id))` (:30, :48-52) — у реальных тенантных таблиц PK `(tenant_id, id)`.
  - [DONE] fail-closed без `missing_ok` (:93-95), составные FK `(tenant_id, x_id)` (:67-68).
- security-rls-performance.md: [TODO] политики без `TO pharmacy_app` (:18, :33).
- security-privileges.md:
  - [TODO] таблица ролей (:15-19): нет `pharmacy_platform`, `pharmacy_resolver`; `pharmacy_owner nologin` (:33) — в initdb owner LOGIN (миграции); `pharmacy_readonly` (ADR-0013 его тоже оставляет «по необходимости») — ADR-0013.
  - [TODO] `alter default privileges … grant select, insert, update, delete on tables to pharmacy_app` (:47-51) — ADR-0013 требует удалить default privileges для `pharmacy_app`; гранты выдаются явно по классу таблицы (миграция: «pharmacy_app has no default privileges»); добавить `revoke execute on functions from public` для резолверов.
  - [TODO] «Хранилище секретов не выбрано» (:60) — осталось верным (вопрос № 8) — DONE.
- conn-pooling.md: [TODO] «ORM и драйвер не выбраны — требует ADR» (:13) → `pg.Pool` внутри Kysely; второй пул (`PlatformDatabase`), `applicationName`, `connectionTimeoutMillis`; пересчёт `total` с двумя пулами (ADR-0013).
- conn-limits.md: [PARTIAL] таймауты `alter role pharmacy_app set statement_timeout/lock_timeout` (:38-40) — ADR-0006 п.1 и код ставят их через `set_config(..., true)` внутри `withTenant`; followups: «no role/db-level app.* settings». Добавить ссылку на `TenantDatabase` и учесть, что роль-уровневые `ALTER ROLE` могут быть не нужны; второй пул — лимиты (ADR-0013).
- lock-skip-locked.md: [TODO] «Модель ролей воркера — требует ADR» (:104-105) → цикл по тенантам (ADR-0013); `payload_hash`, статусы inbox, карантин, секвенсор ленты, `sync_changes` (ADR-0014) — не найдено.
- data-idempotency-keys.md: [TODO] `sync_inbox` (:67-73) без `payload_hash`, статусов (`applied/quarantined`), карантина, секвенсора (ADR-0014); `request_hash` для чека — ок; `id uuid primary key` (:34) vs PK `(tenant_id, id)`.
- data-stock-from-movements.md: [PARTIAL] «блокировка отдельно от подсчёта» — шаги 1 и 2 уже раздельные операторы (:44-52), но причина указана иначе («FOR UPDATE не работает с GROUP BY»); ADR-0006 п.2 требует правило с обоснованием: в READ COMMITTED объединённый оператор «FOR UPDATE + подзапрос SUM» видит старый снимок → перепродажа. Добавить в «Правила» (:105-117). `stock_movements id uuid primary key` (:89).
- schema-primary-keys.md: [TODO] «Выбор функции/библиотеки генерации UUIDv7 … согласуется при выборе слоя доступа (ADR)» (:55-56) → `uuid` v7, `newId()` (`libs/shared/util`, ADR-0014 §2 / ADR-0015); пример `id uuid primary key, tenant_id…, unique (tenant_id, id)` (:35-38) → PK `(tenant_id, id)`; `gen_random_uuid()` только в Incorrect (:25) — DONE.
- schema-lowercase-identifiers.md: [TODO] «ORM не выбран (требует ADR)» (:45) → Kysely `CamelCasePlugin` (ADR-0006 п.4).
- schema-foreign-key-indexes.md: [PARTIAL] составные FK уже есть; пример `id uuid primary key` (:19) → PK `(tenant_id, id)`.
- schema-append-only-audit.md: [TODO] политики `audit_read`/`audit_write` без `TO pharmacy_app` (:66-68); `grant all on audit_log to pharmacy_app` в Incorrect — ок.
- schema-money-integer.md: [DONE] TJS-only, без `currency` (:47, :57) — ADR-0016; [PARTIAL] указать парсер `int8 → BigInt` (ADR-0006 п.3).
- monitor-explain-analyze.md, monitor-vacuum-analyze.md: изменений не требуется (ADR не затрагивают).

## 27. .claude/skills/react-dev/SKILL.md (всё TODO — переписать)

- [TODO] ADR-0017: раздел «1. Структура проекта» (:8-19) — `features/ · shared/ · app/`, «`app/` (или `core/`)» → слои FSD `app → pages → widgets → features → entities → shared`, корневая `app/` (реэкспорты маршрутов) + пустая `pages/` с README, алиас `@/*`, срезы с `index.ts`, запрет глубоких импортов, Steiger (`npx nx fsd web|admin`), ESLint `no-restricted-imports`.
- [TODO] ADR-0009: «Раннер де-факто — Jest (или Vitest)… e2e-раннер предлагается в ADR-0009 (proposed)» (:34-35) → Jest + Playwright зафиксированы (accepted); Vitest не используется; jest-axe / `@axe-core/playwright`.
- [TODO] ADR-0015: структура `features/*/api` с TanStack Query, тонкий клиент API (`shared/api`, `ApiRoutes`), `import type` из `libs/shared-dto`, формы на React Hook Form + zod, Zustand-селекторы, use-intl, `idb`-буфер outbox-first — не найдено (файл про них ничего не знает).
- [TODO] ADR-0007: «только компоненты `libs/ui`», запрет UI-библиотек без ADR; Tailwind-утилиты только для раскладки через `className` — не найдено.
- [TODO] ADR-0018: права в профиле сессии — только для UI, проверка на сервере — не найдено.
- [PARTIAL] ADR-0016: «Валюта — только TJS» есть (:61); «CI/CD, мониторинг… не выбраны» (:63-64) — CI выбран (ADR-0009). Заголовок «v1, черновик до ревью архитектора» (:6).

## 28. .claude/skills/tailwind-patterns/SKILL.md и reference/tailwind-theme-mapping.md

- [TODO] ADR-0007: description «ONLY after an ADR selects Tailwind» (:3), «Pharmacy: контекст» (:29-36) «Tailwind не зафиксирован в stack.md… только после ADR», Iron Law «NO TAILWIND WITHOUT AN ACCEPTED ADR» (:53), раздел «1. Что должен решить ADR (чек-лист /03-adr)» (:57-66), «Tailwind без ADR → CSS Modules» (:320), Verify «ADR на Tailwind существует и принят» (:335) → снять «только после ADR»; ADR-0007 принят. reference/tailwind-theme-mapping.md:3, :10 «Только после ADR».
- [TODO] `clsx`/`tailwind-merge`/CVA «на согласование» (:35-36, :64, :152, :188-192) → собственный `cx()` (`libs/ui/src/lib/cx.ts` существует) и карты `Record<Variant,string>`; внешний `className` только для раскладки.
- [TODO] Пути-примеры: `apps/web/src/app/globals.css` (:126) → реально `apps/web/src/app/styles/global.css`; `libs/ui/src/lib/Button/Button.tsx` (:155) → папки `libs/ui/src/lib/button/…`; `apps/web/src/features/pos/PosScreen.tsx` (:214) → FSD (`pages/pos` / `widgets/pos`) — ADR-0017.
- [TODO] CSS Modules — только `ReceiptPrint` и `PosLayout` (ADR-0007 п.2); сейчас «CSS Modules вне слоёв» описано общо — PARTIAL.
- [DONE] Запрет arbitrary values, `dark:`, модификаторов прозрачности (:6, :320-341) — совпадает с ADR-0007 п.1.

## 29. .claude/skills/ui-standards-tokens (SKILL.md + 4 reference)

- SKILL.md: [TODO] «Tailwind применяется только после ADR… До ADR — CSS Modules» (:26-28), «UI-библиотеки, библиотеки иконок, i18n … только через ADR» (:29-30) → Tailwind принят (ADR-0007), i18n — use-intl (ADR-0015), иконки — свой набор SVG в `libs/ui` (копии Lucide с `THIRD_PARTY_NOTICES`); «Скил работает без какого-либо CSS-фреймворка» (:24); схема «(CSS Modules) | утилиты Tailwind — после ADR» (:83); «Проверки Tailwind… только если ADR выбрал Tailwind» (:151); «tailwind-patterns… только после ADR» (:190); добавить компоненты на нативной платформе (Select `appearance: base-select`, Dialog `<dialog>`, Popover API + anchor positioning, Combobox ARIA APG), требование ADR-0007 п.7 (чек-лист APG в шапке, тест клавиатуры, axe).
- reference/ui-design-tokens.md: [TODO] ADR-0017: «в корневом layout (App Router) или `_app.tsx` (Pages Router)» (:26) → только App Router, `apps/web/app/layout.tsx` — реэкспорт `RootLayout` из `src/app/layouts/RootLayout.tsx` (стили `src/app/styles/global.css`); пример пути `apps/web/src/app/layout.tsx` (:29). [TODO] ADR-0007: «Если ADR выберет Tailwind» (:4, :34), §10 «Пример компонента на CSS Modules» (Button.module.css, :362-411) — по ADR-0007 компоненты на Tailwind-утилитах, CSS Modules лишь для печати/POS-сетки; «`clsx`/`classnames` — только по согласованию» (:435) → `cx()`.
- reference/ui-accessibility-patterns.md: [TODO] ADR-0009: «`jest-axe` и т.п. — новая зависимость, по согласованию» (:211) → решено (jest-axe 11.0.0 в package.json) + `@axe-core/playwright` и гейт serious/critical. [TODO] ADR-0017: `apps/web/src/features/pos` (:51) → FSD (`features/scan` / `shared/lib`). [PARTIAL] ADR-0007: native `<dialog>` (:68-104) — совпадает; нет Popover/Select/Combobox/Tabs/Toast/DataTable; иконки «icon packages need approval» (:134) → свой набор SVG (Lucide копией).
- reference/ui-localization-formatting.md: [TODO] ADR-0015: «Библиотека i18n (react-intl, i18next, next-intl…) не выбрана… До решения — простой словарь» (:7-8) → use-intl (ICU, типизированные ключи, словари `ru`/`tg`, `shared/i18n`). [DONE] ADR-0016: «Валюта в системе одна» (:93).
- reference/ui-print-receipts.md: [TODO] ADR-0017: `apps/web/src/features/pos` (:107); [PARTIAL] «`print:`-варианты Tailwind (если ADR его выберет)» (:114) → ADR-0007 принят.

## 30. .claude/skills/web-performance-optimization (SKILL.md + references/optimization-checklists.md)

- SKILL.md: [TODO] ADR-0009: `@next/bundle-analyzer — согласовать` (:41) → `next experimental-analyze`; `web-vitals — согласовать` (:42) → devDependency без прод-бандла; виртуализация «ADR» (:45) → условно `@tanstack/react-virtual`; строка 251 «`@next/bundle-analyzer` — после согласования». [TODO] ADR-0015: «Обёртки IndexedDB (`idb`, Dexie), TanStack Query, Zustand… — ADR», «Service Worker — ADR» (:46-48) → решено (idb, TanStack Query, Zustand, Service Worker только в облачной сборке web). [TODO] ADR-0007: «Tailwind CSS — не в stack.md» (:49), «Tailwind не выбран в stack.md → только после ADR» (:259) → принят. [TODO] ADR-0017: «структура `features/`/`shared/`» (:257) → FSD.
- references/optimization-checklists.md: [TODO] ADR-0015: «Нативный IndexedDB API без обёрток; `idb`/Dexie — только после ADR» (:137-139) → `idb`; пример сканера на `event.key` (:94-105) → `event.code`; «HTTP-библиотеки (axios…) не выбраны» (:206) → тонкий клиент на fetch. [TODO] ADR-0009: цели/бюджет first-load (:21-26), Step 2 анализатор (:223-227), потолки/порядок фиксации бюджетов (:310-311, :337), виртуализация (:357-358), инструменты `@next/bundle-analyzer`/`web-vitals` «после согласования» (:512-513). [PARTIAL] ADR-0017: путь `apps/web/src/app/fonts.ts` (:413) — совместим со слоем `src/app` (проверить); отсутствия `_app` — ок.

## 31. .claude/agents/ui-standards-expert.md

- [TODO] ADR-0007: «`tailwind-patterns` — только если ADR выбрал Tailwind… до ADR — CSS Modules + токены» (:24), «UI-библиотеки… только после ADR» (:26), «или шкала Tailwind, если принята по ADR» (:31-32) → Tailwind принят; добавить проверки: «приложения используют только компоненты `libs/ui`», запрет UI-библиотек без ADR, чек-лист APG/клавиатурный тест/axe для виджетов.
- [TODO] ADR-0017: «`react-dev` — … структура features/shared» (:25) → слои FSD (проверять импорты вверх по слоям, public API, `nx fsd`).
- [TODO] ADR-0009 (axe): добавить проверку axe-гейта (serious/critical) в «Доступность».

## 32. .claude/agents/nestjs-api.md

- [TODO] ADR-0006: «ORM/слой доступа к данным и инструмент миграций (пока не выбраны)» (:44), «Схема/миграция (чистый SQL или выбранный по ADR инструмент)» (:52) → Kysely + pg, node-pg-migrate (SQL, только Up), `TenantDatabase`; ADR-0008 «библиотека хеширования паролей» (:46) → решено; «CI пока не выбран» (:57); «всё «пока не выбранное»… вводится через ADR» (:22-24) — ок.
- [DONE] ADR-0016: «валюта только TJS» (:47).

## 33. .claude/agents/postgresql-database-reviewer.md

- [TODO] ADR-0006: формат миграций — `apps/api/migrations/*.sql` (node-pg-migrate, только Up; `CREATE INDEX CONCURRENTLY` — отдельная `.mjs` с `noTransaction()`; «план отката» (:31) → откат только новой миграцией/из бэкапа); проверка каждой миграции этим агентом (ADR-0006 п.7).
- [TODO] ADR-0013: добавить проверки: класс таблицы в `table-classes.ts`, политики `TO <роль>` без `missing_ok`, явные гранты (exact set), без default privileges, SECURITY DEFINER-резолверы (owner `pharmacy_resolver`, `search_path`, `revoke execute from public`).

## 34. .claude/agents/nestjs-reviewer.md

- [PARTIAL] ADR-0006/0013/0018: проверка «технологии из proposed ADR не используются — ORM, Fastify…» (:30-31) — ORM теперь принят; добавить пункты: tenant-путь только через `TenantDatabase`, `PlatformDatabase` только в `app/platform/**` и `app/sync/**`, `@RequirePermission` по каталогу, охват точек. Основное содержание берётся из `reference/nestjs-review-checklist.md` (см. п. 22).

## 35. .claude/commands/scaffold-nestjs-api.md

- [TODO] ADR-0006: шаг 8 «ORM и инструмент миграций НЕ выбраны — ничего не устанавливать. Оставить `DatabaseModule`… TODO» (:42-44) → установить/подключить Kysely + pg + node-pg-migrate + kysely-codegen по ADR-0006 (`TenantDatabase`, `PlatformDatabase`, `scripts/migrate.mjs`, `migrations/`); «Запрещено: Prisma/TypeORM/Drizzle» (:53) — остаётся верным.
- [TODO] ADR-0009: «CI-пайплайны… CI пока не выбран» (:56); шаг 6 пути модулей (`nx g @nx/nest:module` под `app/<module>`) — сверить.
- commands/03-adr.md — изменений не требуется (статусная логика proposed/accepted корректна).

## 36. Файлы вне .claude/ , упомянутые ADR, но не относящиеся к документации (для справки, не входят в счёт)

- ADR-0014: `docker/` профиль офлайн-точки + `docker/env/*.env.example`, `libs/shared/dto` контракты sync.
- ADR-0015: ESLint-правила импорта `libs/shared/dto`, Jest под `uuid` (ESM) и `fake-indexeddb`, перенос `axios` в dev (package.json:92 пока в dependencies).
- ADR-0013: `docker/postgres/initdb` (сделано), `eslint.config.mjs` no-restricted-imports (сделано, followups Task 7).

---------------------------------------------------------------------------------------------------

## Целевые файлы по объёму работы (больше → меньше)

1. `.claude/skills/nestjs-api/reference/nestjs-config-data-access.md` — переписать (Kysely, TenantDatabase, BigInt, миграции, platform).
2. `.claude/skills/nestjs-api/reference/nestjs-security-auth.md` — переписать (scrypt/pepper, node-redis, cookie `__Host-`, CSRF, PgSessionStore, impersonation, RBAC каталог).
3. `.claude/skills/react-dev/SKILL.md` — переписать под FSD + ADR-0015/0009/0007/0018.
4. `.claude/skills/tailwind-patterns/SKILL.md` (+ reference) — снять «только после ADR», `cx()`, пути.
5. `.claude/skills/postgres-best-practices/` (SKILL.md + 12 rules: rls-basics, rls-performance, privileges, conn-pooling, conn-limits, lock-skip-locked, idempotency, stock, primary-keys, lowercase, fk-indexes, append-only).
6. `.claude/skills/nestjs-api/` остальные reference (~25 файлов с `DatabaseService`/`Tx`, пути `modules/`, тесты по ADR-0009) + `SKILL.md`.
7. `.claude/skills/ui-standards-tokens/` (SKILL + 4 reference).
8. `.claude/skills/web-performance-optimization/` (SKILL + checklists).
9. `docs/architecture/glossary.md` — ~15 терминов.
10. `docs/architecture/c4/container.md|.mmd`, `deployment.md|.mmd` (+ PNG вручную).
11. `docs/architecture/stack.md` — строка «Авторизация», Node/Redis-клиент, auth, секреты/pepper, sync-строка.
12. `.claude/agents/ui-standards-expert.md`, `nestjs-api.md`, `postgresql-database-reviewer.md`, `nestjs-reviewer.md`.
13. `.claude/commands/scaffold-nestjs-api.md`.
14. `CLAUDE.md` — 4-5 точечных правок (Next.js/ADR-0015, правило офлайн-точки ADR-0014, CI-формулировка, Redis-клиент, `logs migrate`, пароли в URL).
15. ADR-файлы: 0006 (имя `TenantDatabase` + ссылка на 0013), 0008 («рабочие обозначения»), 0009 (имя мока), 0013 (классы таблиц), 0014 (5 уточнений ленты/операций).

## ADR-требуемые обновления, у которых целевого файла нет

- Новый ADR «хранение файлов» (фото/сканы рецептов ПКУ) — файла нет (следующий номер 0019) — data-model/README.md:100.
- «Migration guide» (followups.md:64: FORCE RLS binds `pharmacy_owner`, backfills) — документа нет; предлагается раздел в `postgres-best-practices` или `docs/`.
- `docker/compose.offline.yml` / профиль офлайн-точки — ADR-0014; нет (упомянут в nestjs-templates-infrastructure.md:92 как существующий).
- `docs/architecture/generated/CLAUDE.pharmacy-app.md` — ADR-0013 просит обновить, но файл исторический и неизменяемый (ADR-0016:60, CLAUDE.md:59): конфликт указаний; рекомендуется поправить формулировку ADR-0013.
- PNG диаграмм C4 (`img/container.png`, `img/deployment.png`, при необходимости `context.png`) — перегенерация вручную отдельным шагом.
