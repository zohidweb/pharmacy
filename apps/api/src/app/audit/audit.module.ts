import { Module } from '@nestjs/common';
import { AuditFacts } from './audit-facts';
import { AuditJournal } from './audit-journal';
import { AuditJournalController } from './audit-journal.controller';
import { AuditJournalRepository } from './audit-journal.repository';
import { AuditService } from './audit.service';
import { SyncCoreModule } from '../../core/sync';

// Domain module boundary (ADR-0002). Other modules use only what is listed in `exports`. The
// journal reads the log of the network for the screen and the home (spec 2026-10-14-owner-cabinet,
// E7); an offline store reads its own log the same way.
@Module({
  imports: [SyncCoreModule],
  controllers: [AuditJournalController],
  // AuditFacts — the journal rows of offline stores without a domain operation (spec 2026-10-16-offline-sync)
  providers: [AuditService, AuditJournalRepository, AuditJournal, AuditFacts],
  exports: [AuditService, AuditJournal],
})
export class AuditModule {}
