import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';

export interface OperatorCredentialsRow {
  id: string;
  status: string;
  passwordHash: string | null;
  passwordPepperVersion: number | null;
}

export interface OperatorProfileRow {
  id: string;
  fullName: string;
  login: string;
  status: string;
}

// Data access of operator sign-in and activation (auth design 2026-10-02, section 9). Runs in the
// caller's platform transaction (role pharmacy_platform). Logins are compared lower-cased.
@Injectable()
export class OperatorAuthRepository {
  async findByLogin(
    trx: Transaction<DB>,
    login: string,
  ): Promise<OperatorCredentialsRow | null> {
    const row = await trx
      .selectFrom('operators')
      .leftJoin(
        'operatorCredentials',
        'operatorCredentials.operatorId',
        'operators.id',
      )
      .select([
        'operators.id',
        'operators.status',
        'operatorCredentials.passwordHash',
        'operatorCredentials.passwordPepperVersion',
      ])
      .where(sql`lower(operators.login)`, '=', login)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      passwordHash: row.passwordHash ?? null,
      passwordPepperVersion: row.passwordPepperVersion ?? null,
    };
  }

  async findProfile(
    trx: Transaction<DB>,
    operatorId: string,
  ): Promise<OperatorProfileRow | null> {
    const row = await trx
      .selectFrom('operators')
      .select(['id', 'fullName', 'login', 'status'])
      .where('id', '=', operatorId)
      .executeTakeFirst();
    return row ?? null;
  }

  async recordLogin(trx: Transaction<DB>, operatorId: string): Promise<void> {
    await trx
      .updateTable('operators')
      .set({ lastLoginAt: sql<Date>`now()`, updatedAt: sql<Date>`now()` })
      .where('id', '=', operatorId)
      .execute();
  }

  /** Rewrites the hash with current parameters while it still equals the verified one. */
  async updatePasswordHash(
    trx: Transaction<DB>,
    operatorId: string,
    verifiedPhc: string,
    next: { phc: string; pepperVersion: number },
  ): Promise<void> {
    await trx
      .updateTable('operatorCredentials')
      .set({
        passwordHash: next.phc,
        passwordPepperVersion: next.pepperVersion,
        updatedAt: sql<Date>`now()`,
      })
      .where('operatorId', '=', operatorId)
      .where('passwordHash', '=', verifiedPhc)
      .execute();
  }

  /**
   * Consumes a one-time code and sets the password in one statement: only while the stored code
   * hash equals `codeHash`, the code has not expired and the operator is active. The operator id,
   * or null when nothing matched (unknown, used, expired or wrong code are not told apart).
   */
  async consumeActivationCode(
    trx: Transaction<DB>,
    login: string,
    codeHash: string,
    next: { phc: string; pepperVersion: number },
  ): Promise<string | null> {
    const { rows } = await sql<{ operatorId: string }>`
      update pharmacy.operator_credentials c
      set password_hash = ${next.phc},
          password_pepper_version = ${next.pepperVersion},
          password_changed_at = now(),
          one_time_code_hash = null,
          one_time_code_expires_at = null,
          updated_at = now()
      from pharmacy.operators o
      where o.id = c.operator_id
        and lower(o.login) = ${login}
        and o.status = 'active'
        and c.one_time_code_hash = ${codeHash}
        and c.one_time_code_expires_at > now()
      returning c.operator_id as "operatorId"`.execute(trx);
    return rows.length === 1 ? rows[0].operatorId : null;
  }
}
