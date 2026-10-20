import type {
  NotificationListQuery,
  NotificationPreferences,
  NotificationTopic,
} from '@pharmacy/shared-dto';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NOTIFICATION_TOPICS } from '../notification-topics';

/** GET /api/v1/operator/notifications (spec 2026-10-19-operator-notifications, N7). */
export class NotificationListQueryDto implements NotificationListQuery {
  @IsOptional()
  @IsIn(NOTIFICATION_TOPICS)
  topic?: NotificationTopic;

  /** Only the topics the operator keeps on for the bell (N9). */
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === true || value === 'true',
  )
  @IsBoolean()
  bell?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** PUT /api/v1/operator/me/notification-preferences — every topic on or off (N9). */
export class NotificationPreferencesDto implements NotificationPreferences {
  @IsBoolean()
  billing!: boolean;

  @IsBoolean()
  keys!: boolean;

  @IsBoolean()
  services!: boolean;

  @IsBoolean()
  sync!: boolean;
}
