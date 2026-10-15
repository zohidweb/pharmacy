/*
 * The operators' audit log of the mock transport: an action of the demo operator, newest first, as
 * apps/api writes platform_audit_log.
 */
import { mockDb } from './db';
import { demoOperator } from './fixtures';
import { auditEntry, type AuditRefs } from './operator-audit';

export function logAction(action: string, refs: AuditRefs = {}): void {
  mockDb().system.operatorAudit.unshift(
    auditEntry(
      `oa-${Date.now()}`,
      new Date().toISOString(),
      demoOperator,
      action,
      refs,
    ),
  );
}
