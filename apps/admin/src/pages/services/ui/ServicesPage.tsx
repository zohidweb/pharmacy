'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { PlatformService, ServiceRequestItem } from '@pharmacy/shared-dto';
import {
  formatDateTime,
  formatMoney,
  parseMoneyToMinor,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CountBadge,
  Dialog,
  EmptyState,
  RadioCardGroup,
  StatusPill,
  Switch,
  TextareaField,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { tenantKeys } from '@/entities/tenant';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const keys = {
  services: ['services'] as const,
  requests: ['service-requests'] as const,
};

const serviceSchema = z.object({
  name: z.string().trim().min(1, { error: 'required' }),
  description: z.string().trim().min(1, { error: 'required' }),
  billing: z.enum(['one_time', 'monthly']),
  price: z
    .string()
    .refine((value) => (parseMoneyToMinor(value) ?? 0) > 0, { error: 'money' }),
  visibleInCatalog: z.boolean(),
});
type ServiceValues = z.input<typeof serviceSchema>;

function ServiceDialog({
  service,
  open,
  onClose,
}: {
  service: PlatformService | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('services.form');
  const tErrors = useTranslations('validation');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<ServiceValues>({
    resolver: zodResolver(serviceSchema),
    values: service
      ? {
          name: service.name,
          description: service.description,
          billing: service.billing,
          price: formatMoney(service.priceMinor, {
            withSign: false,
            plainSpaces: true,
          }),
          visibleInCatalog: service.visibleInCatalog,
        }
      : {
          name: '',
          description: '',
          billing: 'one_time',
          price: '',
          visibleInCatalog: true,
        },
  });
  const save = useMutation({
    mutationFn: (values: ServiceValues) => {
      const body = {
        name: values.name.trim(),
        description: values.description.trim(),
        billing: values.billing,
        priceMinor: parseMoneyToMinor(values.price) ?? 0,
        visibleInCatalog: values.visibleInCatalog,
      };
      return service
        ? apiRequest('services.update', { params: { id: service.id }, body })
        : apiRequest('services.create', { body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.services });
      toast.show(service ? t('updated') : t('created'));
      close();
    },
  });
  const error = useApiErrorMessage(save.error);
  const close = () => {
    form.reset();
    save.reset();
    onClose();
  };
  const fieldError = (field: keyof ServiceValues) => {
    const message = form.formState.errors[field]?.message;
    return message === 'required' || message === 'money'
      ? tErrors(message)
      : undefined;
  };
  const billing = form.watch('billing');

  return (
    <Dialog
      open={open}
      onClose={close}
      title={service ? t('editTitle') : t('createTitle')}
      closeLabel={tCommon('close')}
      size="md"
      footer={
        <>
          <Button variant="tertiary" onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" form="service-form" loading={save.isPending}>
            {t('save')}
          </Button>
        </>
      }
    >
      <form
        id="service-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <TextField
          label={t('name')}
          required
          error={fieldError('name')}
          {...form.register('name')}
        />
        <TextareaField
          label={t('description')}
          required
          hint={t('descriptionHint')}
          error={fieldError('description')}
          {...form.register('description')}
        />
        <Controller
          control={form.control}
          name="billing"
          render={({ field }) => (
            <RadioCardGroup
              label={t('billing')}
              value={field.value}
              onValueChange={field.onChange}
              options={[
                {
                  value: 'one_time',
                  title: t('billingValue.one_time'),
                  description: t('billingHint.one_time'),
                },
                {
                  value: 'monthly',
                  title: t('billingValue.monthly'),
                  description: t('billingHint.monthly'),
                },
              ]}
            />
          )}
        />
        <TextField
          label={billing === 'monthly' ? t('priceMonthly') : t('price')}
          inputMode="decimal"
          required
          error={fieldError('price')}
          {...form.register('price')}
        />
        <Controller
          control={form.control}
          name="visibleInCatalog"
          render={({ field }) => (
            <Switch
              label={t('visible')}
              description={t('visibleHint')}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </form>
    </Dialog>
  );
}

function RequestRow({ request }: { request: ServiceRequestItem }) {
  const t = useTranslations('services.requests');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const done = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: keys.requests });
    void queryClient.invalidateQueries({ queryKey: keys.services });
    void queryClient.invalidateQueries({
      queryKey: tenantKeys.detail(request.tenantId),
    });
    toast.show(message);
  };
  const approve = useMutation({
    mutationFn: () =>
      apiRequest('serviceRequests.approve', { params: { id: request.id } }),
    onSuccess: () => done(t('approved', { name: request.serviceName })),
  });
  const reject = useMutation({
    mutationFn: () =>
      apiRequest('serviceRequests.reject', {
        params: { id: request.id },
        body: { reason: reason.trim() },
      }),
    onSuccess: () => {
      setRejecting(false);
      done(t('rejected'));
    },
  });
  const error = useApiErrorMessage(approve.error ?? reject.error);

  return (
    <li className="flex flex-wrap items-center gap-4 border-t border-border px-(--ph-card-padding) py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{request.serviceName}</span>
        <span className="text-xs text-fg-subtle">
          {t('meta', {
            tenant: request.tenantName,
            at: formatDateTime(request.requestedAt),
            billing: t(`billing.${request.billing}`),
            price: formatMoney(request.priceMinor),
          })}
        </span>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
      <Button variant="tertiary" onClick={() => setRejecting(true)}>
        {t('reject')}
      </Button>
      <Button
        variant="success"
        iconStart="check"
        loading={approve.isPending}
        onClick={() => approve.mutate()}
      >
        {t('approve')}
      </Button>
      <Dialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title={t('rejectTitle')}
        description={t('rejectDescription', {
          tenant: request.tenantName,
          name: request.serviceName,
        })}
        closeLabel={tCommon('close')}
        icon="ban"
        tone="danger"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setRejecting(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={reject.isPending}
              disabled={reason.trim().length < 5}
              onClick={() => reject.mutate()}
            >
              {t('reject')}
            </Button>
          </>
        }
      >
        <TextareaField
          label={t('reason')}
          hint={t('reasonHint')}
          rows={2}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Dialog>
    </li>
  );
}

/** «Услуги» (UI mockup «Услуги»): connection requests and the catalog of additional services. */
export function ServicesPage() {
  const t = useTranslations('services');
  const [editing, setEditing] = useState<PlatformService | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const services = useQuery({
    queryKey: keys.services,
    queryFn: ({ signal }) => apiRequest('services.list', { signal }),
  });
  const requests = useQuery({
    queryKey: keys.requests,
    queryFn: ({ signal }) => apiRequest('serviceRequests.list', { signal }),
  });

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 p-6">
        <Card as="section" padding="none" aria-labelledby="requests-title">
          <CardHeader
            inset
            titleId="requests-title"
            title={
              <span className="inline-flex items-center gap-2">
                {t('requests.title')}
                <CountBadge
                  count={requests.data?.length ?? 0}
                  label={t('requests.count', {
                    count: requests.data?.length ?? 0,
                  })}
                />
              </span>
            }
          />
          <QueryState query={requests}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon="circle-check"
                  title={t('requests.empty')}
                  description={t('requests.emptyDescription')}
                />
              ) : (
                <ul className="m-0 list-none p-0">
                  {rows.map((request) => (
                    <RequestRow key={request.id} request={request} />
                  ))}
                </ul>
              )
            }
          </QueryState>
        </Card>

        <section
          aria-labelledby="catalog-title"
          className="flex flex-col gap-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="catalog-title" className="text-md font-bold">
              {t('catalog.title')}
            </h2>
            <Button
              variant="secondary"
              iconStart="plus"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              {t('catalog.add')}
            </Button>
          </div>
          <QueryState query={services}>
            {(rows) => (
              <ul className="m-0 grid list-none grid-cols-3 gap-4 p-0">
                {rows.map((service) => (
                  <li key={service.id}>
                    <Card as="article" className="flex h-full flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold">{service.name}</h3>
                        <StatusPill
                          tone={
                            service.billing === 'monthly' ? 'info' : 'neutral'
                          }
                          icon={null}
                        >
                          {t(`catalog.billing.${service.billing}`)}
                        </StatusPill>
                      </div>
                      <p className="text-sm text-fg-muted">
                        {service.description}
                      </p>
                      <div className="mt-auto flex items-end justify-between gap-2">
                        <div className="flex flex-col">
                          <span className="text-lg font-bold tabular-nums">
                            {service.billing === 'monthly'
                              ? t('catalog.perMonth', {
                                  price: formatMoney(service.priceMinor),
                                })
                              : formatMoney(service.priceMinor)}
                          </span>
                          <span className="text-xs text-fg-subtle">
                            {t('catalog.usedBy', { count: service.tenants })}
                            {!service.visibleInCatalog &&
                              ` · ${t('catalog.hidden')}`}
                          </span>
                        </div>
                        <Button
                          variant="tertiary"
                          iconStart="pencil"
                          aria-label={t('catalog.editFor', {
                            name: service.name,
                          })}
                          onClick={() => {
                            setEditing(service);
                            setDialogOpen(true);
                          }}
                        >
                          {t('catalog.edit')}
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
          <p className="text-xs text-fg-subtle">{t('catalog.note')}</p>
        </section>
      </div>
      <ServiceDialog
        service={editing}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
