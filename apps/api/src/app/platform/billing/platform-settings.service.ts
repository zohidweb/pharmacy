import { Injectable } from '@nestjs/common';
import type { PlatformSettings } from '@pharmacy/shared-dto';
import { requireOperator } from '../../../common/context/request-context';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { BillingRepository } from './billing.repository';

/** The names of the fields that differ, `supplier.*` for the requisites; never the values. */
function changedFields(
  before: PlatformSettings,
  after: PlatformSettings,
): string[] {
  const fields: string[] = [];
  if (before.pricePerStoreMinor !== after.pricePerStoreMinor)
    fields.push('pricePerStoreMinor');
  if (before.vatRatePercent !== after.vatRatePercent)
    fields.push('vatRatePercent');
  for (const key of Object.keys(
    after.supplier,
  ) as (keyof PlatformSettings['supplier'])[]) {
    if (before.supplier[key] !== after.supplier[key])
      fields.push(`supplier.${key}`);
  }
  return fields;
}

// The platform settings (spec 2026-10-15-billing-services, B14, A20): the tariff and the VAT rate of
// the invoices generated next, and the requisites printed on them.
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: BillingRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  get(): Promise<PlatformSettings> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.settings(trx),
    );
  }

  /** The whole settings; an unchanged save writes nothing to the journal. */
  async update(next: PlatformSettings): Promise<PlatformSettings> {
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const before = await this.repository.settings(trx);
      const fields = changedFields(before, next);
      if (fields.length === 0) return before;
      await this.repository.updateSettings(trx, next, actor.operatorId);
      await this.audit.append(trx, {
        action: 'settings.updated',
        details: { fields },
      });
      return this.repository.settings(trx);
    });
  }
}
