# Скилы, агенты и документы под принятые ADR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести скилы, агентов, команды Claude Code и архитектурные документы в соответствие с принятыми ADR, моделью данных и реальным кодом плана B — чтобы AI и разработчики не копировали устаревшие решения.

**Architecture:** Спецификация — чек-лист `docs/superpowers/plans/2026-10-02-skills-update-checklist.md` (164 пункта по 73 файлам со статусами и ссылками на строки). Сначала добавляется скрипт `tools/scripts/check-docs.mjs`: он ищет устаревшие формулировки и битые относительные ссылки. Затем задачи по областям закрывают пункты чек-листа; каждая задача заканчивается зелёным прогоном скрипта на своих файлах.

**Tech Stack:** Markdown, Node 24 (скрипт без зависимостей), Mermaid (C4).

**Spec:**
- `docs/superpowers/plans/2026-10-02-skills-update-checklist.md` — что менять, по файлам и строкам;
- ADR-0006…0018 (accepted), `docs/architecture/data-model/`, `docs/superpowers/plans/2026-09-30-data-layer-followups.md`;
- код как источник истины для имён: `apps/api/src/core/database/`, `apps/api/migrations/`, `docker/postgres/initdb/`.

## Global Constraints

- Имена из кода, а не из старых скилов:
  - `TenantDatabase.withTenant(tenantId, (trx) => …)` и `TenantDatabase.tenantTransaction((trx) => …)`, тип `TenantTransaction = Transaction<DB>`;
  - `PlatformDatabase.platformTransaction(actor, (trx) => …)`, `PlatformActor = { kind: 'operator'; operatorId } | { kind: 'system'; job }`;
  - `newId()` — UUIDv7;
  - модули — `apps/api/src/app/<module>/`, база — `apps/api/src/core/database/`, контекст — `apps/api/src/common/context/request-context.ts`;
  - алиасы — `@pharmacy/shared-dto`, `@pharmacy/shared-domain`, `@pharmacy/shared-util`, `@pharmacy/ui`.
- Схема в примерах — по модели данных:
  - первичный ключ тенантной таблицы `(tenant_id, id)`, `id` без `default`;
  - ссылки составные `(tenant_id, x_id)`;
  - деньги `bigint` `_dirams`, количества `integer` `_pieces`, проценты `_bp`;
  - политика `for all to pharmacy_app using/with check (tenant_id = (select current_setting('app.tenant_id')::uuid))`, без `missing_ok`;
  - гранты явные.
- Команды:
  - `npx nx run api:migrate`, `npx nx run api:integration`, `npx nx run api:db-types`, `npx nx run api:db-types-verify`;
  - миграции — `apps/api/migrations/*.sql`, только Up; вне транзакции — `.mjs` с `pgm.noTransaction()`.
- **Решения, а не варианты.** Принятые ADR — это решения. Фразы «не выбран», «по согласованию», «вариант А» для решённого убрать; вместо них ссылка на ADR. Отклонённые альтернативы упоминаются только с явным «не используем (ADR-00xx)».
- **Язык.** Проза — русская, код и комментарии в коде — английские. Стиль и структура скилов (frontmatter `name`/`description`, разделы) сохраняются; `description` меняется, только если устарели триггеры.
- **Не менять:**
  - `docs/architecture/generated/` (исторический артефакт);
  - лицензионные шапки и `.claude/THIRD_PARTY_NOTICES.md` (MIT) — только дополнять.
- **Безопасность примеров:** никаких секретов и реальных данных; примеры RLS и прав никогда не ослабляют модель ADR-0013 (нет `BYPASSRLS`, нет политик без `TO`).
- **PNG диаграмм C4** перегенерирует пользователь вручную. В плане — только `.md` и `.mmd`.
- **Вне плана:**
  - ADR-0019 «хранение файлов» (`/03-adr` отдельно);
  - профиль офлайн-точки в `docker/` (план синхронизации);
  - CI (план C).

## Review Focus

