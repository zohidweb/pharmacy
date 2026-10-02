'use client';

import type {
  Supplier,
  SupplierCard,
  SupplierInput,
  SupplierPaymentMethod,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatMoney,
  parseMoneyToMinor,
  toAppDate,
  uuidv7,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Select,
  Tabs,
  TextField,
  useToast,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { DebtStatePill, OrderStatusPill } from '@/entities/purchasing';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';

const EMPTY: SupplierInput = {
  name: '',
  taxId: '',
  phone: '',
  address: '',
  paymentDelayDays: 30,
};

/** New supplier or its details (UI mockup «Новый поставщик»). */
export function SupplierFormDialog({
  supplier,
  onClose,
}: {
  supplier: Supplier | null;
  onClose: () => void;
}) {
  const t = useTranslations('suppliers.form');
  const tDocs = useTranslations('stockDocs');
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SupplierInput>(() =>
    supplier
      ? {
          name: supplier.name,
          taxId: supplier.taxId,
          phone: supplier.phone,
          address: supplier.address,
          paymentDelayDays: supplier.paymentDelayDays,
        }
      : EMPTY,
  );
  const [touched, setTouched] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      supplier
        ? apiRequest('suppliers.update', {
            params: { id: supplier.id },
            body: form,
          })
        : apiRequest('suppliers.create', { body: form }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    },
  });
  const error = useApiErrorMessage(save.error);
  const invalid = {
    name: form.name.trim() === '',
    taxId: form.taxId.trim() !== '' && !/^\d{9}$/.test(form.taxId.trim()),
  };
  const field = (key: keyof SupplierInput) => ({
    value: String(form[key]),
    onChange: (event: { target: { value: string } }) =>
      setForm((current) => ({
        ...current,
        [key]:
          key === 'paymentDelayDays'
            ? Number(event.target.value.replace(/\D/g, '') || 0)
            : event.target.value,
      })),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={supplier ? supplier.name : t('newTitle')}
      description={t('subtitle')}
      closeLabel={tDocs('close')}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tDocs('cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalid.name && !invalid.taxId) save.mutate();
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t('name')}
            required
            {...field('name')}
            error={touched && invalid.name ? t('nameRequired') : undefined}
          />
          <TextField
            label={t('taxId')}
            inputMode="numeric"
            {...field('taxId')}
            hint={t('taxIdHint')}
            error={touched && invalid.taxId ? t('taxIdFormat') : undefined}
          />
          <TextField label={t('phone')} type="tel" {...field('phone')} />
          <TextField
            label={t('paymentDelay')}
            inputMode="numeric"
            {...field('paymentDelayDays')}
          />
        </div>
        <TextField label={t('address')} {...field('address')} />
      </div>
    </Dialog>
  );
}

type CardTab = 'orders' | 'receipts' | 'ledger';

