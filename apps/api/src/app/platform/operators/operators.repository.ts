import { Injectable } from '@nestjs/common';
import type { PlatformOperator } from '@pharmacy/shared-dto';
import type { Transaction } from 'kysely';
import type { DB } from '../../../core/database';

// The platform team (data model 06, operators). One role in the MVP: every operator has full
// access (auth design, section 9); a blocked operator is shown as disabled.
@Injectable()
export class OperatorsRepository {
  async list(trx: Transaction<DB>): Promise<PlatformOperator[]> {
    const rows = await trx
      .selectFrom('operators')
      .select(['id', 'fullName', 'login', 'status', 'lastLoginAt'])
      .orderBy('fullName')
      .orderBy('id')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      login: row.login,
      role: 'full_access',
      status: row.status === 'active' ? 'active' : 'disabled',
      lastLoginAt: row.lastLoginAt === null ? null : new Date(row.lastLoginAt).toISOString(),
    }));
  }
}
