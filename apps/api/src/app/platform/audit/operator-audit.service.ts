import { Injectable } from '@nestjs/common';
import type { OperatorAuditEntry, Page } from '@pharmacy/shared-dto';
import { requireOperator } from '../../../common/context/request-context';
import { PlatformDatabase } from '../../../core/database/platform';
import { type OperatorAuditFilter, OperatorAuditRepository } from './operator-audit.repository';

// Reading the operators' audit log: the actor of the transaction is the operator who reads.
@Injectable()
export class OperatorAuditLogService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: OperatorAuditRepository,
  ) {}

  async list(filter: OperatorAuditFilter): Promise<Page<OperatorAuditEntry>> {
    const { items, total } = await this.db.platformTransaction(
      { kind: 'operator', operatorId: requireOperator().operatorId },
      (trx) => this.repository.list(trx, filter),
    );
    return { items, total, limit: filter.limit, offset: filter.offset };
  }

  /** The newest events the reading operator did himself, without counting his whole history. */
  recent(limit: number): Promise<OperatorAuditEntry[]> {
    const operatorId = requireOperator().operatorId;
    return this.db.platformTransaction({ kind: 'operator', operatorId }, (trx) =>
      this.repository.entries(trx, {
        operatorId,
        actorOnly: true,
        tenantId: null,
        type: null,
        from: null,
        to: null,
        limit,
        offset: 0,
      }),
    );
  }
}
