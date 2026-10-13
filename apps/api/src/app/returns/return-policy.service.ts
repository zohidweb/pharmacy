import { Injectable } from '@nestjs/common';
import type { ReturnPolicy } from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { TenantDatabase } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import type { ReturnPolicyDto } from './dto/returns.dto';
import { ReturnsRepository } from './returns.repository';

// The return window and policy of the network (spec 2026-10-13-customer-returns, R3, E17): which
// kinds of products are taken back at the customer's wish; a defect is taken back always.
@Injectable()
export class ReturnPolicyService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: ReturnsRepository,
    private readonly audit: AuditService,
  ) {}

  get(): Promise<ReturnPolicy> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const settings = await this.repository.settings(trx, tenantId);
      return {
        returnWindowDays: settings.returnWindowDays,
        customerReturns: settings.customerReturns,
      };
    });
  }

  update(body: ReturnPolicyDto): Promise<ReturnPolicy> {
    const { tenantId, employeeId } = requirePrincipal();
    const next: ReturnPolicy = {
      returnWindowDays: body.returnWindowDays,
      customerReturns: {
        none: body.customerReturns.none,
        rx: body.customerReturns.rx,
        controlled: body.customerReturns.controlled,
      },
    };
    return this.db.tenantTransaction(async (trx) => {
      const before = await this.repository.settings(trx, tenantId);
      await this.repository.updatePolicy(trx, tenantId, next, employeeId);
      await this.audit.append(trx, {
        action: 'settings.returns-updated',
        entityType: 'tenant_settings',
        entityId: tenantId,
        details: {
          before: {
            returnWindowDays: before.returnWindowDays,
            customerReturns: before.customerReturns,
          },
          after: next,
        },
      });
      return next;
    });
  }
}
