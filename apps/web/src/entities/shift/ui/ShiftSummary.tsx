'use client';

import type {
  CashInReason,
  CashOutReason,
  Shift,
  ShiftEvent,
} from '@pharmacy/shared-dto';
import { formatDateTime, formatMoney } from '@pharmacy/shared-util';
import {
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  StatusPill,
} from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

// The totals by payment method, the drawer and the log of a shift: the shift screen of the till and the card of a
// shift in the history (plan 2026-10-27-shift-history, S2). They read the `shift` messages of the `pos` group.

export function ShiftTotals({ shift }: { shift: Shift }) {
  const t = useTranslations('shift');
  const rows = [
    ...(['cash', 'card', 'qr', 'nfc'] as const).map((m) => ({
      key: m,
      label: t(`methods.${m}`),
      count: shift.byMethod[m].count,
      amount: shift.byMethod[m].amountMinor,
      note: m === 'cash' ? null : t('manualReconcile'),
    })),
    {
      key: 'returns',
      label: t('returns'),
      count: shift.returns.count,
      amount: -shift.returns.amountMinor,
      note: null,
    },
  ];
  return (
    <Card padding="none">
      <CardHeader title={t('byMethod')} inset />
      <DataTable
        caption={t('byMethod')}
        minWidth="none"
        rowKey={(row) => row.key}
        rows={rows}
        columns={[
          {
            key: 'label',
            header: t('method'),
            cell: (row) => (
              <span className="flex flex-col">
                {row.label}
                {row.note && (
                  <span className="text-xs text-fg-subtle">{row.note}</span>
                )}
              </span>
            ),
          },
          {
            key: 'count',
            header: t('receiptsCount'),
            numeric: true,
            cell: (row) => row.count,
          },
          {
            key: 'amount',
            header: t('sum'),
            numeric: true,
            nowrap: true,
            cell: (row) => formatMoney(row.amount),
          },
        ]}
      />
      <p className="flex justify-between border-t border-border px-(--ph-card-padding) py-3 text-md font-bold">
        <span>{t('revenue')}</span>
        <span className="tabular-nums">{formatMoney(shift.revenueMinor)}</span>
      </p>
    </Card>
  );
}

export function ShiftDrawer({ shift }: { shift: Shift }) {
  const t = useTranslations('shift');
  const c = shift.cash;
  const rows: Array<[string, number]> = [
    [t('openingCash'), c.openingMinor],
    [`+ ${t('cashSales')}`, c.salesMinor],
    [`+ ${t('cashIn')}`, c.inMinor],
    // the label carries the sign: the amounts are shown as they are, not negated
    [`− ${t('cashOut')}`, c.outMinor],
    [`− ${t('cashReturns')}`, c.returnsMinor],
  ];
  return (
    <Card
      as="section"
      aria-labelledby="drawer-title"
      className="flex flex-col gap-3"
    >
      <CardHeader title={t('drawer')} titleId="drawer-title" />
      <dl className="m-0 flex flex-col gap-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <dt>{label}</dt>
            <dd className="m-0 tabular-nums">{formatMoney(value)}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-border pt-2 text-md font-bold">
          <dt>{t('expected')}</dt>
          <dd className="m-0 tabular-nums">{formatMoney(c.expectedMinor)}</dd>
        </div>
      </dl>
    </Card>
  );
}

export function ShiftEventLog({
  events,
  title,
}: {
  events: ShiftEvent[];
  /** The log of the shift by default. */
  title?: string;
}) {
  const t = useTranslations('shift');
  const caption = title ?? t('log');
  return (
    <Card padding="none">
      <CardHeader title={caption} inset />
      <DataTable
        caption={caption}
        minWidth="none"
        rowKey={(row) => row.id}
        rows={events}
        empty={<EmptyState icon="scroll-text" title={t('logEmpty')} />}
        columns={[
          {
            key: 'at',
            header: t('time'),
            nowrap: true,
            cell: (e) => formatDateTime(e.at),
          },
          {
            key: 'kind',
            header: t('operation'),
            cell: (e) => (
              <span className="flex flex-wrap items-center gap-2">
                {t(`events.${e.kind}`, {
                  reference:
                    e.kind === 'cash_in' || e.kind === 'cash_out'
                      ? t(
                          `reasons.${(e.reference ?? 'other') as CashInReason | CashOutReason}`,
                        )
                      : (e.reference ?? ''),
                })}
                {/* a receipt with discrepancy marks, an author without the right now (K7) */}
                {e.flagged && (
                  <span title={t('flaggedHint')}>
                    <StatusPill tone="warning">{t('flagged')}</StatusPill>
                  </span>
                )}
              </span>
            ),
          },
          { key: 'who', header: t('cashier'), cell: (e) => e.employeeName },
          {
            key: 'amount',
            header: t('sum'),
            numeric: true,
            nowrap: true,
            cell: (e) => formatMoney(e.amountMinor),
          },
        ]}
      />
    </Card>
  );
}
