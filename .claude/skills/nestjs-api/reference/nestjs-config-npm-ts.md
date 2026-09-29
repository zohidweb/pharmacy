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
| `@nestjs/schedule` | курсы НБТ по расписанию, воркеры очередей-таблиц | библиотека экосистемы NestJS |
| `@nestjs/swagger` | OpenAPI-документация (опционально, не в проде публично) | библиотека экосистемы NestJS |
| `helmet` | заголовки безопасности (Express) | библиотека |
| Redis-клиент (`ioredis` **или** `redis`) | сессии, кэш | Redis утверждён; выбрать **один** клиент и зафиксировать |
| `pg` / ORM | доступ к PostgreSQL | **требует ADR** (ORM не выбран) |
| библиотека хеширования паролей/PIN | аутентификация | **требует ADR + согласования ИБ** («Криптография (библиотеки)» на утверждении) |

Dev: `@nx/nest`, `@nx/jest`, `jest`, `ts-jest`, `@types/jest`, `@nestjs/testing`, `supertest`,
`@types/supertest`, `eslint-plugin-security`.

**Не добавлять:** `bullmq`, `amqplib`, `kafkajs` и любые брокеры; `@opentelemetry/*`, `pino`,
`winston`, SDK облачного логирования; `axios` (для НБТ хватает встроенного `fetch` Node LTS);
`decimal.js` и прочие десятичные типы для денег (деньги — integer дирамы); `uuid`
(есть `crypto.randomUUID()`); `@nestjs/platform-fastify`, `@fastify/*`; `vitest`.

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
// tsconfig.base.json (фрагмент) — имена алиасов задаются генератором libs, пример:
{
  "compilerOptions": {
    "paths": {
      "@pharmacy/shared/dto": ["libs/shared/dto/src/index.ts"],
      "@pharmacy/shared/domain": ["libs/shared/domain/src/index.ts"],
      "@pharmacy/shared/util": ["libs/shared/util/src/index.ts"]
    }
  }
}
```

Грабли:
- Не переводить сборку api на esbuild: он не эмитит decorator metadata → ломается DI Nest.
- `libs/shared/dto` тоже должна компилироваться с `experimentalDecorators` (class-validator).
- Границы импорта проверяет `@nx/enforce-module-boundaries` в ESLint: apps не импортируют
  друг друга, только libs.
