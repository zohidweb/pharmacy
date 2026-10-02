# NestJS Configuration Basics — Pharmacy

Fail-fast конфигурация apps/api: статический reader переменных окружения + агрегирующий
`ConfigModule`. Секреты на MVP — переменные окружения среды деплоя; локально — `.env`
(в `.gitignore`), в git — только `.env.example`.

## Static Configuration Reader

**File:** `apps/api/src/config/static-config-reader.ts`

```typescript
/**
 * Fail-fast env reader. All validation lives here; the app refuses to start
 * when a required variable is missing or malformed.
 */
import { StaticConfigurationException } from '../common/exceptions/static-configuration.exception';

const read = (key: string): string | undefined => {
  const value = process.env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const getRequiredString = (key: string): string => {
  const value = read(key);
  if (value === undefined) throw StaticConfigurationException.missingEnvVar(key);
  return value;
};

export const getRequiredInt = (key: string): number => {
  const raw = getRequiredString(key);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw StaticConfigurationException.invalidEnvVar(key, raw, 'integer');
  }
  return parsed;
};

export const getRequiredBoolean = (key: string): boolean => {
  const raw = getRequiredString(key).toLowerCase();
  if (raw !== 'true' && raw !== 'false') {
    throw StaticConfigurationException.invalidEnvVar(key, raw, 'true | false');
  }
  return raw === 'true';
};

export const getRequiredStringArray = (key: string): string[] =>
  getRequiredString(key).split(',').map((s) => s.trim()).filter(Boolean);

export const getOptionalString = (key: string): string | undefined => read(key);

export const getOptionalInt = (key: string): number | undefined => {
  const raw = read(key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw StaticConfigurationException.invalidEnvVar(key, raw, 'integer or unset');
  }
  return parsed;
};
```

`StaticConfigurationException` — в `nestjs-enterprise-patterns.md`.
В сообщениях об ошибке **не печатать значения** переменных, похожих на секреты
(`*_PASSWORD`, `*_SECRET`, `*_KEY`, `DATABASE_URL`).

## Configuration Module

**File:** `apps/api/src/app/config/config.module.ts` (when the registerAs() configs appear;
today `AppModule` calls `ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv })`)

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { validateEnv } from './env.validation';
import applicationConfig from './application.config';
import redisConfig from './redis.config';
import securityConfig from './security.config';
import sessionConfig from './session.config';
import fiscalConfig from './fiscal.config';

// Database settings are not a registerAs() config: env.validation.ts validates them and
// core/database builds DatabaseSettings for TenantDatabase / PlatformDatabase.
export const ALL_CONFIGS = [
  applicationConfig,
  redisConfig,
  securityConfig,
  sessionConfig,
  fiscalConfig,
];

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      load: ALL_CONFIGS,
      // Nx serve reads .env from the workspace root by default; set envFilePath explicitly if needed
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
```

## Individual Config Files

```typescript
// apps/api/src/config/application.config.ts
import { registerAs } from '@nestjs/config';
import { getRequiredInt, getRequiredString, getRequiredBoolean } from './static-config-reader';

export default registerAs('application', () => ({
  nodeEnv: getRequiredString('NODE_ENV'),
  port: getRequiredInt('PORT'),
  // cloud | offline — the same artifact runs in the cloud and on an offline store PC (ADR-0002)
  deploymentMode: getRequiredString('DEPLOYMENT_MODE') as 'cloud' | 'offline',
  enableSwagger: getRequiredBoolean('ENABLE_SWAGGER'),
}));
```

```typescript
// apps/api/src/config/session.config.ts
import { registerAs } from '@nestjs/config';
import { getRequiredInt } from './static-config-reader';

// Actual idle timeout is a tenant network setting (stored in DB).
// Env only bounds it: the tenant value is clamped to [min, max].
export default registerAs('session', () => ({
  idleTimeoutMinSeconds: getRequiredInt('SESSION_IDLE_TIMEOUT_MIN_SECONDS'),
  idleTimeoutMaxSeconds: getRequiredInt('SESSION_IDLE_TIMEOUT_MAX_SECONDS'),
  absoluteTtlSeconds: getRequiredInt('SESSION_ABSOLUTE_TTL_SECONDS'),
  pinMaxAttempts: getRequiredInt('PIN_MAX_ATTEMPTS'),
  pinLockoutSeconds: getRequiredInt('PIN_LOCKOUT_SECONDS'),
}));
```

```typescript
// apps/api/src/config/fiscal.config.ts — fiscal adapter (closed integration list; KKM vendor not chosen)
import { registerAs } from '@nestjs/config';
import { StaticConfigurationException } from '../common/exceptions/static-configuration.exception';
import { getOptionalString, getRequiredInt, getRequiredString } from './static-config-reader';

