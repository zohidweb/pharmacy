import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// Domain module boundary (ADR-0002). Other modules use only what is listed in `exports`.
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
