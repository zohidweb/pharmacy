import { licenseStatusKey } from './license-status';

describe('licenseStatusKey', () => {
  const today = '2026-10-01';
  const base = {
    state: 'active' as const,
    validUntil: '2027-01-01',
    notifyDaysBefore: 7,
  };

  it('derives expiring, expired and active from the notice window', () => {
    expect(licenseStatusKey({ ...base, validUntil: '2026-10-08' }, today)).toBe(
      'expiring',
    );
    expect(licenseStatusKey({ ...base, validUntil: '2026-10-09' }, today)).toBe(
      'active',
    );
    expect(licenseStatusKey({ ...base, validUntil: '2026-09-30' }, today)).toBe(
      'expired',
    );
    expect(
      licenseStatusKey(
        { ...base, validUntil: '2026-10-20', notifyDaysBefore: 30 },
        today,
      ),
    ).toBe('expiring');
  });

  it('keeps revoked keys revoked regardless of dates', () => {
    expect(licenseStatusKey({ ...base, state: 'revoked' }, today)).toBe(
      'revoked',
    );
  });
});
