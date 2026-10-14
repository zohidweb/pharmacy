import { Injectable } from '@nestjs/common';
import type { PlatformOperator } from '@pharmacy/shared-dto';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';

interface OperatorRow {
  id: string;
  fullName: string;
  login: string;
  status: string;
  lastLoginAt: Date | string | null;
}

// One role in the MVP: every operator has full access (auth design, section 9); a blocked
// operator is shown as disabled.
const toOperator = (row: OperatorRow): PlatformOperator => ({
  id: row.id,
  fullName: row.fullName,
  login: row.login,
  role: 'full_access',
  status: row.status === 'active' ? 'active' : 'disabled',
  lastLoginAt: row.lastLoginAt === null ? null : new Date(row.lastLoginAt).toISOString(),
});

const COLUMNS = ['id', 'fullName', 'login', 'status', 'lastLoginAt'] as const;

// The platform team (data model 01, operators and operator_credentials), in the caller's platform
// transaction (role pharmacy_platform). One-time codes are stored as SHA-256 only, as
// scripts/create-operator.mjs does.
@Injectable()
export class OperatorsRepository {
  async list(trx: Transaction<DB>): Promise<PlatformOperator[]> {
    const rows = await trx
      .selectFrom('operators')
      .select(COLUMNS)
      .orderBy('fullName')
      .orderBy('id')
      .execute();
    return rows.map(toOperator);
  }

  async find(trx: Transaction<DB>, operatorId: string): Promise<PlatformOperator | null> {
    const row = await trx
      .selectFrom('operators')
      .select(COLUMNS)
      .where('id', '=', operatorId)
      .executeTakeFirst();
    return row ? toOperator(row) : null;
  }

  /** `active` / `blocked`, or null for an unknown operator; the row stays locked to the commit. */
  async lockStatus(trx: Transaction<DB>, operatorId: string): Promise<string | null> {
    const row = await trx
      .selectFrom('operators')
      .select('status')
      .where('id', '=', operatorId)
      .forUpdate()
      .executeTakeFirst();
    return row?.status ?? null;
  }

  /** A new operator without a password, with a one-time code for the first sign-in. */
  async create(
    trx: Transaction<DB>,
    operator: {
      id: string;
      login: string;
      fullName: string;
      codeHash: string;
      codeExpiresAt: Date;
    },
  ): Promise<void> {
    await trx
      .insertInto('operators')
      .values({ id: operator.id, login: operator.login, fullName: operator.fullName })
      .execute();
    await trx
      .insertInto('operatorCredentials')
      .values({
        operatorId: operator.id,
        oneTimeCodeHash: operator.codeHash,
        oneTimeCodeExpiresAt: operator.codeExpiresAt,
      })
      .execute();
  }

  /** A new code replaces an unused one; a password stays until the code is used. */
  async issueCode(
    trx: Transaction<DB>,
    operatorId: string,
    codeHash: string,
    codeExpiresAt: Date,
  ): Promise<void> {
    await trx
      .insertInto('operatorCredentials')
      .values({
        operatorId,
        oneTimeCodeHash: codeHash,
        oneTimeCodeExpiresAt: codeExpiresAt,
      })
      .onConflict((conflict) =>
        conflict.column('operatorId').doUpdateSet({
          oneTimeCodeHash: codeHash,
          oneTimeCodeExpiresAt: codeExpiresAt,
          updatedAt: sql<Date>`now()`,
        }),
      )
      .execute();
  }

  async block(trx: Transaction<DB>, operatorId: string): Promise<void> {
    await trx
      .updateTable('operators')
      .set({ status: 'blocked', updatedAt: sql<Date>`now()` })
      .where('id', '=', operatorId)
      .execute();
  }
}
