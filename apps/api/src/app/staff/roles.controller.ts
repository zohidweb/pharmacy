import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import type { Role } from '@pharmacy/shared-dto';
import { RequireFreshAuth } from '../../common/guards/decorators';
import { RequirePermission } from '../auth/decorators';
import { RoleInputDto } from './dto/staff.dto';
import { RolesService } from './roles.service';

// Roles of the network (spec 2026-10-06-staff-design, section 4; ADR-0018, п. 2).
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission('roles:view')
  @Get()
  list(): Promise<Role[]> {
    return this.roles.list();
  }

  /** 201; 403 `permission_escalation`, 409 `role_name_taken`. */
  @RequirePermission('roles:manage')
  @RequireFreshAuth()
  @Post()
  create(@Body() body: RoleInputDto): Promise<Role> {
    return this.roles.create(body);
  }

  /** 403 `permission_escalation` / `own_assignment`, 409 `system_role` / `role_name_taken`. */
  @RequirePermission('roles:manage')
  @RequireFreshAuth()
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RoleInputDto,
  ): Promise<Role> {
    return this.roles.update(id, body);
  }
}
