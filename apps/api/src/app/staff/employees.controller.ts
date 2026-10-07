import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { EmployeeCard, EmployeeListResponse } from '@pharmacy/shared-dto';
import { RequireFreshAuth } from '../../common/guards/decorators';
import { RequirePermission } from '../auth/decorators';
import {
  CreateEmployeeDto,
  EmployeeListQueryDto,
  ResetEmployeePasswordDto,
  SetEmployeePinDto,
  SetEmployeeStatusDto,
  UpdateEmployeeDto,
} from './dto/staff.dto';
import { EmployeesService } from './employees.service';

// Employees of the network (spec 2026-10-06-staff-design, section 4). Every change needs a fresh
// password sign-in (auth design, guard 5).
@Controller({ path: 'employees', version: '1' })
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @RequirePermission('employees:view')
  @Get()
  list(@Query() query: EmployeeListQueryDto): Promise<EmployeeListResponse> {
    return this.employees.list(query);
  }

  /** 404 outside the viewer's scope. */
  @RequirePermission('employees:view')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<EmployeeCard> {
    return this.employees.get(id);
  }

  /** 201; 403 `permission_escalation` / `store_not_in_scope`, 409 `*_taken`, 422 policies. */
  @RequirePermission('employees:create')
  @RequireFreshAuth()
  @Post()
  create(@Body() body: CreateEmployeeDto): Promise<EmployeeCard> {
    return this.employees.create(body);
  }

  /** A new role or scope also needs `employees:assign-role`; 403 `own_assignment`, 409 `last_owner`. */
  @RequirePermission('employees:update')
  @RequireFreshAuth()
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateEmployeeDto,
  ): Promise<EmployeeCard> {
    return this.employees.update(id, body);
  }

  /** 204; the employee's sessions end. 422 `password_policy`. */
  @RequirePermission('employees:update')
  @RequireFreshAuth()
  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ResetEmployeePasswordDto,
  ): Promise<void> {
    return this.employees.resetPassword(id, body.newPassword);
  }

  /** 204; lifts the PIN lock. 422 `pin_length` / `pin_trivial`. */
  @RequirePermission('employees:update')
  @RequireFreshAuth()
  @Post(':id/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  setPin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetEmployeePinDto,
  ): Promise<void> {
    return this.employees.setPin(id, body.pin);
  }

  /** Blocking ends the employee's sessions; 403 `own_assignment`, 409 `last_owner`. */
  @RequirePermission('employees:update')
  @RequireFreshAuth()
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SetEmployeeStatusDto,
  ): Promise<EmployeeCard> {
    return this.employees.setStatus(id, body.status);
  }
}
