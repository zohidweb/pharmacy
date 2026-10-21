import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { getRequestContext } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { isUuid, type TenantTransaction } from '../database';

/** `import_jobs.kind` (spec 2026-10-20-data-import, section 6). */
export type ImportJobKind = 'catalog' | 'opening_balance' | 'suppliers';

/**
 * The two hashes of a load: `content` — of the rows only, the warning about the same rows loaded before (F13);
 * `request` — of the kind and the whole body, what a repeat of the key must match (F15).
 */
export interface ImportHashes {
  content: Buffer;
  request: Buffer;
}

export interface ImportJobRecord {
  tenantId: string;
  id: string;
  kind: ImportJobKind;
  storeId: string | null;
  fileName: string;
  hashes: ImportHashes;
  key: string;
  result: unknown;
  createdBy: string;
}

/** Loads one process runs at once: each holds a connection of the pool the POS shares for seconds. */
const MAX_RUNNING_LOADS = 2;

/**
 * JSON with the keys of every object sorted, so the same body hashes the same. Its own and not the canonical form
 * of the sync protocol: a change of that protocol must not change the hashes of the journal (final review M9).
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (value: unknown): Buffer =>
  createHash('sha256').update(canonical(value)).digest();

/** The hashes of a load: the rows apart (F13), the kind and the whole body together (F15). */
export function importHashes(
  kind: ImportJobKind,
  request: { rows: unknown },
): ImportHashes {
  return { content: sha256(request.rows), request: sha256({ kind, request }) };
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

// The journal of the loads from a file (spec 2026-10-20-data-import, F15, F16): one load of a network at a time, at
// most two of the process, a repeat of a load returns its first answer, a check finds the loads of the same rows
// before. The methods with a transaction run in the tenant transaction of the caller.
@Injectable()
export class ImportJobs {
  private readonly logger = new Logger(ImportJobs.name);
  private running = 0;

  /**
   * A place for a load of this process, released by the returned function. Two at most (final review M5): a load holds
   * a connection of the pool for seconds, the POS needs the rest — a third gets 503 `imports_busy` and is repeated.
   */
  begin(): () => void {
    if (this.running >= MAX_RUNNING_LOADS) {
      throw new ProblemException(503, 'imports_busy');
    }
    this.running += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running -= 1;
    };
  }

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
   * The stored answer of the load with this key; the key with another request — another kind, store, date, comment or
   * rows — 409 `idempotency_conflict` (as the POS); no such key — null.
   */
  async replay<T>(
    trx: TenantTransaction,
    tenantId: string,
    key: string,
    hashes: ImportHashes,
  ): Promise<T | null> {
    const row = await trx
      .selectFrom('importJobs')
      .select(['requestSha256', 'result'])
      .where('tenantId', '=', tenantId)
      .where('idempotencyKey', '=', key)
      .executeTakeFirst();
    if (!row) return null;
    if (!Buffer.from(row.requestSha256).equals(hashes.request)) {
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
        contentSha256: job.hashes.content,
        requestSha256: job.hashes.request,
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
    hashes: ImportHashes,
  ): Promise<{ id: string; createdAt: string; result: unknown }[]> {
    let query = trx
      .selectFrom('importJobs')
      .select(['id', 'createdAt', 'result'])
      .where('tenantId', '=', tenantId)
      .where('kind', '=', kind)
      .where('contentSha256', '=', hashes.content);
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

  /** A line of the log for a load written (§11): the kind, the rows, the outcome in counts and the time — no cell. */
  logged(
    kind: ImportJobKind,
    rows: number,
    outcome: string,
    startedAt: number,
  ): void {
    this.logger.log(
      `Import ${kind}: ${rows} rows, ${outcome}, ${Date.now() - startedAt} ms [correlationId=${getRequestContext()?.correlationId}]`,
    );
  }
}
