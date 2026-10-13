import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';

/**
 * Operations with an idempotency key (data model 06, `idempotency_keys.scope`): the POS buffer and
 * the customer return (spec 2026-10-13-customer-returns, E1).
 */
export type PosScope =
  | 'receipt'
  | 'shift.open'
  | 'shift.cash'
  | 'shift.close'
  | 'return';

/** How long a key answers repeats: longer than any buffer of a terminal (ADR-0015: 24 h). */
const KEY_TTL_DAYS = 30;

/** JSON with the keys of every object sorted: the same body hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Idempotency of the buffered operations of the POS (ADR-0015; spec 2026-10-13-pos-shift-sale, E11):
// the client UUIDv7 `id` of the operation is also the Idempotency-Key. The key row is written first
// in the transaction of the operation: a concurrent repeat waits on it and then reads the answer of
// the first; an operation that fails leaves no key, so its repeat is evaluated again.
@Injectable()
export class PosIdempotency {
  constructor(private readonly db: TenantDatabase) {}

  /**
   * The stored answer of an operation already accepted, read before any check of the session (final
   * review M4): its repeat after a rebind or a change of the author still gets the first answer.
   * Another body with the key — 409 `idempotency_conflict`; no key yet — null.
   */
  async replay<T>(
    tenantId: string,
    scope: PosScope,
    key: string,
    body: unknown,
  ): Promise<{ response: T } | null> {
    const hash = createHash('sha256').update(canonical(body)).digest();
    const row = await this.db.tenantTransaction(async (trx) => {
      const stored = await sql<{ requestHash: Buffer; response: unknown }>`
        select request_hash, response from pharmacy.idempotency_keys
        where tenant_id = ${tenantId} and scope = ${scope} and key = ${key}`.execute(trx);
      return stored.rows[0] ?? null;
    });
    if (row === null || row.response === null) return null;
    if (!Buffer.from(row.requestHash).equals(hash)) {
      throw new ProblemException(409, 'idempotency_conflict');
    }
    return { response: row.response as T };
  }

  /** 400 at `Idempotency-Key` when the header is missing or is not the id of the body. */
  checkHeader(header: string | undefined, id: string): void {
    if (header?.trim().toLowerCase() !== id.toLowerCase()) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'Idempotency-Key', code: 'mismatch' },
      ]);
    }
  }

  /**
   * Runs `work` once per key: a repeat with the same body returns the stored answer, another body
   * — 409 `idempotency_conflict`.
   */
  async run<T>(
    trx: TenantTransaction,
    tenantId: string,
    scope: PosScope,
    key: string,
    body: unknown,
    statusCode: number,
    work: () => Promise<T>,
  ): Promise<T> {
    const hash = createHash('sha256').update(canonical(body)).digest();
    const inserted = await sql<{ key: string }>`
      insert into pharmacy.idempotency_keys
        (tenant_id, scope, key, request_hash, expires_at)
      values (${tenantId}, ${scope}, ${key}, ${hash},
              now() + make_interval(days => ${KEY_TTL_DAYS}))
      on conflict (tenant_id, scope, key) do nothing
      returning key`.execute(trx);
    if (inserted.rows.length === 0) {
      const stored = await sql<{ requestHash: Buffer; response: unknown }>`
        select request_hash, response from pharmacy.idempotency_keys
        where tenant_id = ${tenantId} and scope = ${scope} and key = ${key}`.execute(trx);
      const row = stored.rows[0];
      if (!row || !Buffer.from(row.requestHash).equals(hash)) {
        throw new ProblemException(409, 'idempotency_conflict');
      }
      return row.response as T;
    }
    const result = await work();
    await sql`
      update pharmacy.idempotency_keys
      set status_code = ${statusCode}, response = ${JSON.stringify(result)}::jsonb
      where tenant_id = ${tenantId} and scope = ${scope} and key = ${key}`.execute(trx);
    return result;
  }
}
