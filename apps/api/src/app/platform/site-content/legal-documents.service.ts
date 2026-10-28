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
import {
  PlatformDatabase,
  PublicSiteDatabase,
} from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { SiteContentRepository } from './site-content.repository';

const notFound = () => new ProblemException(404, 'not_found');

/** The RU fallback of the site (spec 7.2–7.3), the only one: what `read` finds in the language, else in RU. */
async function inLocaleOrRu<T>(
  locale: UiLocale,
  read: (locale: UiLocale) => Promise<T | null>,
): Promise<T | null> {
  const own = await read(locale);
  if (own !== null || locale === 'ru') return own;
  return read('ru');
}

/** The draft is the revision already: the same title, text and date of entry into force. */
const sameAs = (
  draft: LegalDocumentDraft,
  revision: LegalDocumentRevision,
): boolean =>
  draft.title === revision.title &&
  draft.body === revision.body &&
  draft.effectiveFrom === revision.effectiveFrom;

// The offer and the privacy policy of the platform (spec 2026-10-28-public-site-design, 7.1–7.3; P4, P13): the operator
// keeps one draft per kind and language and publishes it as a revision. A revision is append-only: a new edition is a new
// row, because the consent of a connection request refers to the revision that was shown. The current one is the last
// published whose date of entry into force (Dushanbe) has come.
@Injectable()
export class LegalDocumentsService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly publicDb: PublicSiteDatabase,
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
        entityType: 'legal_document_draft',
        details: { kind, locale },
      });
      return draft;
    });
  }

  /**
   * The draft becomes a revision; the draft stays (the next edit starts from it). A draft equal to the revision
   * published last (title, text, date) publishes nothing: that revision, `created: false`, no journal entry (R10). 409
   * `draft_empty` without a draft; 400 `validation_failed` (`effectiveFrom` earlier than today, Dushanbe); 400
   * `media_not_found` for a picture of the text that is not stored. The draft row is locked: two publications of one
   * kind and language run one after the other.
   */
  async publish(
    kind: LegalDocumentKind,
    locale: UiLocale,
  ): Promise<{ revision: LegalDocumentRevision; created: boolean }> {
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      // the table keeps no empty draft (title 3+, body 1+ characters)
      const draft = await this.repository.legalDraft(trx, kind, locale, true);
      if (draft === null) throw new ProblemException(409, 'draft_empty');
      const latest = await this.repository.latestLegalRevision(
        trx,
        kind,
        locale,
      );
      if (latest !== null && sameAs(draft, latest))
        return { revision: latest, created: false };
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
        entityType: 'legal_document_revision',
        entityId: revision.id,
        details: { kind, locale, effectiveFrom: revision.effectiveFrom },
      });
      return { revision, created: true };
    });
  }

  /**
   * The current revision of the language, else of RU, else 404 `not_found`. No session: a system actor reads, on the
   * pool of the public reads.
   */
  async publicCurrent(
    kind: LegalDocumentKind,
    locale: UiLocale,
  ): Promise<LegalDocumentRevision> {
    const found = await this.publicDb.platformTransaction(
      { kind: 'system', job: 'site.public-read' },
      (trx) => {
        const today = toAppDate();
        return inLocaleOrRu(locale, (asked) =>
          this.repository.currentLegalRevision(trx, kind, asked, today),
        );
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
    return inLocaleOrRu(locale, (asked) =>
      this.repository.currentLegalRevisionId(trx, 'privacy', asked, today),
    );
  }
}
