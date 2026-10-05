import { Module } from '@nestjs/common';
import { PlatformAuditService } from './platform-audit.service';

// Platform audit (platform_audit_log). Used only by modules of app/platform/**.
@Module({
  providers: [PlatformAuditService],
  exports: [PlatformAuditService],
})
export class PlatformAuditModule {}
