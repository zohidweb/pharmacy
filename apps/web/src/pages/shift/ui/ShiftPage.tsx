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
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useCatalog } from '@/entities/catalog';
import {
  canWrite,
  currentStoreOf,
  ensureSession,
  useSession,
} from '@/entities/session';
import { shiftQueryKey, useCurrentShift } from '@/entities/shift';
import {
  useBufferState,
  useOutboxCounts,
  useTerminalRuntime,
} from '@/entities/terminal';
import { apiRequest, useApiCodeMessage } from '@/shared/api';
import type {
  PosOutboxRecord,
  TerminalRuntime,
} from '@/shared/lib/offline-queue';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { withPending } from '../lib/pending';
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
    discrepancyReceipts: t('discrepancyReceipts'),
    reasonMissing: t('reasonMissing'),
    preliminary: t('preliminary'),
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

const kindKey = {
  receipt: 'receipt',
  'shift.open': 'shift_open',
  'shift.cash': 'shift_cash',
  'shift.close': 'shift_close',
} as const;

/**
 * Operations that the server refused: kept for the manager, retried with the same key (ADR-0015). A receipt refused by
 * the price rules can be accepted as it is by someone who may set the prices or the discount rules (ADR-0015, amendment
 * 2026-10-23); the server checks the rights again.
 */
