import { Controller, Get } from '@nestjs/common';
import type { AttentionCounts } from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import { PlatformNotificationsService } from './notifications.service';

// The counters of the admin menu (spec 2026-10-15-billing-services, A18; spec
// 2026-10-19-operator-notifications, N9): the requests without a decision and the unread notifications
// of the topics the operator keeps on for the bell. Licenses come with the keys screen (stage 6).
@Controller({ path: 'operator/attention-counts', version: '1' })
export class AttentionController {
  constructor(private readonly notifications: PlatformNotificationsService) {}

  @RequireOperatorPermission('platform:view')
  @Get()
  counts(): Promise<AttentionCounts> {
    return this.notifications.attention();
  }
}
