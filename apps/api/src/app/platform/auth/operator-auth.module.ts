import { Module } from '@nestjs/common';
import { OperatorPrincipalResolver } from '../../../common/middleware/operator-principal-resolver';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { SessionsModule } from '../../../core/sessions';
import { OperatorSessionResolver } from './operator-session-resolver';

// Authentication of platform operators, the admin contour (auth design 2026-10-02, section 9).
// SessionTokenService and PasswordHasher come from the global CryptoModule.
@Module({
  imports: [PlatformDatabaseModule, SessionsModule],
  providers: [
    OperatorSessionResolver,
    { provide: OperatorPrincipalResolver, useExisting: OperatorSessionResolver },
  ],
  exports: [OperatorPrincipalResolver],
})
export class OperatorAuthModule {}
