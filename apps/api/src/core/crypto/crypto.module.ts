import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KeyRing } from './key-ring';
import { PasswordHasher } from './password-hasher';
import { runCryptoSelfCheck } from './self-check';

// Password hashing and the start-up crypto self-check (ADR-0008). Global; exports PasswordHasher.
@Global()
@Module({
  providers: [
    {
      provide: PasswordHasher,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new PasswordHasher(config.getOrThrow<KeyRing>('pepperRing')),
    },
  ],
  exports: [PasswordHasher],
})
export class CryptoModule implements OnModuleInit {
  onModuleInit(): void {
    runCryptoSelfCheck();
  }
}