1. **Пример в скиле расходится с реальным кодом** (имя метода, тип, путь, сигнатура). Тогда AI-агент генерирует некомпилирующийся код. Ожидание: каждый пример `TenantDatabase` / `PlatformDatabase` / `newId` совпадает с `apps/api/src/core/database/*`. Ревьюер задачи сверяет примеры с кодом.
2. **Пример RLS или прав ослабляет модель:** политика без `TO`, `current_setting(…, true)`, `alter default privileges … to pharmacy_app`, `id` с `default` у тенантной таблицы. Ожидание: `check-docs` ловит эти шаблоны (Task 1), ревьюер проверяет остальное.
3. **Перенос или переименование файла ломает ссылки** между скилами, агентами и CLAUDE.md. Ожидание: `check-docs` проверяет существование относительных ссылок (Task 1).
4. **Устаревшая формулировка остаётся в файле, которого нет в чек-листе.** Ожидание: финальный прогон `check-docs` по всем `.claude/**`, `CLAUDE.md` и `docs/architecture/*.md` (Task 9).
5. **Правка ADR меняет принятое решение без отметки архитектора.** Ожидание: все содержательные поправки ADR-0013 и ADR-0014 оформлены разделом «Поправка 2026-10-02» и строкой в `APPROVAL.md` (Task 9). Терминологические правки — без смены решения.

---

### Task 1: Скрипт проверки документации

**Files:**
- Create: `tools/scripts/check-docs.mjs`, `tools/scripts/check-docs.test.mjs`
- Modify: `package.json` — скрипт `"docs:check": "node tools/scripts/check-docs.mjs"`

**Interfaces:**
- Produces: `node tools/scripts/check-docs.mjs [paths…]`.
  - Без аргументов проверяет `.claude/skills`, `.claude/agents`, `.claude/commands`, `CLAUDE.md`, `docs/architecture/glossary.md`, `docs/architecture/stack.md`, `docs/architecture/c4`.
  - Для каждого `.md` выводит `file:line: <rule>: <text>`; код выхода 1 при нарушениях, 0 — без.
  - Строка с маркером `<!-- docs-check: ok -->` пропускается: это намеренное упоминание.
  - Экспорт для теста: `checkText(path: string, text: string, exists: (p: string) => boolean): Violation[]`, где `Violation = { line: number; rule: string; text: string }`.

Правила (`rule` — имя, регулярное выражение без учёта регистра):

| rule | Шаблон |
|---|---|
| `orm-undecided` | `ORM (и инструмент миграций )?(НЕ )?не выбран\|ORM не выбран` |
| `rejected-orm` | `\b(Prisma\|TypeORM\|MikroORM\|Drizzle)\b` |
| `old-db-service` | `DatabaseService\|tx\.query\(` |
| `old-module-path` | `apps/api/src/modules/` |
| `currency` | `НБТ\|курс(ы\|ов)? валют\|exchange[ _-]?rate` |
| `old-redis-client` | `\bioredis\b` |
| `old-hash` | `\bbcrypt\b` |
| `fsd-old-layer` | `\b_app\b\|\b_pages\b` |
| `ci-undecided` | `CI (пока )?не выбран` |
| `tailwind-pending` | `только после ADR-0007` |
| `rls-missing-ok` | `current_setting\('app\.tenant_id',\s*true\)` |
| `uuid-default` | `gen_random_uuid\(\)` |
| `old-alias` | `@pharmacy/shared/(dto\|domain\|util)` |
| `broken-link` | относительная ссылка `](path)` или `](path#anchor)` на несуществующий файл; `http(s):`, `mailto:` и `#anchor` пропускаются; путь — относительно файла |

- [ ] **Step 1: Тест `check-docs.test.mjs`** (`node --test`):
  - `flags each stale pattern with its rule name` — по одной строке на правило, ожидаемые `rule`;
  - `skips a line marked docs-check: ok`;
  - `reports a relative link to a missing file and accepts an existing one` — через подставной `exists`;
  - `ignores http links and pure anchors`;
  - `reports 1-based line numbers`.

- [ ] **Step 2: Запустить** `node --test tools/scripts/check-docs.test.mjs`. Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать** `check-docs.mjs` (без зависимостей, `node:fs`, `node:path`). Запуск как CLI — только если файл вызван напрямую.

