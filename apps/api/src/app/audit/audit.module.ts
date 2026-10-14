import { Module } from '@nestjs/common';
import { AuditJournal } from './audit-journal';
import { AuditJournalController } from './audit-journal.controller';
import { AuditJournalRepository } from './audit-journal.repository';
import { AuditService } from './audit.service';

// Domain module boundary (ADR-0002). Other modules use only what is listed in `exports`. The
// journal reads the log of the network for the screen and the home (spec 2026-10-14-owner-cabinet,
// E7); an offline store reads its own log the same way.
@Module({
  controllers: [AuditJournalController],
  providers: [AuditService, AuditJournalRepository, AuditJournal],
  exports: [AuditService, AuditJournal],
})
export class AuditModule {}
