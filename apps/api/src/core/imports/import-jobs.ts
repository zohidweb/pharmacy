import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { isUuid, type TenantTransaction } from '../database';
import { canonicalJson } from '../sync';

/** `import_jobs.kind` (spec 2026-10-20-data-import, section 6). */
export type ImportJobKind = 'catalog' | 'opening_balance' | 'suppliers';

export interface ImportJobRecord {
  tenantId: string;
  id: string;
  kind: ImportJobKind;
  storeId: string | null;
  fileName: string;
  hash: Buffer;
  key: string;
  result: unknown;
  createdBy: string;
}

/** SHA-256 of the canonical JSON of the rows of a load — the file name is not part of it. */
export function importHash(rows: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(rows)).digest();
}

/** The Idempotency-Key of a load (F15): a UUID, lower case; otherwise 400 at the header. */
export function idempotencyKeyOf(header: string | undefined): string {
  const key = header?.trim() ?? '';
  if (key === '' || !isUuid(key)) {
    throw new FieldProblemException(400, 'validation_failed', [
      { field: 'Idempotency-Key', code: key === '' ? 'required' : 'invalid' },
    ]);
  }
  return key.toLowerCase();
}

// The journal of the loads from a file (spec 2026-10-20-data-import, F15, F16): the loads of a network go one at a
// time, a repeat of a load returns its first answer, a check finds the loads of the same rows before. Every method
// runs in the tenant transaction of the caller.
@Injectable()
export class ImportJobs {
  /**
   * One load of a network at a time, until the end of the transaction. An advisory lock, not the row of the tenant:
   * billing locks that row, a load of 20 000 rows must not hold it. Taken without waiting (final review I1): a load
   * runs for seconds, past the `lock_timeout` of a request, and a waiting request would hold a connection of the pool
   * the POS shares — the second load gets 409 `import_in_progress` and is repeated later.
   */
  async lock(trx: TenantTransaction, tenantId: string): Promise<void> {
    const result = await sql<{ locked: boolean }>`
      select pg_try_advisory_xact_lock(hashtextextended(${`imports:${tenantId}`}, 0)) as locked`.execute(
      trx,
    );
    if (result.rows[0]?.locked !== true) {
      throw new ProblemException(409, 'import_in_progress');
    }
  }

  /**
   * The stored answer of the load with this key; the key with other rows — 409 `idempotency_conflict` (as the POS);
   * no such key — null.
   */
  async replay<T>(
    trx: TenantTransaction,
    tenantId: string,
    key: string,
    hash: Buffer,
  ): Promise<T | null> {
    const row = await trx
      .selectFrom('importJobs')
      .select(['contentSha256', 'result'])
      .where('tenantId', '=', tenantId)
      .where('idempotencyKey', '=', key)
      .executeTakeFirst();
    if (!row) return null;
    if (!Buffer.from(row.contentSha256).equals(hash)) {
      throw new ProblemException(409, 'idempotency_conflict');
    }
    return row.result as T;
  }

  async record(trx: TenantTransaction, job: ImportJobRecord): Promise<void> {
    await trx
      .insertInto('importJobs')
      .values({
        tenantId: job.tenantId,
        id: job.id,
        kind: job.kind,
        storeId: job.storeId,
        fileName: job.fileName,
        contentSha256: job.hash,
        idempotencyKey: job.key,
        result: JSON.stringify(job.result),
        createdBy: job.createdBy,
      })
      .execute();
  }

  /** Loads of the same rows of this kind (and store) before, newest first — the warning of the check (F13). */
  async previous(
    trx: TenantTransaction,
    tenantId: string,
    kind: ImportJobKind,
    storeId: string | null,
    hash: Buffer,
  ): Promise<{ id: string; createdAt: string; result: unknown }[]> {
    let query = trx
      .selectFrom('importJobs')
      .select(['id', 'createdAt', 'result'])
      .where('tenantId', '=', tenantId)
      .where('kind', '=', kind)
      .where('contentSha256', '=', hash);
    query =
      storeId === null
        ? query.where('storeId', 'is', null)
        : query.where('storeId', '=', storeId);
    const rows = await query.orderBy('createdAt', 'desc').execute();
    return rows.map((row) => ({
      id: row.id,
      createdAt: new Date(row.createdAt).toISOString(),
      result: row.result,
    }));
  }
}
