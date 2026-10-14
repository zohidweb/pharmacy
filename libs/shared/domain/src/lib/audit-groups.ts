/*
 * Groups of the tenant audit journal (spec 2026-10-14-owner-cabinet, section 6.4): the events of
 * `audit_log.action` fold into the groups of the journal filter. The rules exclude each other: a code
 * with exceptions under its prefix is listed exactly. The API builds its SQL filter from these rules,
 * the screens label an entry by its group when they have no text for its code.
 */

export const auditGroups = [
  'sale',
  'return',
  'shift',
  'goods_receipt',
  'supplier_return',
  'transfer',
  'write_off',
  'stock_count',
  'unpost',
  'price_change',
  'catalog',
  'purchasing',
  'sign_in',
  'access_denied',
  'employee',
  'employee_block',
  'password_reset',
  'role_change',
  'store',
  'settings_change',
  'expense',
] as const;

export type AuditGroup = (typeof auditGroups)[number];

/**
 * A row matches when its action is one of `actions` or starts with one of `prefixes`, and — when
 * `documentTypes` is set — `details.type` is one of them.
 */
export interface AuditGroupRule {
  group: AuditGroup;
  actions?: readonly string[];
  prefixes?: readonly string[];
  documentTypes?: readonly string[];
}

// the events of a stock document before and after its posting; unposting is a group of its own
const documentEvents = [
  'document.created',
  'document.updated',
  'document.posted',
  'document.deleted',
] as const;

export const AUDIT_GROUP_RULES: readonly AuditGroupRule[] = [
  { group: 'sale', actions: ['receipt.completed'] },
  { group: 'return', actions: ['return.completed'] },
  { group: 'shift', prefixes: ['shift.'] },
  { group: 'unpost', actions: ['document.unposted', 'transfer.recalled'] },
  {
    group: 'goods_receipt',
    actions: documentEvents,
    documentTypes: ['goods_receipt', 'opening_balance'],
  },
  { group: 'write_off', actions: documentEvents, documentTypes: ['write_off'] },
  {
    group: 'stock_count',
    actions: documentEvents,
    documentTypes: ['inventory'],
  },
  { group: 'stock_count', prefixes: ['stock_count.'] },
  {
    group: 'supplier_return',
    actions: documentEvents,
    documentTypes: ['supplier_return'],
  },
  {
    group: 'transfer',
    actions: documentEvents,
    documentTypes: ['transfer', 'transfer_request'],
  },
  {
    group: 'transfer',
    actions: ['transfer.dispatched', 'transfer.received', 'transfer.cancelled'],
    prefixes: ['transfer_request.'],
  },
  {
    group: 'price_change',
    actions: ['price.changed', 'markups.updated'],
    prefixes: ['discount_rule.'],
  },
  { group: 'catalog', prefixes: ['product.', 'category.'] },
  {
    group: 'purchasing',
    prefixes: ['supplier.', 'payment.', 'purchase_order.'],
  },
  {
    group: 'sign_in',
    actions: [
      'auth.login-succeeded',
      'auth.login-failed',
      'auth.pin-succeeded',
      'auth.pin-failed',
      'auth.pin-locked',
      'auth.reconfirmed',
      'auth.reconfirm-failed',
      'auth.activated',
    ],
  },
  { group: 'access_denied', actions: ['access.denied'] },
  {
    group: 'employee_block',
    actions: ['employee.blocked', 'employee.unblocked'],
  },
  {
    group: 'password_reset',
    actions: [
      'employee.password-reset',
      'employee.pin-set',
      'auth.password-changed',
      'auth.pin-changed',
    ],
  },
  {
    group: 'role_change',
    actions: ['employee.assignment-changed'],
    prefixes: ['role.'],
  },
  {
    group: 'employee',
    actions: ['employee.created', 'employee.updated'],
    prefixes: ['owner.'],
  },
  { group: 'store', prefixes: ['store.', 'legal-entity.', 'terminal.'] },
  { group: 'settings_change', prefixes: ['settings.'] },
  { group: 'expense', prefixes: ['expense.'] },
];

export function auditRuleMatches(
  rule: AuditGroupRule,
  action: string,
  details: Readonly<Record<string, unknown>>,
): boolean {
  const named =
    (rule.actions?.includes(action) ?? false) ||
    (rule.prefixes?.some((prefix) => action.startsWith(prefix)) ?? false);
  if (!named) return false;
  if (rule.documentTypes === undefined) return true;
  const type = details['type'];
  return typeof type === 'string' && rule.documentTypes.includes(type);
}

/** The group of an audit event; null for a code no rule names (seen without a group filter only). */
export function auditGroupOf(
  action: string,
  details: Readonly<Record<string, unknown>>,
): AuditGroup | null {
  return (
    AUDIT_GROUP_RULES.find((rule) => auditRuleMatches(rule, action, details))
      ?.group ?? null
  );
}
