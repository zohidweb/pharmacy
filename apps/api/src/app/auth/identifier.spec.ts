import { normalizeIdentifier } from './identifier';

// Login identifier normalization (auth design 2026-10-02, section 6, step 2). resolve_login
// compares the value as given against lower(login), lower(email) and the E.164 phone.

describe('normalizeIdentifier', () => {
  it.each([
    [' Zarina ', { kind: 'login', value: 'zarina' }],
    ['Zarina.Karimova', { kind: 'login', value: 'zarina.karimova' }],
    ['ЗАРИНА', { kind: 'login', value: 'зарина' }],
    ['Z@X.TJ', { kind: 'email', value: 'z@x.tj' }],
    [
      '  Owner.One@Pharmacy.Example.TJ ',
      { kind: 'email', value: 'owner.one@pharmacy.example.tj' },
    ],
    ['+992 93 123-45-67', { kind: 'phone', value: '+992931234567' }],
    ['931234567', { kind: 'phone', value: '+992931234567' }],
    ['992931234567', { kind: 'phone', value: '+992931234567' }],
    ['(93) 123 45 67', { kind: 'phone', value: '+992931234567' }],
    ['+7 916 123-45-67', { kind: 'phone', value: '+79161234567' }],
  ])('%j → %j', (raw, expected) => {
    expect(normalizeIdentifier(raw)).toEqual(expected);
  });

  it.each([
    ['12'],
    [''],
    ['   '],
    ['+0123'],
    ['+'],
    ['()'],
    ['9+92931234567'],
    ['+992 93 123 45 67 89 01 23'],
    ['1234567890'],
    ['@x.tj'],
    ['z@'],
    ['z@x'],
    ['z@.tj'],
    ['z@x.'],
    ['z @x.tj'],
    ['z@@x.tj'],
    ['zarina karimova'],
    ['a'.repeat(129)],
  ])('%j → null', (raw) => {
    expect(normalizeIdentifier(raw)).toBeNull();
  });

  it('accepts a login of 128 characters', () => {
    expect(normalizeIdentifier('A'.repeat(128))).toEqual({
      kind: 'login',
      value: 'a'.repeat(128),
    });
  });
});
