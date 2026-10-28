import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
  IsUUID,
} from 'class-validator';
import {
  holdsPublicDevelopmentKey,
  type KeyRing,
  parseKeyRing,
} from '../../core/crypto/key-ring';

// Fail-fast validation of process env. The database variables come from the data layer (ADR-0006);
// the auth variables from ADR-0008 (sessions, JWT, password pepper) and the auth design spec, section 11.
const POSTGRES_URL = /^postgres(ql)?:\/\//;
const REDIS_URL = /^rediss?:\/\//;
// http(s)://host[:port] with no path, query or fragment: compared with the Origin header (CSRF).
const ORIGIN = /^https?:\/\/[^\s/?#]+$/;
// Pepper ids are versions stored in password hashes.
const PEPPER_ID = /^[1-9][0-9]*$/;

// Env values are strings, and Boolean('false') is true: parse booleans explicitly.
function toBoolean({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}): unknown {
  const value = obj[key];
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return value;
}

class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  @IsOptional()
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  // Deployment environment (docker/env/*.env); independent of NODE_ENV, which is `production` in test and prod.
  @IsIn(['dev', 'test', 'prod'])
  @IsOptional()
  APP_ENV: 'dev' | 'test' | 'prod' = 'dev';

  // Env values are strings; convert explicitly instead of relying on emitted type metadata.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT = 3000;

  // Connection of the tenant-scoped role (pharmacy_app); the platform role is the cross-tenant one (ADR-0013).
  @Matches(POSTGRES_URL)
  DATABASE_URL!: string;

  @Matches(POSTGRES_URL)
  PLATFORM_DATABASE_URL!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  DB_POOL_MAX = 10;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  PLATFORM_DB_POOL_MAX = 3;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  DB_STATEMENT_TIMEOUT_MS = 5000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  DB_LOCK_TIMEOUT_MS = 2000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  DB_CONNECTION_TIMEOUT_MS = 5000;

  // --- Authentication (ADR-0008) ---

  // cloud: Redis server sessions; offline: sessions in the store's PostgreSQL.
  @IsIn(['cloud', 'offline'])
  @IsOptional()
  STORE_MODE: 'cloud' | 'offline' = 'cloud';

  // The one network an offline store serves (plan auth-part4, decision P1); required with
  // STORE_MODE=offline, refused in the cloud (cross-field check in validateEnv). Kept in lower case,
  // the form the database returns ids in: it is compared with them as a string.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID()
  @IsOptional()
  OFFLINE_TENANT_ID?: string;

  // The cloud routes of the offline-store sync, /api/v1/sync/*, and their 2 MB body parser (ADR-0014 §6): off unless
  // set, while no network has an offline store (security review 2026-10-22, decision 7.4). Cloud only.
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  OFFLINE_SYNC_ENABLED = false;

  // Required in cloud mode (cross-field check in validateEnv).
  @Matches(REDIS_URL)
  @IsOptional()
  REDIS_URL?: string;

  // Lists `id:base64url`; parsed and checked by parseKeyRing in validateEnv.
  @IsString()
  @IsNotEmpty()
  SESSION_JWT_KEYS!: string;

  @IsString()
  @IsNotEmpty()
  SESSION_JWT_ACTIVE_KID!: string;

  @IsString()
  @IsNotEmpty()
  PASSWORD_PEPPERS!: string;

  @IsString()
  @IsNotEmpty()
  PASSWORD_PEPPER_ACTIVE!: string;

  // Bounds of the network's idle timeout setting.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  SESSION_IDLE_TIMEOUT_MIN_SECONDS = 300;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  SESSION_IDLE_TIMEOUT_MAX_SECONDS = 43200;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  SESSION_ABSOLUTE_TTL_SECONDS = 43200;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  STEP_UP_MAX_AGE_SECONDS = 900;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  LOGIN_MAX_FAILURES = 5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  LOGIN_LOCK_SECONDS = 900;

  // Every 401 invalid_credentials answer is padded to this time (plus 0-50 ms of jitter) from the
  // start of the sign-in, so its timing does not tell a known identifier from an unknown one.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  LOGIN_FAILURE_FLOOR_MS = 400;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  ACTIVATION_CODE_TTL_HOURS = 72;

  // PIN failures on one terminal within the window lock the terminal (423 terminal_locked) until
  // the window has passed (auth design, section 8).
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  TERMINAL_PIN_MAX_FAILURES = 10;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(86400)
  @IsOptional()
  TERMINAL_PIN_WINDOW_SECONDS = 900;

  // Platform operator sessions (auth design, section 9): idle timeout and absolute lifetime.
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(86400)
  @IsOptional()
  OPERATOR_SESSION_IDLE_SECONDS = 1800;

  @Type(() => Number)
  @IsInt()
  @Min(300)
  @Max(86400)
  @IsOptional()
  OPERATOR_SESSION_ABSOLUTE_SECONDS = 28800;

  // Number of reverse proxies in front of the API (Express `trust proxy` hop count); 0 = no proxy,
  // req.ip is the socket address. Behind a proxy it must equal the real hop count: too low makes
  // every client share the proxy's address (one platform-wide rate-limit bucket), too high lets a
  // client spoof X-Forwarded-For. Set together with the reverse proxy of ADR-0012.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  @IsOptional()
  TRUST_PROXY = 0;

  // Allowed origins of the two web apps (CSRF Origin check).
  @Matches(ORIGIN)
  WEB_ORIGIN!: string;

  @Matches(ORIGIN)
  ADMIN_ORIGIN!: string;

  // The origin of the public marketing site (ADR-0023): its form posts to /api/v1/public/*.
  @Matches(ORIGIN)
  SITE_ORIGIN!: string;

  // e2e only: cookies without the __Host- prefix and Secure. A process outside APP_ENV=test refuses to start.
  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  AUTH_TEST_COOKIES = false;

  // Derived by validateEnv from the lists above (not environment variables).
  jwtKeyRing!: KeyRing;
  pepperRing!: KeyRing;
}