/** Supplier card: details, orders, receipts and the debt ledger (UI mockup «Карточка поставщика»). */
export function SupplierCardDialog({
  supplierId,
  canPay,
  canEdit,
  onPay,
  onEdit,
  onClose,
}: {
  supplierId: string;
  canPay: boolean;
  canEdit: boolean;
  onPay: (card: SupplierCard) => void;
  onEdit: (card: SupplierCard) => void;
  onClose: () => void;
}) {
  const t = useTranslations('suppliers.card');
  const tSup = useTranslations('suppliers');
  const tDocs = useTranslations('stockDocs');
  const [tab, setTab] = useState<CardTab>('ledger');
  const card = useQuery({
    queryKey: ['suppliers', 'card', supplierId],
    queryFn: ({ signal }) =>
      apiRequest('suppliers.get', { params: { id: supplierId }, signal }),
  });

  const docColumns = (
    withStatus: boolean,
  ): DataTableColumn<SupplierCard['orders'][number]>[] => [
    { key: 'number', header: '№', cell: (row) => row.number },
    {
      key: 'date',
      header: tDocs('date'),
      nowrap: true,
      cell: (row) => formatDateOnly(row.date),
    },
    { key: 'store', header: tDocs('store'), cell: (row) => row.storeName },
    {
      key: 'total',
      header: tDocs('sum'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.totalMinor, { withSign: false }),
    },
    ...(withStatus
      ? [
          {
            key: 'status',
            header: tDocs('statusHeader'),
            cell: (row: SupplierCard['orders'][number]) => (
              <OrderStatusPill status={row.status} />
            ),
          },
        ]
      : []),
  ];
  const ledgerColumns: DataTableColumn<SupplierCard['ledger'][number]>[] = [
    {
      key: 'date',
      header: tDocs('date'),
      nowrap: true,
      cell: (row) => formatDateOnly(row.date),
    },
    {
      key: 'operation',
      header: t('operation'),
      cell: (row) =>
        [
          t(`kinds.${row.kind}`),
          row.document,
          row.method ? t(`methods.${row.method}`) : '',
          row.comment,
        ]
          .filter(Boolean)
          .join(' · '),
    },
    {
      key: 'amount',
      header: t('amount'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.amountMinor, { withSign: false }),
    },
    {
      key: 'balance',
      header: t('balance'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.balanceMinor, { withSign: false }),
    },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={card.data?.name ?? t('title')}
      description={t('title')}
      closeLabel={tDocs('close')}
      size="xl"
      footer={
        card.data && (
          <>
            <Button variant="secondary" onClick={onClose}>
              {tDocs('close')}
            </Button>
            {canEdit && (
              <Button
                variant="secondary"
                iconStart="pencil"
                onClick={() => card.data && onEdit(card.data)}
              >
                {t('edit')}
              </Button>
            )}
            {canPay && (card.data.debtMinor ?? 0) > 0 && (
              <Button
                iconStart="wallet"
                onClick={() => card.data && onPay(card.data)}
              >
                {tSup('pay')}
              </Button>
            )}
          </>
        )
      }
    >
      <QueryState query={card}>
        {(data) => (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-4 gap-4 text-sm">
              {(
                [
                  ['taxId', data.taxId || '—'],
                  ['phone', data.phone || '—'],
                  ['paymentDelay', t('days', { count: data.paymentDelayDays })],
                  ['address', data.address || '—'],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex flex-col gap-1">
                  <dt className="text-xs text-fg-muted">{t(key)}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-fg-muted">{tSup('debt')}</span>
              <b className="text-lg tabular-nums">
                {formatMoney(data.debtMinor ?? 0)}
              </b>
              <DebtStatePill
                state={data.debtState}
                overdueDays={data.overdueDays}
              />
              {data.nextDueOn && (
                <span className="text-sm text-fg-muted">
                  {tSup('payBy', { date: formatDateOnly(data.nextDueOn) })}
                </span>
              )}
            </div>
            <Tabs
              label={t('title')}
              value={tab}
              onValueChange={setTab}
              items={[
                {
                  value: 'ledger',
                  label: t('tabs.ledger'),
                  panel: (
                    <DataTable
                      caption={t('tabs.ledger')}
                      rowKey={(row) =>
                        `${row.date}-${row.kind}-${row.document}-${row.balanceMinor}`
                      }
                      rows={data.ledger}
                      columns={ledgerColumns}
                      empty={<EmptyState icon="wallet" title={t('empty')} />}
                    />
                  ),
                },
                {
                  value: 'orders',
                  label: t('tabs.orders'),
                  count: data.orders.length,
                  panel: (
                    <DataTable
                      caption={t('tabs.orders')}
                      rowKey={(row) => row.id}
                      rows={data.orders}
                      columns={docColumns(true)}
                      empty={
                        <EmptyState icon="clipboard-list" title={t('empty')} />
                      }
                    />
                  ),
                },
                {
                  value: 'receipts',
                  label: t('tabs.receipts'),
                  count: data.receipts.length,
                  panel: (
                    <DataTable
                      caption={t('tabs.receipts')}
                      rowKey={(row) => row.id}
                      rows={data.receipts.map((r) => ({
                        ...r,
                        status: 'closed' as const,
                      }))}
                      columns={docColumns(false)}
                      empty={<EmptyState icon="inbox" title={t('empty')} />}
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
      </QueryState>
    </Dialog>
  );
}

/**
 * Payment to a supplier — a financial operation: one idempotency key per dialog, so a retry after
 * a lost answer does not pay twice (CLAUDE.md «Integrations»).
 */
export function PaymentDialog({
  supplier,
  onClose,
}: {
  supplier: { id: string; name: string; debtMinor?: number };
  onClose: () => void;
}) {
  const t = useTranslations('suppliers.payment');
  const tDocs = useTranslations('stockDocs');
  const toast = useToast();
  const queryClient = useQueryClient();
  const debt = supplier.debtMinor ?? 0;
  const [key] = useState(uuidv7);
  const [amountText, setAmountText] = useState(
    formatMoney(debt, { withSign: false }),
  );
  const [date, setDate] = useState(toAppDate());
  const [method, setMethod] = useState<SupplierPaymentMethod>('bank');
  const [comment, setComment] = useState('');
  const amount = parseMoneyToMinor(amountText);
  const amountError =
    amount === null || amount <= 0
      ? t('amountInvalid')
      : amount > debt
        ? t('amountAboveDebt')
        : null;
  const pay = useMutation({
    mutationFn: () =>
      apiRequest('suppliers.pay', {
        params: { id: supplier.id },
        body: {
          id: key,
          amountMinor: amount ?? 0,
          date,
          method,
          comment,
        },
        idempotencyKey: key,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.show(t('done', { amount: formatMoney(amount ?? 0) }));
      onClose();
    },
  });
  const error = useApiErrorMessage(pay.error);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={supplier.name}
      closeLabel={tDocs('close')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tDocs('cancel')}
          </Button>
          <Button
            iconStart="wallet"
            loading={pay.isPending}
            disabled={amountError !== null}
            onClick={() => pay.mutate()}
          >
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <p className="flex justify-between text-sm">
          <span className="text-fg-muted">{t('debt')}</span>
          <b className="tabular-nums">{formatMoney(debt)}</b>
        </p>
        <TextField
          label={t('amount')}
          inputMode="decimal"
          value={amountText}
          error={amountError ?? undefined}
          onChange={(event) => setAmountText(event.target.value)}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={tDocs('date')}
            type="date"
            max={toAppDate()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <Select
            label={t('method')}
            value={method}
            onChange={(event) =>
              setMethod(event.target.value as SupplierPaymentMethod)
            }
            options={(['bank', 'cash'] as const).map((value) => ({
              value,
              label: t(`methods.${value}`),
            }))}
          />
        </div>
        <TextField
          label={t('comment')}
          placeholder={t('commentPlaceholder')}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <p className="text-xs text-fg-subtle">{t('fifoHint')}</p>
      </div>
    </Dialog>
  );
}
