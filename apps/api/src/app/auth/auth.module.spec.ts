import { randomBytes } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CryptoModule, parseKeyRing } from '../../core/crypto';
import { ContextResolvers, DatabaseModule } from '../../core/database';
import { RedisModule } from '../../core/redis/redis.module';
import { AuthModule } from './auth.module';
import { LoginClock, SystemLoginClock } from './login-clock';
import { LoginLimiter } from './login-limiter';
import { PrincipalLoader } from './principal-loader';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

// AuthModule wires its controller and services from the global core modules. Synthetic,
// unreachable URLs: nothing connects during compile (lazy pools, Redis connects on init only).

const key = () => randomBytes(32).toString('base64url');

const env = {
  STORE_MODE: 'cloud',
  REDIS_URL: 'redis://127.0.0.1:1/15',
  DATABASE_URL: 'postgresql://tenant-role@127.0.0.1:1/unit',
  DB_POOL_MAX: 2,
  DB_STATEMENT_TIMEOUT_MS: 1000,
  DB_LOCK_TIMEOUT_MS: 500,
  DB_CONNECTION_TIMEOUT_MS: 500,
  SESSION_IDLE_TIMEOUT_MIN_SECONDS: 300,
  SESSION_IDLE_TIMEOUT_MAX_SECONDS: 43200,
  SESSION_ABSOLUTE_TTL_SECONDS: 43200,
  LOGIN_MAX_FAILURES: 5,
  LOGIN_LOCK_SECONDS: 900,
  LOGIN_FAILURE_FLOOR_MS: 400,
  AUTH_TEST_COOKIES: false,
  jwtKeyRing: parseKeyRing(`k1:${key()}`, 'k1', 'SESSION_JWT_KEYS'),
  pepperRing: parseKeyRing(`1:${key()}`, '1', 'PASSWORD_PEPPERS'),
};

describe('AuthModule', () => {
  it('wires the sessions controller, service, limiter and principal loader', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () => env,
        }),
        DatabaseModule,
        CryptoModule,
        RedisModule,
        AuthModule,
      ],
    }).compile();

    expect(moduleRef.get(SessionsController)).toBeInstanceOf(
      SessionsController,
    );
    expect(moduleRef.get(SessionsService)).toBeInstanceOf(SessionsService);
    expect(moduleRef.get(LoginLimiter)).toBeInstanceOf(LoginLimiter);
    expect(moduleRef.get(LoginClock)).toBeInstanceOf(SystemLoginClock);
    expect(moduleRef.get(PrincipalLoader)).toBeInstanceOf(PrincipalLoader);
    expect(moduleRef.get(ContextResolvers)).toBeInstanceOf(ContextResolvers);
    await moduleRef.close();
  });
});
