import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '../../../core/database/platform';
import { SessionsModule } from '../../../core/sessions';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { TenantsController } from './tenants.controller';
import { TenantsRepository } from './tenants.repository';
import { TenantsService } from './tenants.service';

// Networks of the platform for the operator (spec 2026-10-05-tenants-module). Cloud only: an
// offline store has no operator contour.
@Module({
  imports: [PlatformDatabaseModule, SessionsModule, PlatformAuditModule],
  controllers: [TenantsController],
  providers: [TenantsRepository, TenantsService],
})
export class TenantsModule {}
