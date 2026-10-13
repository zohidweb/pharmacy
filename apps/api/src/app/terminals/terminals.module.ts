import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { deriveRingKey, type KeyRing } from '../../core/crypto';
import { REDIS_CLIENT, type RedisClient } from '../../core/redis/redis.tokens';
import { SessionsModule } from '../../core/sessions';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { LIMITER_KEY_PURPOSE, RedisLoginLimiter } from '../auth/login-limiter';
import { MemoryLoginLimiter } from '../auth/memory-login-limiter';
import { MePinController } from './me-pin.controller';
import { MePinService } from './me-pin.service';
import { TerminalSessionsController } from './terminal-sessions.controller';
import {
  TERMINAL_PIN_LIMITER,
  TerminalSessionsService,
} from './terminal-sessions.service';
import { TerminalsController } from './terminals.controller';
import { TerminalRevocationChecks } from './terminal-revocation-checks';
import { TerminalsRepository } from './terminals.repository';
import { TerminalsService } from './terminals.service';

// Terminals and PIN sessions of the web contour (auth design 2026-10-02, section 8). TenantDatabase
// and ContextResolvers come from the global DatabaseModule, PasswordHasher from the global
// CryptoModule, the Redis client from the global RedisModule; the session issuer and the principal
// loader from AuthModule.
@Module({
  imports: [SessionsModule, AuditModule, AuthModule],
  controllers: [TerminalsController, TerminalSessionsController, MePinController],
  providers: [
    TerminalsRepository,
    TerminalRevocationChecks,
    TerminalsService,
    TerminalSessionsService,
    MePinService,
    {
      provide: TERMINAL_PIN_LIMITER,
      inject: [REDIS_CLIENT, ConfigService],
      useFactory: (client: RedisClient | null, config: ConfigService) => {
        const windowSeconds = config.getOrThrow<number>(
          'TERMINAL_PIN_WINDOW_SECONDS',
        );
        // N failures within the window lock the terminal for the window; no longer repeat lock.
        const options = {
          maxFailures: config.getOrThrow<number>('TERMINAL_PIN_MAX_FAILURES'),
          windowSeconds,
          lockSeconds: windowSeconds,
          repeatLockSeconds: windowSeconds,
          repeatWindowSeconds: windowSeconds,
        };
        // No Redis on an offline store: the counters live in the single API process.
        return client === null
          ? new MemoryLoginLimiter(options)
          : new RedisLoginLimiter(
              client,
              options,
              deriveRingKey(config.getOrThrow<KeyRing>('pepperRing'), LIMITER_KEY_PURPOSE),
            );
      },
    },
  ],
  exports: [TerminalsService, TerminalRevocationChecks],
})
export class TerminalsModule {}
