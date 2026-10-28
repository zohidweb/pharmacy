import { Controller, Get, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { PublicSiteInfo } from '@pharmacy/shared-dto';
import type { Response } from 'express';
import { PUBLIC_READ_LIMIT } from '../../../common/throttling/public-limits';
import { ProblemException } from '../../../common/errors/problem.exception';
import { Public } from '../../../common/guards/decorators';
import { isUuid } from '../../../core/database';
import { sendMedia } from './media-response';
import { SiteMediaService } from './site-media.service';
import { SiteSettingsService } from './site-settings.service';

// The public contour of the site (ADR-0023, spec 2026-10-28-public-site-design, 7.2): no session, reads only. The
// articles and the legal documents join the same path in their own controllers.
@Public()
@Throttle({ default: PUBLIC_READ_LIMIT })
@Controller({ path: 'public', version: '1' })
export class PublicSiteController {
  constructor(
    private readonly settings: SiteSettingsService,
    private readonly media: SiteMediaService,
  ) {}

  /** The settings of the site and the tariffs in one answer; the site keeps it for 60 seconds (A5). */
  @Get('site-info')
  siteInfo(): Promise<PublicSiteInfo> {
    return this.settings.siteInfo();
  }

  /**
   * The picture; the id never changes its content, so the answer is cached for a year. 404 `media_not_found` (also
   * for a malformed id) stays `no-store`: the header is set only with the image.
   */
  @Get('media/:id')
  async mediaFile(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!isUuid(id)) throw new ProblemException(404, 'media_not_found');
    const media = await this.media.publicContent(id);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    sendMedia(res, media);
  }
}
