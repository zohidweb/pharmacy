import { Module } from '@nestjs/common';
import { OperatorPrincipalResolver } from '../../../common/middleware/operator-principal-resolver';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { SessionsModule } from '../../../core/sessions';
import { AuthModule } from '../../auth/auth.module';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { OperatorActivationsController } from './operator-activations.controller';
import { OperatorActivationsService } from './operator-activations.service';
import { OperatorAuthRepository } from './operator-auth.repository';
import { OperatorMeController } from './operator-me.controller';
import { OperatorMeService } from './operator-me.service';
import { OperatorSessionResolver } from './operator-session-resolver';
import { OperatorSessionsController } from './operator-sessions.controller';
import { OperatorSessionsService } from './operator-sessions.service';

// Authentication of platform operators, the admin contour (auth design 2026-10-02, section 9),
// and the operator's own profile, password and sessions. SessionTokenService and PasswordHasher
// come from the global CryptoModule; the login limiter and clock from AuthModule. Exports the
// resolver the session middleware uses and the platform audit the operator permissions guard
// writes to.
@Module({
  imports: [PlatformDatabaseModule, SessionsModule, PlatformAuditModule, AuthModule],
  controllers: [
    OperatorSessionsController,
    OperatorActivationsController,
    OperatorMeController,
  ],
  providers: [
    OperatorAuthRepository,
    OperatorSessionsService,
    OperatorActivationsService,
    OperatorMeService,
    OperatorSessionResolver,
    { provide: OperatorPrincipalResolver, useExisting: OperatorSessionResolver },
  ],
  exports: [OperatorPrincipalResolver, PlatformDatabaseModule, PlatformAuditModule],
})
export class OperatorAuthModule {}
