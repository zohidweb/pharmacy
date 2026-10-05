import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface TerminalStore {
  id: string;
  name: string;
  address: string;
  mode: string;
  kind: string;
  status: string;
}

export interface TerminalRow {
  id: string;
  name: string;
  storeId: string;
  revokedAt: Date | null;
}

export interface CashierRow {
  employeeId: string;
  fullName: string;
}

/** What a PIN sign-in needs to know about an employee at a store. */
export interface PinCandidate {
  status: string;
  hasStoreAccess: boolean;
  pinHash: string | null;
  pinPepperVersion: number | null;
  pinLockedAt: Date | null;
}

/** The PIN failure counter after one more failure. */
export interface PinFailure {
  attempts: number;
  locked: boolean;
}

/** PIN failures in a row that lock the PIN (auth design 2026-10-02, section 8). */
export const PIN_MAX_FAILED_ATTEMPTS = 3;

// The column default of tenant_settings.pin_min_length, for a tenant without a settings row.
const DEFAULT_PIN_MIN_LENGTH = 4;

// last_seen_at is written at most once per this interval (auth design, section 8).
const LAST_SEEN_INTERVAL = '5 minutes';

// PostgreSQL unique_violation.
const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

// Data access of terminals and PIN sign-in. Every query runs in the caller's tenant transaction and
// filters by tenant_id; RLS is the second line.
@Injectable()
export class TerminalsRepository {
  async findStore(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<TerminalStore | null> {
    const row = await trx
      .selectFrom('stores')
      .select(['id', 'name', 'address', 'mode', 'kind', 'status'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', storeId)
      .executeTakeFirst();
    return row ?? null;
  }

  async findTerminal(
    trx: TenantTransaction,
    tenantId: string,
    terminalId: string,
  ): Promise<TerminalRow | null> {
    const row = await trx
      .selectFrom('terminals')
      .select(['id', 'name', 'storeId', 'revokedAt'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', terminalId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      ...row,
      revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt),
    };
  }

  async insertTerminal(
    trx: TenantTransaction,
    terminal: {
      tenantId: string;
      id: string;
      storeId: string;
      name: string;
      credentialHash: Buffer;
      boundBy: string;
    },
  ): Promise<void> {
    await trx
      .insertInto('terminals')
      .values({ ...terminal, boundAt: sql<Date>`now()` })
      .execute();
  }

  /** Revokes an active terminal; false when it was already revoked or does not exist. */
  async revoke(
    trx: TenantTransaction,
    tenantId: string,
    terminalId: string,
    revokedBy: string,
  ): Promise<boolean> {
    const result = await trx
      .updateTable('terminals')
      .set({ revokedAt: sql<Date>`now()`, revokedBy })
      .where('tenantId', '=', tenantId)
      .where('id', '=', terminalId)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async touchLastSeen(
    trx: TenantTransaction,
    tenantId: string,
    terminalId: string,
  ): Promise<void> {
    await trx
      .updateTable('terminals')
      .set({ lastSeenAt: sql<Date>`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', terminalId)
      .where((eb) =>
        eb.or([
          eb('lastSeenAt', 'is', null),
          eb(
            'lastSeenAt',
            '<',
            sql<Date>`now() - ${sql.lit(LAST_SEEN_INTERVAL)}::interval`,
          ),
        ]),
      )
      .execute();
  }

  /** Active employees with access to the store and a PIN set, by name. */
  async cashiers(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<CashierRow[]> {
    return trx
      .selectFrom('employees')
      .innerJoin('employeeCredentials', (join) =>
        join
          .onRef('employeeCredentials.tenantId', '=', 'employees.tenantId')
          .onRef('employeeCredentials.employeeId', '=', 'employees.id'),
      )
      .select(['employees.id as employeeId', 'employees.fullName'])
      .where('employees.tenantId', '=', tenantId)
      .where('employees.status', '=', 'active')
      .where('employeeCredentials.pinHash', 'is not', null)
      .where((eb) =>
        eb.or([
          eb('employees.storeScope', '=', 'all'),
          eb.exists(
            eb
              .selectFrom('employeeStores')
              .select(sql.lit(1).as('one'))
              .whereRef('employeeStores.tenantId', '=', 'employees.tenantId')
              .whereRef('employeeStores.employeeId', '=', 'employees.id')
              .where('employeeStores.storeId', '=', storeId),
          ),
        ]),
      )
      .orderBy('employees.fullName')
      .orderBy('employees.id')
      .execute();
  }

  async pinMinLength(trx: TenantTransaction, tenantId: string): Promise<number> {
    const row = await trx
      .selectFrom('tenantSettings')
      .select('pinMinLength')
      .where('tenantId', '=', tenantId)
      .executeTakeFirst();
    return row?.pinMinLength ?? DEFAULT_PIN_MIN_LENGTH;
  }

  async pinCandidate(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
    storeId: string,
  ): Promise<PinCandidate | null> {
    const row = await trx
      .selectFrom('employees')
      .leftJoin('employeeCredentials', (join) =>
        join
          .onRef('employeeCredentials.tenantId', '=', 'employees.tenantId')
          .onRef('employeeCredentials.employeeId', '=', 'employees.id'),
      )
      .select((eb) => [
        'employees.status',
        'employees.storeScope',
        'employeeCredentials.pinHash',
        'employeeCredentials.pinPepperVersion',
        'employeeCredentials.pinLockedAt',
        eb
          .exists(
            eb
              .selectFrom('employeeStores')
              .select(sql.lit(1).as('one'))
              .whereRef('employeeStores.tenantId', '=', 'employees.tenantId')
              .whereRef('employeeStores.employeeId', '=', 'employees.id')
              .where('employeeStores.storeId', '=', storeId),
          )
          .as('assigned'),
      ])
      .where('employees.tenantId', '=', tenantId)
      .where('employees.id', '=', employeeId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      status: row.status,
      hasStoreAccess: row.storeScope === 'all' || row.assigned === true,
      pinHash: row.pinHash ?? null,
      pinPepperVersion: row.pinPepperVersion ?? null,
      pinLockedAt:
        row.pinLockedAt === null || row.pinLockedAt === undefined
          ? null
          : new Date(row.pinLockedAt),
    };
  }

  // One more failure, counted and locked atomically in one statement, so concurrent wrong PINs
  // cannot get past PIN_MAX_FAILED_ATTEMPTS.
  async recordPinFailure(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<PinFailure> {
    const row = await trx
      .updateTable('employeeCredentials')
      .set((eb) => ({
        pinFailedAttempts: eb('pinFailedAttempts', '+', 1),
        pinLockedAt: sql<Date | null>`case when pin_failed_attempts + 1 >= ${PIN_MAX_FAILED_ATTEMPTS} then coalesce(pin_locked_at, now()) else pin_locked_at end`,
        updatedAt: sql<Date>`now()`,
      }))
      .where('tenantId', '=', tenantId)
      .where('employeeId', '=', employeeId)
      .returning(['pinFailedAttempts', 'pinLockedAt'])
      .executeTakeFirst();
    return {
      attempts: row?.pinFailedAttempts ?? 0,
      locked: row?.pinLockedAt !== null && row?.pinLockedAt !== undefined,
    };
  }

  async resetPinFailures(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<void> {
    await trx
      .updateTable('employeeCredentials')
      .set({ pinFailedAttempts: 0, updatedAt: sql<Date>`now()` })
      .where('tenantId', '=', tenantId)
      .where('employeeId', '=', employeeId)
      .where('pinFailedAttempts', '>', 0)
      .execute();
  }
}
