import { randomToken, sha256Hex } from './tokens';

describe('randomToken', () => {
  it('returns base64url of 32 random bytes by default', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('honours the requested size and is not repeated', () => {
    expect(Buffer.from(randomToken(16), 'base64url')).toHaveLength(16);
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 test vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
