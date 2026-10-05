import { runWithContext } from '../../common/context/request-context';
import type { TenantTransaction } from '../../core/database';
import type { PermissionsVersionCache } from '../../core/sessions';
import type { PermissionsVersionRepository } from './permissions-version.repository';
import { PermissionsVersionService } from './permissions-version.service';

// PermissionsVersionService (auth design 2026-10-02, section 7, "Версия прав"): the version grows
// inside the caller's transaction, the cache is written only after the commit.

const TENANT = '0197a1b2-0000-7000-8000-000000000001';
const EMPLOYEE_1 = '0197a1b2-0000-7000-8000-000000000002';
const EMPLOYEE_2 = '0197a1b2-0000-7000-8000-000000000003';
const trx = { trxId: 1 } as unknown as TenantTransaction;

function setup() {
  const repository = {
    bump: jest.fn(
      async (_trx: TenantTransaction, _tenantId: string, ids: string[]) =>
        ids.map((employeeId, index) => ({ employeeId, version: 5 + index })),
    ),
  };
  const cache = {
    set: jest.fn(async () => undefined),
    setIfAbsent: jest.fn(async () => undefined),
  };
  const service = new PermissionsVersionService(
    repository as unknown as PermissionsVersionRepository,
    cache as unknown as PermissionsVersionCache,
  );
  return { service, repository, cache };
}

const inTenant = <T>(fn: () => Promise<T>) =>
  runWithContext(
    { correlationId: 'corr-1', tenantId: TENANT, principal: null },
    fn,
  );

describe('PermissionsVersionService.bump', () => {
  it('increments the versions in the caller transaction of the request tenant', async () => {
    const t = setup();

    await inTenant(() => t.service.bump(trx, [EMPLOYEE_1, EMPLOYEE_2]));

    expect(t.repository.bump).toHaveBeenCalledWith(trx, TENANT, [
      EMPLOYEE_1,
      EMPLOYEE_2,
    ]);
  });

  it('does not touch the cache before the returned callback runs', async () => {
    const t = setup();

    const afterCommit = await inTenant(() => t.service.bump(trx, [EMPLOYEE_1]));

    expect(t.cache.set).not.toHaveBeenCalled();
    expect(t.cache.setIfAbsent).not.toHaveBeenCalled();

    await afterCommit();

    expect(t.cache.set).toHaveBeenCalledTimes(1);
    expect(t.cache.set).toHaveBeenCalledWith(TENANT, EMPLOYEE_1, 5);
    expect(t.cache.setIfAbsent).not.toHaveBeenCalled();
  });

  it('writes the new version of every employee after the commit', async () => {
    const t = setup();

    const afterCommit = await inTenant(() =>
      t.service.bump(trx, [EMPLOYEE_1, EMPLOYEE_2]),
    );
    await afterCommit();

    expect(t.cache.set).toHaveBeenCalledWith(TENANT, EMPLOYEE_1, 5);
    expect(t.cache.set).toHaveBeenCalledWith(TENANT, EMPLOYEE_2, 6);
  });

  it('bumps each employee once even when listed twice', async () => {
    const t = setup();

    await inTenant(() => t.service.bump(trx, [EMPLOYEE_1, EMPLOYEE_1]));

    expect(t.repository.bump).toHaveBeenCalledWith(trx, TENANT, [EMPLOYEE_1]);
  });

  it('does nothing for an empty list', async () => {
    const t = setup();

    const afterCommit = await inTenant(() => t.service.bump(trx, []));
    await afterCommit();

    expect(t.repository.bump).not.toHaveBeenCalled();
    expect(t.cache.set).not.toHaveBeenCalled();
  });

  it('never writes the cache when the bump itself fails (the transaction rolls back)', async () => {
    const t = setup();
    t.repository.bump.mockRejectedValue(new Error('db down'));

    await expect(
      inTenant(() => t.service.bump(trx, [EMPLOYEE_1])),
    ).rejects.toThrow('db down');

    expect(t.cache.set).not.toHaveBeenCalled();
  });

  it('refuses to run without a tenant context', async () => {
    const t = setup();

    await expect(t.service.bump(trx, [EMPLOYEE_1])).rejects.toThrow(
      'Tenant context is missing',
    );
    expect(t.repository.bump).not.toHaveBeenCalled();
  });
});