- [ ] **Step 4: Запустить тест.** Expected: PASS. Затем `npm run docs:check`. Expected: код 1 и список нарушений по текущим файлам — это «красный» снимок для задач 2–9. Сохранить его число строк в отчёт.

- [ ] **Step 5: Commit**

```bash
git add tools/scripts/check-docs.mjs tools/scripts/check-docs.test.mjs package.json
git commit -m "build: docs:check — stale ADR wording and broken links in skills and docs"
```

---

Задачи 2–9 устроены одинаково. Это решает исполнитель:
1. Прочитать свои разделы чек-листа.
2. Сверить формулировки с ADR и кодом.
3. Закрыть каждый пункт `TODO` и `PARTIAL`; `DONE` не трогать.
4. Прогнать `node tools/scripts/check-docs.mjs <файлы задачи>` — Expected: код 0.
5. Закоммитить.

В отчёте задачи — таблица «пункт чек-листа → что сделано» и список намеренных упоминаний с маркером `docs-check: ok`.

### Task 2: nestjs-api — доступ к данным

**Spec:** разделы чек-листа §14 (`SKILL.md`), §15 (`reference/nestjs-config-data-access.md` — переписать), §17, §18, §19.

**Files:** `.claude/skills/nestjs-api/SKILL.md`, `.claude/skills/nestjs-api/reference/{nestjs-config-data-access,nestjs-config-npm-ts,nestjs-conventions,nestjs-config-basics}.md`

**Interfaces:**
- Produces: раздел «Доступ к данным» в `nestjs-config-data-access.md` — эталон, на который ссылаются задачи 3–6. Обязательные подразделы:
  - `TenantDatabase` и `tenantTransaction` (контекст — из `requireTenantId()`);
  - `withTenant` (только guards и job runner);
  - `PlatformDatabase` (только `app/platform/**`, `app/sync/**`);
  - транзакции и «блокировка отдельно от подсчёта» (ADR-0006 п. 2);
  - `bigint` и сериализация в DTO;
  - миграции node-pg-migrate (только Up, `.mjs` + `noTransaction`, роль owner, `api:migrate`);
  - `kysely-codegen` (`api:db-types`, `db-types-verify`);
  - манифест `table-classes.ts`;
  - интеграционные тесты (`*.int-spec.ts`, `api:integration`, `pharmacy_test`).

- [ ] **Step 1: Прогнать** `node tools/scripts/check-docs.mjs <файлы задачи>`. Expected: нарушения есть (красный снимок).
- [ ] **Step 2: Внести правки** по пунктам §14, §15, §17–§19. Примеры кода — по реальным файлам `apps/api/src/core/database/*`, без выдуманных API.
- [ ] **Step 3: Прогнать** `node tools/scripts/check-docs.mjs <файлы задачи>`. Expected: код 0.
- [ ] **Step 4: Commit** — `docs(skills): nestjs-api data access per ADR-0006/0013 and the real core/database`.

### Task 3: nestjs-api — безопасность, контекст, чек-лист ревью

**Spec:** §16 (`nestjs-security-auth.md` — переписать под ADR-0008, 0013, 0014, 0018), §21, §22.

**Files:** `.claude/skills/nestjs-api/reference/{nestjs-security-auth,nestjs-resilience-context,nestjs-review-checklist}.md`

**Interfaces:**
- Consumes: эталон доступа к данным из Task 2 (ссылки на него, а не повтор).
- Produces: разделы, на которые ссылаются агенты (Task 6):
  - `nestjs-security-auth.md#пароли-и-pin` — scrypt `N=2^15, r=8, p=3`, pepper HMAC-SHA-256, PHC, `needsRehash`;
  - `#сессии` — `__Host-sid`, `__Host-op_sid`, node-redis, `PgSessionStore` офлайн;
  - `#csrf` — Sec-Fetch-Site / Origin / JSON;
  - `#терминал-и-pin` — device-cookie, лимиты 3 и 10/15 мин;
  - `#от-имени` — E2: только просмотр, 60 мин;
  - `#авторизация` — каталог `модуль:действие` в `libs/shared/domain`, `@RequirePermission`, запрет по умолчанию, охват точек, запрет эскалации, `permissions_version`, `finance:view-cost`.
