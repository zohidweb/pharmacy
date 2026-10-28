import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { LegalDocumentsController } from './legal-documents.controller';
import { LegalDocumentsService } from './legal-documents.service';
import { PublicSiteController } from './public-site.controller';
import { SiteContentRepository } from './site-content.repository';
import { SiteMediaController } from './site-media.controller';
import { SiteMediaService } from './site-media.service';
import { SiteSettingsController } from './site-settings.controller';
import { SiteSettingsService } from './site-settings.service';

// The content of the public site (ADR-0023, spec 2026-10-28-public-site-design): the settings, the pictures and the legal
// documents here, the articles join them. The operator screens of «Сайт» and the public contour
// `/api/v1/public/*` (no session, reads only). Cloud only: an offline store has no site.
@Module({
  imports: [PlatformDatabaseModule, PlatformAuditModule],
  controllers: [
    SiteSettingsController,
    SiteMediaController,
    LegalDocumentsController,
    PublicSiteController,
  ],
  providers: [
    SiteContentRepository,
    SiteSettingsService,
    SiteMediaService,
    LegalDocumentsService,
  ],
  // Task 8 binds the consent of a connection request to the current privacy revision.
  exports: [LegalDocumentsService],
})
export class SiteContentModule {}
