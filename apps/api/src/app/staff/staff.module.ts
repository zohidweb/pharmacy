import { Module } from '@nestjs/common';
import { SessionsModule } from '../../core/sessions';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { StaffRepository } from './staff.repository';

// Employees and roles of the network (spec 2026-10-06-staff-design). Cloud only: an offline store
// receives them by the change feed (ADR-0014). TenantDatabase comes from the global DatabaseModule,
// PasswordHasher from the global CryptoModule; the permissions version from AuthModule.
@Module({
  imports: [SessionsModule, AuditModule, AuthModule],
  controllers: [EmployeesController, RolesController],
  providers: [StaffRepository, EmployeesService, RolesService],
})
export class StaffModule {}