- В `nestjs-resilience-context.md` — `RequestContext` из реального `request-context.ts` и правило: контекст **неизменяемый после guard** (follow-up плана B: заморозить перед реализацией guards).

- [ ] **Steps 1–4** — как в общей схеме. Commit — `docs(skills): nestjs-api security per ADR-0008/0018, context and review checklist`.

### Task 4: nestjs-api — остальные справочники

**Spec:** §20 (`nestjs-messaging-basics.md` — цикл по тенантам, `enqueuePlatform`), §24 (около 20 файлов с идиомой `DatabaseService`/`Tx`, путями `modules/`, формулировкой «CI не выбран»).

**Files:** файлы, перечисленные в §20 и §24 чек-листа.

- [ ] **Steps 1–4.** Пример внешнего клиента — адаптер фискализации, не НБТ (ADR-0016). Commit — `docs(skills): nestjs-api references use TenantDatabase, app/<module> paths, decided CI`.

### Task 5: nestjs-api — тестирование (ADR-0009)

**Spec:** §23.

**Files:** тестовые справочники `nestjs-api/reference` из §23.

- [ ] **Steps 1–4.** Решения ADR-0009 вместо «согласовать»:
  - фейки портов + `jest.spyOn(global.fetch)`, без nock и MSW;
  - свои билдеры в `libs/shared/testing`, без faker и `@golevelup/ts-jest`;
  - пороги покрытия из таблицы ADR-0009;
  - бюджеты API кассы;
  - интеграционный стенд плана B (`api:integration`, `pharmacy_test`, имя `*_test`).

  Commit — `docs(skills): nestjs-api testing per ADR-0009 and the integration stand`.

### Task 6: postgres-best-practices, агенты и команда scaffold

**Spec:** §25, §26 (12 правил), §32, §33, §34, §35; follow-up плана B «FORCE RLS действует на pharmacy_owner — бэкфиллы в контексте тенанта».

**Files:**
- `.claude/skills/postgres-best-practices/SKILL.md`, `rules/*` из §26;
- Create: `.claude/skills/postgres-best-practices/rules/schema-migrations.md` — миграции node-pg-migrate: только Up, `.mjs` + `pgm.noTransaction()` для `CONCURRENTLY`, роль owner, FORCE RLS действует и на owner, поэтому бэкфиллы данных — с `set_config('app.tenant_id', …, true)` по тенантам; гранты по классу таблицы; запись в `table-classes.ts` в том же PR. Ссылка на правило — из `SKILL.md`;
- `.claude/agents/{nestjs-api,postgresql-database-reviewer,nestjs-reviewer}.md`, `.claude/commands/scaffold-nestjs-api.md`.

**Interfaces:**
- Consumes: эталоны из Task 2 и Task 3 — агенты и команда ссылаются на них.

- [ ] **Steps 1–4.** Блок «Не решено» в `SKILL.md` убрать; модель ролей — ADR-0013 (`pharmacy_owner`, `pharmacy_app`, `pharmacy_platform`, `pharmacy_resolver`). Примеры политик — только `to pharmacy_app` и fail-closed. Commit — `docs(skills): postgres rules, agents and scaffold command per ADR-0006/0013/0014`.

### Task 7: react-dev и агент ui-standards-expert (FSD, ADR-0015, 0018)

**Spec:** §27 (`react-dev/SKILL.md` — переписать), §31.

**Files:** `.claude/skills/react-dev/SKILL.md` (и reference, если есть), `.claude/agents/ui-standards-expert.md`

