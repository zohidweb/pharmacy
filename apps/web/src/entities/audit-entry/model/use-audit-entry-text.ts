'use client';

import type { TenantAuditEntry } from '@pharmacy/shared-dto';
import { formatMoney } from '@pharmacy/shared-util';
import { useTranslations } from 'use-intl';

// the parameters of an event the journal shows, in this order; others are not shown
const SHOWN_PARAMS = [
  'totalMinor',
  'refundMinor',
  'amountMinor',
  'discrepancyMinor',
  'expectedMinor',
  'actualCashMinor',
  'priceMinor',
  'lines',
  'positions',
  'reason',
  'receipt',
] as const;

/** The i18n key of an audit code: `receipt.completed` → `receipt_completed`. */
export function auditEventKey(event: string): string {
  return event.replace(/[.-]/g, '_');
}

/**
 * Title and details of a journal entry in the interface language (spec 2026-10-14-owner-cabinet,
 * E7): the server sends the code and the values, not a sentence. A code without a text shows its
 * group, a code without a group shows itself.
 */
export function useAuditEntryText() {
  const events = useTranslations('auditEvents');
  const groups = useTranslations('auditGroups');
  const labels = useTranslations('auditParams');
  const reasons = useTranslations('auditReasons');
  return (entry: TenantAuditEntry) => {
    const key = auditEventKey(entry.event);
    const title = events.has(key as never)
      ? events(key as never)
      : entry.action
        ? groups(entry.action)
        : entry.event;
    const details = SHOWN_PARAMS.flatMap((name) => {
      const value = entry.params[name];
      if (value === undefined || value === null || value === '') return [];
      let shown = String(value);
      if (name.endsWith('Minor') && typeof value === 'number') {
        shown = formatMoney(value);
      } else if (name === 'reason' && reasons.has(shown as never)) {
        shown = reasons(shown as never);
      }
      return [`${labels(name)}: ${shown}`];
    }).join(' · ');
    return { title, details };
  };
}
