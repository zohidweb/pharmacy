'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Icon,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { ActivationCodeCard, tenantKeys } from '@/entities/tenant';
import { ApiError, apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { PageHeader } from '@/widgets/app-shell';
import {
  createTenantSchema,
  FIELD_CONFLICTS,
  isCreateTenantErrorKey,
  toCreateTenantRequest,
  type CreateTenantValues,
} from '../model/create-tenant-schema';

/**
 * «Новая компания»: the operator creates a network and its owner (spec 2026-10-05-tenants-module,
 * T2: the owner adds stores after activation). The owner's one-time activation code is shown once.
 */
export function CompanyCreatePage() {
  const t = useTranslations('companyCreate');
  const tErrors = useTranslations('validation');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const schema = useMemo(() => createTenantSchema(), []);
  // One key per form: a retried submit cannot create the network twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [created, setCreated] = useState<{
    id: string;
    activationCode: string;
  } | null>(null);

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
      ownerEmail: '',
    },
  });
  const { register, control, handleSubmit, setError, formState } = form;
  const values = useWatch({ control });

  const create = useMutation({
    mutationFn: (request: ReturnType<typeof toCreateTenantRequest>) =>
      apiRequest('tenants.create', { body: request, idempotencyKey }),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
      toast.show(t('created'));
      setCreated(response);
    },
    onError: (error) => {
      if (error instanceof ApiError && FIELD_CONFLICTS[error.code]) {
        setError(FIELD_CONFLICTS[error.code], { message: error.code });
      }
    },
  });
  const submitError = useApiErrorMessage(
    create.error instanceof ApiError && FIELD_CONFLICTS[create.error.code]
      ? null
      : create.error,
  );

  const error = (field: keyof CreateTenantValues) => {
    const message = formState.errors[field]?.message;
    if (
      message === 'inn_taken' ||
      message === 'login_taken' ||
      message === 'phone_taken' ||
      message === 'email_taken'
    ) {
      return t(`conflict.${message}`);
    }
    return isCreateTenantErrorKey(message) ? tErrors(message) : undefined;
  };

  if (created) {
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <div className="p-6">
          <ActivationCodeCard
            code={created.activationCode}
            title={t('code.title')}
            action={
              <Link
                href={routes.company(created.id)}
                className="text-sm text-primary hover:text-primary-hover"
              >
                {t('code.toCompany')}
              </Link>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="grid grid-cols-3 items-start gap-4 p-6">
        <Card
          as="section"
          aria-labelledby="form-title"
          className="col-span-2 flex flex-col gap-6"
        >
          <h2 id="form-title" className="ph-visually-hidden">
            {t('title')}
          </h2>
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
            <fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0">
              <legend className="mb-2 p-0 text-md font-bold">
                {t('section')}
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
                hint={t('fields.ownerLoginHint')}
                error={error('ownerLogin')}
                {...register('ownerLogin')}
              />
              <TextField
                label={t('fields.ownerEmail')}
                type="email"
                error={error('ownerEmail')}
                {...register('ownerEmail')}
              />
            </fieldset>
            <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
              <Link
                href={routes.companies()}
                className="text-sm text-primary hover:text-primary-hover"
              >
                {tCommon('cancel')}
              </Link>
              <Button type="submit" iconStart="check" loading={create.isPending}>
                {t('submit')}
              </Button>
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
              {(['isolation', 'ownerLogin', 'stores'] as const).map((key) => (
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
