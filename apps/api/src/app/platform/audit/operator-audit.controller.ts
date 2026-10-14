import { Controller, Get, Query } from '@nestjs/common';
import type { OperatorAuditEntry, Page } from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import { OperatorAuditQueryDto } from './dto/operator-audit.dto';
import { OperatorAuditLogService } from './operator-audit.service';

const DEFAULT_LIMIT = 20;

// The operators' audit log, read only (data model 06): what operators and platform jobs did.
@Controller({ path: 'operator/operator-audit-log', version: '1' })
export class OperatorAuditController {
  constructor(private readonly audit: OperatorAuditLogService) {}

  /** Newest first; `from`/`to` are calendar dates of the platform, both included. */
  @RequireOperatorPermission('platform:view')
  @Get()
  list(@Query() query: OperatorAuditQueryDto): Promise<Page<OperatorAuditEntry>> {
    return this.audit.list({
      operatorId: query.operatorId?.toLowerCase() ?? null,
      tenantId: query.tenantId?.toLowerCase() ?? null,
      type: query.type ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
      limit: query.limit ?? DEFAULT_LIMIT,
      offset: query.offset ?? 0,
    });
  }
}
