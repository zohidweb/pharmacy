import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';

export interface OperatorCredentialsRow {
  id: string;
  status: string;
  passwordHash: string | null;
  passwordPepperVersion: number | null;
  /** Moved by an activation and a password change, not by a re-hash. */
  passwordChangedAt: Date | null;
}

function toCredentials(row: {
  id: string;
  status: string;
  passwordHash: string | null;
  passwordPepperVersion: number | null;
  passwordChangedAt: Date | string | null;
}): OperatorCredentialsRow {
  return {
    id: row.id,
    status: row.status,
    passwordHash: row.passwordHash ?? null,
    passwordPepperVersion: row.passwordPepperVersion ?? null,
    passwordChangedAt:
      row.passwordChangedAt === null || row.passwordChangedAt === undefined
        ? null
        : new Date(row.passwordChangedAt),
  };
}

export interface OperatorProfileRow {
  id: string;
  fullName: string;
  login: string;
  status: string;
  /** `ru` / `tj`, as employees.language. */
  language: string;
  lastLoginAt: Date | null;
}

// Data access of operator sign-in, activation and the own profile (auth design 2026-10-02,
// section 9). Runs in the caller's platform transaction (role pharmacy_platform). Logins are
// compared lower-cased.
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
        'operatorCredentials.passwordChangedAt',
      ])
      .where(sql`lower(operators.login)`, '=', login)
      .executeTakeFirst();
    return row ? toCredentials(row) : null;
  }

  async findProfile(
    trx: Transaction<DB>,
    operatorId: string,
  ): Promise<OperatorProfileRow | null> {
    const row = await trx
      .selectFrom('operators')
      .select(['id', 'fullName', 'login', 'status', 'language', 'lastLoginAt'])
      .where('id', '=', operatorId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      ...row,
      lastLoginAt: row.lastLoginAt === null ? null : new Date(row.lastLoginAt),
    };
  }

  /** The password of the operator, for the change of his own password. */
  async findCredentials(
    trx: Transaction<DB>,
    operatorId: string,
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
        'operatorCredentials.passwordChangedAt',
      ])
      .where('operators.id', '=', operatorId)
      .executeTakeFirst();
    return row ? toCredentials(row) : null;
  }

  async updateProfile(
    trx: Transaction<DB>,
    operatorId: string,
    profile: { fullName: string; language: 'ru' | 'tj' },
  ): Promise<void> {
    await trx
      .updateTable('operators')
      .set({
        fullName: profile.fullName,
        language: profile.language,
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', operatorId)
      .execute();
  }

  /**
   * The time of the last password change, holding the credentials row to the commit: a sign-in
   * that verified a password compares it, so a password changed (or set by a code) meanwhile is
   * refused, and a change that comes later waits and then ends the new session. A re-hash does
   * not move the time, so concurrent sign-ins that re-hash do not refuse each other.
   */
  async lockPasswordChange(
    trx: Transaction<DB>,
    operatorId: string,
  ): Promise<{ changedAt: Date | null } | null> {
    const row = await trx
      .selectFrom('operatorCredentials')
      .select('passwordChangedAt')
      .where('operatorId', '=', operatorId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (!row) return null;
    return {
      changedAt:
        row.passwordChangedAt === null ? null : new Date(row.passwordChangedAt),
    };
  }

  /**
   * Whether the operator is active, holding his row FOR SHARE to the commit: a concurrent disable
   * (FOR UPDATE) waits, or has already committed and is seen. Taken before operator_credentials,
   * the order of every writer of both tables.
   */
  async lockActive(trx: Transaction<DB>, operatorId: string): Promise<boolean> {
    const row = await trx
      .selectFrom('operators')
      .select('status')
      .where('id', '=', operatorId)
      .forShare()
      .executeTakeFirst();
    return row?.status === 'active';
  }

  /**
   * Sets a new password while the stored hash still equals the verified one; false when it does
   * not (the password changed meanwhile). A pending one-time code is dropped: the operator knows
   * the password.
   */
  async changePassword(
    trx: Transaction<DB>,
    operatorId: string,
    verifiedPhc: string,
    next: { phc: string; pepperVersion: number },
  ): Promise<boolean> {
    const result = await trx
      .updateTable('operatorCredentials')
      .set({
        passwordHash: next.phc,
        passwordPepperVersion: next.pepperVersion,
        passwordChangedAt: sql<Date>`now()`,
        oneTimeCodeHash: null,
        oneTimeCodeExpiresAt: null,
        updatedAt: sql<Date>`now()`,
      })
      .where('operatorId', '=', operatorId)
      .where('passwordHash', '=', verifiedPhc)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n;
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
