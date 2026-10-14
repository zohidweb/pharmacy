import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { OperatorAuditController } from './operator-audit.controller';
import { OperatorAuditRepository } from './operator-audit.repository';
import { OperatorAuditLogService } from './operator-audit.service';

// Reading the operators' audit log (platform_audit_log). Cloud only: an offline store has no
// operator contour. Writing stays in PlatformAuditModule, inside each operation's transaction.
@Module({
  imports: [PlatformDatabaseModule],
  controllers: [OperatorAuditController],
  providers: [OperatorAuditRepository, OperatorAuditLogService],
})
export class OperatorAuditModule {}
