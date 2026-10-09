import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database';
import { PurchasingRepository } from './purchasing.repository';

// The public interface of the suppliers for the stock module (ADR-0002).
@Injectable()
export class SuppliersReader {
  constructor(private readonly repository: PurchasingRepository) {}

  async findActive(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<{ id: string; name: string; paymentTermDays: number } | null> {
    const row = await this.repository.findSupplier(trx, tenantId, id);
    if (row === null || row.status !== 'active') return null;
    return { id: row.id, name: row.name, paymentTermDays: row.paymentTermDays };
  }

  async names(
    trx: TenantTransaction,
    tenantId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.repository.listSuppliers(trx, tenantId);
    const wanted = new Set(ids);
    return new Map(
      rows.filter((r) => wanted.has(r.id)).map((r) => [r.id, r.name]),
    );
  }
}
