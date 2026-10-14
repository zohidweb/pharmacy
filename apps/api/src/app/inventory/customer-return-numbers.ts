import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';

export type CustomerReturnNumbersLookup = (
  trx: TenantTransaction,
  tenantId: string,
  ids: readonly string[],
) => Promise<Map<string, string>>;

// The numbers of the customer returns a write-off records (spec 2026-10-13-customer-returns, E9),
// filled by the returns module: the stock shows «по возврату ВЗ-…» without depending on it. Nothing
// registered — no numbers.
@Injectable()
export class CustomerReturnNumbers {
  private lookup: CustomerReturnNumbersLookup | null = null;

  register(lookup: CustomerReturnNumbersLookup): void {
    this.lookup = lookup;
  }

  numbers(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    return this.lookup && unique.length > 0
      ? this.lookup(trx, tenantId, unique)
      : Promise.resolve(new Map());
  }
}
