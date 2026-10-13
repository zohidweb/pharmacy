'use client';

import type { OperatorAuditEntry } from '@pharmacy/shared-dto';
import { useTranslations } from 'use-intl';

// Message keys cannot hold dots: `tenant.owner-code-issued` → `tenant_owner-code-issued`.
const messageKey = (code: string) => code.replace(/\./g, '_');

/**
 * Wording of an operator audit entry in the UI language: the server sends codes, not prose. An
 * unknown event code is shown as it is, so a new event is visible before it gets its text.
 */
export function useOperatorAuditText() {
  const t = useTranslations('auditLog');
  const known = (key: string) => t.has(key as never);
  const text = (key: string, values?: Record<string, string>) =>
    t(key as never, values as never);

  const describe = (entry: OperatorAuditEntry): string => {
    const action = `actions.${messageKey(entry.action)}`;
    let result =
      entry.action === 'operator.code-issued' &&
      entry.details.created === 'true'
        ? text('actions.operator_code-issued-new')
        : known(action)
          ? text(action)
          : text('actions.unknown', { action: entry.action });
    const { reason, permission } = entry.details;
    if (reason) {
      const reasonKey = `reasons.${messageKey(reason)}`;
      result += ` — ${known(reasonKey) ? text(reasonKey) : reason}`;
    }
    if (permission) result += ` (${permission})`;
    return result;
  };

  const actor = (entry: OperatorAuditEntry): string => {
    if (entry.actor.kind === 'operator') return entry.actor.name;
    const job = `jobs.${messageKey(entry.actor.job)}`;
    return known(job)
      ? text(job)
      : text('jobs.other', { job: entry.actor.job });
  };

  const target = (entry: OperatorAuditEntry): string => {
    if (entry.store) {
      return entry.tenant
        ? `${entry.tenant.name} · ${entry.store.name}`
        : entry.store.name;
    }
    return entry.tenant?.name ?? entry.operator?.name ?? text('platform');
  };

  return { describe, actor, target };
}
