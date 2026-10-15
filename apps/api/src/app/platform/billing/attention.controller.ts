import { Controller, Get } from '@nestjs/common';
import type { AttentionCounts } from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import { ServiceOrdersService } from './service-orders.service';

// The counters of the admin menu (spec 2026-10-15-billing-services, A18): the requests without a
// decision. Licenses and operator notifications do not exist yet, so their counters are 0.
@Controller({ path: 'operator/attention-counts', version: '1' })
export class AttentionController {
  constructor(private readonly orders: ServiceOrdersService) {}

  @RequireOperatorPermission('platform:view')
  @Get()
  async counts(): Promise<AttentionCounts> {
    return {
      serviceRequests: await this.orders.pendingCount(),
      expiringLicenses: 0,
      unreadNotifications: 0,
    };
  }
}
