import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PublicSiteController } from './public-site.controller';
import { SiteContentRepository } from './site-content.repository';
import { SiteMediaController } from './site-media.controller';
import { SiteMediaService } from './site-media.service';
import { SiteSettingsController } from './site-settings.controller';
import { SiteSettingsService } from './site-settings.service';

// The content of the public site (ADR-0023, spec 2026-10-28-public-site-design): the settings and the pictures here, the
// legal documents and the articles join them. The operator screens of «Сайт» and the public contour
// `/api/v1/public/*` (no session, reads only). Cloud only: an offline store has no site.
@Module({
  imports: [PlatformDatabaseModule, PlatformAuditModule],
  controllers: [
    SiteSettingsController,
    SiteMediaController,
    PublicSiteController,
  ],
  providers: [SiteContentRepository, SiteSettingsService, SiteMediaService],
})
export class SiteContentModule {}
