import { Injectable } from '@nestjs/common';
import type {
  DrugReferenceListResponse,
  DrugReferenceQuery,
} from '@pharmacy/shared-dto';
import { TenantDatabase } from '../../core/database';
import { DrugReferencesRepository } from './drug-references.repository';

const DEFAULT_LIMIT = 10;

/** Search of the platform drug reference for the product card (plan 2026-11-11-drug-reference-seed, R9). */
@Injectable()
export class DrugReferencesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: DrugReferencesRepository,
  ) {}

  search(query: DrugReferenceQuery): Promise<DrugReferenceListResponse> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => ({
      ...(await this.repository.search(trx, query.q, { limit, offset })),
      limit,
      offset,
    }));
  }
}
