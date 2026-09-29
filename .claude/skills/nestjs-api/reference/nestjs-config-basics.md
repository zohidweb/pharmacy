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

**File:** `apps/api/src/config/config.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import applicationConfig from './application.config';
import databaseConfig from './database.config';
import redisConfig from './redis.config';
import securityConfig from './security.config';
import sessionConfig from './session.config';
import nbtConfig from './nbt.config';

export const ALL_CONFIGS = [
  applicationConfig,
  databaseConfig,
  redisConfig,
  securityConfig,
  sessionConfig,
  nbtConfig,
];

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
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
// apps/api/src/config/nbt.config.ts — NBT exchange rates (closed integration list)
import { registerAs } from '@nestjs/config';
import { getRequiredString, getRequiredInt } from './static-config-reader';

export default registerAs('nbt', () => ({
  baseUrl: getRequiredString('NBT_RATES_BASE_URL'), // HTTPS only; validated at startup
  timeoutMs: getRequiredInt('NBT_RATES_TIMEOUT_MS'),
}));
```

Аналогично: `database.config.ts` (`DATABASE_URL`, размер пула), `redis.config.ts`
(`REDIS_URL`), `security.config.ts` (`SECURITY_CORS_ORIGINS` — список, без `*`).

## .env.example (коммитится; реальных значений нет)

```bash
NODE_ENV=development
PORT=3000
DEPLOYMENT_MODE=cloud
ENABLE_SWAGGER=true

DATABASE_URL=postgresql://pharmacy:<password>@localhost:5432/pharmacy
DATABASE_POOL_MAX=10
REDIS_URL=redis://localhost:6379

SECURITY_CORS_ORIGINS=http://localhost:4200,http://localhost:4300

SESSION_IDLE_TIMEOUT_MIN_SECONDS=300
SESSION_IDLE_TIMEOUT_MAX_SECONDS=43200
SESSION_ABSOLUTE_TTL_SECONDS=86400
PIN_MAX_ATTEMPTS=5
PIN_LOCKOUT_SECONDS=900

NBT_RATES_BASE_URL=https://<nbt-host>
NBT_RATES_TIMEOUT_MS=5000
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
