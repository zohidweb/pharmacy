'use client';

import { useTranslations } from 'use-intl';
import type { ZReportLabels } from '../lib/z-report';

/** The words of a printed Z-report in the interface language (the `pos` messages: `shift` and `shift.z`). */
export function useZReportLabels(): ZReportLabels {
  const t = useTranslations('shift.z');
  const tShift = useTranslations('shift');
  return {
    title: t('title'),
    shift: t('shift'),
    cashier: t('cashier'),
    opened: t('opened'),
    closed: t('closed'),
    receipts: t('receipts'),
    method: {
      cash: tShift('methods.cash'),
      card: tShift('methods.card'),
      qr: tShift('methods.qr'),
      nfc: tShift('methods.nfc'),
    },
    returns: (count) => t('returns', { count }),
    revenue: t('revenue'),
    opening: tShift('openingCash'),
    cashIn: tShift('cashIn'),
    cashOut: tShift('cashOut'),
    expected: tShift('expected'),
    actual: tShift('actual'),
    discrepancy: tShift('discrepancy'),
    byTerminal: (method) => t('byTerminal', { method }),
    fiscalPlaceholder: t('fiscalPlaceholder'),
    taxId: t('taxId'),
    discrepancyReceipts: t('discrepancyReceipts'),
    reasonMissing: t('reasonMissing'),
    preliminary: t('preliminary'),
    forced: (name, reason) => t('forced', { name, reason }),
  };
}
