import { Injectable } from '@nestjs/common';
import type { Reminder } from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import { NotificationsService } from './notifications.service';

// The reminders of the home of the owner cabinet (spec 2026-10-14-owner-cabinet, E12): the
// notifications of the current employee, the unread ones first; none without `notifications:view`.
@Injectable()
export class Reminders {
  constructor(private readonly notifications: NotificationsService) {}

  forDashboard(trx: TenantTransaction, limit: number): Promise<Reminder[]> {
    return this.notifications.reminders(trx, limit);
  }
}
