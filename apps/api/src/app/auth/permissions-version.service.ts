import { Injectable } from '@nestjs/common';
import { requireTenantId } from '../../common/context/request-context';
import type { TenantTransaction } from '../../core/database';
import { PermissionsVersionCache } from '../../core/sessions';
import { PermissionsVersionRepository } from './permissions-version.repository';

/** Runs after the transaction of the bump has committed; never inside it. */
export type AfterCommit = () => Promise<void>;

// The version of an employee's permissions (auth design 2026-10-02, section 7). A service that
// changes a role, its permissions, the store scope or the status of employees bumps their version
// in the same transaction, then runs the returned callback after the commit: the cache must never
// hold a version that was rolled back. The callback writes the committed version with set-if-greater, so
// concurrent bumps and cache-miss fills landing in any order never move the cache backwards.
@Injectable()
export class PermissionsVersionService {
  constructor(
    private readonly repository: PermissionsVersionRepository,
    private readonly cache: PermissionsVersionCache,
  ) {}

  async bump(
    trx: TenantTransaction,
    employeeIds: readonly string[],
  ): Promise<AfterCommit> {
    const tenantId = requireTenantId();
    const ids = [...new Set(employeeIds)];
    if (ids.length === 0) return async () => undefined;

    const bumped = await this.repository.bump(trx, tenantId, ids);
    // A failed cache write leaves an older version cached until its short TTL (minutes); the error is not
    // swallowed: the caller (already committed) decides how to report it.
    return async () => {
      await Promise.all(
        bumped.map(({ employeeId, version }) =>
          this.cache.setIfGreater(tenantId, employeeId, version),
        ),
      );
    };
  }
}
