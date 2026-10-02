# NestJS Infrastructure — Docker, compose, Jest (реальные файлы репозитория)

Docker — по ADR-0005: облачные среды test/prod, офлайн-дистрибутив точки и локальная среда.
Файлы уже есть в репозитории — этот справочник объясняет, где что лежит и какие правила
действуют; содержимое файлов не дублируется. CI — GitHub Actions (ADR-0009); пока
workflow-файлов нет, качество проверяется вручную `npm run check` и шагом `build` скрипта стека.

## Образ API — `apps/api/Dockerfile`

- Multi-stage: сборка `npx nx run api:prune --configuration=production` → `apps/api/dist`
  (`main.js`, урезанные `package.json` / `package-lock.json`, `scripts/migrate.mjs`,
  `migrations/*.sql`) → runtime `npm ci --omit=dev`, пользователь `node`, healthcheck на
  `/api/v1/health`.
- Базовый образ `node:24.x-alpine` закреплён по версии **и digest**; обновление — осознанно.
- Контекст сборки — корень репозитория (`.dockerignore` исключает env-файлы и `docker/env`).
- Мигратор (`node-pg-migrate`) — runtime-зависимость: тот же образ запускает миграции.

## Compose — `docker/compose.yml` + `docker/compose.<dev|test|prod>.yml`

| Сервис | Роль |
|---|---|
| `postgres` | образ `docker/postgres` (PostgreSQL 17, initdb: роли `pharmacy_owner` / `pharmacy_app` / `pharmacy_platform` / `pharmacy_resolver`, БД принадлежит owner, схема `pharmacy`, `pg_trgm`; в dev — пустая `pharmacy_test`) |
| `redis` | образ `docker/redis`, без персистентности, пароль обязателен |
| `migrate` | образ API, `node scripts/migrate.mjs` ролью `pharmacy_owner`; one-shot до старта API |
| `api` | `DATABASE_URL` (`pharmacy_app`), `PLATFORM_DATABASE_URL` (`pharmacy_platform`); пароль owner в API не передаётся; стартует после `migrate: service_completed_successfully` |

- Порты публикуются только на `127.0.0.1`. Env-файлы: dev — корневой `.env`, test/prod —
  `docker/env/<env>.env` (не в git; `npm run stack -- <env> init` создаёт из примера со
  случайными паролями).
- initdb выполняется только на **пустом томе**: изменение ролей — пересоздание тома (с данными
  — только по согласованию).
- Команды: `npm run dev:deps` (PostgreSQL + Redis для `npx nx serve api`),
  `npm run stack -- <dev|test|prod> <init|build|up|down|ps|logs>`; упавшую миграцию смотреть
  `npm run stack -- <env> logs migrate`.

## Офлайн-точка (ADR-0014)

Тот же образ API и PostgreSQL, один тенант, без Redis (сессии — `PgSessionStore`, throttler —
in-memory), обновление — `pg_dump` → миграции тем же `scripts/migrate.mjs` → новый образ.
Профиль compose офлайн-точки и флеш-комплект появятся с модулем `sync`; до этого ориентир —
ADR-0014 §4–7. Доступ к точке с других ПК по LAN требует TLS и отдельного решения.

## Jest

- `apps/api/jest.config.cts` (unit, `*.spec.ts`) и `apps/api/jest.integration.config.cts`
  (`*.int-spec.ts`, globalSetup пересоздаёт `pharmacy_test`) — трансформер `@swc/jest`.
- ESM-only пакеты (`uuid`, `kysely`, `@nestjs/config`) — общий список
  `apps/api/jest.esm-packages.cjs` в `transformIgnorePatterns` обоих конфигов: новый ESM-пакет
  добавляется туда.
- Запуск: `npx nx test api` (`--coverage`, `--watch`), `npx nx run api:integration`,
  `npx nx e2e api-e2e`.
- Библиотеки `@pharmacy/*` резолвятся как пакеты npm workspaces (`customConditions`) —
  `moduleNameMapper` не нужен.
- Не включайте `retry` флейки-тестов: нестабильный тест чинится, а не перезапускается.
- Пороги покрытия и стенд — `nestjs-testing-integration-setup.md`,
  `nestjs-testing-ci-troubleshooting.md`.
