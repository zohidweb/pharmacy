import { Controller, Get } from '@nestjs/common';
import type { OperatorAuditEntry } from '@pharmacy/shared-dto';
import { requireOperator } from '../../../common/context/request-context';
import { RequireOperatorPermission } from '../auth/decorators';
import { OperatorAuditLogService } from './operator-audit.service';

// «Мои последние действия» in the profile: the newest events of the operators' audit log the
// signed-in operator did himself.
const RECENT = 5;

@Controller({ path: 'operator/me/activity', version: '1' })
export class OperatorActivityController {
  constructor(private readonly audit: OperatorAuditLogService) {}

  @RequireOperatorPermission('platform:view')
  @Get()
  async list(): Promise<OperatorAuditEntry[]> {
    const page = await this.audit.list({
      operatorId: requireOperator().operatorId,
      tenantId: null,
      type: null,
      from: null,
      to: null,
      limit: RECENT,
      offset: 0,
    });
    return page.items;
  }
}
