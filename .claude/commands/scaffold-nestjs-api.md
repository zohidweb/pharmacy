---
description: Scaffold the NestJS API application (apps/api + apps/api-e2e) inside the Pharmacy Nx monorepo pharmacy
argument-hint: "[app name, default: api]"
allowed-tools: Bash, Read, Write, Edit
disable-model-invocation: true
source: "adapted from kumaran-is/claude-code-onboarding (MIT), develop@a7f2fc5"
---

# Scaffold NestJS API (Pharmacy)

**Имя приложения:** $ARGUMENTS (по умолчанию `api` — по структуре из корневой CLAUDE.md).

Работай по-русски. Все паттерны, шаблоны и конвенции — из скила `nestjs-api` (Iron Law:
сначала `reference/nestjs-conventions.md`). Стек — строго из CLAUDE.md `pharmacy` (ADR-0010).

## Предусловия (проверить ДО любых действий, иначе СТОП)

1. Команда запущена из корня репозитория `pharmacy` (в корне есть `nx.json`) — иначе остановись
   и сообщи пользователю. `apps/api` уже создан при инициализации; команда нужна для нового
   API-приложения (например, отдельного сервиса офлайн-точки) — и только после ADR о нём.
2. `apps/<имя>` ещё не существует — иначе остановись (не перезаписывать).
3. В корне есть `.gitignore` с `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.local`, `*.pem`,
   `*.key`, `.nx/cache` — если нет, создай/дополни его первым.

## Шаги

1. Прочитать скил `nestjs-api`: `reference/nestjs-conventions.md`, `nestjs-config-basics.md`,
   `nestjs-config-npm-ts.md`, `nestjs-templates-core.md`, `nestjs-templates-infrastructure.md`.
2. Подключить плагин Nx для NestJS, если его нет: `npx nx add @nx/nest`.
3. Сгенерировать приложение генератором Nx (НЕ `nest new`): `npx nx g @nx/nest:application apps/<имя>`
   — с e2e-проектом `apps/<имя>-e2e`, unit-тестами на Jest (стандарт Nx, НЕ Vitest).
   Перед запуском посмотри доступные опции: `npx nx g @nx/nest:application --help`.
4. HTTP-адаптер — стандартный NestJS (Express). Fastify — только после ADR.
5. Каркас по шаблонам скила: `main.ts` (глобальный префикс `api`, версия `v1`, `ValidationPipe`
   с whitelist/transform, exception filter RFC 7807 `application/problem+json`, Helmet, CORS только
   для origin'ов web/admin), `AppModule` → `ConfigModule` (fail-fast валидация env) → `CoreModule`
   (correlation ID через AsyncLocalStorage, контекст tenant/user/store) → доменные модули.
6. Пустые доменные модули по ADR-0002: `catalog`, `inventory`, `pos`, `purchasing`, `pricing`,
   `returns`, `billing`, `sync`, `fiscal`, `export-1c`, `audit` — каждый через `npx nx g @nx/nest:module`
   (с `--help` для проверки опций), без бизнес-логики.
7. Health-эндпоинт (`@nestjs/terminus`: PostgreSQL, Redis).
8. Слой доступа к данным: ORM и инструмент миграций НЕ выбраны — ничего не устанавливать. Оставить
   `DatabaseModule` с интерфейсом tenant-scoped доступа и TODO со ссылкой на будущий ADR
   (зафиксировать тикет, иначе нарушится Definition of Done — сообщить пользователю).
9. `.env.example` с полным списком переменных (без реальных значений); локальный `.env` — через Bash,
   в `.gitignore`. Для локальной среды — PostgreSQL и Redis из `docker/` (ADR-0005).
10. Проверка безопасности зависимостей: `npm audit --audit-level=high` — критичные/высокие CVE
    исправить или задокументировать.
11. Проверка: `npx nx build <имя>`, `npx nx test <имя>`, `npx nx lint <имя>`, `npx nx e2e <имя>-e2e`.

## Запрещено при скаффолде

- Устанавливать Prisma/TypeORM/Drizzle, Fastify, BullMQ/RabbitMQ/Kafka, pino/winston, OpenTelemetry,
  Vault и любые технологии без accepted ADR (proposed ADR недостаточно; см. `docs/architecture/stack.md`
  и `docs/architecture/adr/`).
- Настраивать CI-пайплайны (CI пока не выбран — вводится через ADR; до ADR проверки вручную, `npm run check`).
- Коммитить секреты и реальные данные.

## Итог

Выведи: созданные проекты Nx, установленные зависимости (с версиями), результаты проверок из шага 11,
и список отложенных решений, требующих ADR (ORM, миграции и т.д.).
