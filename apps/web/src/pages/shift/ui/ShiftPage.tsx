'use client';

import type {
  CashInReason,
  CashMovementKind,
  CashOutReason,
  Shift,
  ShiftEvent,
  ZReport,
} from '@pharmacy/shared-dto';
import { formatDateTime, formatMoney, uuidv7 } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  EmptyState,
  printReceipt,
  RECEIPT_COLUMNS,
  ReceiptPreview,
  ReceiptPrint,
  SegmentedControl,
  StatusPill,
  useToast,
  type PaperWidth,
} from '@pharmacy/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useCatalog } from '@/entities/catalog';
import { canWrite, currentStoreOf, useSession } from '@/entities/session';
import { shiftQueryKey, useCurrentShift } from '@/entities/shift';
import { useOutboxCounts, useTerminalRuntime } from '@/entities/terminal';
import { apiRequest } from '@/shared/api';
import type { PosOutboxRecord } from '@/shared/lib/offline-queue';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { zReportLines, type ZReportLabels } from '../lib/z-report';
import {
  CashMovementDialog,
  CloseShiftDialog,
  OpenShiftDialog,
} from './ShiftDialogs';
import { WithMessages } from '@/shared/i18n';
import { rememberShift } from '@/shared/lib/terminal-cache';

function useZLabels(): ZReportLabels {
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
  };
}

