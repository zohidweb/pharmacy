import { randomBytes } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CryptoModule, PasswordHasher, SessionTokenService } from './index';

describe('CryptoModule', () => {
  it('provides a PasswordHasher built from the validated pepper ring', async () => {
    const pepperRing = {
      activeId: '1',
      keys: new Map([['1', randomBytes(32)]]),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () => ({ pepperRing, jwtKeyRing: pepperRing }),
        }),
        CryptoModule,
      ],
    }).compile();
    await moduleRef.init();

    const hasher = moduleRef.get(PasswordHasher);
    expect(hasher).toBeInstanceOf(PasswordHasher);
    const { phc, pepperVersion } = await hasher.hash('secret');
    expect(pepperVersion).toBe(1);
    await expect(hasher.verify('secret', phc, 1)).resolves.toBe(true);
    await moduleRef.close();
  });

  it('provides a SessionTokenService built from the validated JWT key ring', async () => {
    const jwtKeyRing = {
      activeId: 'k1',
      keys: new Map([['k1', randomBytes(32)]]),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () => ({
            pepperRing: {
              activeId: '1',
              keys: new Map([['1', randomBytes(32)]]),
            },
            jwtKeyRing,
          }),
        }),
        CryptoModule,
      ],
    }).compile();

    const tokens = moduleRef.get(SessionTokenService);
    const claims = { jti: 'j', sub: 's', tid: 't', aud: 'web' as const };
    const token = await tokens.sign(claims, 60);
    await expect(tokens.verify(token, 'web')).resolves.toMatchObject(claims);
    await moduleRef.close();
  });
});
