// Table classes of ADR-0013 (data model: docs/architecture/data-model/). Every table of schema
// pharmacy is listed here and vice versa; catalog.int-spec.ts checks this against pg_catalog.
//   tenant        - tenant data, RLS by app.tenant_id for pharmacy_app;
//   tenant-export - tenant-owned aggregates without personal data, readable by the platform;
//   platform      - platform registry: pharmacy_app reads at most its own rows of `tenants`,
//                   `tenant_services`, `invoices`, `invoice_lines` and `tenant_discounts`;
//                   `operators`, `operator_credentials`, `platform_audit_log`, `tenant_payments`
//                   and `tenant_payment_allocations` are open to pharmacy_platform only, which
//                   never deletes their rows (spec 2026-10-15-billing-services, B18);
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
    categories: 'tenant',
    dictionary_values: 'tenant',
    products: 'tenant',
    product_barcodes: 'tenant',
    store_products: 'tenant',
    discount_rules: 'tenant',
    discount_rule_tiers: 'tenant',
    discount_rule_stores: 'tenant',
    suppliers: 'tenant',
    document_counters: 'tenant',
    documents: 'tenant',
    batches: 'tenant',
    goods_receipt_lines: 'tenant',
    opening_balance_lines: 'tenant',
    write_off_lines: 'tenant',
    inventory_lines: 'tenant',
    inventory_count_entries: 'tenant',
    supplier_return_lines: 'tenant',
    transfer_request_lines: 'tenant',
    transfer_lines: 'tenant',
    stock_movements: 'tenant',
    supplier_ledger_entries: 'tenant',
    supplier_payments: 'tenant',
    supplier_payment_allocations: 'tenant',
    supplier_return_allocations: 'tenant',
    purchase_orders: 'tenant',
    purchase_order_lines: 'tenant',
    shifts: 'tenant',
    shift_cash_operations: 'tenant',
    held_receipts: 'tenant',
    receipts: 'tenant',
    receipt_lines: 'tenant',
    payments: 'tenant',
    controlled_sale_records: 'tenant',
    idempotency_keys: 'tenant',
    customer_returns: 'tenant',
    customer_return_lines: 'tenant',
    customer_return_refunds: 'tenant',
    notifications: 'tenant',
    notification_reads: 'tenant',
    notification_refresh: 'tenant',
    expenses: 'tenant',
    audit_log: 'tenant',
    sessions: 'tenant',
    service_requests: 'tenant-export',
    operators: 'platform',
    operator_credentials: 'platform',
    platform_audit_log: 'platform',
    tenant_services: 'platform',
    store_usage_monthly: 'tenant-export',
    invoices: 'platform',
    invoice_lines: 'platform',
    tenant_payments: 'platform',
    tenant_payment_allocations: 'platform',
    tenant_discounts: 'platform',
    platform_settings: 'shared',
    services: 'shared',
  });

// Tenant tables that are append-only (insert and select only; a trigger rejects update, delete
// and truncate). pharmacy_app has exactly SELECT, INSERT on them instead of full DML.
export const APPEND_ONLY_TABLES: readonly string[] = Object.freeze([
  'audit_log',
  'stock_movements',
  'supplier_ledger_entries',
  'supplier_payments',
  'shift_cash_operations',
  'receipts',
  'receipt_lines',
  'payments',
  'controlled_sale_records',
  'customer_returns',
  'customer_return_lines',
  'customer_return_refunds',
]);

// SECURITY DEFINER resolver functions owned by pharmacy_resolver (ADR-0013 p. 3 and its
// amendment 2026-10-02: resolve_login replaces resolve_tenant_by_code; resolve_terminal - auth
// part 2).
export const RESOLVER_FUNCTIONS: readonly string[] = Object.freeze([
  'resolve_login',
  'resolve_terminal',
]);

// SECURITY DEFINER tenant provisioning functions owned by pharmacy_provisioner (ADR-0013, amendment
// 2026-10-05): the only way from the platform path into tenant tables. EXECUTE for pharmacy_platform.
export const PROVISIONING_FUNCTIONS: readonly string[] = Object.freeze([
  'issue_owner_code',
  'provision_tenant',
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
