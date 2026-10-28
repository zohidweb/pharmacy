import { Injectable } from '@nestjs/common';
import type {
  PublicSiteInfo,
  SiteSettings,
  SiteText,
  UpdateSiteSettingsRequest,
} from '@pharmacy/shared-dto';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { SiteContentRepository } from './site-content.repository';

const TEXT_FIELDS = [
  'name',
  'tagline',
  'seoDescription',
  'address',
  'workingHours',
] as const;
const PLAIN_FIELDS = [
  'logoMediaId',
  'faviconMediaId',
  'ogImageMediaId',
  'phone',
  'email',
  'telegramUrl',
  'whatsappUrl',
] as const;

const sameText = (a: SiteText, b: SiteText): boolean =>
  a.ru === b.ru && a.tg === b.tg;

/** The names of the fields that differ; never the values (the contacts are personal enough). */
function changedFields(
  before: SiteSettings,
  after: UpdateSiteSettingsRequest,
): string[] {
  return [
    ...TEXT_FIELDS.filter((key) => !sameText(before[key], after[key])),
    ...PLAIN_FIELDS.filter((key) => before[key] !== after[key]),
  ];
}

// The settings of the public site (spec 2026-10-28-public-site-design, 6.2, 7.2): the name, the contacts, the SEO
// defaults and the pictures of the site, one row for the whole platform. The public answer joins them with the tariffs.
@Injectable()
export class SiteSettingsService {
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

  get(): Promise<SiteSettings> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.settings(trx),
    );
  }

  /** The whole settings; 400 `media_not_found` for an image that is not stored; an unchanged save writes nothing. */
  async update(next: UpdateSiteSettingsRequest): Promise<SiteSettings> {
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const ids = [
        ...new Set(
          [next.logoMediaId, next.faviconMediaId, next.ogImageMediaId].filter(
            (id): id is string => id !== null,
          ),
        ),
      ];
      if ((await this.repository.missingMedia(trx, ids)).length > 0)
        throw new ProblemException(400, 'media_not_found');
      const before = await this.repository.settings(trx);
      const fields = changedFields(before, next);
      if (fields.length === 0) return before;
      await this.repository.updateSettings(trx, next, actor.operatorId);
      await this.audit.append(trx, {
        action: 'site-settings.updated',
        entityType: 'site_settings',
        details: { fields },
      });
      return this.repository.settings(trx);
    });
  }

  /** The public answer: the settings (without the update time) and the tariffs. No session: a system actor reads. */
  async siteInfo(): Promise<PublicSiteInfo> {
    return this.db.platformTransaction(
      { kind: 'system', job: 'site.public-read' },
      async (trx) => {
        return {
          settings: await this.repository.publicSettings(trx),
          pricing: await this.repository.pricing(trx),
        };
      },
    );
  }
}
