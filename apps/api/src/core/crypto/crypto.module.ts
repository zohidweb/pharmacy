import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KeyRing } from './key-ring';
import { PasswordHasher } from './password-hasher';
import { runCryptoSelfCheck } from './self-check';
import { SessionTokenService } from './session-token.service';

// Password hashing, session tokens and the start-up crypto self-check (ADR-0008). Global;
// exports PasswordHasher and SessionTokenService.
@Global()
@Module({
  providers: [
    {
      provide: PasswordHasher,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new PasswordHasher(config.getOrThrow<KeyRing>('pepperRing')),
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
export class CryptoModule implements OnModuleInit {
  onModuleInit(): void {
    runCryptoSelfCheck();
  }
}
