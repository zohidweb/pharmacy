import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Page, SiteMedia } from '@pharmacy/shared-dto';
import type { Response } from 'express';
import { ProblemException } from '../../../common/errors/problem.exception';
import { isUuid } from '../../../core/database';
import { RequireOperatorPermission } from '../auth/decorators';
import {
  SiteMediaListQueryDto,
  UploadSiteMediaDto,
} from './dto/site-media.dto';
import { sendMedia } from './media-response';
import { SiteMediaService } from './site-media.service';

// The pictures of the site (spec 2026-10-28-public-site-design, 6.3): «Сайт → Картинки» of the admin.
@Controller({ path: 'operator/site-media', version: '1' })
export class SiteMediaController {
  constructor(private readonly media: SiteMediaService) {}

  /**
   * 201 with the record (the stored one when the same file is already there); 400 `validation_failed`, 400
   * `unsupported_media_type`, 413 `media_too_large`.
   */
  @RequireOperatorPermission('content:manage')
  @Post()
  upload(@Body() body: UploadSiteMediaDto): Promise<SiteMedia> {
    return this.media.upload(body);
  }

  /** The newest first; 20 by default, 100 at most. */
  @RequireOperatorPermission('content:manage')
  @Get()
  async list(@Query() query: SiteMediaListQueryDto): Promise<Page<SiteMedia>> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const page = await this.media.list(limit, offset);
    return { ...page, limit, offset };
  }

  /**
   * The file itself; 404 `media_not_found` (also for a malformed id, like the public route). Not stored by the browser
   * (the global `no-store`).
   */
  @RequireOperatorPermission('content:manage')
  @Get(':id/content')
  async content(@Param('id') id: string, @Res() res: Response): Promise<void> {
    if (!isUuid(id)) throw new ProblemException(404, 'media_not_found');
    sendMedia(res, await this.media.content(id));
  }
}
