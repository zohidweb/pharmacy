import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  NotificationListResponse,
  NotificationPreferences,
} from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import {
  NotificationListQueryDto,
  NotificationPreferencesDto,
  ReadAllNotificationsDto,
} from './dto/notifications.dto';
import { PlatformNotificationsService } from './notifications.service';

// The notifications of the operator and the bell preferences (spec 2026-10-19-operator-notifications,
// 5): every operator of the platform sees them; «read» and the preferences are their own.
@Controller({ path: 'operator', version: '1' })
export class PlatformNotificationsController {
  constructor(private readonly notifications: PlatformNotificationsService) {}

  @RequireOperatorPermission('platform:view')
  @Get('notifications')
  list(
    @Query() query: NotificationListQueryDto,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(query);
  }

  /** 204: the visible notifications up to `upTo` (the newest one the operator saw) are read (N8). */
  @RequireOperatorPermission('platform:view')
  @Post('notifications/read-all')
  @HttpCode(204)
  readAll(@Body() body: ReadAllNotificationsDto): Promise<void> {
    return this.notifications.readAll(body.upTo ?? null);
  }

  @RequireOperatorPermission('platform:view')
  @Get('me/notification-preferences')
  preferences(): Promise<NotificationPreferences> {
    return this.notifications.preferences();
  }

  /** 400 `validation_failed` — a topic missing, unknown or not a boolean. */
  @RequireOperatorPermission('platform:view')
  @Put('me/notification-preferences')
  updatePreferences(
    @Body() body: NotificationPreferencesDto,
  ): Promise<NotificationPreferences> {
    return this.notifications.updatePreferences(body);
  }
}
