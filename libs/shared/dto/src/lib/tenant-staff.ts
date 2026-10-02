/*
 * REST contract of employees, roles and terminals (ТЗ «Сотрудники и роли», UI mockup «Сотрудники и
 * роли», ADR-0018). Roles are dynamic per tenant: a set of permissions of the catalog in
 * @pharmacy/shared-domain; one role per employee plus a store scope. No escalation: a role and an
 * assignment never exceed the editor's own permissions and scope; one's own role and scope are not
 * changed; «Владелец» is a system role. Passwords and PINs travel only in requests and are hashed by
 * the server (scrypt, ADR-0008); responses never carry them.
 */
import type { Permission, RoleTemplateKey } from '@pharmacy/shared-domain';
import type { Page } from './platform-tenants.js';
import type { UiLocale } from './tenant-auth.js';

export type EmployeeStatus = 'active' | 'blocked';

export interface EmployeeListItem {
  id: string;
  fullName: string;
  login: string;
  phone: string;
  roleId: string;
  roleName: string;
  /** null — the whole network. */
  storeIds: string[] | null;
  storeNames: string[];
  locale: UiLocale;
  status: EmployeeStatus;
  pinSet: boolean;
  lastLoginAt: string | null;
}

export interface EmployeeListQuery {
  storeId?: string;
  roleId?: string;
  status?: EmployeeStatus;
  limit?: number;
  offset?: number;
}

/** GET /api/v1/employees?storeId=&roleId=&status=&limit=&offset= */
export type EmployeeListResponse = Page<EmployeeListItem>;

/** POST /api/v1/employees — password and PIN follow ADR-0008 (PIN by the network minimum). */
export interface CreateEmployeeRequest {
  fullName: string;
  phone: string;
  login: string;
  password: string;
  /** Empty — the employee signs in by password only. */
  pin: string;
  roleId: string;
  storeIds: string[] | null;
  locale: UiLocale;
}

/** PUT /api/v1/employees/{id} */
export type UpdateEmployeeRequest = Omit<
  CreateEmployeeRequest,
  'password' | 'pin'
>;

/** POST /api/v1/employees/{id}/password — set by the manager; the employee's sessions end. */
export interface ResetEmployeePasswordRequest {
  newPassword: string;
}

/** POST /api/v1/employees/{id}/status — blocking ends the employee's sessions (ADR-0018, п. 7). */
export interface SetEmployeeStatusRequest {
  status: EmployeeStatus;
}

export interface EmployeeActivityEntry {
  at: string;
  action: AuditAction;
  object: string;
  details: string;
}

/** GET /api/v1/employees/{id} */
export interface EmployeeCard extends EmployeeListItem {
  activity: EmployeeActivityEntry[];
}

export interface Role {
  id: string;
  name: string;
  /** «Владелец»: every permission, the whole network, not editable. */
  system: boolean;
  templateKey: RoleTemplateKey | null;
  permissions: Permission[];
  employees: number;
}

/** POST /api/v1/roles, PUT /api/v1/roles/{id} — 403 `permission_escalation` above the editor. */
export interface RoleInput {
  name: string;
  permissions: Permission[];
}

export interface TenantTerminal {
  id: string;
  name: string;
  serial: string;
  storeId: string;
  storeName: string;
  storeOffline: boolean;
  boundByName: string;
  boundAt: string;
  lastSeenAt: string | null;
}

/* ---------------- audit ---------------- */

export type AuditAction =
  | 'sale'
  | 'return'
  | 'goods_receipt'
  | 'transfer'
  | 'write_off'
  | 'stock_count'
  | 'price_change'
  | 'sign_in'
  | 'shift_open'
  | 'employee_block'
  | 'password_reset'
  | 'role_change'
  | 'unpost'
  | 'settings_change';

export interface TenantAuditEntry {
  id: string;
  at: string;
  /** Date of the document when it differs from the time of entry (a back-dated document). */
  documentDate: string | null;
  employeeName: string;
  storeName: string | null;
  action: AuditAction;
  object: string;
  details: string;
  /** An action of the platform operator «от имени» the tenant (ADR-0008, ADR-0013). */
  byOperator: boolean;
}

export interface AuditQuery {
  from?: string;
  to?: string;
  employeeId?: string;
  storeId?: string;
  action?: AuditAction;
  q?: string;
  limit?: number;
  offset?: number;
}

/** GET /api/v1/audit-log — append-only, read only (CLAUDE.md «Conventions»). */
export type AuditListResponse = Page<TenantAuditEntry>;