export default registerAs('fiscal', () => {
  const adapter = getRequiredString('FISCAL_ADAPTER');         // 'stub' in MVP, 'http' after the vendor is chosen
  if (adapter !== 'stub' && adapter !== 'http') {
    throw StaticConfigurationException.invalidEnvVar('FISCAL_ADAPTER', adapter, 'stub | http');
  }
  const baseUrl = getOptionalString('FISCAL_BASE_URL');        // HTTPS only; validated at startup
  if (adapter === 'http' && baseUrl === undefined) {
    throw StaticConfigurationException.missingEnvVar('FISCAL_BASE_URL');
  }
  return { adapter, baseUrl, timeoutMs: getRequiredInt('FISCAL_TIMEOUT_MS') } as const;
});
```

Аналогично: `redis.config.ts` (`REDIS_URL`), `security.config.ts` (сессии, PIN, pepper — ADR-0008;
CORS-настроек нет: CORS выключен, один origin). Настройки БД уже валидируются в `apps/api/src/app/config/env.validation.ts`
и собираются в `DatabaseSettings` модулями `core/database` (`DATABASE_URL` — роль
`pharmacy_app`, `PLATFORM_DATABASE_URL` — роль `pharmacy_platform`, пулы и таймауты).
`MIGRATION_DATABASE_URL` (роль `pharmacy_owner`) читает только мигратор — API его не получает.

## .env.example (коммитится; реальных значений нет)

```bash
NODE_ENV=development
PORT=3000
DEPLOYMENT_MODE=cloud
ENABLE_SWAGGER=true

# roles per ADR-0013; the real list is the root .env.example
DATABASE_URL=postgres://pharmacy_app:change-me-local-only@127.0.0.1:5432/pharmacy
PLATFORM_DATABASE_URL=postgres://pharmacy_platform:change-me-local-only@127.0.0.1:5432/pharmacy
MIGRATION_DATABASE_URL=postgres://pharmacy_owner:change-me-local-only@127.0.0.1:5432/pharmacy
DB_POOL_MAX=10
PLATFORM_DB_POOL_MAX=3
DB_STATEMENT_TIMEOUT_MS=5000
DB_LOCK_TIMEOUT_MS=2000
DB_CONNECTION_TIMEOUT_MS=5000
REDIS_URL=redis://:change-me-local-only@127.0.0.1:6379

SESSION_IDLE_TIMEOUT_MIN_SECONDS=300
SESSION_IDLE_TIMEOUT_MAX_SECONDS=43200
SESSION_ABSOLUTE_TTL_SECONDS=86400
PIN_MAX_ATTEMPTS=3
PIN_LOCKOUT_SECONDS=900

FISCAL_ADAPTER=stub
# FISCAL_BASE_URL=https://<kkm-vendor-host>   # required when FISCAL_ADAPTER=http
FISCAL_TIMEOUT_MS=5000
```

Каждый `getRequired*()` должен иметь строку в `.env.example`. Локальный `.env` создаётся
копированием `.env.example` и подстановкой значений локальной среды (compose из
`nestjs-templates-infrastructure.md`); `.env` никогда не коммитится.

## Использование в сервисах

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import sessionConfig from '../../config/session.config';

@Injectable()
export class SessionPolicy {
  constructor(
    @Inject(sessionConfig.KEY) private readonly cfg: ConfigType<typeof sessionConfig>,
  ) {}

  clampIdleTimeout(tenantSeconds: number): number {
    return Math.min(Math.max(tenantSeconds, this.cfg.idleTimeoutMinSeconds), this.cfg.idleTimeoutMaxSeconds);
  }
}
```

Предпочтительно `ConfigType<typeof x>` через `x.KEY` — типобезопасно, без строковых путей.
