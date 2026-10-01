'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatDateOnly,
  formatMoney,
  parseMoneyToMinor,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Icon,
  RadioCardGroup,
  Select,
  Stepper,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { tenantKeys } from '@/entities/tenant';
import { ApiError, apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { PageHeader } from '@/widgets/app-shell';
import {
  createTenantSchema,
  isCreateTenantErrorKey,
  stepFields,
  toCreateTenantRequest,
  type CreateTenantValues,
} from '../model/create-tenant-schema';

function addMonthEnd(today: string): string {
  const [year, month] = today.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** Wizard «Новая компания»: the operator creates a tenant, its owner and the first store. */
export function CompanyCreatePage() {
  const t = useTranslations('companyCreate');
  const tErrors = useTranslations('validation');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = toAppDate();
  const schema = useMemo(() => createTenantSchema(today), [today]);
  const [step, setStep] = useState(0);
  // One key per wizard: a retried submit cannot create the tenant twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const form = useForm<CreateTenantValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      city: '',
      inn: '',
      ownerFullName: '',
      ownerPhone: '',
      ownerLogin: '',
      storeName: '',
      storeAddress: '',
      mode: 'cloud',
      licenseTerm: 'year',
      syncSchedule: 'daily',
      paidUntil: addMonthEnd(today),
      price: '120,00',
    },
  });
  const { register, control, trigger, handleSubmit, setError, formState } =
    form;
  const values = useWatch({ control });

  const create = useMutation({
    mutationFn: (request: ReturnType<typeof toCreateTenantRequest>) =>
      apiRequest('tenants.create', { body: request, idempotencyKey }),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
      toast.show(t('created'));
      router.push(routes.company(id));
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.errors.some((field) => field.field === 'inn')
      ) {
        setError('inn', { message: 'innTaken' });
        setStep(0);
      }
    },
  });
  const submitError = useApiErrorMessage(
    create.error instanceof ApiError && create.error.code === 'inn_taken'
      ? null
      : create.error,
  );

  const error = (field: keyof CreateTenantValues) => {
    const message = formState.errors[field]?.message;
    if (message === 'innTaken') return t('innTaken');
    return isCreateTenantErrorKey(message) ? tErrors(message) : undefined;
  };

  const next = async () => {
    if (await trigger(stepFields[step], { shouldFocus: true }))
      setStep((s) => s + 1);
  };

  const offline = values.mode === 'offline';
  const priceMinor = parseMoneyToMinor(values.price ?? '') ?? 0;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="grid grid-cols-3 items-start gap-4 p-6">
        <Card
          as="section"
          aria-labelledby="wizard-title"
          className="col-span-2 flex flex-col gap-6"
        >
          <h2 id="wizard-title" className="ph-visually-hidden">
            {t('title')}
          </h2>
          <Stepper
            label={t('stepsLabel')}
            steps={[
              { label: t('steps.company') },
              { label: t('steps.store') },
              { label: t('steps.billing') },
            ]}
            current={step}
            completedText={t('stepDone')}
            onStepSelect={setStep}
          />
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={handleSubmit((data) =>
              create.mutate(toCreateTenantRequest(data)),
            )}
          >
            {submitError && (
              <Alert tone="danger" live="assertive">
                {submitError}
              </Alert>
            )}

            {step === 0 && (
              <fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0">
                <legend className="mb-2 p-0 text-md font-bold">
                  {t('steps.company')}
                </legend>
                <TextField
                  label={t('fields.name')}
                  required
                  error={error('name')}
                  className="col-span-2"
                  {...register('name')}
                />
                <TextField
                  label={t('fields.city')}
                  required
                  error={error('city')}
                  {...register('city')}
                />
                <TextField
                  label={t('fields.inn')}
                  required
                  inputMode="numeric"
                  placeholder="000000000"
                  error={error('inn')}
                  {...register('inn')}
                />
                <TextField
                  label={t('fields.ownerFullName')}
                  required
                  error={error('ownerFullName')}
                  {...register('ownerFullName')}
                />
                <TextField
                  label={t('fields.ownerPhone')}
                  required
                  type="tel"
                  placeholder="+992 00 000 00 00"
                  error={error('ownerPhone')}
                  {...register('ownerPhone')}
                />
                <TextField
                  label={t('fields.ownerLogin')}
                  required
                  type="email"
                  hint={t('fields.ownerLoginHint')}
                  error={error('ownerLogin')}
                  className="col-span-2"
                  {...register('ownerLogin')}
                />
              </fieldset>
            )}

            {step === 1 && (
              <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
                <legend className="mb-2 p-0 text-md font-bold">
                  {t('steps.store')}
                </legend>
                <div className="grid grid-cols-2 gap-4">
                  <TextField
                    label={t('fields.storeName')}
                    required
                    error={error('storeName')}
                    {...register('storeName')}
                  />
                  <TextField
                    label={t('fields.storeAddress')}
                    required
                    error={error('storeAddress')}
                    {...register('storeAddress')}
                  />
                </div>
                <Controller
                  control={control}
                  name="mode"
                  render={({ field }) => (
                    <RadioCardGroup
                      label={t('fields.mode')}
                      value={field.value}
                      onValueChange={field.onChange}
                      options={[
                        {
                          value: 'cloud',
                          title: t('mode.cloud'),
                          description: t('mode.cloudHint'),
                          icon: 'store',
                        },
                        {
                          value: 'offline',
                          title: t('mode.offline'),
                          description: t('mode.offlineHint'),
                          icon: 'key-round',
                        },
                      ]}
                    />
                  )}
                />
                {offline && (
                  <div className="grid grid-cols-2 gap-4">
                    <Select
                      label={t('fields.licenseTerm')}
                      options={(['week', 'quarter', 'year'] as const).map(
                        (value) => ({ value, label: t(`term.${value}`) }),
                      )}
                      {...register('licenseTerm')}
                    />
                    <Select
                      label={t('fields.syncSchedule')}
                      options={(
                        ['daily', 'twice_daily', 'hourly', 'manual'] as const
                      ).map((value) => ({
                        value,
                        label: t(`schedule.${value}`),
                      }))}
                      {...register('syncSchedule')}
                    />
                  </div>
                )}
              </fieldset>
            )}

            {step === 2 && (
              <fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0">
                <legend className="mb-2 p-0 text-md font-bold">
                  {t('steps.billing')}
                </legend>
                <TextField
                  label={t('fields.paidUntil')}
                  type="date"
                  min={today}
                  required
                  hint={t('fields.paidUntilHint')}
                  error={error('paidUntil')}
                  {...register('paidUntil')}
                />
                <TextField
                  label={t('fields.price')}
                  inputMode="decimal"
                  required
                  hint={t('fields.priceHint')}
                  error={error('price')}
                  {...register('price')}
                />
              </fieldset>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
              {step === 0 ? (
                <Link
                  href={routes.companies()}
                  className="text-sm text-primary hover:text-primary-hover"
                >
                  {tCommon('cancel')}
                </Link>
              ) : (
                <Button
                  variant="tertiary"
                  iconStart="arrow-left"
                  onClick={() => setStep((s) => s - 1)}
                >
                  {t('back')}
                </Button>
              )}
              {step < 2 ? (
                <Button iconEnd="chevron-right" onClick={next}>
                  {t('next')}
                </Button>
              ) : (
                <Button
                  type="submit"
                  iconStart="check"
                  loading={create.isPending}
                >
                  {t('submit')}
                </Button>
              )}
            </div>
          </form>
        </Card>

        <aside className="flex flex-col gap-4">
          <Card as="section" aria-labelledby="summary-title">
            <CardHeader
              title={t('summary.title')}
              titleId="summary-title"
              level={2}
            />
            <dl className="m-0 flex flex-col gap-3 text-sm">
              {(
                [
                  ['company', values.name || '—'],
                  ['owner', values.ownerFullName || '—'],
                  [
                    'store',
                    values.storeName
                      ? `${values.storeName} · ${t(`mode.${values.mode ?? 'cloud'}`)}`
                      : '—',
                  ],
                  [
                    'firstInvoice',
                    offline
                      ? t('summary.offlineBilling')
                      : t('summary.firstInvoiceText', {
                          price: formatMoney(priceMinor),
                          date: values.paidUntil
                            ? formatDateOnly(values.paidUntil)
                            : '—',
                        }),
                  ],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex flex-col">
                  <dt className="text-xs text-fg-subtle">
                    {t(`summary.${key}`)}
                  </dt>
                  <dd className="m-0 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card as="section" aria-labelledby="what-next-title">
            <CardHeader title={t('whatNext.title')} titleId="what-next-title" />
            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-fg-muted">
              {(['isolation', 'ownerLogin', 'billing'] as const).map((key) => (
                <li key={key} className="flex gap-2">
                  <span className="mt-0.5 text-success">
                    <Icon name="circle-check" size="sm" />
                  </span>
                  {t(`whatNext.${key}`)}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
