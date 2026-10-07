import { Injectable } from '@nestjs/common';
import { checkPin, passwordProblems } from '@pharmacy/shared-domain';
import type {
  AuditAction,
  CreateEmployeeRequest,
  EmployeeCard,
  EmployeeListItem,
  EmployeeListQuery,
  EmployeeListResponse,
  EmployeeStatus,
  UpdateEmployeeRequest,
} from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { PasswordHasher } from '../../core/crypto';
import {
  newId,
  TenantDatabase,
  type TenantTransaction,
  uniqueConstraint,
} from '../../core/database';
import { SessionStore } from '../../core/sessions';
import { AuditService } from '../audit/audit.service';
import { normalizeIdentifier } from '../auth/identifier';
import { PermissionsVersionService } from '../auth/permissions-version.service';
import { dbLanguage, roleDisplayName, uiLocale } from '../auth/session-profile';
import {
  type Editor,
  isVisible,
  roleWithinEditor,
  type Scope,
  sameScope,
  scopeWithinEditor,
} from './assignment-rules';
import { loadEditor } from './roles.service';
import { type EmployeeRow, type Hash, StaffRepository } from './staff.repository';

const DEFAULT_LIMIT = 20;
const ACTIVITY_LIMIT = 20;

const notFound = () => new ProblemException(404, 'not_found');
const invalid = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);

// Unique indexes of employees → the conflict of the field (spec 2026-10-06-staff-design, section 4).
const CONFLICTS: Readonly<Record<string, { code: string; field: string }>> = {
  employees_login_uq: { code: 'login_taken', field: 'login' },
  employees_login_global_uq: { code: 'login_taken', field: 'login' },
  employees_phone_global_uq: { code: 'phone_taken', field: 'phone' },
  employees_email_global_uq: { code: 'email_taken', field: 'email' },
};

// The audit actions of the API shown in the employee card as the UI's action kinds.
const ACTIVITY_KINDS: Readonly<Record<string, AuditAction>> = {
  'auth.login-succeeded': 'sign_in',
  'auth.pin-succeeded': 'sign_in',
  'employee.blocked': 'employee_block',
  'employee.unblocked': 'employee_block',
  'employee.password-reset': 'password_reset',
  'auth.password-changed': 'password_reset',
  'employee.assignment-changed': 'role_change',
  'employee.created': 'role_change',
  'role.created': 'role_change',
  'role.updated': 'role_change',
};

/** Normalized identifiers and data of an employee form. */
interface EmployeeFields {
  fullName: string;
  login: string;
  phone: string;
  /** undefined — keep the current one (update only). */
  email: string | null | undefined;
  language: 'ru' | 'tj';
}

