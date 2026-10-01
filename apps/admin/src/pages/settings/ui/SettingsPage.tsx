'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type {
  PlatformOperator,
  PlatformSettings,
  SyncSchedule,
} from '@pharmacy/shared-dto';
import {
  formatDateTime,
  formatMoney,
  parseMoneyToMinor,
} from '@pharmacy/shared-util';
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  Dialog,
  Select,
  StatusPill,
  Switch,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const schedules: SyncSchedule[] = ['daily', 'twice_daily', 'hourly', 'manual'];

const schema = z.object({
  price: z
    .string()
    .refine((value) => (parseMoneyToMinor(value) ?? 0) > 0, { error: 'money' }),
  vatRate: z.string().regex(/^\d{1,2}$/, { error: 'vat' }),
  prorateByDays: z.boolean(),
  noticeDays: z
    .string()
    .regex(/^\d{1,2}$/, { error: 'notifyDays' })
    .refine((value) => Number(value) >= 1 && Number(value) <= 60, {
      error: 'notifyDays',
    }),
  defaultSyncSchedule: z.enum(schedules),
  acceptLegacyVersionSync: z.boolean(),
  supplierName: z.string().trim().min(1, { error: 'required' }),
  supplierInn: z
    .string()
    .trim()
    .regex(/^\d{9}$/, { error: 'inn' }),
  bankAccount: z
    .string()
    .trim()
    .regex(/^\d{20}$/, { error: 'bankAccount' }),
  paymentPurpose: z
    .string()
    .trim()
    .refine((value) => value.includes('{number}'), { error: 'purpose' }),
});
type Values = z.input<typeof schema>;
type ErrorKey =
  | 'money'
  | 'vat'
  | 'notifyDays'
  | 'required'
  | 'inn'
  | 'bankAccount'
  | 'purpose';
const errorKeys: readonly string[] = [
  'money',
  'vat',
  'notifyDays',
  'required',
  'inn',
  'bankAccount',
  'purpose',
];

function toValues(settings: PlatformSettings): Values {
  return {
    price: formatMoney(settings.pricePerStoreMinor, {
      withSign: false,
      plainSpaces: true,
    }),
    vatRate: String(settings.vatRatePercent),
    prorateByDays: settings.prorateByDays,
    noticeDays: String(settings.keyExpiryNoticeDays),
    defaultSyncSchedule: settings.defaultSyncSchedule,
    acceptLegacyVersionSync: settings.acceptLegacyVersionSync,
    supplierName: settings.supplier.name,
    supplierInn: settings.supplier.inn,
    bankAccount: settings.supplier.bankAccount,
    paymentPurpose: settings.supplier.paymentPurposeTemplate,
  };
}

function toSettings(values: Values): PlatformSettings {
  return {
    pricePerStoreMinor: parseMoneyToMinor(values.price) ?? 0,
    vatRatePercent: Number(values.vatRate),
    prorateByDays: values.prorateByDays,
    keyExpiryNoticeDays: Number(values.noticeDays),
    defaultSyncSchedule: values.defaultSyncSchedule,
    acceptLegacyVersionSync: values.acceptLegacyVersionSync,
    supplier: {
      name: values.supplierName.trim(),
      inn: values.supplierInn.trim(),
      bankAccount: values.bankAccount.trim(),
      paymentPurposeTemplate: values.paymentPurpose.trim(),
    },
  };
}

