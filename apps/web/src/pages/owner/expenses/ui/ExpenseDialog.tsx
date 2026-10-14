'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type ExpenseKind, expenseKinds } from '@pharmacy/shared-domain';
import type { CreateExpenseRequest, Expense } from '@pharmacy/shared-dto';
import { parseMoneyToMinor, toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Dialog,
  Select,
  TextField,
  TextareaField,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { useSession } from '@/entities/session';
import { ApiError, apiRequest, useApiErrorMessage } from '@/shared/api';

/** The store field of the whole network. */
const NETWORK = 'network';

const MAX_MONEY_MINOR = 10_000_000_000;

const schema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'monthInvalid')
    .refine((month) => month <= toAppDate().slice(0, 7), 'monthInvalid'),
  storeId: z.string().min(1),
  kind: z.enum(expenseKinds),
  amount: z.string().refine((value) => {
    const minor = parseMoneyToMinor(value);
    return minor !== null && minor >= 1 && minor <= MAX_MONEY_MINOR;
  }, 'amountInvalid'),
  comment: z.string().max(500, 'commentTooLong'),
});

type Values = z.infer<typeof schema>;

const amountText = (minor: number) =>
  `${Math.floor(minor / 100)},${String(minor % 100).padStart(2, '0')}`;

// the server fields of the form and the message of each (spec 2026-10-14-owner-cabinet, 7)
const FIELD_MESSAGES: Record<string, { field: keyof Values; message: string }> = {
  month: { field: 'month', message: 'monthInvalid' },
  amountMinor: { field: 'amount', message: 'amountInvalid' },
  comment: { field: 'comment', message: 'commentTooLong' },
};

/**
 * Adding or changing an expense (spec 2026-10-14-owner-cabinet, E16, 8 «PR 3»): the month, a store
 * or the whole network (only for an employee of the whole network), the kind, the amount and a
 * comment. The server is the source of truth: its field errors go to the fields.
 */
export function ExpenseDialog({
  expense,
  month,
  onClose,
}: {
  /** null — a new expense of `month`. */
  expense: Expense | null;
  month: string;
  onClose: () => void;
}) {
  const t = useTranslations('expenses');
  const kinds = useTranslations('expenseKinds');
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const wholeNetwork = session?.scope === 'network';
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      month: expense?.month ?? month,
      storeId:
        expense?.storeId ??
        (expense || wholeNetwork ? NETWORK : (session?.stores[0]?.id ?? '')),
      kind: expense?.kind ?? 'rent',
      amount: expense ? amountText(expense.amountMinor) : '',
      comment: expense?.comment ?? '',
    },
  });

  const save = useMutation({
    mutationFn: (values: Values) => {
      const body: CreateExpenseRequest = {
        month: values.month,
        storeId: values.storeId === NETWORK ? null : values.storeId,
        kind: values.kind as ExpenseKind,
        amountMinor: parseMoneyToMinor(values.amount) ?? 0,
        comment: values.comment.trim() || null,
      };
      return expense
        ? apiRequest('expenses.update', { params: { id: expense.id }, body })
        : apiRequest('expenses.create', { body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
      onClose();
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      for (const problem of error.errors ?? []) {
        const target = FIELD_MESSAGES[problem.field];
        if (target) setError(target.field, { message: target.message });
      }
    },
  });
  const fieldErrors =
    save.error instanceof ApiError &&
    (save.error.errors ?? []).some((problem) => FIELD_MESSAGES[problem.field]);
  const errorMessage = useApiErrorMessage(fieldErrors ? null : save.error);
  const message = (key?: string) =>
    key ? t(key as 'amountInvalid') : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      title={expense ? t('editTitle') : t('createTitle')}
      closeLabel={t('cancel')}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form="expense-form"
            loading={save.isPending}
            disabled={save.isPending}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <form
        id="expense-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={handleSubmit((values) => save.mutate(values))}
      >
        {errorMessage && <Alert tone="danger">{errorMessage}</Alert>}
        <TextField
          label={t('monthField')}
          type="month"
          max={toAppDate().slice(0, 7)}
          error={message(errors.month?.message)}
          {...register('month')}
        />
        <Select
          label={t('store')}
          error={message(errors.storeId?.message)}
          options={[
            ...(wholeNetwork ? [{ value: NETWORK, label: t('network') }] : []),
            ...(session?.stores ?? []).map((store) => ({
              value: store.id,
              label: store.name,
            })),
          ]}
          {...register('storeId')}
        />
        <Select
          label={t('kind')}
          options={expenseKinds.map((kind) => ({
            value: kind,
            label: kinds(kind),
          }))}
          {...register('kind')}
        />
        <TextField
          label={t('amount')}
          inputMode="decimal"
          autoComplete="off"
          error={message(errors.amount?.message)}
          {...register('amount')}
        />
        <TextareaField
          label={t('comment')}
          rows={2}
          error={message(errors.comment?.message)}
          {...register('comment')}
        />
      </form>
    </Dialog>
  );
}
