import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { SiteMedia } from '@pharmacy/shared-dto';
import type { Response } from 'express';
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

  @RequireOperatorPermission('content:manage')
  @Get()
  list(
    @Query() query: SiteMediaListQueryDto,
  ): Promise<{ items: SiteMedia[]; total: number }> {
    return this.media.list(query.limit ?? 50, query.offset ?? 0);
  }

  /** The file itself; 404 `media_not_found`. Not stored by the browser (the global `no-store`). */
  @RequireOperatorPermission('content:manage')
  @Get(':id/content')
  async content(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    sendMedia(res, await this.media.content(id));
  }
}
