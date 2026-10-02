# NestJS Configuration — Nx, npm & TypeScript

В Nx-монорепо у `apps/api` **нет собственного package.json для зависимостей** — все
зависимости в корневом `package.json`, установка строго `npm ci` по lock-файлу. Слой доступа к
данным — `nestjs-config-data-access.md`.

## Создание приложения (один раз)

```bash
npx nx add @nx/nest                       # plugin + generators
npx nx g @nx/nest:application apps/api    # Nx >= 20: path-based; e2e project apps/api-e2e
```

Синтаксис генераторов менялся между мажорными версиями Nx (в старых — `--directory`,
`--project`). Перед запуском сверяйтесь с `npx nx g @nx/nest:<generator> --help`.

## Зависимости apps/api

Версии не пинуем вручную в скиле — их ставит `npx nx add` / `npm install`, фиксирует
`package-lock.json`. Новая зависимость = проверка лицензии и реестра (правила AI usage в CLAUDE.md).

| Пакет | Зачем | Статус |
|---|---|---|
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `reflect-metadata`, `rxjs` | ядро NestJS (Express) | стек (ADR-0003) |
| `@nestjs/config` | конфигурация / env | стек |
| `class-validator`, `class-transformer` | валидация DTO (`libs/shared/dto`) | стек (CLAUDE.md) |
| `@nestjs/terminus` | health checks | библиотека экосистемы NestJS |
| `@nestjs/throttler` | rate limiting | библиотека экосистемы NestJS |
| `@nestjs/schedule` | плановые задачи (счета тенантам, очистка очередей), воркеры очередей-таблиц | библиотека экосистемы NestJS |
| `@nestjs/swagger` | OpenAPI-документация (опционально, не в проде публично) | библиотека экосистемы NestJS |
| `helmet` | заголовки безопасности (Express) | библиотека |
| `redis` (node-redis 6.x) | сессии, кэш, хранилище throttler | единственный Redis-клиент проекта (ADR-0008) |
| `kysely`, `pg` | доступ к PostgreSQL | ADR-0006; версии закреплены точно |
| `node-pg-migrate` | миграции (`apps/api/scripts/migrate.mjs`) | ADR-0006; runtime-зависимость — мигратор входит в образ API |
| `uuid` | `newId()` — UUIDv7 | ADR-0014 §2, ADR-0015 |
| хеширование паролей/PIN | аутентификация | **без зависимостей**: `crypto.scrypt` из `node:crypto` (ADR-0008); самописная криптография запрещена |

Dev: `@nx/nest`, `@nx/jest`, `jest`, `@swc/jest`, `@types/jest`, `@nestjs/testing`, `supertest`,
`@types/supertest`, `kysely-codegen`, `@types/pg`, `eslint-plugin-security`.

Версии `kysely`, `pg`, `node-pg-migrate`, `kysely-codegen`, `uuid` закрепляются точно (без `^`);
обновление Kysely (линия 0.x) — отдельным PR с прогоном интеграционных тестов (ADR-0006 п. 9).
ESM-only пакеты (`uuid`, `kysely`, `@nestjs/config`) перечислены в `apps/api/jest.esm-packages.cjs`
— общем списке `transformIgnorePatterns` обоих Jest-конфигов.

**Не добавлять:** `bullmq`, `amqplib`, `kafkajs` и любые брокеры; `@opentelemetry/*`, `pino`,
`winston`, SDK облачного логирования; `axios` в runtime API (HTTP-клиент фискализации и
синхронизации — встроенный `fetch`; `axios` допустим только в `api-e2e`, ADR-0015);
`decimal.js` и прочие десятичные типы для денег (деньги — integer дирамы); другой Redis-клиент;
`@nestjs/platform-fastify`, `@fastify/*`; `vitest`.

## Nx targets apps/api (project.json)

Генератор создаёт `build` (webpack/tsc), `serve`, `test` (Jest), `lint`. Команды:

```bash
npx nx serve api
npx nx build api --configuration=production
npx nx test api
npx nx lint api
npx nx e2e api-e2e
npx nx affected -t build test lint
```

Для Docker-образа включите в опциях `build` `generatePackageJson: true` — Nx сгенерирует
`dist/apps/api/package.json` только с реально используемыми зависимостями.

## TypeScript

`tsconfig.base.json` (корень) держит `paths` для libs; `apps/api/tsconfig.app.json` его расширяет.

```jsonc
// apps/api/tsconfig.app.json (ключевые опции)
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "module": "commonjs",
    "types": ["node"],
    "target": "es2021",
    "emitDecoratorMetadata": true,   // required by Nest DI
    "experimentalDecorators": true,
    "strict": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true
  },
  "exclude": ["jest.config.ts", "src/**/*.spec.ts", "src/**/*.test.ts"],
  "include": ["src/**/*.ts"]
}
```

```jsonc
// Libraries are npm workspaces: the import name is the package name (libs/**/package.json),
// resolved to source through the custom condition in tsconfig.base.json — no "paths".
// tsconfig.base.json (fragment)
{
  "compilerOptions": {
    "customConditions": ["@pharmacy/source"]
  }
}
// imports: '@pharmacy/shared-dto', '@pharmacy/shared-domain', '@pharmacy/shared-util', '@pharmacy/ui'
```

Грабли:
- Не переводить сборку api на esbuild: он не эмитит decorator metadata → ломается DI Nest.
- `libs/shared/dto` тоже должна компилироваться с `experimentalDecorators` (class-validator).
- Границы импорта проверяет `@nx/enforce-module-boundaries` в ESLint: apps не импортируют
  друг друга, только libs.