**Interfaces:**
- Produces: раздел «Структура проекта» `react-dev`:
  - корневая `app/` — маршруты-реэкспорты; пустая `pages/` с README;
  - `src/{app,pages,widgets,features,entities,shared}`;
  - «pages first»; сегменты `ui/model/api/lib/config`; public API `index.ts`; `@x`;
  - `npx nx fsd <app>`, ESLint `tools/eslint-rules/fsd-layers.mjs`;
  - `RootLayout` — в `src/app/layouts` (Steiger запрещает `ui` в слое `app`).

  Библиотеки ADR-0015 с версиями: TanStack Query 5, Zustand 5, React Hook Form + zod 4, use-intl, idb, uuid; свои API-клиент, Service Worker, сканер. Права в профиле сессии — только для UI (ADR-0018). Хуки `usePathname`/`useSearchParams`/`useParams` возвращают `null`-совместимые типы из-за корневой `pages/` (follow-up плана A).

- [ ] **Steps 1–4.** Commit — `docs(skills): react-dev and ui-standards-expert per FSD (ADR-0017) and ADR-0015/0018`.

### Task 8: tailwind-patterns, ui-standards-tokens, web-performance-optimization

**Spec:** §28, §29 (в том числе `_app.tsx` в `ui-design-tokens.md`, i18n — use-intl, jest-axe — решение ADR-0009), §30 (решения ADR-0015/0009 вместо «согласовать»).

**Files:** `.claude/skills/tailwind-patterns/**`, `.claude/skills/ui-standards-tokens/**`, `.claude/skills/web-performance-optimization/**`

- [ ] **Steps 1–4.** Tailwind v4 поверх токенов `--ph-*`, свой `cx()`; пути примеров — FSD. Commit — `docs(skills): tailwind, tokens and web performance per ADR-0007/0009/0015/0017`.

### Task 9: CLAUDE.md, stack.md, глоссарий, C4, правки ADR и итоговая проверка

**Spec:** §1–§11, §13.

**Files:**
- `CLAUDE.md`, `docs/architecture/stack.md`, `docs/architecture/glossary.md`;
- `docs/architecture/c4/{container,deployment,context}.md|.mmd`;
- ADR 0006, 0008, 0009, 0013, 0014;
- `docs/architecture/APPROVAL.md`, `docs/architecture/data-model/README.md` (отметить закрытые пункты «Что уточнить»).

Правила для ADR:
- **Терминологические правки** (0006: имя `TenantDatabase` и ссылка на ADR-0013; 0008: «рабочие обозначения прав» → ссылка на каталог ADR-0018; 0009: имя мока) — без изменения решения.
- **Содержательные уточнения ADR-0014** (пункты data-model/README «Что уточнить» и §11):
  - лента «облако → точка» включает `drug_reference`, `services`, `dictionary_values`, `payment_methods`, `legal_entities`, `categories`, `tenant_settings`;
  - долг по приходу офлайн-точки заводит облако;
  - заказы, оплаты поставщикам и заявки — только в облаке;
  - отмена проведения на офлайн-точке запрещена;
  - `return.completed` включает автоматическое списание просроченного.
- **ADR-0013:** классы `service_requests` (tenant-export), `store_billing` (platform), `legal_entities` (tenant); формулировка о `generated/CLAUDE.pharmacy-app.md` — «исторический артефакт, не меняется».
- Содержательные уточнения оформляются разделом «Поправка 2026-10-02» + строкой в `APPROVAL.md`. Решения уже приняты архитектором при утверждении модели данных 2026-09-30 / 2026-10-01; поправка их фиксирует.

- [ ] **Step 1: Правки** по §1–§11, §13. Глоссарий — недостающие термины из чек-листа §3, в том числе «Юрлицо сети», «Бизнес-дата», «Счётчик номеров», «Право», «Охват точек», «Витрина тенанта», «Платформенные данные».
- [ ] **Step 2: Итоговая проверка** — `npm run docs:check` (все пути по умолчанию). Expected: код 0. Отдельно — `node tools/scripts/check-docs.mjs docs/architecture/adr docs/architecture/data-model`: устаревшие формулировки там допустимы только как история решения с маркером `docs-check: ok`.
- [ ] **Step 3: Commit** — `docs: CLAUDE.md, stack, glossary, C4 and ADR amendments per accepted decisions`.
- [ ] **Step 4: Попросить пользователя** перегенерировать PNG C4 (`docs/architecture/c4/img/*.png`) из обновлённых `.mmd` и запустить `npm run check`.
