import { Module } from '@nestjs/common';
import { AuditFacts } from './audit-facts';
import { AuditJournal } from './audit-journal';
import { AuditJournalController } from './audit-journal.controller';
import { AuditJournalRepository } from './audit-journal.repository';
import { AuditService } from './audit.service';
import { LoginLocks } from './login-locks';
import { PinSignIns } from './pin-sign-ins';
import { PriceChanges } from './price-changes';
import { ReceiptRefusals } from './receipt-refusals';
import { SyncCoreModule } from '../../core/sync';

// Domain module boundary (ADR-0002). Other modules use only what is listed in `exports`. The
// journal reads the log of the network for the screen and the home (spec 2026-10-14-owner-cabinet,
// E7); an offline store reads its own log the same way.
@Module({
  imports: [SyncCoreModule],
  controllers: [AuditJournalController],
  // AuditFacts — the journal rows of offline stores without a domain operation (spec 2026-10-16-offline-sync)
  // PinSignIns — who held a terminal at the moment of a POS operation sent under it (spec 2026-10-21-pos-offline-limits)
  // PriceChanges — the price of a store at the moment of a POS snapshot (security review 2026-10-22, I2)
  // ReceiptRefusals — the sales the price rules refused, for the owner's notification (I2)
  // LoginLocks — the sign-in locks of the employees, for the owner's notification (A2)
  providers: [
    AuditService,
    AuditJournalRepository,
    AuditJournal,
    AuditFacts,
    PinSignIns,
    PriceChanges,
    ReceiptRefusals,
    LoginLocks,
  ],
  exports: [
    AuditService,
    AuditJournal,
    PinSignIns,
    PriceChanges,
    ReceiptRefusals,
    LoginLocks,
  ],
})
export class AuditModule {}
