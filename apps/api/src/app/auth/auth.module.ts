import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { deriveRingKey, type KeyRing } from '../../core/crypto';
import { REDIS_CLIENT, type RedisClient } from '../../core/redis/redis.tokens';
import { SessionsModule } from '../../core/sessions';
import { AuditModule } from '../audit/audit.module';
import { ACCOUNT_LIMITER_OPTIONS, AccountLimiter } from './account-limiter';
import { ActivationsController } from './activations.controller';
import { ActivationsService } from './activations.service';
import { EmployeeAuthRepository } from './employee-auth.repository';
import { LoginClock, SystemLoginClock } from './login-clock';
import {
  LIMITER_KEY_PURPOSE,
  LOGIN_LIMITER_DEFAULTS,
  LoginLimiter,
  type LoginLimiterOptions,
  RedisLoginLimiter,
} from './login-limiter';
import { MemoryLoginLimiter } from './memory-login-limiter';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { PermissionsVersionRepository } from './permissions-version.repository';
import { PermissionsVersionService } from './permissions-version.service';
import { PrincipalLoader } from './principal-loader';
import { SessionsController } from './sessions.controller';
import { SessionIssuer } from './session-issuer';
import { SessionsService } from './sessions.service';
import { SignInLocks } from './sign-in-locks';

// A limiter with the given policy. No Redis on an offline store: the counters live in the single
// API process.
function createLimiter(
  client: RedisClient | null,
  config: ConfigService,
  options: LoginLimiterOptions,
): LoginLimiter {
  return client === null
    ? new MemoryLoginLimiter(options)
    : new RedisLoginLimiter(
        client,
        options,
        deriveRingKey(
          config.getOrThrow<KeyRing>('pepperRing'),
          LIMITER_KEY_PURPOSE,
        ),
      );
}

// Employee authentication of the web contour (auth design 2026-10-02): sessions, owner activation
// by a one-time code, the login limiter and the principal loader. TenantDatabase and
// ContextResolvers come from the global DatabaseModule, PasswordHasher and SessionTokenService
// from the global CryptoModule, the Redis client from the global RedisModule.
@Module({
  imports: [SessionsModule, AuditModule],
  controllers: [SessionsController, ActivationsController, MeController],
  providers: [
    EmployeeAuthRepository,
    PrincipalLoader,
    SessionsService,
    SessionIssuer,
    ActivationsService,
    MeService,
    PermissionsVersionRepository,
    PermissionsVersionService,
    { provide: LoginClock, useClass: SystemLoginClock },
    {
      provide: LoginLimiter,
      inject: [REDIS_CLIENT, ConfigService],
      useFactory: (client: RedisClient | null, config: ConfigService) =>
        createLimiter(client, config, {
          ...LOGIN_LIMITER_DEFAULTS,
          maxFailures: config.getOrThrow<number>('LOGIN_MAX_FAILURES'),
          lockSeconds: config.getOrThrow<number>('LOGIN_LOCK_SECONDS'),
        }),
    },
    {
      provide: AccountLimiter,
      inject: [REDIS_CLIENT, ConfigService],
      useFactory: (client: RedisClient | null, config: ConfigService) =>
        createLimiter(client, config, ACCOUNT_LIMITER_OPTIONS),
    },
    SignInLocks,
  ],
  exports: [
    PrincipalLoader,
    PermissionsVersionService,
    SessionIssuer,
    LoginLimiter,
    LoginClock,
    SignInLocks,
  ],
})
export class AuthModule {}
