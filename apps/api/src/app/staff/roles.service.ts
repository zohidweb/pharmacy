import { Injectable } from '@nestjs/common';
import { isPermission, type Permission } from '@pharmacy/shared-domain';
import type { Role, RoleInput } from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { newId, TenantDatabase, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { roleDisplayName, toRoleTemplateKey } from '../auth/session-profile';
import { PermissionsVersionService } from '../auth/permissions-version.service';
import {
  type Editor,
  permissionsOf,
  roleWithinEditor,
  scopeOf,
} from './assignment-rules';
import { type RoleRow, StaffRepository } from './staff.repository';

const notFound = () => new ProblemException(404, 'not_found');
const escalation = () => new ProblemException(403, 'permission_escalation');

/** The principal as the editor of the assignment rules. */
export async function loadEditor(
  repository: StaffRepository,
  trx: TenantTransaction,
): Promise<Editor> {
  const principal = requirePrincipal();
  return {
    employeeId: principal.employeeId,
    permissions: principal.permissions,
    scope: scopeOf(principal.storeScope),
    isOwner: await repository.isOwnerEmployee(trx, principal.tenantId, principal.employeeId),
  };
}

// Roles of the network (spec 2026-10-06-staff-design, section 4; ADR-0018, п. 2–4): «Владелец» is
// a system role with every permission; any other role is a set of catalog permissions that never
// exceeds the editor's own; one's own role is not edited.
@Injectable()
export class RolesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: StaffRepository,
    private readonly versions: PermissionsVersionService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Role[]> {
    const { tenantId, locale } = requirePrincipal();
    const rows = await this.db.tenantTransaction((trx) =>
      this.repository.listRoles(trx, tenantId),
    );
    return rows.map((row) => toRole(row, locale));
  }

  async create(input: RoleInput): Promise<Role> {
    const { tenantId, locale } = requirePrincipal();
    const permissions = catalogPermissions(input.permissions);
    return this.db.tenantTransaction(async (trx) => {
      const editor = await loadEditor(this.repository, trx);
      if (!roleWithinEditor(editor, { isOwner: false, permissions })) throw escalation();
      if (await this.repository.roleNameTaken(trx, tenantId, input.name, null)) {
        throw nameTaken();
      }
      const id = newId();
      await this.repository.insertRole(trx, tenantId, id, input.name, permissions);
      await this.audit.append(trx, {
        action: 'role.created',
        entityType: 'role',
        entityId: id,
        details: { name: input.name, permissions: permissions.length },
      });
      return toRole(await this.read(trx, tenantId, id), locale);
    });
  }

  async update(id: string, input: RoleInput): Promise<Role> {
    const { tenantId, locale, employeeId } = requirePrincipal();
    const roleId = id.toLowerCase();
    const permissions = catalogPermissions(input.permissions);
    let afterCommit: () => Promise<void> = async () => undefined;
    const role = await this.db.tenantTransaction(async (trx) => {
      const current = await this.repository.findRole(trx, tenantId, roleId);
      if (current === null) throw notFound();
      if (current.isOwner) throw new ProblemException(409, 'system_role');
      const editor = await loadEditor(this.repository, trx);
      const holders = await this.repository.roleEmployeeIds(trx, tenantId, roleId);
      if (holders.includes(employeeId)) throw new ProblemException(403, 'own_assignment');
      // Neither the new set nor the role as it is may exceed the editor (a stronger role is not
      // touched, even to take permissions away).
      if (
        !roleWithinEditor(editor, { isOwner: false, permissions }) ||
        !roleWithinEditor(editor, current)
      ) {
        throw escalation();
      }
      if (await this.repository.roleNameTaken(trx, tenantId, input.name, roleId)) {
        throw nameTaken();
      }
      await this.repository.updateRole(trx, tenantId, roleId, input.name, permissions);
      afterCommit = await this.versions.bump(trx, holders);
      await this.audit.append(trx, {
        action: 'role.updated',
        entityType: 'role',
        entityId: roleId,
        details: { name: input.name, permissions: permissions.length },
      });
      return this.read(trx, tenantId, roleId);
    });
    await afterCommit();
    return toRole(role, locale);
  }

  private async read(trx: TenantTransaction, tenantId: string, id: string): Promise<RoleRow> {
    const role = await this.repository.findRole(trx, tenantId, id);
    if (role === null) throw new Error('The role just written is not readable');
    return role;
  }
}

const nameTaken = () =>
  new FieldProblemException(409, 'role_name_taken', [
    { field: 'name', code: 'role_name_taken' },
  ]);

// Catalog strings only, in a stable order (the DTO already rejects duplicates).
function catalogPermissions(values: readonly string[]): Permission[] {
  const unknown = values.filter((value) => !isPermission(value));
  if (unknown.length > 0) {
    throw new FieldProblemException(400, 'validation_failed', [
      { field: 'permissions', code: 'unknown_permission' },
    ]);
  }
  return [...(values as Permission[])].sort();
}

export function toRole(row: RoleRow, locale: 'ru' | 'tg'): Role {
  return {
    id: row.id,
    name: roleDisplayName(row.name, locale),
    system: row.isOwner,
    templateKey: toRoleTemplateKey(row.templateKey),
    permissions: [...permissionsOf(row)],
    employees: row.employees,
  };
}
