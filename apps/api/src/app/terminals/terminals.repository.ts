import { Injectable } from '@nestjs/common';
import type { TenantTerminal } from '@pharmacy/shared-dto';
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

/** The PIN failure counter after a reserved attempt. */
export interface PinFailure {
  attempts: number;
  locked: boolean;
}

/** The own PIN state of an employee (POST /me/pin). */
export interface PinState {
  pinHash: string | null;
  pinPepperVersion: number | null;
  pinLockedAt: Date | null;
}

export interface MyTerminalRow {
  id: string;
  name: string;
  storeName: string | null;
  boundAt: Date;
  lastSignInAt: Date;
}

/** How far back GET /me/terminals looks (auth design, section 8). */
const MY_TERMINALS_DAYS = 90;

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

  // Reserves one PIN attempt before scrypt, atomically: counted as a failure in advance and locking
  // the PIN when it reaches PIN_MAX_FAILED_ATTEMPTS, only while the PIN is not locked. Concurrent
  // attempts therefore get at most PIN_MAX_FAILED_ATTEMPTS checks; a success clears the count
  // and the lock (clearPinFailures). Null when the PIN is locked (or there are no credentials).
  async reservePinAttempt(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<PinFailure | null> {
    const row = await trx
      .updateTable('employeeCredentials')
      .set((eb) => ({
        pinFailedAttempts: eb('pinFailedAttempts', '+', 1),
        pinLockedAt: sql<Date | null>`case when pin_failed_attempts + 1 >= ${PIN_MAX_FAILED_ATTEMPTS} then now() else null end`,
        updatedAt: sql<Date>`now()`,
      }))
      .where('tenantId', '=', tenantId)
      .where('employeeId', '=', employeeId)
      .where('pinLockedAt', 'is', null)
      .returning(['pinFailedAttempts', 'pinLockedAt'])
      .executeTakeFirst();
    if (!row) return null;
    return {
      attempts: row.pinFailedAttempts,
      locked: row.pinLockedAt !== null,
    };
  }

  /** After a correct PIN: the reserved attempt and any lock it set are cleared. */
  async clearPinFailures(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<void> {
    await trx
      .updateTable('employeeCredentials')
      .set({ pinFailedAttempts: 0, pinLockedAt: null, updatedAt: sql<Date>`now()` })
      .where('tenantId', '=', tenantId)
      .where('employeeId', '=', employeeId)
      .execute();
  }

  async pinState(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<PinState> {
    const row = await trx
      .selectFrom('employeeCredentials')
      .select(['pinHash', 'pinPepperVersion', 'pinLockedAt'])
      .where('tenantId', '=', tenantId)
      .where('employeeId', '=', employeeId)
      .executeTakeFirst();
    return {
      pinHash: row?.pinHash ?? null,
      pinPepperVersion: row?.pinPepperVersion ?? null,
      pinLockedAt:
        row?.pinLockedAt === null || row?.pinLockedAt === undefined
          ? null
          : new Date(row.pinLockedAt),
    };
  }

  /** Sets the PIN and clears the failure counter and the lock; creates the credentials row. */
  async setPin(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
    next: { phc: string; pepperVersion: number },
  ): Promise<void> {
    await trx
      .insertInto('employeeCredentials')
      .values({
        tenantId,
        employeeId,
        pinHash: next.phc,
        pinPepperVersion: next.pepperVersion,
        pinFailedAttempts: 0,
        pinLockedAt: null,
      })
      .onConflict((oc) =>
        oc.columns(['tenantId', 'employeeId']).doUpdateSet({
          pinHash: next.phc,
          pinPepperVersion: next.pepperVersion,
          pinFailedAttempts: 0,
          pinLockedAt: null,
          updatedAt: sql<Date>`now()`,
        }),
      )
      .execute();
  }

  /** Terminals the employee signed in on by PIN within MY_TERMINALS_DAYS, latest first. */
  async myTerminals(
    trx: TenantTransaction,
    tenantId: string,
    employeeId: string,
  ): Promise<MyTerminalRow[]> {
    const rows = await trx
      .with('signIns', (db) =>
        db
          .selectFrom('auditLog')
          .select([
            sql<string>`details ->> 'terminalId'`.as('terminalId'),
            sql<Date>`max(recorded_at)`.as('lastSignInAt'),
          ])
          .where('tenantId', '=', tenantId)
          .where('action', '=', 'auth.pin-succeeded')
          .where('entityType', '=', 'employee')
          .where('entityId', '=', employeeId)
          .where(
            'recordedAt',
            '>=',
            sql<Date>`now() - ${sql.lit(`${MY_TERMINALS_DAYS} days`)}::interval`,
          )
          .groupBy(sql`details ->> 'terminalId'`),
      )
      .selectFrom('signIns')
      .innerJoin('terminals', (join) =>
        join
          .on('terminals.tenantId', '=', tenantId)
          .on(sql`terminals.id::text`, '=', sql.ref('signIns.terminalId')),
      )
      .leftJoin('stores', (join) =>
        join
          .onRef('stores.tenantId', '=', 'terminals.tenantId')
          .onRef('stores.id', '=', 'terminals.storeId'),
      )
      .select([
        'terminals.id',
        'terminals.name',
        'stores.name as storeName',
        'terminals.boundAt',
        'signIns.lastSignInAt',
      ])
      .orderBy('signIns.lastSignInAt', 'desc')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      storeName: row.storeName ?? null,
      boundAt: new Date(row.boundAt),
      lastSignInAt: new Date(row.lastSignInAt),
    }));
  }

  /** Active terminals of the stores in the scope, by store and name. */
  async listTerminals(
    trx: TenantTransaction,
    tenantId: string,
    storeScope: 'all' | readonly string[],
  ): Promise<TenantTerminal[]> {
    let query = trx
      .selectFrom('terminals as t')
      .innerJoin('stores as s', (join) =>
        join.onRef('s.tenantId', '=', 't.tenantId').onRef('s.id', '=', 't.storeId'),
      )
      .innerJoin('employees as e', (join) =>
        join.onRef('e.tenantId', '=', 't.tenantId').onRef('e.id', '=', 't.boundBy'),
      )
      .select([
        't.id',
        't.name',
        't.storeId',
        's.name as storeName',
        's.mode as storeMode',
        'e.fullName as boundByName',
        't.boundAt',
        't.lastSeenAt',
      ])
      .where('t.tenantId', '=', tenantId)
      .where('t.revokedAt', 'is', null);
    if (storeScope !== 'all') {
      if (storeScope.length === 0) return [];
      query = query.where('t.storeId', 'in', [...storeScope]);
    }
    const rows = await query.orderBy('s.name').orderBy('t.name').execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      // A short, human-readable reference of the terminal for support calls.
      serial: row.id.replace(/-/g, '').slice(-8).toUpperCase(),
      storeId: row.storeId,
      storeName: row.storeName,
      storeOffline: row.storeMode !== 'online',
      boundByName: row.boundByName,
      boundAt: row.boundAt.toISOString(),
      lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    }));
  }
}
