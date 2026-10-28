import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import type {
  LegalDocumentDraft,
  LegalDocumentKind,
  LegalDocumentRevision,
  LegalDocumentsOverview,
  UiLocale,
} from '@pharmacy/shared-dto';
import { ProblemException } from '../../../common/errors/problem.exception';
import { RequireOperatorPermission } from '../auth/decorators';
import {
  LEGAL_KINDS,
  LEGAL_LOCALES,
  SaveLegalDocumentDraftDto,
} from './dto/legal-documents.dto';
import { LegalDocumentsService } from './legal-documents.service';

/** An unknown kind or language in the path is an unknown resource: 404 `not_found`. */
export function legalKind(value: string): LegalDocumentKind {
  const kind = LEGAL_KINDS.find((known) => known === value);
  if (kind === undefined) throw new ProblemException(404, 'not_found');
  return kind;
}

function legalLocale(value: string): UiLocale {
  const locale = LEGAL_LOCALES.find((known) => known === value);
  if (locale === undefined) throw new ProblemException(404, 'not_found');
  return locale;
}

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
   * 201 with the revision; 409 `draft_empty` (no draft); 400 `validation_failed` (`effectiveFrom` earlier than today in
   * Dushanbe), 400 `media_not_found`; 404 `not_found`.
   */
  @RequireOperatorPermission('content:manage')
  @Post(':kind/:locale/publish')
  publish(
    @Param('kind') kind: string,
    @Param('locale') locale: string,
  ): Promise<LegalDocumentRevision> {
    return this.documents.publish(legalKind(kind), legalLocale(locale));
  }
}
