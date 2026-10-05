// Permissions of platform operators (auth design 2026-10-02, section 9). They are defined in code,
// not per tenant: in the MVP there is one role with full access (АП 6). Separate from the tenant
// catalog in permissions.ts — an operator never holds a tenant permission and vice versa.

export const OPERATOR_PERMISSIONS = [
  'platform:view',
  'platform:manage',
  'tenants:view',
  'tenants:manage',
  'operators:manage',
] as const;

export type OperatorPermission = (typeof OPERATOR_PERMISSIONS)[number];

export const OPERATOR_ROLES = ['full_access'] as const;

export type OperatorRoleKey = (typeof OPERATOR_ROLES)[number];

export const OPERATOR_ROLE_PERMISSIONS: Readonly<
  Record<OperatorRoleKey, readonly OperatorPermission[]>
> = Object.freeze({
  full_access: Object.freeze([...OPERATOR_PERMISSIONS]),
});

export function isOperatorPermission(value: unknown): value is OperatorPermission {
  return (
    typeof value === 'string' &&
    (OPERATOR_PERMISSIONS as readonly string[]).includes(value)
  );
}
