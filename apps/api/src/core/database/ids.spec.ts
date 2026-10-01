import { isUuid, newId } from './ids';

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('returns a version 7 UUID', () => {
    expect(newId()).toMatch(UUID_V7);
  });

  it('returns increasing ids on consecutive calls', () => {
    const a = newId();
    const b = newId();
    expect(a < b).toBe(true);
  });
});

describe('isUuid', () => {
  it('accepts canonical UUIDs in either case', () => {
    expect(isUuid(newId())).toBe(true);
    expect(isUuid(newId().toUpperCase())).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['short', 'x'],
    ['no dashes', '0190000000007000800000000000000a'],
    ['braces', '{01900000-0000-7000-8000-00000000000a}'],
    ['trailing text', '01900000-0000-7000-8000-00000000000a; reset all'],
    ['trailing newline', '01900000-0000-7000-8000-00000000000a\n'],
    ['non-hex', '0190000g-0000-7000-8000-00000000000a'],
    ['number', 42],
    ['undefined', undefined],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });
});
