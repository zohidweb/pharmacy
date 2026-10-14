import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { SessionsModule } from '../../../core/sessions';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { OperatorsController } from './operators.controller';
import { OperatorsRepository } from './operators.repository';
import { OperatorsService } from './operators.service';

// The platform team for the operator contour. Cloud only: an offline store has no operators.
@Module({
  imports: [PlatformDatabaseModule, SessionsModule, PlatformAuditModule],
  controllers: [OperatorsController],
  providers: [OperatorsRepository, OperatorsService],
})
export class OperatorsModule {}
