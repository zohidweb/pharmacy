import { Injectable } from '@nestjs/common';
import type { PlatformOperator } from '@pharmacy/shared-dto';
import { requireOperator } from '../../../common/context/request-context';
import { PlatformDatabase } from '../../../core/database/platform';
import { OperatorsRepository } from './operators.repository';

@Injectable()
export class OperatorsService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: OperatorsRepository,
  ) {}

  list(): Promise<PlatformOperator[]> {
    return this.db.platformTransaction(
      { kind: 'operator', operatorId: requireOperator().operatorId },
      (trx) => this.repository.list(trx),
    );
  }
}
