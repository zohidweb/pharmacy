import { Module } from '@nestjs/common';
import { SessionsModule } from '../../core/sessions';
import { AuditModule } from '../audit/audit.module';
import { TerminalsController } from './terminals.controller';
import { TerminalsRepository } from './terminals.repository';
import { TerminalsService } from './terminals.service';

// Terminals and PIN sessions of the web contour (auth design 2026-10-02, section 8). TenantDatabase
// and ContextResolvers come from the global DatabaseModule, the Redis client from the global
// RedisModule.
@Module({
  imports: [SessionsModule, AuditModule],
  controllers: [TerminalsController],
  providers: [TerminalsRepository, TerminalsService],
  exports: [TerminalsService],
})
export class TerminalsModule {}
