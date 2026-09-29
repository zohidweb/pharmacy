# NestJS Infrastructure Templates — Docker, compose, Jest

Docker в проекте — по ADR-0005 (`docs/architecture/adr/0005-vybor-docker.md`): **только** для офлайн-дистрибутива
точки и локальной среды разработки. Файлы — в `docker/` монорепо. Оркестраторы,
CI-пайплайны сборки образов и реестры — вне этого скила (пока не выбраны — вводятся через ADR).
Базовые образы — только официальные образы (реестр образов определяется в рамках ADR-0005); теги — конкретные, не `latest`.

## Dockerfile api (docker/api.Dockerfile)

```dockerfile
# Build stage: whole monorepo, Nx builds only apps/api and its libs
FROM node:24-alpine AS builder
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# build target must have generatePackageJson: true -> dist/apps/api/package.json + lock file
RUN npx nx build api --configuration=production

# Runtime stage: production deps only, non-root
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /workspace/dist/apps/api ./
RUN npm ci --omit=dev && npm cache clean --force
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health/live || exit 1
CMD ["node", "main.js"]
```

- Секреты (`DATABASE_URL`, лицензионный ключ точки) не запекаются в образ — только env
  при запуске (`env_file`, вне git).
- Миграции — отдельная одноразовая команда перед стартом новой версии (инструмент — по ADR),
  не в `CMD` приложения.

## .dockerignore

```
node_modules
dist
coverage
tmp
.nx
.git
.env
.env.*
!.env.example
**/*.spec.ts
apps/*-e2e
```

## Локальная среда разработки (docker/compose.dev.yml)

Только зависимости; сами приложения — `npx nx serve api|web|admin` на хосте.

```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports: ["127.0.0.1:5432:5432"]
    environment:
      POSTGRES_USER: pharmacy
      POSTGRES_PASSWORD: ${LOCAL_DB_PASSWORD:?set in docker/.env}
      POSTGRES_DB: pharmacy
    volumes: [pg-data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pharmacy"]
      interval: 10s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["127.0.0.1:6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 5

volumes:
  pg-data:
```

```bash
docker compose -f docker/compose.dev.yml up -d
```

Порты публикуются только на `127.0.0.1`. Данные — синтетические, никаких реальных
клиентских данных в локальной БД и фикстурах.

## Офлайн-дистрибутив точки (docker/compose.offline.yml)

Тот же артефакт api, что в облаке (ADR-0002), с `DEPLOYMENT_MODE=offline` и локальной PostgreSQL.

```yaml
services:
  api:
    image: pharmacy-api:${PHARMACY_VERSION:?}
    env_file: ./offline.env            # not in git: DATABASE_URL, REDIS_URL, license key, cloud sync URL
    environment:
      DEPLOYMENT_MODE: offline
    ports: ["127.0.0.1:3000:3000"]     # open to the store LAN only by explicit decision (TLS required)
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    restart: unless-stopped

  postgres:
    image: postgres:17-alpine
    env_file: ./offline.env
    volumes: [pg-data:/var/lib/postgresql/data]   # not published to the host network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 10s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

volumes:
  pg-data:
```

Открытые вопросы — решать ADR до реализации, не «по месту»:
- как раздаётся статика `apps/web` на офлайн-точке (например, `@nestjs/serve-static` в api
  или отдельный веб-сервер — последний означает новую технологию);
- TLS внутри точки, если к api подключаются терминалы по LAN;
- резервное копирование локальной PostgreSQL и процедура обновления версии/миграций.

## Jest (apps/api/jest.config.ts, генерирует Nx)

```typescript
export default {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/api',
};
```

- Запуск: `npx nx test api` (`--coverage`, `--watch`), e2e: `npx nx e2e api-e2e`.
- Алиасы `@pharmacy/shared/*` резолвит пресет Nx из `tsconfig.base.json` — отдельный
  `moduleNameMapper` не нужен.
- Не включайте `retry` флейки-тестов: нестабильный тест чинится, а не перезапускается.
- Пороги покрытия, интеграционные тесты с реальной PostgreSQL —
  `nestjs-testing-integration-setup.md`, `nestjs-testing-ci-troubleshooting.md`.
