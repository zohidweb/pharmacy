import { randomBytes } from 'node:crypto';
import { parseKeyRing } from './key-ring';

const key = (bytes = 32): string => randomBytes(bytes).toString('base64url');

describe('parseKeyRing', () => {
  it('parses a list of keys and selects the active one', () => {
    const k1 = key();
    const k2 = key();
    const ring = parseKeyRing(`k1:${k1},k2:${k2}`, 'k2', 'SESSION_JWT_KEYS');
    expect(ring.activeId).toBe('k2');
    expect(ring.keys.size).toBe(2);
    expect(ring.keys.get('k1')).toEqual(Buffer.from(k1, 'base64url'));
    expect(ring.keys.get('k2')).toEqual(Buffer.from(k2, 'base64url'));
  });

  it('accepts a longer key and surrounding whitespace', () => {
    const ring = parseKeyRing(
      ` 1:${key(48)} , 2:${key()} `,
      '1',
      'PASSWORD_PEPPERS',
    );
    expect(ring.keys.get('1')?.length).toBe(48);
    expect(ring.keys.size).toBe(2);
  });

  it('rejects a key shorter than 32 bytes without leaking the key', () => {
    const short = key(31);
    let message = '';
    try {
      parseKeyRing(`k1:${short}`, 'k1', 'SESSION_JWT_KEYS');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('SESSION_JWT_KEYS');
    expect(message).not.toContain(short);
  });

  it('rejects a repeated key id', () => {
    expect(() =>
      parseKeyRing(`k1:${key()},k1:${key()}`, 'k1', 'SESSION_JWT_KEYS'),
    ).toThrow(/SESSION_JWT_KEYS/);
  });

  it('rejects an active id that is not in the list', () => {
    expect(() =>
      parseKeyRing(`k1:${key()}`, 'k2', 'SESSION_JWT_ACTIVE_KID'),
    ).toThrow(/SESSION_JWT_ACTIVE_KID/);
  });

  it('rejects an empty string', () => {
    expect(() => parseKeyRing('', 'k1', 'SESSION_JWT_KEYS')).toThrow(
      /SESSION_JWT_KEYS/,
    );
    expect(() => parseKeyRing('  ', 'k1', 'SESSION_JWT_KEYS')).toThrow(
      /SESSION_JWT_KEYS/,
    );
  });

  it.each(['k1', ':abc', 'k1:', 'k1:not base64!', 'k1:a:b'])(
    'rejects a malformed entry %p without leaking it',
    (entry) => {
      let message = '';
      try {
        parseKeyRing(entry, 'k1', 'SESSION_JWT_KEYS');
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('SESSION_JWT_KEYS');
      expect(message).not.toContain(entry);
    },
  );

  it('rejects a blank key id', () => {
    expect(() => parseKeyRing(`:${key()}`, 'k1', 'SESSION_JWT_KEYS')).toThrow(
      /SESSION_JWT_KEYS/,
    );
  });
});
