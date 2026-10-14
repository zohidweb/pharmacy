/*
 * Operator audit entries of the mocks, built the way apps/api returns them: an event code, the
 * kind by its prefix (apps/api/src/app/platform/audit/operator-audit.repository.ts), refs and
 * codes in the details — the screen words them.
 */
import type {
  OperatorActionType,
  OperatorAuditEntry,
  OperatorAuditRef,
  OperatorProfile,
} from '@pharmacy/shared-dto';

const KIND_PREFIXES: Array<[OperatorActionType, readonly string[]]> = [
  ['company', ['tenant.']],
  ['payment', ['payment.', 'invoice.']],
  ['key', ['license.']],
  ['service', ['service.']],
  ['settings', ['settings.', 'announcement.']],
];

export function mockActionType(action: string): OperatorActionType {
  const found = KIND_PREFIXES.find(([, prefixes]) =>
    prefixes.some((prefix) => action.startsWith(prefix)),
  );
  return found ? found[0] : 'access';
}

export interface AuditRefs {
  tenant?: OperatorAuditRef;
  store?: OperatorAuditRef;
  operator?: OperatorAuditRef;
  details?: Record<string, string>;
}

export function auditEntry(
  id: string,
  at: string,
  actor: Pick<OperatorProfile, 'id' | 'fullName'>,
  action: string,
  refs: AuditRefs = {},
): OperatorAuditEntry {
  return {
    id,
    at,
    actor: { kind: 'operator', operatorId: actor.id, name: actor.fullName },
    type: mockActionType(action),
    action,
    tenant: refs.tenant ?? null,
    store: refs.store ?? null,
    operator: refs.operator ?? null,
    details: refs.details ?? {},
  };
}
