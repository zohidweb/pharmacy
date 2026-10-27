'use client';

import type { ShiftEvent, ZReport } from '@pharmacy/shared-dto';
import { formatDateTime, formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  printReceipt,
  RECEIPT_COLUMNS,
  ReceiptPreview,
  ReceiptPrint,
  SegmentedControl,
  StatusPill,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useZReportLabels, zReportLines } from '@/entities/shift';
import { ForceCloseShiftButton } from '@/features/force-close-shift';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

type Paper = '80' | '58';

/**
 * The card of a shift (plan 2026-10-27-shift-history, S2, S8): its totals and journal, the Z-report of a closed shift
 * with its print, the operations of its till accepted after a closing from another computer, and for an open shift
 * the closing from another computer.
 */
function ShiftCardView() {
  const t = useTranslations('shiftHistory');
  const tShift = useTranslations('shift');
  const zLabels = useZReportLabels();
  const queryClient = useQueryClient();
  const id = useSearchParams()?.get('id') ?? '';
  const [paper, setPaper] = useState<Paper>('80');
  const card = useQuery({
    queryKey: ['shifts', 'details', id],
    queryFn: ({ signal }) =>
      apiRequest('shifts.details', { params: { id }, signal }),
    enabled: id !== '',
  });

  const eventColumns: DataTableColumn<ShiftEvent>[] = [
    {
      key: 'at',
      header: t('events.at'),
      nowrap: true,
      cell: (row) => formatDateTime(row.at),
    },
    {
      key: 'kind',
      header: t('events.kind'),
      cell: (row) =>
        tShift(`events.${row.kind}`, { reference: row.reference ?? '' }),
    },
    {
      key: 'employee',
      header: t('events.employee'),
      cell: (row) => row.employeeName,
    },
    {
      key: 'amount',
      header: t('events.amount'),
      align: 'end',
      nowrap: true,
      cell: (row) => formatMoney(row.amountMinor),
    },
  ];

  return (
    <>
      <PageHeader
        title={
          card.data
            ? t('cardTitle', { number: card.data.shift.number })
            : t('title')
        }
        actions={
          <Link href={routes.shiftHistory()} className="text-primary underline">
            {t('back')}
          </Link>
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <QueryState query={card}>
          {(details) => {
            const { shift, zReport, afterClosing } = details;
            const zLines = zReport
              ? zReportLines(
                  zReport,
                  details.print,
                  zLabels,
                  RECEIPT_COLUMNS[paper],
                )
              : [];
            const late =
              afterClosing.receipts > 0 ||
              afterClosing.cashInMinor > 0 ||
              afterClosing.cashOutMinor > 0;
            return (
              <>
                <Card>
                  <CardHeader
                    title={`${details.storeName} · ${details.terminalName}`}
                    actions={
                      <ForceCloseShiftButton
                        details={details}
                        onClosed={(report: ZReport) => {
                          queryClient.setQueryData(['shifts', 'details', id], {
                            ...details,
                            shift: report.shift,
                            zReport: report,
                            closedByName: report.forced?.byName ?? null,
                          });
                          void queryClient.invalidateQueries({
                            queryKey: ['shifts', 'list'],
                          });
                        }}
                      />
                    }
                  />
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
                    <dt className="text-fg-subtle">{t('status')}</dt>
                    <dd>
                      {shift.status === 'open' ? (
                        <StatusPill tone="info" icon={null}>
                          {t('open')}
                        </StatusPill>
                      ) : zReport?.forced ? (
                        <StatusPill tone="warning" icon={null}>
                          {`${t('closedStatus')} ${t('forced')}`}
                        </StatusPill>
                      ) : (
                        t('closedStatus')
                      )}
                    </dd>
                    <dt className="text-fg-subtle">{t('columns.opened')}</dt>
                    <dd>
                      {formatDateTime(shift.openedAt)} · {shift.openedBy}
                    </dd>
                    <dt className="text-fg-subtle">{t('columns.closed')}</dt>
                    <dd>
                      {shift.closedAt
                        ? `${formatDateTime(shift.closedAt)} · ${details.closedByName ?? '—'}`
                        : '—'}
                    </dd>
                    <dt className="text-fg-subtle">{t('lastActivity')}</dt>
                    <dd>
                      {details.lastActivityAt
                        ? formatDateTime(details.lastActivityAt)
                        : '—'}
                    </dd>
                    <dt className="text-fg-subtle">{t('columns.receipts')}</dt>
                    <dd className="tabular-nums">{shift.receipts}</dd>
                    <dt className="text-fg-subtle">{t('columns.revenue')}</dt>
                    <dd className="tabular-nums">
                      {formatMoney(shift.revenueMinor)}
                    </dd>
                    <dt className="text-fg-subtle">{tShift('expected')}</dt>
                    <dd className="tabular-nums">
                      {formatMoney(shift.cash.expectedMinor)}
                    </dd>
                    {zReport && (
                      <>
                        <dt className="text-fg-subtle">{tShift('actual')}</dt>
                        <dd className="tabular-nums">
                          {formatMoney(zReport.actualCashMinor)} (
                          {formatMoney(zReport.discrepancyMinor)})
                        </dd>
                      </>
                    )}
                  </dl>
                  {zReport?.forced && (
                    <Alert tone="warning" className="mt-4">
                      {zLabels.forced(
                        zReport.forced.byName,
                        zReport.forced.reason,
                      )}
                    </Alert>
                  )}
                </Card>
                {late && (
                  <Alert tone="warning" title={t('afterClosingTitle')}>
                    {t('afterClosingText', {
                      receipts: afterClosing.receipts,
                      amount: formatMoney(afterClosing.revenueMinor),
                      in: formatMoney(afterClosing.cashInMinor),
                      out: formatMoney(afterClosing.cashOutMinor),
                    })}
                  </Alert>
                )}
                <Card padding="none">
                  <DataTable
                    caption={t('events.title')}
                    showCaption
                    rowKey={(row) => row.id}
                    rows={shift.events}
                    columns={eventColumns}
                    empty={
                      <EmptyState icon="clock" title={t('events.empty')} />
                    }
                  />
                </Card>
                {zReport && (
                  <Card>
                    <CardHeader
                      title={tShift('z.previewTitle')}
                      actions={
                        <>
                          <SegmentedControl
                            label={tShift('z.paper')}
                            value={paper}
                            onValueChange={setPaper}
                            options={[
                              { value: '80', label: '80 мм' },
                              { value: '58', label: '58 мм' },
                            ]}
                          />
                          <Button
                            iconStart="printer"
                            onClick={() => void printReceipt()}
                          >
                            {tShift('z.print')}
                          </Button>
                        </>
                      }
                    />
                    <div className="flex flex-col items-center">
                      <ReceiptPreview
                        lines={zLines}
                        paperWidth={paper}
                        label={tShift('z.previewTitle')}
                      />
                    </div>
                    <ReceiptPrint lines={zLines} paperWidth={paper} />
                  </Card>
                )}
              </>
            );
          }}
        </QueryState>
      </div>
    </>
  );
}

export function ShiftCardPage() {
  return (
    <WithMessages groups={['pos']}>
      <Suspense>
        <ShiftCardView />
      </Suspense>
    </WithMessages>
  );
}
