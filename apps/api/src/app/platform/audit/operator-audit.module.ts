import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { OperatorActivityController } from './operator-activity.controller';
import { OperatorAuditController } from './operator-audit.controller';
import { OperatorAuditRepository } from './operator-audit.repository';
import { OperatorAuditLogService } from './operator-audit.service';

// Reading the operators' audit log (platform_audit_log): the whole log and the signed-in
// operator's own recent events. Cloud only: an offline store has no operator contour. Writing
// stays in PlatformAuditModule, inside each operation's transaction.
@Module({
  imports: [PlatformDatabaseModule],
  controllers: [OperatorAuditController, OperatorActivityController],
  providers: [OperatorAuditRepository, OperatorAuditLogService],
})
export class OperatorAuditModule {}
