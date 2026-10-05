import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT, type RedisClient } from '../../core/redis/redis.tokens';
import { SessionsModule } from '../../core/sessions';
import { AuditModule } from '../audit/audit.module';
import { ActivationsController } from './activations.controller';
import { ActivationsService } from './activations.service';
import { EmployeeAuthRepository } from './employee-auth.repository';
import { LoginClock, SystemLoginClock } from './login-clock';
import { LOGIN_LIMITER_DEFAULTS, LoginLimiter } from './login-limiter';
import { PrincipalLoader } from './principal-loader';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

// Employee authentication of the web contour (auth design 2026-10-02): sessions, owner activation
// by a one-time code, the login limiter and the principal loader. TenantDatabase and
// ContextResolvers come from the global DatabaseModule, PasswordHasher and SessionTokenService
// from the global CryptoModule, the Redis client from the global RedisModule.
@Module({
  imports: [SessionsModule, AuditModule],
  controllers: [SessionsController, ActivationsController],
  providers: [
    EmployeeAuthRepository,
    PrincipalLoader,
    SessionsService,
    ActivationsService,
    { provide: LoginClock, useClass: SystemLoginClock },
    {
      provide: LoginLimiter,
      inject: [REDIS_CLIENT, ConfigService],
      useFactory: (client: RedisClient | null, config: ConfigService) => {
        // The PostgreSQL implementation for STORE_MODE=offline arrives with part 4 of the design.
        if (client === null) {
          throw new Error(
            'The login limiter supports STORE_MODE=cloud only until part 4 of the auth design',
          );
        }
        return new LoginLimiter(client, {
          ...LOGIN_LIMITER_DEFAULTS,
          maxFailures: config.getOrThrow<number>('LOGIN_MAX_FAILURES'),
          lockSeconds: config.getOrThrow<number>('LOGIN_LOCK_SECONDS'),
        });
      },
    },
  ],
  exports: [PrincipalLoader],
})
export class AuthModule {}
