import { uuidv7 } from './id';

describe('uuidv7', () => {
  it('produces RFC 9562 version 7 identifiers', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is unique and ordered by creation time', () => {
    const ids = Array.from({ length: 50 }, () => uuidv7());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});
