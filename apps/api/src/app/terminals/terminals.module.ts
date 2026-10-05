import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT, type RedisClient } from '../../core/redis/redis.tokens';
import { SessionsModule } from '../../core/sessions';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { LoginLimiter } from '../auth/login-limiter';
import { TerminalSessionsController } from './terminal-sessions.controller';
import {
  TERMINAL_PIN_LIMITER,
  TerminalSessionsService,
} from './terminal-sessions.service';
import { TerminalsController } from './terminals.controller';
import { TerminalsRepository } from './terminals.repository';
import { TerminalsService } from './terminals.service';

// Terminals and PIN sessions of the web contour (auth design 2026-10-02, section 8). TenantDatabase
// and ContextResolvers come from the global DatabaseModule, PasswordHasher from the global
// CryptoModule, the Redis client from the global RedisModule; the session issuer and the principal
// loader from AuthModule.
@Module({
  imports: [SessionsModule, AuditModule, AuthModule],
  controllers: [TerminalsController, TerminalSessionsController],
  providers: [
    TerminalsRepository,
    TerminalsService,
    TerminalSessionsService,
    {
      provide: TERMINAL_PIN_LIMITER,
      inject: [REDIS_CLIENT, ConfigService],
      useFactory: (client: RedisClient | null, config: ConfigService) => {
        // The offline store gets its own limiter with part 4 of the design.
        if (client === null) {
          throw new Error(
            'The terminal PIN limiter supports STORE_MODE=cloud only until part 4 of the auth design',
          );
        }
        const windowSeconds = config.getOrThrow<number>(
          'TERMINAL_PIN_WINDOW_SECONDS',
        );
        // N failures within the window lock the terminal for the window; no longer repeat lock.
        return new LoginLimiter(client, {
          maxFailures: config.getOrThrow<number>('TERMINAL_PIN_MAX_FAILURES'),
          windowSeconds,
          lockSeconds: windowSeconds,
          repeatLockSeconds: windowSeconds,
          repeatWindowSeconds: windowSeconds,
        });
      },
    },
  ],
  exports: [TerminalsService],
})
export class TerminalsModule {}