function Totals({ shift }: { shift: Shift }) {
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

function Drawer({ shift }: { shift: Shift }) {
  const t = useTranslations('shift');
  const c = shift.cash;
  const rows: Array<[string, number]> = [
    [t('openingCash'), c.openingMinor],
    [`+ ${t('cashSales')}`, c.salesMinor],
    [`+ ${t('cashIn')}`, c.inMinor],
    [`− ${t('cashOut')}`, -c.outMinor],
    [`− ${t('cashReturns')}`, -c.returnsMinor],
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

function EventLog({ events }: { events: ShiftEvent[] }) {
  const t = useTranslations('shift');
  return (
    <Card padding="none">
      <CardHeader title={t('log')} inset />
      <DataTable
        caption={t('log')}
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
            cell: (e) =>
              t(`events.${e.kind}`, {
                reference:
                  e.kind === 'cash_in' || e.kind === 'cash_out'
                    ? t(
                        `reasons.${(e.reference ?? 'other') as CashInReason | CashOutReason}`,
                      )
                    : (e.reference ?? ''),
              }),
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

const kindKey = {
  receipt: 'receipt',
  'shift.open': 'shift_open',
  'shift.cash': 'shift_cash',
  'shift.close': 'shift_close',
} as const;

/** Operations that the server refused: kept for the manager, retried with the same key (ADR-0015). */
function Quarantine({
  records,
  onRetry,
}: {
  records: PosOutboxRecord[];
  onRetry: (id: string) => void;
}) {
  const t = useTranslations('shift.quarantine');
  if (records.length === 0) return null;
  return (
    <Card padding="none" className="border border-danger-border">
      <CardHeader title={t('title')} description={t('hint')} inset />
      <DataTable
        caption={t('title')}
        minWidth="none"
        rowKey={(row) => row.id}
        rows={records}
        columns={[
          {
            key: 'at',
            header: t('createdAt'),
            nowrap: true,
            cell: (r) => formatDateTime(r.createdAt),
          },
          {
            key: 'kind',
            header: t('kind'),
            cell: (r) => t(`kinds.${kindKey[r.kind]}`),
          },
          {
            key: 'error',
            header: t('error'),
            cell: (r) =>
              r.lastError
                ? t('errorText', {
                    status: r.lastError.status,
                    code: r.lastError.code,
                    correlationId: r.lastError.correlationId,
                  })
                : '—',
          },
          {
            key: 'actions',
            header: <span className="ph-visually-hidden">{t('actions')}</span>,
            align: 'end',
            cell: (r) => (
              <Button variant="secondary" onClick={() => onRetry(r.id)}>
                {t('retry')}
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}

/** Shift of the working store (UI mockup «Смена / Z-отчёт»). */
function ShiftPageView() {
  const t = useTranslations('shift');
  const toast = useToast();
  const queryClient = useQueryClient();
  const zLabels = useZLabels();
  const { data: session } = useSession();
  const store = currentStoreOf(session);
  const storeId = store?.id ?? null;
  const runtime = useTerminalRuntime();
  const counts = useOutboxCounts(runtime);
  const shift = useCurrentShift(storeId);
  const settings = useCatalog(runtime, storeId).data?.snapshot.settings;
  const [dialog, setDialog] = useState<
    'open' | 'close' | CashMovementKind | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ZReport | null>(null);
  const [paper, setPaper] = useState<PaperWidth>('80');
  const records = useQuery({
    queryKey: ['outbox', runtime?.key, counts.pending, counts.quarantine],
    queryFn: async () => (await runtime?.queue.list()) as PosOutboxRecord[],
    enabled: Boolean(runtime),
  });
  const held = useQuery({
    queryKey: ['held-receipts', storeId],
    queryFn: ({ signal }) =>
      apiRequest('heldReceipts.list', {
        params: { storeId: storeId ?? '' },
        signal,
      }),
    enabled: Boolean(storeId),
  });
  const writable = canWrite(session, 'shifts:update');
  const context = () => ({
    id: uuidv7(),
    storeId: storeId ?? '',
    terminalId: session?.terminalId ?? null,
    employeeId: session?.employee.id ?? '',
    occurredAt: new Date().toISOString(),
  });

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  const refreshAfterDelivery = (id: string) => {
    const unsubscribe = runtime?.queue.onDelivered((record) => {
      if (record.id !== id) return;
      unsubscribe?.();
      void queryClient.invalidateQueries({ queryKey: shiftQueryKey(storeId) });
    });
  };

  const openShift = (openingCashMinor: number) =>
    run(async () => {
      if (!runtime || !session) return;
      const payload = { ...context(), openingCashMinor };
      refreshAfterDelivery(payload.id);
      await runtime.enqueue({ kind: 'shift.open', payload });
      // the POS can sell at once, even before the server confirms (the id is ours)
      const zero = () => ({ count: 0, amountMinor: 0 });
      const local: Shift = {
        id: payload.id,
        number: 0,
        storeId: payload.storeId,
        status: 'open',
        openedAt: payload.occurredAt,
        openedBy: session.employee.fullName,
        closedAt: null,
        receipts: 0,
        byMethod: { cash: zero(), card: zero(), qr: zero(), nfc: zero() },
        returns: zero(),
        revenueMinor: 0,
        cash: {
          openingMinor: openingCashMinor,
          salesMinor: 0,
          inMinor: 0,
          outMinor: 0,
          returnsMinor: 0,
          expectedMinor: openingCashMinor,
        },
        events: [],
      };
      queryClient.setQueryData(shiftQueryKey(storeId), local);
      void rememberShift(storeId ?? '', local);
      toast.show(t('opened'));
    });

  const movement = (
    current: Shift,
    input: {
      kind: CashMovementKind;
      amountMinor: number;
      reason: CashInReason | CashOutReason;
      comment: string;
    },
  ) =>
    run(async () => {
      if (!runtime) return;
      const payload = { ...context(), shiftId: current.id, ...input };
      refreshAfterDelivery(payload.id);
      await runtime.enqueue({ kind: 'shift.cash', payload });
      toast.show(input.kind === 'in' ? t('cashInDone') : t('cashOutDone'));
    });

  const close = (
    current: Shift,
    input: {
      actualCashMinor: number;
      discrepancyReason: string;
      terminalTotals: Record<'card' | 'qr' | 'nfc', number>;
    },
  ) =>
    run(async () => {
      if (!runtime) return;
      const payload = { ...context(), shiftId: current.id, ...input };
      refreshAfterDelivery(payload.id);
      await runtime.enqueue({ kind: 'shift.close', payload });
      setReport({
        shift: { ...current, status: 'closed', closedAt: payload.occurredAt },
        actualCashMinor: input.actualCashMinor,
        discrepancyMinor: input.actualCashMinor - current.cash.expectedMinor,
        terminalDiff: {
          card: input.terminalTotals.card - current.byMethod.card.amountMinor,
          qr: input.terminalTotals.qr - current.byMethod.qr.amountMinor,
          nfc: input.terminalTotals.nfc - current.byMethod.nfc.amountMinor,
        },
      });
      queryClient.setQueryData(shiftQueryKey(storeId), null);
      void rememberShift(storeId ?? '', null);
    });

  const quarantined = (records.data ?? []).filter(
    (r) => r.status === 'quarantine',
  );
  const zLines = report
    ? zReportLines(
        report,
        {
          storeName: settings?.storeName ?? store?.name ?? '',
          storeAddress: settings?.storeAddress ?? store?.address ?? '',
          taxId: settings?.taxId ?? '—',
        },
        zLabels,
        RECEIPT_COLUMNS[paper],
      )
    : [];

  return (
    <>
      <QueryState query={shift}>
        {(current) => (
          <>
            <PageHeader
              title={
                current
                  ? t('title', { number: current.number || '…' })
                  : t('titleNone')
              }
              subtitle={
                current
                  ? t('openedAt', {
                      at: formatDateTime(current.openedAt),
                      name: current.openedBy,
                    })
                  : t('noneHint')
              }
              actions={
                current ? (
                  <>
                    <StatusPill tone="success">{t('statusOpen')}</StatusPill>
                    <Button
                      variant="secondary"
                      disabled={!writable}
                      onClick={() => setDialog('in')}
                    >
                      {t('cashIn')}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!writable}
                      onClick={() => setDialog('out')}
                    >
                      {t('cashOut')}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={!writable}
                      onClick={() => setDialog('close')}
                    >
                      {t('closeAction')}
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={!canWrite(session, 'shifts:create')}
                    onClick={() => setDialog('open')}
                  >
                    {t('openAction')}
                  </Button>
                )
              }
            />
            <div className="flex flex-col gap-4 px-6 pt-4">
              {counts.pending > 0 && (
                <Alert tone="info" live="polite">
                  {t('pendingHint', { count: counts.pending })}
                </Alert>
              )}
              <Quarantine
                records={quarantined}
                onRetry={(id) => void runtime?.queue.retry(id)}
              />
              {current ? (
                <>
                  <div className="grid grid-cols-2 items-start gap-4">
                    <Totals shift={current} />
                    <Drawer shift={current} />
                  </div>
                  <EventLog events={current.events} />
                  <CashMovementDialog
                    key={dialog ?? 'none'}
                    kind={dialog === 'in' || dialog === 'out' ? dialog : null}
                    shift={current}
                    busy={busy}
                    onConfirm={(input) => void movement(current, input)}
                    onClose={() => setDialog(null)}
                  />
                  {dialog === 'close' && (
                    <CloseShiftDialog
                      open
                      shift={current}
                      pendingOperations={counts.pending}
                      heldReceipts={held.data?.length ?? 0}
                      busy={busy}
                      onConfirm={(input) => void close(current, input)}
                      onClose={() => setDialog(null)}
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  icon="clock"
                  title={t('titleNone')}
                  description={t('noneHint')}
                />
              )}
            </div>
          </>
        )}
      </QueryState>
      <OpenShiftDialog
        key={dialog === 'open' ? 'open' : 'closed'}
        open={dialog === 'open'}
        storeName={store?.name ?? ''}
        cashierName={session?.employee.fullName ?? ''}
        busy={busy}
        onConfirm={(opening) => void openShift(opening)}
        onClose={() => setDialog(null)}
      />
      <Dialog
        open={report !== null}
        onClose={() => setReport(null)}
        title={t('z.previewTitle')}
        description={
          report ? t('shiftNumber', { number: report.shift.number }) : undefined
        }
        closeLabel={t('close')}
        size="md"
        footer={
          <>
            <SegmentedControl
              label={t('z.paper')}
              value={paper}
              onValueChange={setPaper}
              options={[
                { value: '80', label: '80 мм' },
                { value: '58', label: '58 мм' },
              ]}
            />
            <Button variant="secondary" onClick={() => setReport(null)}>
              {t('close')}
            </Button>
            <Button iconStart="printer" onClick={() => void printReceipt()}>
              {t('z.print')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center">
          <ReceiptPreview
            lines={zLines}
            paperWidth={paper}
            label={t('z.previewTitle')}
          />
          {report && <ReceiptPrint lines={zLines} paperWidth={paper} />}
        </div>
      </Dialog>
    </>
  );
}

export function ShiftPage() {
  return (
    <WithMessages groups={['pos']}>
      <ShiftPageView />
    </WithMessages>
  );
}
