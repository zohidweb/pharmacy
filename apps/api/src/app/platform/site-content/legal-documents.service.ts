import { Injectable } from '@nestjs/common';
import type {
  LegalDocumentDraft,
  LegalDocumentKind,
  LegalDocumentRevision,
  LegalDocumentsOverview,
  SaveLegalDocumentDraftRequest,
  UiLocale,
} from '@pharmacy/shared-dto';
import {
  parseSiteMarkdown,
  siteMarkdownMediaIds,
  toAppDate,
} from '@pharmacy/shared-util';
import type { Transaction } from 'kysely';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { type DB, newId } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { SiteContentRepository } from './site-content.repository';

const notFound = () => new ProblemException(404, 'not_found');

// The offer and the privacy policy of the platform (spec 2026-10-28-public-site-design, 7.1–7.3; P4, P13): the operator
// keeps one draft per kind and language and publishes it as a revision. A revision is append-only: a new edition is a new
// row, because the consent of a connection request refers to the revision that was shown. The current one is the last
// published whose date of entry into force (Dushanbe) has come.
@Injectable()
export class LegalDocumentsService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: SiteContentRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  /** The drafts with the text and the published revisions without it. */
  overview(): Promise<LegalDocumentsOverview> {
    return this.db.platformTransaction(this.actor(), async (trx) => ({
      drafts: await this.repository.legalDrafts(trx),
      revisions: await this.repository.legalRevisions(trx),
    }));
  }

  /** The draft is replaced as a whole; nothing is published. */
  async saveDraft(
    kind: LegalDocumentKind,
    locale: UiLocale,
    body: SaveLegalDocumentDraftRequest,
  ): Promise<LegalDocumentDraft> {
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const draft = await this.repository.saveLegalDraft(
        trx,
        kind,
        locale,
        {
          title: body.title,
          body: body.body,
          effectiveFrom: body.effectiveFrom,
        },
        actor.operatorId,
      );
      // No text in the details: the draft is not yet a decision of the platform.
      await this.audit.append(trx, {
        action: 'legal-document.draft-saved',
        entityType: 'legal-document-draft',
        details: { kind, locale },
      });
      return draft;
    });
  }

  /**
   * The draft becomes a revision; the draft stays (the next edit starts from it). 409 `draft_empty` without a draft;
   * 400 `validation_failed` (`effectiveFrom` earlier than today, Dushanbe); 400 `media_not_found` for a picture of the
   * text that is not stored.
   */
  async publish(
    kind: LegalDocumentKind,
    locale: UiLocale,
  ): Promise<LegalDocumentRevision> {
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const draft = await this.repository.legalDraft(trx, kind, locale);
      if (draft === null || draft.title === '' || draft.body.trim() === '')
        throw new ProblemException(409, 'draft_empty');
      if (draft.effectiveFrom < toAppDate())
        throw new FieldProblemException(400, 'validation_failed', [
          { field: 'effectiveFrom', code: 'is_not_in_the_past' },
        ]);
      const mediaIds = siteMarkdownMediaIds(parseSiteMarkdown(draft.body));
      if ((await this.repository.missingMedia(trx, mediaIds)).length > 0)
        throw new ProblemException(400, 'media_not_found');
      const revision = await this.repository.insertLegalRevision(trx, {
        id: newId(),
        kind,
        locale,
        title: draft.title,
        body: draft.body,
        effectiveFrom: draft.effectiveFrom,
        publishedBy: actor.operatorId,
      });
      await this.audit.append(trx, {
        action: 'legal-document.published',
        entityType: 'legal-document-revision',
        entityId: revision.id,
        details: { kind, locale, effectiveFrom: revision.effectiveFrom },
      });
      return revision;
    });
  }

  /** The current revision of the language, else of RU, else 404 `not_found`. No session: a system actor reads. */
  async publicCurrent(
    kind: LegalDocumentKind,
    locale: UiLocale,
  ): Promise<LegalDocumentRevision> {
    const found = await this.db.platformTransaction(
      { kind: 'system', job: 'site.public-read' },
      async (trx) => {
        const today = toAppDate();
        const own = await this.repository.currentLegalRevision(
          trx,
          kind,
          locale,
          today,
        );
        if (own !== null || locale === 'ru') return own;
        return this.repository.currentLegalRevision(trx, kind, 'ru', today);
      },
    );
    if (found === null) throw notFound();
    return found;
  }

  /**
   * The id of the current privacy policy for a language (RU when the language has none), `null` when nothing is
   * published: the connection request binds its consent to it (spec 7.3, P13). In the transaction of the caller.
   */
  async currentPrivacyId(
    trx: Transaction<DB>,
    locale: UiLocale,
  ): Promise<string | null> {
    const today = toAppDate();
    const own = await this.repository.currentLegalRevisionId(
      trx,
      'privacy',
      locale,
      today,
    );
    if (own !== null || locale === 'ru') return own;
    return this.repository.currentLegalRevisionId(trx, 'privacy', 'ru', today);
  }
}
