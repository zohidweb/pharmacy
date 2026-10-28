import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common';
import type {
  LegalDocumentDraft,
  LegalDocumentRevision,
  LegalDocumentsOverview,
} from '@pharmacy/shared-dto';
import type { Response } from 'express';
import { RequireFreshAuth } from '../../../common/guards/decorators';
import { RequireOperatorPermission } from '../auth/decorators';
import {
  legalKind,
  legalLocale,
  SaveLegalDocumentDraftDto,
} from './dto/legal-documents.dto';
import { LegalDocumentsService } from './legal-documents.service';

// The offer and the privacy policy (spec 2026-10-28-public-site-design, 7.1–7.3): «Сайт → Документы» of the admin.
@Controller({ path: 'operator/legal-documents', version: '1' })
export class LegalDocumentsController {
  constructor(private readonly documents: LegalDocumentsService) {}

  /** The drafts with the text, the published revisions without it. */
  @RequireOperatorPermission('content:manage')
  @Get()
  overview(): Promise<LegalDocumentsOverview> {
    return this.documents.overview();
  }

  /** 200 with the saved draft; 400 `validation_failed`; 404 `not_found` (unknown kind or language). */
  @RequireOperatorPermission('content:manage')
  @Put(':kind/:locale/draft')
  saveDraft(
    @Param('kind') kind: string,
    @Param('locale') locale: string,
    @Body() body: SaveLegalDocumentDraftDto,
  ): Promise<LegalDocumentDraft> {
    return this.documents.saveDraft(legalKind(kind), legalLocale(locale), body);
  }

  /**
   * 201 with the revision (200 with the latest one when the draft is that revision already: nothing is published
   * twice); 409 `draft_empty` (no draft); 400 `validation_failed` (`effectiveFrom` earlier than today in Dushanbe), 400
   * `media_not_found`; 403 `fresh_auth_required`; 404 `not_found`. The offer and the policy are legally weighty: the
   * publication needs a recent sign-in, like the settings of the site.
   */
  @RequireOperatorPermission('content:manage')
  @RequireFreshAuth()
  @Post(':kind/:locale/publish')
  async publish(
    @Param('kind') kind: string,
    @Param('locale') locale: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LegalDocumentRevision> {
    const { revision, created } = await this.documents.publish(
      legalKind(kind),
      legalLocale(locale),
    );
    if (!created) res.status(200);
    return revision;
  }
}