// Employees of the network (spec 2026-10-06-staff-design, section 4; ADR-0018): one role and a store
// scope, never above the editor; one's own assignment and status are not changed; the network keeps
// an active owner. Changes reach the employee's sessions on the next request.
@Injectable()
export class EmployeesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: StaffRepository,
    private readonly hasher: PasswordHasher,
    private readonly versions: PermissionsVersionService,
    private readonly sessions: SessionStore,
    private readonly audit: AuditService,
  ) {}

  async list(query: EmployeeListQuery): Promise<EmployeeListResponse> {
    const principal = requirePrincipal();
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const viewer = await loadEditor(this.repository, trx);
      const { rows, total } = await this.repository.listEmployees(
        trx,
        principal.tenantId,
        viewer.scope,
        {
          storeId: query.storeId?.toLowerCase(),
          roleId: query.roleId?.toLowerCase(),
          status: query.status,
        },
        limit,
        offset,
      );
      const context = await this.viewContext(trx);
      return { items: rows.map((row) => context.toItem(row)), total, limit, offset };
    });
  }

  async get(id: string): Promise<EmployeeCard> {
    return this.db.tenantTransaction(async (trx) => {
      const viewer = await loadEditor(this.repository, trx);
      const employee = await this.visible(trx, viewer, id.toLowerCase());
      return this.card(trx, employee);
    });
  }

  async create(body: CreateEmployeeRequest): Promise<EmployeeCard> {
    const { tenantId } = requirePrincipal();
    const fields = normalizeFields(body, false);
    if (passwordProblems(body.password).length > 0) {
      throw new ProblemException(422, 'password_policy');
    }
    const id = newId();
    // Hashes are computed before the transaction: no transaction is held open during scrypt.
    const minLength = await this.db.tenantTransaction((trx) =>
      this.repository.pinMinLength(trx, tenantId),
    );
    checkEmployeePin(body.pin, minLength, 'pin');
    const password = await this.hasher.hash(body.password);
    const pin = body.pin === '' ? null : await this.hasher.hash(body.pin);
    try {
      return await this.db.tenantTransaction(async (trx) => {
        const editor = await loadEditor(this.repository, trx);
        const { roleId, scope } = await this.checkAssignment(trx, editor, body);
        await this.repository.insertEmployee(
          trx,
          tenantId,
          { id, roleId, scope, ...fields, email: fields.email ?? null },
          password,
          pin,
        );
        await this.audit.append(trx, {
          action: 'employee.created',
          entityType: 'employee',
          entityId: id,
          details: { roleId, stores: scope },
        });
        return this.card(trx, await this.read(trx, id));
      });
    } catch (error) {
      throw asConflict(error);
    }
  }

  async update(id: string, body: UpdateEmployeeRequest): Promise<EmployeeCard> {
    const principal = requirePrincipal();
    const { tenantId } = principal;
    const employeeId = id.toLowerCase();
    const fields = normalizeFields(body, true);
    let afterCommit: () => Promise<void> = async () => undefined;
    try {
      const card = await this.db.tenantTransaction(async (trx) => {
        const editor = await loadEditor(this.repository, trx);
        const employee = await this.editable(trx, editor, employeeId);
        const assigned = body.storeIds === null ? null : body.storeIds.map((s) => s.toLowerCase());
        const changed =
          employee.roleId !== body.roleId.toLowerCase() ||
          !sameScope(scopeOfRow(employee), assigned);
        if (changed) {
          if (employee.id === principal.employeeId) {
            throw new ProblemException(403, 'own_assignment');
          }
          if (!principal.permissions.includes('employees:assign-role')) {
            throw new ProblemException(403, 'forbidden');
          }
          const { roleId, scope, isOwner } = await this.checkAssignment(trx, editor, body);
          if (
            employee.roleIsOwner &&
            !isOwner &&
            employee.status === 'active' &&
            (await this.repository.activeOwners(trx, tenantId)) <= 1
          ) {
            throw new ProblemException(409, 'last_owner');
          }
          await this.repository.assign(trx, tenantId, employee.id, roleId, scope);
          afterCommit = await this.versions.bump(trx, [employee.id]);
          await this.audit.append(trx, {
            action: 'employee.assignment-changed',
            entityType: 'employee',
            entityId: employee.id,
            details: { roleId, stores: scope },
          });
        }
        await this.repository.updateEmployee(trx, tenantId, employee.id, fields);
        await this.audit.append(trx, {
          action: 'employee.updated',
          entityType: 'employee',
          entityId: employee.id,
        });
        return this.card(trx, await this.read(trx, employee.id));
      });
      await afterCommit();
      return card;
    } catch (error) {
      throw asConflict(error);
    }
  }

  /** The manager sets a new password; every session of the employee ends. */
  async resetPassword(id: string, newPassword: string): Promise<void> {
    const { tenantId } = requirePrincipal();
    const employeeId = id.toLowerCase();
    if (passwordProblems(newPassword).length > 0) {
      throw new ProblemException(422, 'password_policy');
    }
    await this.db.tenantTransaction(async (trx) => {
      const editor = await loadEditor(this.repository, trx);
      await this.othersEditable(trx, editor, employeeId);
    });
    const hash = await this.hasher.hash(newPassword);
    await this.db.tenantTransaction(async (trx) => {
      await this.repository.setPassword(trx, tenantId, employeeId, hash);
      await this.audit.append(trx, {
        action: 'employee.password-reset',
        entityType: 'employee',
        entityId: employeeId,
      });
    });
    await this.sessions.destroyAllFor(tenantId, employeeId);
  }

  /** The manager sets a new PIN; it also lifts the PIN lock. */
  async setPin(id: string, pin: string): Promise<void> {
    const { tenantId } = requirePrincipal();
    const employeeId = id.toLowerCase();
    const minLength = await this.db.tenantTransaction(async (trx) => {
      const editor = await loadEditor(this.repository, trx);
      await this.othersEditable(trx, editor, employeeId);
      return this.repository.pinMinLength(trx, tenantId);
    });
    checkEmployeePin(pin, minLength, 'pin');
    const hash: Hash = await this.hasher.hash(pin);
    await this.db.tenantTransaction(async (trx) => {
      await this.repository.setPin(trx, tenantId, employeeId, hash);
      await this.audit.append(trx, {
        action: 'employee.pin-set',
        entityType: 'employee',
        entityId: employeeId,
      });
    });
  }

  /** Blocking ends every session of the employee (ADR-0018, п. 7). */
  async setStatus(id: string, status: EmployeeStatus): Promise<EmployeeCard> {
    const { tenantId } = requirePrincipal();
    const employeeId = id.toLowerCase();
    let afterCommit: () => Promise<void> = async () => undefined;
    let blocked = false;
    const card = await this.db.tenantTransaction(async (trx) => {
      const editor = await loadEditor(this.repository, trx);
      const employee = await this.othersEditable(trx, editor, employeeId);
      if (employee.status !== status) {
        if (
          status === 'blocked' &&
          employee.roleIsOwner &&
          (await this.repository.activeOwners(trx, tenantId)) <= 1
        ) {
          throw new ProblemException(409, 'last_owner');
        }
        await this.repository.setStatus(trx, tenantId, employee.id, status);
        afterCommit = await this.versions.bump(trx, [employee.id]);
        blocked = status === 'blocked';
        await this.audit.append(trx, {
          action: status === 'blocked' ? 'employee.blocked' : 'employee.unblocked',
          entityType: 'employee',
          entityId: employee.id,
        });
      }
      return this.card(trx, await this.read(trx, employee.id));
    });
    try {
      await afterCommit();
    } finally {
      // A failed cache write of the version must not keep a blocked employee signed in.
      if (blocked) await this.sessions.destroyAllFor(tenantId, employeeId);
    }
    return card;
  }

  /**
   * The role and scope of a form against ADR-0018, п. 4: an active role of the network not above
   * the editor; «Владелец» always has the whole network; a list of active stores within the
   * editor's scope.
   */
  private async checkAssignment(
    trx: TenantTransaction,
    editor: Editor,
    body: Pick<UpdateEmployeeRequest, 'roleId' | 'storeIds'>,
  ): Promise<{ roleId: string; scope: Scope; isOwner: boolean }> {
    const { tenantId } = requirePrincipal();
    const role = await this.repository.findRole(trx, tenantId, body.roleId.toLowerCase());
    if (role === null) throw invalid('roleId', 'unknown_role');
    if (!roleWithinEditor(editor, role)) {
      throw new ProblemException(403, 'permission_escalation');
    }
    const scope: Scope = role.isOwner
      ? null
      : body.storeIds === null
        ? null
        : [...new Set(body.storeIds.map((s) => s.toLowerCase()))];
    if (scope !== null) {
      if (scope.length === 0) throw invalid('storeIds', 'required');
      const active = await this.repository.activeStoreIds(trx, tenantId, scope);
      if (active.length !== scope.length) throw invalid('storeIds', 'unknown_store');
    }
    if (!scopeWithinEditor(editor, scope)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    return { roleId: role.id, scope, isOwner: role.isOwner };
  }

  // A visible employee or 404.
  private async visible(
    trx: TenantTransaction,
    viewer: Editor,
    employeeId: string,
  ): Promise<EmployeeRow> {
    const { tenantId } = requirePrincipal();
    const employee = await this.repository.findEmployee(trx, tenantId, employeeId);
    if (employee === null || !isVisible(viewer.scope, scopeOfRow(employee))) throw notFound();
    return employee;
  }

  // A visible employee who is not above the editor — neither the role nor the stores: resetting the
  // password of a stronger employee, or of one working in other stores too, would hand over that
  // employee's permissions or stores (ADR-0018, п. 4).
  private async editable(
    trx: TenantTransaction,
    editor: Editor,
    employeeId: string,
  ): Promise<EmployeeRow> {
    const employee = await this.visible(trx, editor, employeeId);
    if (employee.id === editor.employeeId) return employee;
    const role = await this.repository.findRole(trx, requirePrincipal().tenantId, employee.roleId);
    if (role === null || !roleWithinEditor(editor, role)) {
      throw new ProblemException(403, 'permission_escalation');
    }
    if (!scopeWithinEditor(editor, scopeOfRow(employee))) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    return employee;
  }

  // As `editable`, and not oneself: one's own password, PIN and status are changed in the profile
  // (with the current password), not here.
  private async othersEditable(
    trx: TenantTransaction,
    editor: Editor,
    employeeId: string,
  ): Promise<EmployeeRow> {
    const employee = await this.editable(trx, editor, employeeId);
    if (employee.id === editor.employeeId) throw new ProblemException(403, 'own_assignment');
    return employee;
  }

  private async read(trx: TenantTransaction, id: string): Promise<EmployeeRow> {
    const employee = await this.repository.findEmployee(trx, requirePrincipal().tenantId, id);
    if (employee === null) throw new Error('The employee just written is not readable');
    return employee;
  }

  private async card(trx: TenantTransaction, employee: EmployeeRow): Promise<EmployeeCard> {
    const { tenantId } = requirePrincipal();
    const context = await this.viewContext(trx);
    const activity = await this.repository.activity(trx, tenantId, employee.id, ACTIVITY_LIMIT);
    return {
      ...context.toItem(employee),
      activity: activity.flatMap((entry) => {
        const action = ACTIVITY_KINDS[entry.action];
        return action === undefined
          ? []
          : [
              {
                at: entry.recordedAt.toISOString(),
                action,
                object: entry.entityType ?? '—',
                details: entry.action,
              },
            ];
      }),
    };
  }

  // What the list items need besides the rows: store names and the default language.
  private async viewContext(trx: TenantTransaction) {
    const { tenantId, locale } = requirePrincipal();
    const names = await this.repository.storeNames(trx, tenantId);
    const defaultLanguage = await this.repository.defaultLanguage(trx, tenantId);
    return {
      toItem: (row: EmployeeRow): EmployeeListItem => {
        const scope = scopeOfRow(row);
        return {
          id: row.id,
          fullName: row.fullName,
          login: row.login,
          phone: row.phone ?? '',
          roleId: row.roleId,
          roleName: roleDisplayName(row.roleName, locale),
          storeIds: scope === null ? null : [...scope],
          storeNames:
            scope === null
              ? [...names.values()]
              : scope.map((storeId) => names.get(storeId) ?? '—'),
          locale: uiLocale(row.language, defaultLanguage),
          status: row.status === 'blocked' ? 'blocked' : 'active',
          pinSet: row.pinSet,
          pinLocked: row.pinLocked,
          lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
        };
      },
    };
  }
}

