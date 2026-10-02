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
} from 'class-validator';
import { type KeyRing, parseKeyRing } from '../../core/crypto/key-ring';

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

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  ACTIVATION_CODE_TTL_HOURS = 72;

  // Allowed origins of the two web apps (CSRF Origin check).
  @Matches(ORIGIN)
  WEB_ORIGIN!: string;

  @Matches(ORIGIN)
  ADMIN_ORIGIN!: string;

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

// Cross-field rules, checked once the fields themselves are valid.
function checkCrossFields(env: EnvironmentVariables): string[] {
  const problems: string[] = [];
  if (env.STORE_MODE === 'cloud' && !env.REDIS_URL) {
    problems.push('REDIS_URL is required when STORE_MODE=cloud');
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
  return problems;
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
  return env;
}
