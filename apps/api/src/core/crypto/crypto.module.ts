import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KeyRing } from './key-ring';
import { PasswordHasher } from './password-hasher';
import { runCryptoSelfCheck } from './self-check';
import { SessionTokenService } from './session-token.service';

// Password hashing, session tokens and the start-up crypto self-check (ADR-0008). Global;
// exports PasswordHasher and SessionTokenService. The self-check runs before the hasher exists, so
// no scrypt (not even its dummy hash) runs on a runtime that failed it.
@Global()
@Module({
  providers: [
    {
      provide: PasswordHasher,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        runCryptoSelfCheck();
        return new PasswordHasher(config.getOrThrow<KeyRing>('pepperRing'));
      },
    },
    {
      provide: SessionTokenService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SessionTokenService(config.getOrThrow<KeyRing>('jwtKeyRing')),
    },
  ],
  exports: [PasswordHasher, SessionTokenService],
})
export class CryptoModule {}
