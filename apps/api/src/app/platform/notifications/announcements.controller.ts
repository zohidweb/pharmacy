import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { Announcement } from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/announcements.dto';

// Announcements to networks (spec 2026-10-19-operator-notifications, 5): the list for every operator,
// publishing and cancelling with `platform:manage`.
@Controller({ path: 'operator/announcements', version: '1' })
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @RequireOperatorPermission('platform:view')
  @Get()
  list(): Promise<Announcement[]> {
    return this.announcements.list();
  }

  /** 201; 400 `validation_failed` (`title`, `text`, `startsAt`, `endsAt`: `before_start`, `past`, `scope`). */
  @RequireOperatorPermission('platform:manage')
  @Post()
  create(@Body() body: CreateAnnouncementDto): Promise<Announcement> {
    return this.announcements.create(body);
  }

  /** 200; 404; 409 `not_active` — already cancelled or ended. */
  @RequireOperatorPermission('platform:manage')
  @Post(':id/cancellation')
  @HttpCode(200)
  cancel(@Param('id', new ParseUUIDPipe()) id: string): Promise<Announcement> {
    return this.announcements.cancel(id);
  }
}
