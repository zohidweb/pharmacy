'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { InvoiceListItem, PaymentMethod } from '@pharmacy/shared-dto';
import {
  formatMoney,
  parseMoneyToMinor,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Dialog,
  Select,
  TextareaField,
  TextField,
  useToast,
  type ButtonVariant,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { billingKeys, useInvoices } from '@/entities/invoice';
import { tenantKeys } from '@/entities/tenant';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const methods: PaymentMethod[] = ['bank_transfer', 'cash'];

function schema(today: string) {
  return z.object({
    invoiceId: z.string().min(1, { error: 'required' }),
    amount: z.string().refine((value) => (parseMoneyToMinor(value) ?? 0) > 0, {
      error: 'money',
    }),
    paidOn: z
      .string()
      .regex(DATE, { error: 'required' })
      .refine((value) => value <= today, { error: 'notFuture' }),
    method: z.enum(methods),
    paidUntil: z
      .string()
      .refine((value) => value === '' || (DATE.test(value) && value >= today), {
        error: 'dateFromToday',
      }),
    comment: z.string().max(500),
  });
}
type Values = z.input<ReturnType<typeof schema>>;
type ErrorKey = 'required' | 'money' | 'dateFromToday';
const isErrorKey = (value: unknown): value is ErrorKey =>
  value === 'required' || value === 'money' || value === 'dateFromToday';

export interface RecordPaymentProps {
  /** Limit the invoice choice to one tenant (company card). */
  tenantId?: string;
  variant?: ButtonVariant;
}

/**
 * «Зафиксировать платёж» — a financial write: one Idempotency-Key per opened dialog, so a retried
 * submit cannot record the payment twice. Optionally sets "paid until" for the tenant's cloud stores.
 */
export function RecordPayment({
  tenantId,
  variant = 'primary',
}: RecordPaymentProps) {
  const t = useTranslations('payment');
  const tErrors = useTranslations('validation');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const today = toAppDate();
  const invoices = useInvoices({ filter: 'all', limit: 100 });
  const unpaid: InvoiceListItem[] = (invoices.data?.items ?? []).filter(
    (invoice) =>
      invoice.status !== 'paid' && (!tenantId || invoice.tenantId === tenantId),
  );
  const form = useForm<Values>({
    resolver: zodResolver(schema(today)),
    defaultValues: {
      invoiceId: '',
      amount: '',
      paidOn: today,
      method: 'bank_transfer',
      paidUntil: '',
      comment: '',
    },
  });

  const record = useMutation({
    mutationFn: (values: Values) =>
      apiRequest('payments.record', {
        idempotencyKey,
        body: {
          invoiceId: values.invoiceId,
          amountMinor: parseMoneyToMinor(values.amount) ?? 0,
          paidOn: values.paidOn,
          method: values.method,
          ...(values.paidUntil && { paidUntil: values.paidUntil }),
          ...(values.comment.trim() && { comment: values.comment.trim() }),
        },
      }),
    onSuccess: (payment) => {
      void queryClient.invalidateQueries({ queryKey: billingKeys.all });
      void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
      toast.show(t('recorded', { amount: formatMoney(payment.amountMinor) }));
      close();
    },
  });
  const apiError = useApiErrorMessage(record.error);

  function openDialog() {
    setIdempotencyKey(crypto.randomUUID());
    setOpen(true);
  }
  function close() {
    setOpen(false);
    form.reset();
    record.reset();
  }
  const error = (field: keyof Values) => {
    const message = form.formState.errors[field]?.message;
    if (message === 'notFuture') return t('notFuture');
    return isErrorKey(message) ? tErrors(message) : undefined;
  };

  return (
    <>
      <Button variant={variant} iconStart="receipt" onClick={openDialog}>
        {t('action')}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={t('title')}
        description={t('description')}
        closeLabel={tCommon('close')}
        size="md"
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              form="record-payment"
              loading={record.isPending}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <form
          id="record-payment"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => record.mutate(values))}
        >
          {apiError && (
            <Alert tone="danger" live="assertive">
              {apiError}
            </Alert>
          )}
          {invoices.isSuccess && unpaid.length === 0 ? (
            <Alert tone="info">{t('noUnpaid')}</Alert>
          ) : (
            <Select
              label={t('invoice')}
              placeholder={t('invoicePlaceholder')}
              required
              error={error('invoiceId')}
              options={unpaid.map((invoice) => ({
                value: invoice.id,
                label: `${invoice.number} · ${invoice.tenantName} · ${formatMoney(invoice.totalMinor)}`,
              }))}
              {...form.register('invoiceId', {
                onChange: (event: { target: { value: string } }) => {
                  const invoice = unpaid.find(
                    (item) => item.id === event.target.value,
                  );
                  if (invoice) {
                    form.setValue(
                      'amount',
                      formatMoney(invoice.totalMinor, {
                        withSign: false,
                        plainSpaces: true,
                      }),
                    );
                  }
                },
              })}
            />
          )}
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label={t('amount')}
              inputMode="decimal"
              required
              error={error('amount')}
              {...form.register('amount')}
            />
            <TextField
              label={t('paidOn')}
              type="date"
              max={today}
              required
              error={error('paidOn')}
              {...form.register('paidOn')}
            />
          </div>
          <Select
            label={t('method')}
            options={methods.map((value) => ({
              value,
              label: t(`methods.${value}`),
            }))}
            {...form.register('method')}
          />
          <TextField
            label={t('paidUntil')}
            type="date"
            min={today}
            hint={t('paidUntilHint')}
            error={error('paidUntil')}
            {...form.register('paidUntil')}
          />
          <TextareaField
            label={t('comment')}
            rows={2}
            placeholder={t('commentPlaceholder')}
            {...form.register('comment')}
          />
        </form>
      </Dialog>
    </>
  );
}