function SettingsForm({ settings }: { settings: PlatformSettings }) {
  const t = useTranslations('settings');
  const tSchedule = useTranslations('store.license.scheduleValue');
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: toValues(settings),
  });
  const save = useMutation({
    mutationFn: (values: Values) =>
      apiRequest('settings.update', { body: toSettings(values) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings'], saved);
      form.reset(toValues(saved));
      toast.show(t('saved'));
    },
  });
  const apiError = useApiErrorMessage(save.error);
  const error = (field: keyof Values) => {
    const message = form.formState.errors[field]?.message;
    return message && errorKeys.includes(message)
      ? t(`errors.${message as ErrorKey}`)
      : undefined;
  };

  return (
    <form
      id="settings-form"
      noValidate
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      className="flex flex-col gap-4"
    >
      {apiError && (
        <Alert tone="danger" live="assertive">
          {apiError}
        </Alert>
      )}
      <div className="grid grid-cols-2 items-start gap-4">
        <Card
          as="section"
          aria-labelledby="pricing-title"
          className="flex flex-col gap-4"
        >
          <CardHeader title={t('pricing.title')} titleId="pricing-title" />
          <TextField
            label={t('pricing.price')}
            inputMode="decimal"
            hint={t('pricing.priceHint')}
            error={error('price')}
            {...form.register('price')}
          />
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label={t('pricing.currency')}
              value={t('pricing.currencyValue')}
              readOnly
              hint={t('pricing.currencyHint')}
            />
            <TextField
              label={t('pricing.vat')}
              inputMode="numeric"
              hint={t('pricing.vatHint')}
              error={error('vatRate')}
              {...form.register('vatRate')}
            />
          </div>
          <Controller
            control={form.control}
            name="prorateByDays"
            render={({ field }) => (
              <Switch
                label={t('pricing.prorate')}
                description={t('pricing.prorateHint')}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </Card>
        <Card
          as="section"
          aria-labelledby="offline-title"
          className="flex flex-col gap-4"
        >
          <CardHeader title={t('offline.title')} titleId="offline-title" />
          <TextField
            label={t('offline.noticeDays')}
            inputMode="numeric"
            hint={t('offline.noticeDaysHint')}
            error={error('noticeDays')}
            {...form.register('noticeDays')}
          />
          <Select
            label={t('offline.schedule')}
            options={schedules.map((value) => ({
              value,
              label: tSchedule(value),
            }))}
            {...form.register('defaultSyncSchedule')}
          />
          <Controller
            control={form.control}
            name="acceptLegacyVersionSync"
            render={({ field }) => (
              <Switch
                label={t('offline.legacy')}
                description={t('offline.legacyHint')}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Switch
            label={t('offline.autoDelivery')}
            description={t('offline.autoDeliveryHint')}
            checked={false}
            onCheckedChange={() => undefined}
            disabled
          />
        </Card>
        <Card
          as="section"
          aria-labelledby="supplier-title"
          className="col-span-2 flex flex-col gap-4"
        >
          <CardHeader
            title={t('supplier.title')}
            titleId="supplier-title"
            description={t('supplier.hint')}
          />
          <div className="grid grid-cols-3 gap-4">
            <TextField
              label={t('supplier.name')}
              error={error('supplierName')}
              {...form.register('supplierName')}
            />
            <TextField
              label={t('supplier.inn')}
              inputMode="numeric"
              error={error('supplierInn')}
              {...form.register('supplierInn')}
            />
            <TextField
              label={t('supplier.account')}
              inputMode="numeric"
              mono
              error={error('bankAccount')}
              {...form.register('bankAccount')}
            />
          </div>
          <TextField
            label={t('supplier.purpose')}
            hint={t('supplier.purposeHint')}
            error={error('paymentPurpose')}
            {...form.register('paymentPurpose')}
          />
        </Card>
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          iconStart="check"
          disabled={!form.formState.isDirty}
          loading={save.isPending}
        >
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

function AddOperator({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('settings.team');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [login, setLogin] = useState('');
  const [touched, setTouched] = useState(false);
  const invalid = {
    fullName: fullName.trim().length < 3,
    login: !z.email().safeParse(login.trim()).success,
  };
  const create = useMutation({
    mutationFn: () =>
      apiRequest('operators.create', {
        body: { fullName: fullName.trim(), login: login.trim().toLowerCase() },
      }),
    onSuccess: (operator) => {
      void queryClient.invalidateQueries({ queryKey: ['operators'] });
      toast.show(t('added', { name: operator.fullName }));
      setFullName('');
      setLogin('');
      setTouched(false);
      onClose();
    },
  });
  const error = useApiErrorMessage(create.error);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('addTitle')}
      description={t('addDescription')}
      closeLabel={tCommon('close')}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            loading={create.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalid.fullName && !invalid.login) create.mutate();
            }}
          >
            {t('add')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <TextField
        label={t('fullName')}
        required
        value={fullName}
        error={touched && invalid.fullName ? t('fullNameError') : undefined}
        onChange={(event) => setFullName(event.target.value)}
      />
      <TextField
        label={t('login')}
        type="email"
        required
        value={login}
        error={touched && invalid.login ? t('loginError') : undefined}
        onChange={(event) => setLogin(event.target.value)}
      />
      <TextField
        label={t('role')}
        value={t('roleValue')}
        readOnly
        hint={t('roleHint')}
      />
    </Dialog>
  );
}

function TeamCard() {
  const t = useTranslations('settings.team');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [adding, setAdding] = useState(false);
  const [disabling, setDisabling] = useState<PlatformOperator | null>(null);
  const operators = useQuery({
    queryKey: ['operators'],
    queryFn: ({ signal }) => apiRequest('operators.list', { signal }),
  });
  const disable = useMutation({
    mutationFn: (id: string) =>
      apiRequest('operators.disable', { params: { id } }),
    onSuccess: (operator) => {
      void queryClient.invalidateQueries({ queryKey: ['operators'] });
      toast.show(t('disabled', { name: operator.fullName }));
      setDisabling(null);
    },
  });
  const error = useApiErrorMessage(disable.error);
  return (
    <Card as="section" aria-labelledby="team-title">
      <CardHeader
        title={t('title')}
        titleId="team-title"
        description={t('hint')}
        actions={
          <Button
            variant="secondary"
            iconStart="user-plus"
            onClick={() => setAdding(true)}
          >
            {t('addAction')}
          </Button>
        }
      />
      <QueryState query={operators}>
        {(rows) => (
          <ul className="m-0 flex list-none flex-col p-0">
            {rows.map((operator) => (
              <li
                key={operator.id}
                className="flex items-center gap-3 border-t border-border py-3"
              >
                <Avatar name={operator.fullName} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">
                    {operator.fullName}
                    {operator.id === session?.operator.id && (
                      <span className="text-fg-subtle"> · {t('you')}</span>
                    )}
                  </span>
                  <span className="text-xs text-fg-subtle">
                    {operator.login} ·{' '}
                    {operator.lastLoginAt
                      ? t('lastLogin', {
                          at: formatDateTime(operator.lastLoginAt),
                        })
                      : t('neverLoggedIn')}
                  </span>
                </div>
                {operator.status === 'disabled' ? (
                  <StatusPill tone="neutral" icon="ban">
                    {t('statusDisabled')}
                  </StatusPill>
                ) : (
                  operator.id !== session?.operator.id && (
                    <Button
                      variant="tertiary"
                      aria-label={t('disableFor', { name: operator.fullName })}
                      onClick={() => setDisabling(operator)}
                    >
                      <span className="text-danger">{t('disable')}</span>
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <AddOperator open={adding} onClose={() => setAdding(false)} />
      <Dialog
        open={disabling !== null}
        onClose={() => setDisabling(null)}
        title={t('disableTitle', { name: disabling?.fullName ?? '' })}
        description={t('disableDescription')}
        closeLabel={tCommon('close')}
        icon="ban"
        tone="danger"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setDisabling(null)}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={disable.isPending}
              onClick={() => disabling && disable.mutate(disabling.id)}
            >
              {t('disable')}
            </Button>
          </>
        }
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
      </Dialog>
    </Card>
  );
}

/** «Настройки платформы» (UI mockup «Настройки»): tariff, VAT, offline defaults, requisites, team. */
export function SettingsPage() {
  const t = useTranslations('settings');
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => apiRequest('settings.get', { signal }),
  });
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 p-6">
        <QueryState query={settings}>
          {(data) => <SettingsForm settings={data} />}
        </QueryState>
        <TeamCard />
      </div>
    </>
  );
}