function Quarantine({
  records,
  onRetry,
  onAccept,
}: {
  records: PosOutboxRecord[];
  onRetry: (id: string) => void;
  /** Absent — the session may not accept a discrepancy. */
  onAccept?: (id: string) => void;
}) {
  const t = useTranslations('shift.quarantine');
  const known = useApiCodeMessage();
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
              r.lastError ? (
                <span className="flex flex-col">
                  {known(r.lastError.code)}
                  <span className="text-xs text-fg-subtle">
                    {t('errorText', {
                      status: r.lastError.status,
                      code: r.lastError.code,
                      correlationId: r.lastError.correlationId,
                    })}
                  </span>
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'actions',
            header: <span className="ph-visually-hidden">{t('actions')}</span>,
            align: 'end',
            cell: (r) => (
              <span className="flex flex-wrap justify-end gap-2">
                {onAccept && r.lastError?.code === 'price_rules_violated' && (
                  <Button variant="secondary" onClick={() => onAccept(r.id)}>
                    {t('accept')}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => onRetry(r.id)}>
                  {t('retry')}
                </Button>
              </span>
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
  const tPos = useTranslations('pos');
  const toast = useToast();
  const queryClient = useQueryClient();
  const zLabels = useZLabels();
  const { data: session } = useSession();
  const store = currentStoreOf(session);
  const storeId = store?.id ?? null;
  const runtime = useTerminalRuntime();
  const counts = useOutboxCounts(runtime);
  // a buffered operation left the buffer: the shift of the server has it now (final review I1)
  const pendingBefore = useRef(counts.pending);
  useEffect(() => {
    if (counts.pending < pendingBefore.current) {
      void queryClient.invalidateQueries({ queryKey: shiftQueryKey(storeId) });
    }
    pendingBefore.current = counts.pending;
  }, [counts.pending, queryClient, storeId]);
  // the shift belongs to the terminal: only a PIN session of a bound one has it (K6)
  const onTerminal = session?.terminalId != null;
  const shift = useCurrentShift(storeId, onTerminal);
  const settings = useCatalog(runtime, storeId).data?.snapshot.settings;
  const [dialog, setDialog] = useState<
    'open' | 'close' | CashMovementKind | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ZReport | null>(null);
  // the Z-report of the terminal while its closing waits in the buffer
  const [preliminary, setPreliminary] = useState(false);
  // the Z-report of the server for the last closing of this page: printed again on demand (M6)
  const [lastZ, setLastZ] = useState<ZReport | null>(null);
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
    enabled: Boolean(storeId) && onTerminal,
  });
  // an operation goes to the buffer first (ADR-0015): no action before the IndexedDB of the terminal opens
  // a sign-in of the cashier older than the limit of the buffer stops the operations of the shift too: the server
  // would not take them (spec 2026-10-21-pos-offline-limits, P17)
  const buffer = useBufferState(runtime);
  const signInStale = buffer?.signIn === 'blocked';
  const writable =
    canWrite(session, 'shifts:update') && runtime !== null && !signInStale;
  const context = () => ({
    id: uuidv7(),
    storeId: storeId ?? '',
    terminalId: session?.terminalId ?? null,
    employeeId: session?.employee.id ?? '',
    occurredAt: new Date().toISOString(),
  });

  // the actions wait for the buffer of the terminal: without it the dialog stays open, nothing is dropped; like a sale,
  // they are taken under the terminal, so the session is checked first (security review 2026-10-22, F2)
  const run = async (work: (terminal: TerminalRuntime) => Promise<void>) => {
    if (!runtime) return;
    setBusy(true);
    try {
      if ((await ensureSession(queryClient)) === null) return;
      await work(runtime);
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
    run(async (terminal) => {
      if (!session) return;
      const payload = { ...context(), openingCashMinor };
      refreshAfterDelivery(payload.id);
      await terminal.enqueue({ kind: 'shift.open', payload });
      // the POS can sell at once, even before the server confirms (the id is ours)
      const zero = () => ({ count: 0, amountMinor: 0 });
      const local: Shift = {
        id: payload.id,
        // the server gives the number at delivery
        number: '',
        storeId: payload.storeId,
        status: 'open',
        openedAt: payload.occurredAt,
        openedBy: session.employee.fullName,
        closedAt: null,
        receipts: 0,
        byMethod: { cash: zero(), card: zero(), qr: zero(), nfc: zero() },
        returns: zero(),
        returnsByMethod: {
          cash: zero(),
          card: zero(),
          qr: zero(),
          nfc: zero(),
        },
        revenueMinor: 0,
        cash: {
          openingMinor: openingCashMinor,
          salesMinor: 0,
          inMinor: 0,
          outMinor: 0,
          returnsMinor: 0,
          expectedMinor: openingCashMinor,
        },
        discrepancyReceipts: 0,
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
    run(async (terminal) => {
      const payload = { ...context(), shiftId: current.id, ...input };
      refreshAfterDelivery(payload.id);
      await terminal.enqueue({ kind: 'shift.cash', payload });
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
    run(async (terminal) => {
      const payload = { ...context(), shiftId: current.id, ...input };
      refreshAfterDelivery(payload.id);
      // the terminal's own Z-report at once; the server's replaces it whenever the closing is delivered
      const unsubscribe = terminal.queue.onDelivered((record, response) => {
        if (record.id !== payload.id) return;
        unsubscribe();
        const server = response as ZReport;
        setLastZ(server);
        setReport((shown) =>
          shown && shown.shift.id === server.shift.id ? server : shown,
        );
        setPreliminary(false);
      });
      await terminal.enqueue({ kind: 'shift.close', payload });
      setPreliminary(true);
      setReport({
        shift: { ...current, status: 'closed', closedAt: payload.occurredAt },
        actualCashMinor: input.actualCashMinor,
        discrepancyMinor: input.actualCashMinor - current.cash.expectedMinor,
        terminalDiff: {
          // the sales less the returns of a kind (E13 of the returns spec)
          card:
            input.terminalTotals.card -
            current.byMethod.card.amountMinor +
            current.returnsByMethod.card.amountMinor,
          qr:
            input.terminalTotals.qr -
            current.byMethod.qr.amountMinor +
            current.returnsByMethod.qr.amountMinor,
          nfc:
            input.terminalTotals.nfc -
            current.byMethod.nfc.amountMinor +
            current.returnsByMethod.nfc.amountMinor,
        },
        discrepancyReasonMissing:
          input.actualCashMinor !== current.cash.expectedMinor &&
          input.discrepancyReason.trim() === '',
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
        preliminary,
      )
    : [];

  if (session && !onTerminal) {
    return (
      <>
        <PageHeader title={t('titleNone')} />
        <div className="px-6 pt-4">
          <EmptyState
            icon="lock"
            title={t('noTerminal')}
            description={t('noTerminalHint')}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {signInStale && buffer && (
        <Alert tone="danger" live="assertive">
          {tPos('bufferSignIn', { hours: buffer.limits.maxHours })}
        </Alert>
      )}
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
                      // the shift and the buffer are read at the same moment for the reconciliation
                      disabled={!writable || shift.isFetching}
                      onClick={() => setDialog('close')}
                    >
                      {t('closeAction')}
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={
                      !canWrite(session, 'shifts:create') ||
                      runtime === null ||
                      signInStale
                    }
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
                onAccept={
                  canWrite(session, 'pricing:update-store') ||
                  canWrite(session, 'pricing:update-network') ||
                  canWrite(session, 'discounts:manage-store') ||
                  canWrite(session, 'discounts:manage-network')
                    ? (id) =>
                        void runtime?.queue.retry(id, {
                          acceptDiscrepancy: true,
                        })
                    : undefined
                }
              />
              {current ? (
                <>
                  {current.discrepancyReceipts > 0 && (
                    <Alert tone="warning">
                      {t('discrepancyReceipts', {
                        count: current.discrepancyReceipts,
                      })}
                    </Alert>
                  )}
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
                      shift={withPending(current, records.data ?? [])}
                      pendingOperations={counts.pending}
                      heldReceipts={held.data?.length ?? 0}
                      busy={busy}
                      onConfirm={(input) =>
                        void close(
                          withPending(current, records.data ?? []),
                          input,
                        )
                      }
                      onClose={() => setDialog(null)}
                    />
                  )}
                </>
              ) : (
                <EmptyState
                  icon="clock"
                  title={t('titleNone')}
                  description={t('noneHint')}
                  action={
                    lastZ ? (
                      <Button
                        variant="secondary"
                        iconStart="printer"
                        onClick={() => {
                          setPreliminary(false);
                          setReport(lastZ);
                        }}
                      >
                        {t('lastZ', { number: lastZ.shift.number })}
                      </Button>
                    ) : undefined
                  }
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
          report
            ? [
                t('shiftNumber', { number: report.shift.number || '…' }),
                ...(preliminary ? [t('z.preliminary')] : []),
              ].join(' · ')
            : undefined
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
