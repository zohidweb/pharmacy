import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min, validateSync } from 'class-validator';

// Fail-fast validation of process env. Add DATABASE_URL / REDIS_URL here once the data layer
// (ADR-0006) and sessions (ADR-0008) are implemented.
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
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }
  return env;
}
