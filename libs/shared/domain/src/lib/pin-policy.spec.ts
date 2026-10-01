import { checkPin, isTrivialPin } from './pin-policy';

describe('PIN policy (ADR-0008)', () => {
  it.each(['1111', '0000', '1234', '9876', '3456789'])(
    'rejects the trivial PIN %s',
    (pin) => {
      expect(isTrivialPin(pin)).toBe(true);
      expect(checkPin(pin)).toBe('trivial');
    },
  );

  it.each(['2580', '1470', '3690', '1243'])('accepts %s', (pin) => {
    expect(checkPin(pin)).toBeNull();
  });

  it('requires digits and the minimum length of the network', () => {
    expect(checkPin('12a4')).toBe('format');
    expect(checkPin('258')).toBe('length');
    expect(checkPin('2580', 6)).toBe('length');
    expect(checkPin('258013', 6)).toBeNull();
    expect(checkPin('2580', 2)).toBeNull();
    expect(checkPin('2580135791357')).toBe('length');
  });
});
