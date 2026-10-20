import type {
  AnnouncementScope,
  CreateAnnouncementRequest,
} from '@pharmacy/shared-dto';
import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const SCOPES: AnnouncementScope[] = ['all', 'cloud', 'offline'];

/**
 * POST /api/v1/operator/announcements (spec 2026-10-19-operator-notifications, N12): the order of the
 * dates and an end in the past are checked by the service (field `endsAt`).
 */
export class CreateAnnouncementDto implements CreateAnnouncementRequest {
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  title!: string;

  @Transform(trim)
  @IsString()
  @Length(10, 1000)
  text!: string;

  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsISO8601({ strict: true })
  endsAt!: string;

  @IsIn(SCOPES)
  scope!: AnnouncementScope;
}
