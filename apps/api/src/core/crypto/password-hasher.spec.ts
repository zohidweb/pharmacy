import { randomBytes } from 'node:crypto';
import type { KeyRing } from './key-ring';
import { PasswordHasher } from './password-hasher';

const PHC_PATTERN =
  /^\$scrypt\$ln=15,r=8,p=3\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;

function ring(activeId: string, ids: string[] = [activeId]): KeyRing {
  return {
    activeId,
    keys: new Map(ids.map((id) => [id, randomBytes(32)])),
  };
}

describe('PasswordHasher', () => {
  const peppers = ring('2', ['1', '2']);
  const hasher = new PasswordHasher(peppers);
  const secret = 'correct horse battery staple';
  let phc: string;

  beforeAll(async () => {
    phc = (await hasher.hash(secret)).phc;
  });

  it('hashes into a PHC string and reports the active pepper version', async () => {
    const result = await hasher.hash(secret);
    expect(result.phc).toMatch(PHC_PATTERN);
    expect(result.pepperVersion).toBe(2);
    expect(phc).toMatch(PHC_PATTERN);
    // fresh random salt per hash
    expect(result.phc).not.toBe(phc);
  });

  it('verifies the right secret and rejects a wrong one', async () => {
    await expect(hasher.verify(secret, phc, 2)).resolves.toBe(true);
    await expect(hasher.verify('wrong secret', phc, 2)).resolves.toBe(false);
  });

  it('rejects the same secret under a different pepper key', async () => {
    const other = new PasswordHasher(ring('2', ['1', '2']));
    await expect(other.verify(secret, phc, 2)).resolves.toBe(false);
  });

  it('keeps verifying hashes made under a retired pepper version', async () => {
    const rotated = new PasswordHasher({
      activeId: '3',
      keys: new Map([...peppers.keys, ['3', randomBytes(32)]]),
    });
    await expect(rotated.verify(secret, phc, 2)).resolves.toBe(true);
    expect(rotated.needsRehash(phc, 2)).toBe(true);
  });

  it('returns false (never throws) for malformed input', async () => {
    const [, , , salt, hash] = phc.split('$');
    const bad = [
      '',
      'not a phc',
      '$scrypt$ln=15,r=8,p=3$$',
      `$scrypt$ln=15,r=8,p=3$${salt}`,
      `$scrypt$ln=15,r=8,p=3$${salt}$${hash.slice(0, 20)}`,
      `$scrypt$ln=15,r=8,p=3$${salt.slice(0, 10)}$${hash}`,
      `$scrypt$ln=abc,r=8,p=3$${salt}$${hash}`,
      `$scrypt$ln=40,r=8,p=3$${salt}$${hash}`,
      `$argon2id$ln=15,r=8,p=3$${salt}$${hash}`,
    ];
    for (const value of bad) {
      await expect(hasher.verify(secret, value, 2)).resolves.toBe(false);
    }
  });

  it('returns false for an unknown pepper version', async () => {
    await expect(hasher.verify(secret, phc, 99)).resolves.toBe(false);
    await expect(hasher.verify(secret, phc, Number.NaN)).resolves.toBe(false);
  });

  it('verifyDummy always resolves false', async () => {
    await expect(hasher.verifyDummy(secret)).resolves.toBe(false);
  });

  it('needsRehash flags old parameters, inactive pepper and malformed hashes', () => {
    expect(hasher.needsRehash(phc, 2)).toBe(false);
    expect(hasher.needsRehash(phc, 1)).toBe(true);
    expect(hasher.needsRehash(phc.replace('ln=15', 'ln=14'), 2)).toBe(true);
    expect(hasher.needsRehash(phc.replace('p=3', 'p=1'), 2)).toBe(true);
    expect(hasher.needsRehash('garbage', 2)).toBe(true);
  });

  it('refuses a non-numeric active pepper id', () => {
    expect(() => new PasswordHasher(ring('k1'))).toThrow(/pepper/i);
  });
});
