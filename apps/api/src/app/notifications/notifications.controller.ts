import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { TenantNotificationListResponse } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { NotificationsQueryDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

// The notifications of the employee (spec 2026-10-14-owner-cabinet, 5.1, 5.4): reading refreshes
// them first (E11).
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @RequirePermission('notifications:view')
  @Get()
  list(
    @Query() query: NotificationsQueryDto,
  ): Promise<TenantNotificationListResponse> {
    return this.notifications.list(query);
  }

  /** 204: every notification the employee sees now is marked read for this employee only. */
  @RequirePermission('notifications:view')
  @Post('read-all')
  @HttpCode(204)
  readAll(): Promise<void> {
    return this.notifications.readAll();
  }
}
