import { randomBytes } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CryptoModule, PasswordHasher } from './index';

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
          validate: () => ({ pepperRing }),
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
});