function scopeOfRow(row: EmployeeRow): Scope {
  return row.storeScope === 'all' ? null : row.storeIds;
}

// Login, phone and e-mail are the sign-in identifiers (ADR-0008, amendment 2026-10-02).
function normalizeFields(
  body: UpdateEmployeeRequest,
  update: boolean,
): EmployeeFields {
  const login = normalizeIdentifier(body.login);
  if (login === null || login.kind !== 'login') throw invalid('login', 'login_format');
  const phone = normalizeIdentifier(body.phone);
  if (phone === null || phone.kind !== 'phone') throw invalid('phone', 'phone_format');
  let email: string | null | undefined = update ? undefined : null;
  if (body.email !== undefined) {
    if (body.email.trim() === '') {
      email = null;
    } else {
      const parsed = normalizeIdentifier(body.email);
      if (parsed === null || parsed.kind !== 'email') throw invalid('email', 'email_format');
      email = parsed.value;
    }
  }
  return {
    fullName: body.fullName.trim(),
    login: login.value,
    phone: phone.value,
    email,
    language: dbLanguage(body.locale),
  };
}

function checkEmployeePin(pin: string, minLength: number, field: string): void {
  if (pin === '' && field === 'pin') return;
  const problem = checkPin(pin, minLength);
  if (problem === 'trivial') {
    throw new FieldProblemException(422, 'pin_trivial', [{ field, code: 'pin_trivial' }]);
  }
  if (problem !== null) {
    throw new FieldProblemException(422, 'pin_length', [{ field, code: 'pin_length' }]);
  }
}

function asConflict(error: unknown): unknown {
  const constraint = uniqueConstraint(error);
  const conflict = constraint === null ? undefined : CONFLICTS[constraint];
  return conflict
    ? new FieldProblemException(409, conflict.code, [
        { field: conflict.field, code: conflict.code },
      ])
    : error;
}
