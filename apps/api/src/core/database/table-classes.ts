// Table classes of ADR-0013 (data model: docs/architecture/data-model/). Every table of schema
// pharmacy is listed here and vice versa; catalog.int-spec.ts checks this against pg_catalog.
//   tenant        - tenant data, RLS by app.tenant_id for pharmacy_app;
//   tenant-export - tenant-owned aggregates without personal data, readable by the platform;
//   platform      - platform registry (pharmacy_app reads at most its own row);
//   shared        - reference data shared by all tenants;
//   system        - internal service tables (job queue).
export type TableClass =
  'tenant' | 'tenant-export' | 'platform' | 'shared' | 'system';

export const TABLE_CLASSES: Readonly<Record<string, TableClass>> =
  Object.freeze({
    tenants: 'platform',
    tenant_settings: 'tenant',
    legal_entities: 'tenant',
    stores: 'tenant',
    employees: 'tenant',
    employee_credentials: 'tenant',
    roles: 'tenant',
    role_permissions: 'tenant',
    employee_stores: 'tenant',
    terminals: 'tenant',
    audit_log: 'tenant',
    operators: 'platform',
    operator_credentials: 'platform',
    platform_audit_log: 'platform',
  });

// Tenant tables that are append-only (insert and select only; a trigger rejects update, delete
// and truncate). pharmacy_app has exactly SELECT, INSERT on them instead of full DML.
export const APPEND_ONLY_TABLES: readonly string[] = Object.freeze([
  'audit_log',
]);

// SECURITY DEFINER resolver functions owned by pharmacy_resolver (ADR-0013 p. 3 and its
// amendment 2026-10-02: resolve_login replaces resolve_tenant_by_code; resolve_terminal - auth
// part 2).
export const RESOLVER_FUNCTIONS: readonly string[] = Object.freeze([
  'resolve_login',
  'resolve_terminal',
]);

// Columns of stores visible to pharmacy_platform (the store registry without the address).
export const STORE_PLATFORM_COLUMNS: readonly string[] = Object.freeze([
  'id',
  'tenant_id',
  'name',
  'mode',
  'status',
  'created_at',
  'closed_at',
]);
