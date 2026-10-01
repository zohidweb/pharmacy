'use client';

import type {
  InvoiceListItem,
  PaymentListItem,
  PaymentMethod,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatMoney,
  parseMoneyToMinor,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  buttonClassName,
  Chip,
  ChipGroup,
  DataTable,
  Dialog,
  Icon,
  Select,
  TextareaField,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { billingKeys, invoicePdfHref } from '@/entities/invoice';
import { tenantKeys } from '@/entities/tenant';
import { apiMocksEnabled, apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';

export function formatPeriod(period: string): string {
  return formatDateOnly(`${period}-01`).slice(3);
}

function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

/** «Сформировать счета за период» — preview first; only a closed period can be generated. */
export function GenerateInvoices() {
  const t = useTranslations('billing.generate');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const current = toAppDate().slice(0, 7);
  const periods = [shiftPeriod(current, -2), shiftPeriod(current, -1), current];
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(periods[1]);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const preview = useQuery({
    queryKey: ['billing', 'generation-preview', period],
    queryFn: ({ signal }) =>
      apiRequest('invoices.generationPreview', { query: { period }, signal }),
    enabled: open,
  });
  const generate = useMutation({
    mutationFn: () =>
      apiRequest('invoices.generate', { body: { period }, idempotencyKey }),
    onSuccess: ({ created }) => {
      void queryClient.invalidateQueries({ queryKey: billingKeys.all });
      toast.show(t('done', { count: created }));
      setOpen(false);
    },
  });
  const error = useApiErrorMessage(generate.error);

  return (
    <>
      <Button
        variant="secondary"
        iconStart="file-text"
        onClick={() => {
          setIdempotencyKey(crypto.randomUUID());
          generate.reset();
          setOpen(true);
        }}
      >
        {t('action')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('title')}
        closeLabel={tCommon('close')}
        size="lg"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              loading={generate.isPending}
              disabled={preview.data?.state !== 'closed'}
              onClick={() => generate.mutate()}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <ChipGroup label={t('periodLabel')}>
          {periods.map((value) => (
            <Chip
              key={value}
              selected={value === period}
              onClick={() => setPeriod(value)}
            >
              {formatPeriod(value)}
            </Chip>
          ))}
        </ChipGroup>
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <QueryState query={preview}>
          {(data) => (
            <>
              <Alert tone={data.state === 'closed' ? 'info' : 'warning'}>
                {t(`state.${data.state}`)}
              </Alert>
              <DataTable
                caption={t('previewCaption', {
                  period: formatPeriod(data.period),
                })}
                columns={[
                  {
                    key: 'tenant',
                    header: t('columns.tenant'),
                    cell: (row) => row.tenantName,
                  },
                  {
                    key: 'stores',
                    header: t('columns.stores'),
                    numeric: true,
                    cell: (row) => row.activeStores,
                  },
                  {
                    key: 'total',
                    header: t('columns.total'),
                    numeric: true,
                    nowrap: true,
                    cell: (row) =>
                      data.state === 'future'
                        ? '—'
                        : formatMoney(row.totalMinor, { withSign: false }),
                  },
                ]}
                rows={data.rows}
                rowKey={(row) => row.tenantId}
                minWidth="none"
              />
              <p className="flex justify-between text-sm font-bold">
                <span>{t('total')}</span>
                <span className="tabular-nums">
                  {data.state === 'future' ? '—' : formatMoney(data.totalMinor)}
                </span>
              </p>
            </>
          )}
        </QueryState>
      </Dialog>
    </>
  );
}

/** Invoice details: lines with proration days, VAT as a separate line, PDF from apps/api. */
export function InvoiceDetailsDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceListItem | null;
  onClose: () => void;
}) {
  const t = useTranslations('billing.details');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const details = useQuery({
    queryKey: billingKeys.invoice(invoice?.id ?? ''),
    queryFn: ({ signal }) =>
      apiRequest('invoices.get', { params: { id: invoice?.id ?? '' }, signal }),
    enabled: invoice !== null,
  });
  return (
    <Dialog
      open={invoice !== null}
      onClose={onClose}
      title={t('title', { number: invoice?.number ?? '' })}
      description={
        invoice
          ? `${invoice.tenantName} · ${formatPeriod(invoice.period)}`
          : undefined
      }
      closeLabel={tCommon('close')}
      size="lg"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {tCommon('close')}
          </Button>
          {invoice &&
            (apiMocksEnabled ? (
              <Button
                iconStart="download"
                onClick={() => toast.show(t('pdfMock'))}
              >
                {t('pdf')}
              </Button>
            ) : (
              <a
                href={invoicePdfHref(invoice.id)}
                download
                className={buttonClassName({})}
              >
                <Icon name="download" size="sm" />
                <span>{t('pdf')}</span>
              </a>
            ))}
        </>
      }
    >
      <QueryState query={details}>
        {(data) => (
          <>
            <DataTable
              caption={t('linesCaption')}
              columns={[
                {
                  key: 'description',
                  header: t('columns.line'),
                  cell: (line) => line.description,
                },
                {
                  key: 'days',
                  header: t('columns.days'),
                  numeric: true,
                  cell: (line) => line.days ?? '—',
                },
                {
                  key: 'amount',
                  header: t('columns.amount'),
                  numeric: true,
                  nowrap: true,
                  cell: (line) =>
                    formatMoney(line.amountMinor, { withSign: false }),
                },
              ]}
              rows={data.lines}
              rowKey={(line) => line.description}
              minWidth="none"
            />
            <dl className="m-0 flex flex-col gap-1 text-sm">
              {(
                [
                  ['net', data.netMinor],
                  ['vat', data.vatMinor],
                  ['total', data.totalMinor],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex justify-between">
                  <dt
                    className={key === 'total' ? 'font-bold' : 'text-fg-muted'}
                  >
                    {t(key, { rate: data.vatRatePercent })}
                  </dt>
                  <dd
                    className={
                      key === 'total'
                        ? 'm-0 font-bold tabular-nums'
                        : 'm-0 tabular-nums'
                    }
                  >
                    {formatMoney(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </QueryState>
    </Dialog>
  );
}

/** «Пересчитать счёт» — shows before/after; a paid invoice cannot be recalculated. */
export function RecalculateDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceListItem | null;
  onClose: () => void;
}) {
  const t = useTranslations('billing.recalculate');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['billing', 'recalculation', invoice?.id],
    queryFn: ({ signal }) =>
      apiRequest('invoices.recalculationPreview', {
        params: { id: invoice?.id ?? '' },
        signal,
      }),
    enabled: invoice !== null,
  });
  const recalculate = useMutation({
    mutationFn: () =>
      apiRequest('invoices.recalculate', { params: { id: invoice?.id ?? '' } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: billingKeys.all });
      toast.show(t('done'));
      onClose();
    },
  });
  const error = useApiErrorMessage(recalculate.error);
  return (
    <Dialog
      open={invoice !== null}
      onClose={onClose}
      title={t('title', { number: invoice?.number ?? '' })}
      description={t('description')}
      closeLabel={tCommon('close')}
      icon="calculator"
      tone="warning"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            loading={recalculate.isPending}
            disabled={!preview.data}
            onClick={() => recalculate.mutate()}
          >
            {t('confirm')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <QueryState query={preview}>
        {(data) => (
          <dl className="m-0 grid grid-cols-2 gap-3">
            {(
              [
                ['before', data.beforeMinor],
                ['after', data.afterMinor],
              ] as const
            ).map(([key, value]) => (
              <div
                key={key}
                className="flex flex-col rounded-md bg-surface-sunken p-3"
              >
                <dt className="text-xs text-fg-subtle">{t(key)}</dt>
                <dd className="m-0 text-lg font-bold tabular-nums">
                  {formatMoney(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </QueryState>
    </Dialog>
  );
}

const methods: PaymentMethod[] = ['bank_transfer', 'cash'];

/** Payment card: edit the recorded fields or cancel the payment (kept in the audit log). */
export function PaymentDialog({
  payment,
  onClose,
}: {
  payment: PaymentListItem | null;
  onClose: () => void;
}) {
  const t = useTranslations('billing.paymentCard');
  const tPayment = useTranslations('payment');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [comment, setComment] = useState('');
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (payment && payment.id !== loadedId) {
    setLoadedId(payment.id);
    setAmount(
      formatMoney(payment.amountMinor, { withSign: false, plainSpaces: true }),
    );
    setPaidOn(payment.paidOn);
    setMethod(payment.method);
    setComment(payment.comment);
    setCancelReason(null);
  }
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: billingKeys.all });
    void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
  };
  const close = () => {
    setLoadedId(null);
    update.reset();
    cancel.reset();
    onClose();
  };
  const update = useMutation({
    mutationFn: () =>
      apiRequest('payments.update', {
        params: { id: payment?.id ?? '' },
        body: {
          amountMinor: parseMoneyToMinor(amount) ?? 0,
          paidOn,
          method,
          comment: comment.trim(),
        },
      }),
    onSuccess: () => {
      invalidate();
      toast.show(t('saved'));
      close();
    },
  });
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      apiRequest('payments.cancel', {
        params: { id: payment?.id ?? '' },
        body: { reason },
      }),
    onSuccess: () => {
      invalidate();
      toast.show(t('cancelled'));
      close();
    },
  });
  const error = useApiErrorMessage(update.error ?? cancel.error);
  const amountInvalid = (parseMoneyToMinor(amount) ?? 0) <= 0;
  const today = toAppDate();
  const readOnly = payment?.cancelled ?? false;

  return (
    <Dialog
      open={payment !== null}
      onClose={close}
      title={t('title', { number: payment?.invoiceNumber ?? '' })}
      description={
        payment
          ? `${payment.tenantName} · ${t('recordedBy', { name: payment.recordedBy })}`
          : undefined
      }
      closeLabel={tCommon('close')}
      size="md"
      footer={
        readOnly ? (
          <Button variant="tertiary" onClick={close}>
            {tCommon('close')}
          </Button>
        ) : cancelReason === null ? (
          <>
            <Button
              variant="destructive"
              iconStart="ban"
              onClick={() => setCancelReason('')}
            >
              {t('cancel')}
            </Button>
            <Button variant="tertiary" onClick={close}>
              {tCommon('close')}
            </Button>
            <Button
              loading={update.isPending}
              disabled={amountInvalid || paidOn > today}
              onClick={() => update.mutate()}
            >
              {t('save')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="tertiary" onClick={() => setCancelReason(null)}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={cancel.isPending}
              disabled={cancelReason.trim().length < 5}
              onClick={() => cancel.mutate(cancelReason.trim())}
            >
              {t('confirmCancel')}
            </Button>
          </>
        )
      }
    >
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      {readOnly && <Alert tone="warning">{t('cancelledNote')}</Alert>}
      {cancelReason === null ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label={tPayment('amount')}
              inputMode="decimal"
              value={amount}
              readOnly={readOnly}
              error={amountInvalid ? tPayment('amountError') : undefined}
              onChange={(event) => setAmount(event.target.value)}
            />
            <TextField
              label={tPayment('paidOn')}
              type="date"
              max={today}
              value={paidOn}
              readOnly={readOnly}
              onChange={(event) => setPaidOn(event.target.value)}
            />
          </div>
          <Select
            label={tPayment('method')}
            value={method}
            disabled={readOnly}
            options={methods.map((value) => ({
              value,
              label: tPayment(`methods.${value}`),
            }))}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          />
          <TextareaField
            label={tPayment('comment')}
            rows={2}
            value={comment}
            readOnly={readOnly}
            onChange={(event) => setComment(event.target.value)}
          />
        </>
      ) : (
        <>
          <Alert tone="attention">{t('cancelNote')}</Alert>
          <TextareaField
            label={t('cancelReason')}
            rows={2}
            required
            value={cancelReason}
            hint={t('cancelReasonHint')}
            onChange={(event) => setCancelReason(event.target.value)}
          />
        </>
      )}
    </Dialog>
  );
}
