import { Controller, Get } from '@nestjs/common';
import type { TenantAnnouncement } from '@pharmacy/shared-dto';
import { Authenticated } from '../../common/guards/decorators';
import { NotificationsService } from './notifications.service';

// The announcements of the platform for the staff of a network (spec 2026-10-19-operator-notifications,
// N13, N14): any signed-in employee. Cloud only, as the module.
@Controller({ path: 'announcements', version: '1' })
export class AnnouncementsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Authenticated()
  @Get()
  list(): Promise<TenantAnnouncement[]> {
    return this.notifications.announcements();
  }
}
