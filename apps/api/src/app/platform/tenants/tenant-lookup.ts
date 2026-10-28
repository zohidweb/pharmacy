import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../../core/database';

const MAX_SIMILAR = 10;

// Networks that look like a connection request (spec 2026-10-28-public-site-design, 8; A4): the same INN, or the same
// E.164 phone of the owner. Both are columns of the tenants registry (ADR-0013 §5): the INN is `billing_tax_id`, the
// phone is the owner's phone as the provisioning stored it — no tenant table and no resolver is read. Exported by
// `TenantsModule`; runs in the platform transaction of the caller.
@Injectable()
export class TenantLookup {
  async similar(
    trx: Transaction<DB>,
    inn: string | null,
    phone: string | null,
  ): Promise<{ id: string; name: string }[]> {
    if (inn === null && phone === null) return [];
    return trx
      .selectFrom('tenants')
      .select(['id', 'name'])
      .where((eb) => {
        const matches = [];
        if (inn !== null) matches.push(eb('billingTaxId', '=', inn));
        if (phone !== null) matches.push(eb('ownerPhone', '=', phone));
        return eb.or(matches);
      })
      .orderBy('name')
      .orderBy('id')
      .limit(MAX_SIMILAR)
      .execute();
  }
}
