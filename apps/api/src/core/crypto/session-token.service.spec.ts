import { randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { KeyRing } from './key-ring';
import {
  type SessionClaims,
  SessionTokenService,
} from './session-token.service';

// Session JWT (ADR-0008, amendment 2026-10-02, item 1): HS256 with a key picked by kid from the
// key ring, strict algorithm, issuer and audience; any failure is reported as null.

const K1 = randomBytes(32);
const K2 = randomBytes(32);

const ring = (
  activeId: string,
  keys: Record<string, Buffer> = { k1: K1, k2: K2 },
): KeyRing => ({
  activeId,
  keys: new Map(Object.entries(keys)),
});

const claims: SessionClaims = {
  jti: '0197a1b2-0000-7000-8000-0000000000a1',
  sub: '0197a1b2-0000-7000-8000-0000000000e1',
  tid: '0197a1b2-0000-7000-8000-0000000000t1',
  aud: 'web',
};

const jwt = new JwtService();

const segment = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const decodeSegment = (part: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;

// A token signed outside the service, to forge the cases the service must reject.
function forge(options: {
  secret?: Buffer;
  kid?: string;
  algorithm?: 'HS256' | 'HS512';
  audience?: string;
  issuer?: string;
  expiresIn?: number;
}): Promise<string> {
  return jwt.signAsync(
    { tid: claims.tid },
    {
      secret: options.secret ?? K1,
      algorithm: options.algorithm ?? 'HS256',
      keyid: options.kid ?? 'k1',
      audience: options.audience ?? 'web',
      issuer: options.issuer ?? 'pharmacy-api',
      subject: claims.sub,
      jwtid: claims.jti,
      expiresIn: options.expiresIn ?? 600,
    },
  );
}

describe('SessionTokenService', () => {
  const service = new SessionTokenService(ring('k1'));

  it('signs HS256 with the active kid and exactly the session claims', async () => {
    const token = await service.sign(claims, 600);
    const [header, payload] = token.split('.');

    expect(decodeSegment(header)).toEqual({
      alg: 'HS256',
      typ: 'JWT',
      kid: 'k1',
    });
    const body = decodeSegment(payload);
    expect(Object.keys(body).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'jti',
      'sub',
      'tid',
    ]);
    expect(body).toMatchObject({ ...claims, iss: 'pharmacy-api' });
    expect(body.exp).toBe((body.iat as number) + 600);
  });

  it('verifies its own token', async () => {
    const token = await service.sign(claims, 600);
    const verified = await service.verify(token, 'web');
    expect(verified).toEqual({
      ...claims,
      iat: expect.any(Number),
      exp: expect.any(Number),
    });
  });

  it('rejects alg: none', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = `${segment({ alg: 'none', typ: 'JWT', kid: 'k1' })}.${segment(
      {
        ...claims,
        iss: 'pharmacy-api',
        iat: now,
        exp: now + 600,
      },
    )}.`;
    await expect(service.verify(token, 'web')).resolves.toBeNull();
  });

  it('rejects HS512 even with the right key', async () => {
    await expect(
      service.verify(await forge({ algorithm: 'HS512' }), 'web'),
    ).resolves.toBeNull();
  });

  it('rejects a signature made with another key', async () => {
    const token = await forge({ secret: randomBytes(32) });
    await expect(service.verify(token, 'web')).resolves.toBeNull();
  });

  it('rejects a key id that is not in the ring', async () => {
    await expect(
      service.verify(await forge({ kid: 'k9' }), 'web'),
    ).resolves.toBeNull();
  });

  it('rejects a token without a kid', async () => {
    const token = await jwt.signAsync(
      { tid: claims.tid },
      {
        secret: K1,
        audience: 'web',
        issuer: 'pharmacy-api',
        subject: claims.sub,
        jwtid: claims.jti,
      },
    );
    await expect(service.verify(token, 'web')).resolves.toBeNull();
  });

  it('rejects another audience', async () => {
    await expect(
      service.verify(await forge({ audience: 'admin' }), 'web'),
    ).resolves.toBeNull();
  });

  it('rejects another issuer', async () => {
    await expect(
      service.verify(await forge({ issuer: 'someone' }), 'web'),
    ).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    await expect(
      service.verify(await forge({ expiresIn: -10 }), 'web'),
    ).resolves.toBeNull();
  });

  it('rejects a modified payload', async () => {
    const [header, payload, signature] = (
      await service.sign(claims, 600)
    ).split('.');
    const tampered = segment({
      ...decodeSegment(payload),
      sub: '0197a1b2-0000-7000-8000-0000000000e2',
    });
    await expect(
      service.verify(`${header}.${tampered}.${signature}`, 'web'),
    ).resolves.toBeNull();
  });

  it.each(['', 'not-a-jwt', 'a.b.c', '...', `${segment({ kid: 'k1' })}.e30.`])(
    'rejects a non-JWT string %p',
    async (token) => {
      await expect(service.verify(token, 'web')).resolves.toBeNull();
    },
  );

  it('rotation: a token signed with the previous active key still verifies', async () => {
    const before = new SessionTokenService(ring('k1'));
    const after = new SessionTokenService(ring('k2'));
    const oldToken = await before.sign(claims, 600);

    await expect(after.verify(oldToken, 'web')).resolves.toMatchObject(claims);
    const newToken = await after.sign(claims, 600);
    expect(decodeSegment(newToken.split('.')[0]).kid).toBe('k2');
  });

  it('rejects a token whose kid was removed from the ring', async () => {
    const token = await new SessionTokenService(ring('k1')).sign(claims, 600);
    const withoutK1 = new SessionTokenService(ring('k2', { k2: K2 }));
    await expect(withoutK1.verify(token, 'web')).resolves.toBeNull();
  });
});