function parseRing(
  list: string,
  activeId: string,
  name: string,
  pepper = false,
): KeyRing {
  const ring = parseKeyRing(list, activeId, name);
  if (pepper && [...ring.keys.keys()].some((id) => !PEPPER_ID.test(id))) {
    throw new Error(`${name} ids must be positive integers`);
  }
  return ring;
}

const REDACTED = '[redacted]';

// Cross-field rules, checked once the fields themselves are valid.
function checkCrossFields(env: EnvironmentVariables): string[] {
  const problems: string[] = [];
  if (env.STORE_MODE === 'cloud' && !env.REDIS_URL) {
    problems.push('REDIS_URL is required when STORE_MODE=cloud');
  }
  if (env.STORE_MODE === 'offline' && !env.OFFLINE_TENANT_ID) {
    problems.push('OFFLINE_TENANT_ID is required when STORE_MODE=offline');
  }
  if (env.STORE_MODE === 'cloud' && env.OFFLINE_TENANT_ID) {
    problems.push('OFFLINE_TENANT_ID is allowed only when STORE_MODE=offline');
  }
  if (env.STORE_MODE === 'offline' && env.OFFLINE_SYNC_ENABLED) {
    problems.push(
      'OFFLINE_SYNC_ENABLED=true is allowed only when STORE_MODE=cloud (a store calls the cloud, never serves it)',
    );
  }
  if (
    env.SESSION_IDLE_TIMEOUT_MIN_SECONDS > env.SESSION_IDLE_TIMEOUT_MAX_SECONDS
  ) {
    problems.push(
      'SESSION_IDLE_TIMEOUT_MIN_SECONDS must not exceed SESSION_IDLE_TIMEOUT_MAX_SECONDS',
    );
  }
  if (env.AUTH_TEST_COOKIES && env.APP_ENV !== 'test') {
    problems.push('AUTH_TEST_COOKIES=true is allowed only when APP_ENV=test');
  }
  // parseKeyRing messages name the variable and never contain key material.
  try {
    env.jwtKeyRing = parseRing(
      env.SESSION_JWT_KEYS,
      env.SESSION_JWT_ACTIVE_KID,
      'SESSION_JWT_KEYS (SESSION_JWT_ACTIVE_KID)',
    );
  } catch (e) {
    problems.push((e as Error).message);
  }
  try {
    env.pepperRing = parseRing(
      env.PASSWORD_PEPPERS,
      env.PASSWORD_PEPPER_ACTIVE,
      'PASSWORD_PEPPERS (PASSWORD_PEPPER_ACTIVE)',
      true,
    );
  } catch (e) {
    problems.push((e as Error).message);
  }
  // A production copy of .env.example would sign sessions and pepper passwords with public keys.
  // Development and the e2e process (APP_ENV=test on a developer's .env) may keep them.
  if (env.APP_ENV === 'prod') {
    const rings = [
      ['SESSION_JWT_KEYS', env.jwtKeyRing],
      ['PASSWORD_PEPPERS', env.pepperRing],
    ] as const;
    for (const [name, ring] of rings) {
      if (ring !== undefined && holdsPublicDevelopmentKey(ring)) {
        problems.push(
          `${name} holds the public development key of .env.example; generate own keys`,
        );
      }
    }
    // the cloud prod runs behind the reverse proxy of ADR-0012 (security review 2026-10-22, A7 and decision 7.2): https
    // origins, and the real hop count — with 0 every guest behind the proxy shares one rate-limit bucket. An offline
    // store serves its browser on http://localhost without a proxy (ADR-0008, transport offline).
    if (env.STORE_MODE === 'cloud') {
      for (const name of ['WEB_ORIGIN', 'ADMIN_ORIGIN', 'SITE_ORIGIN'] as const) {
        if (!env[name].startsWith('https://')) {
          problems.push(`${name} must be an https:// origin when APP_ENV=prod`);
        }
      }
      if (env.TRUST_PROXY === 0) {
        problems.push(
          'TRUST_PROXY must be the number of reverse proxies in front of the API (at least 1) when APP_ENV=prod',
        );
      }
    }
  }
  return problems;
}

/** A cloud API (not an offline store) by the raw environment, as ConditionalModule sees it before ConfigService exists. */
export function cloudMode(env: NodeJS.ProcessEnv): boolean {
  return env.STORE_MODE !== 'offline';
}

/**
 * The sync contour switch read from the raw environment, as ConditionalModule sees it before ConfigService exists: the
 * same parse as the validated OFFLINE_SYNC_ENABLED (validateEnv refuses any other value, and `true` offline).
 */
export function offlineSyncEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.STORE_MODE !== 'offline' &&
    String(env.OFFLINE_SYNC_ENABLED ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env, {
    skipMissingProperties: false,
    validationError: { target: false, value: false },
  });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }
  const problems = checkCrossFields(env);
  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration: ${problems.join('; ')}`,
    );
  }
  // The key lists live on as the parsed rings only: a config object logged or serialized by
  // mistake must not carry key material (the rings print their ids only).
  env.SESSION_JWT_KEYS = REDACTED;
  env.PASSWORD_PEPPERS = REDACTED;
  return env;
}
