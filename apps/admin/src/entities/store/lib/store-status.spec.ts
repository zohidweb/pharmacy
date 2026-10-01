import { storeStatusKey } from './store-status';

const offline = {
  status: 'active' as const,
  mode: 'offline' as const,
  licenseValidUntil: '2027-01-01',
  lastSyncAt: '2026-09-30T22:00:00Z',
};

describe('storeStatusKey', () => {
  const today = '2026-10-01';

  it('reports closed stores first', () => {
    expect(storeStatusKey({ ...offline, status: 'closed' }, today)).toBe(
      'closed',
    );
  });

  it('flags keys inside the notice window and expired keys', () => {
    expect(
      storeStatusKey({ ...offline, licenseValidUntil: '2026-10-08' }, today),
    ).toBe('keyExpiring');
    expect(
      storeStatusKey({ ...offline, licenseValidUntil: '2026-10-09' }, today),
    ).toBe('active');
    expect(
      storeStatusKey({ ...offline, licenseValidUntil: '2026-09-30' }, today),
    ).toBe('keyExpired');
  });

  it('flags offline stores without a recent sync', () => {
    expect(
      storeStatusKey({ ...offline, lastSyncAt: '2026-09-28T10:00:00Z' }, today),
    ).toBe('noSync');
    expect(storeStatusKey({ ...offline, lastSyncAt: null }, today)).toBe(
      'noSync',
    );
    expect(
      storeStatusKey({ ...offline, lastSyncAt: '2026-09-29T10:00:00Z' }, today),
    ).toBe('active');
  });

  it('ignores license and sync for cloud stores', () => {
    expect(
      storeStatusKey(
        {
          status: 'active',
          mode: 'cloud',
          licenseValidUntil: null,
          lastSyncAt: null,
        },
        today,
      ),
    ).toBe('active');
  });
});
