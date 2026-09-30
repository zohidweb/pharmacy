import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min, validateSync } from 'class-validator';

// Fail-fast validation of process env. The database variables come from the data layer (ADR-0006);
// add REDIS_URL here once sessions (ADR-0008) are implemented.
const POSTGRES_URL = /^postgres(ql)?:\/\//;

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
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }
  return env;
}
