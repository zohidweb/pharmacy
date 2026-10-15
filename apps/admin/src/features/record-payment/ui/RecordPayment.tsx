'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { InvoiceListItem, PaymentMethod } from '@pharmacy/shared-dto';
import {
  formatMoney,
  parseMoneyToMinor,
  toAppDate,
  uuidv7,
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
import { tenantKeys, useTenantList } from '@/entities/tenant';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const methods: PaymentMethod[] = ['bank_transfer', 'cash'];

function schema(today: string) {
  return z.object({
    tenantId: z.string().min(1, { error: 'required' }),
    invoiceId: z.string(),
    amount: z.string().refine((value) => (parseMoneyToMinor(value) ?? 0) > 0, {
      error: 'money',
    }),
    paidOn: z
      .string()
      .regex(DATE, { error: 'required' })
      .refine((value) => value <= today, { error: 'notFuture' }),
    method: z.enum(methods),
    comment: z.string().max(500),
  });
}
type Values = z.input<ReturnType<typeof schema>>;
type ErrorKey = 'required' | 'money';
const isErrorKey = (value: unknown): value is ErrorKey =>
  value === 'required' || value === 'money';

export interface RecordPaymentProps {
  /** The company of the payment, fixed on its card. */
  tenantId?: string;
  variant?: ButtonVariant;
}

/**
 * «Зафиксировать платёж» of a company (spec 2026-10-15-billing-services, B2, A9): the payment goes
 * first to the chosen invoice, then to the oldest; the rest is the advance. Its UUIDv7 `id`, made
 * when the dialog opens, is the idempotency key: a retried submit cannot record it twice.
 */
export function RecordPayment({
  tenantId: fixedTenant,
  variant = 'primary',
}: RecordPaymentProps) {
  const t = useTranslations('payment');
  const tErrors = useTranslations('validation');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [paymentId, setPaymentId] = useState('');
  const today = toAppDate();
  const form = useForm<Values>({
    resolver: zodResolver(schema(today)),
    defaultValues: {
      tenantId: fixedTenant ?? '',
      invoiceId: '',
      amount: '',
      paidOn: today,
      method: 'bank_transfer',
      comment: '',
    },
  });
  const tenantId = form.watch('tenantId');
  const tenants = useTenantList({ limit: 100, sort: 'name' });
  const invoices = useInvoices(
    { tenantId, filter: 'unpaid', limit: 100 },
    open && tenantId !== '',
  );
  const unpaid: InvoiceListItem[] = invoices.data?.items ?? [];

  const record = useMutation({
    mutationFn: (values: Values) =>
      apiRequest('payments.record', {
        body: {
          id: paymentId,
          tenantId: values.tenantId,
          invoiceId: values.invoiceId || null,
          amountMinor: parseMoneyToMinor(values.amount) ?? 0,
          paidOn: values.paidOn,
          method: values.method,
          comment: values.comment.trim() || null,
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
    setPaymentId(uuidv7());
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
          {fixedTenant === undefined && (
            <Select
              label={t('tenant')}
              placeholder={t('tenantPlaceholder')}
              required
              error={error('tenantId')}
              options={(tenants.data?.items ?? []).map((tenant) => ({
                value: tenant.id,
                label: tenant.name,
              }))}
              {...form.register('tenantId', {
                onChange: () => form.setValue('invoiceId', ''),
              })}
            />
          )}
          <Select
            label={t('invoice')}
            placeholder={t('invoicePlaceholder')}
            disabled={tenantId === ''}
            options={unpaid.map((invoice) => ({
              value: invoice.id,
              label: t('invoiceOption', {
                number: invoice.number,
                amount: formatMoney(invoice.remainingMinor),
              }),
            }))}
            {...form.register('invoiceId', {
              onChange: (event: { target: { value: string } }) => {
                const invoice = unpaid.find(
                  (item) => item.id === event.target.value,
                );
                if (invoice) {
                  form.setValue(
                    'amount',
                    formatMoney(invoice.remainingMinor, {
                      withSign: false,
                      plainSpaces: true,
                    }),
                  );
                }
              },
            })}
          />
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
