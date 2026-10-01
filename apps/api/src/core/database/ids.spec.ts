import { newId } from './ids';

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
