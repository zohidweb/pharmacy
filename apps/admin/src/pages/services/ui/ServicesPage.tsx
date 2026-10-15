'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type {
  PlatformService,
  ServiceRequestItem,
  TenantServiceItem,
} from '@pharmacy/shared-dto';
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
import {
  invalidateServices,
  serviceKeys,
  TenantServiceActions,
} from '@/features/tenant-service-actions';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const serviceSchema = z.object({
  nameRu: z.string().trim().min(1, { error: 'required' }).max(120),
  nameTj: z.string().trim().max(120),
  descriptionRu: z.string().trim().min(1, { error: 'required' }).max(1000),
  descriptionTj: z.string().trim().max(1000),
  price: z
    .string()
    .refine((value) => (parseMoneyToMinor(value) ?? 0) > 0, { error: 'money' }),
  visible: z.boolean(),
  archived: z.boolean(),
});
type ServiceValues = z.input<typeof serviceSchema>;

const money = (minor: number) =>
  formatMoney(minor, { withSign: false, plainSpaces: true });

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
          nameRu: service.nameRu,
          nameTj: service.nameTj ?? '',
          descriptionRu: service.descriptionRu,
          descriptionTj: service.descriptionTj ?? '',
          price: money(service.basePriceMinor),
          visible: service.visible,
          archived: service.archived,
        }
      : {
          nameRu: '',
          nameTj: '',
          descriptionRu: '',
          descriptionTj: '',
          price: '',
          visible: true,
          archived: false,
        },
  });
  const save = useMutation({
    mutationFn: (values: ServiceValues) => {
      const body = {
        nameRu: values.nameRu.trim(),
        nameTj: values.nameTj.trim() || null,
        descriptionRu: values.descriptionRu.trim(),
        descriptionTj: values.descriptionTj.trim() || null,
        basePriceMinor: parseMoneyToMinor(values.price) ?? 0,
        visible: values.visible,
        archived: values.archived,
      };
      return service
        ? apiRequest('services.update', { params: { id: service.id }, body })
        : apiRequest('services.create', { body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: serviceKeys.catalog });
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
          label={t('nameRu')}
          required
          error={fieldError('nameRu')}
          {...form.register('nameRu')}
        />
        <TextField
          label={t('nameTj')}
          hint={t('tjHint')}
          {...form.register('nameTj')}
        />
        <TextareaField
          label={t('descriptionRu')}
          required
          hint={t('descriptionHint')}
          error={fieldError('descriptionRu')}
          {...form.register('descriptionRu')}
        />
        <TextareaField
          label={t('descriptionTj')}
          hint={t('tjHint')}
          {...form.register('descriptionTj')}
        />
        <TextField
          label={t('price')}
          hint={t('priceHint')}
          inputMode="decimal"
          required
          error={fieldError('price')}
          {...form.register('price')}
        />
        <Controller
          control={form.control}
          name="visible"
          render={({ field }) => (
            <Switch
              label={t('visible')}
              description={t('visibleHint')}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
        <Controller
          control={form.control}
          name="archived"
          render={({ field }) => (
            <Switch
              label={t('archived')}
              description={t('archivedHint')}
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
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      decision === 'approve'
        ? apiRequest('serviceRequests.approve', {
            params: { id: request.id },
            body: { priceMinor: parseMoneyToMinor(price) ?? 0 },
          })
        : apiRequest('serviceRequests.reject', {
            params: { id: request.id },
            body: { reason: reason.trim() },
          }),
    onSuccess: (_, decision) => {
      invalidateServices(queryClient, request.tenantId);
      toast.show(
        decision === 'approve'
          ? t('approved', { name: request.serviceName })
          : t('rejected'),
      );
      setMode(null);
    },
  });
  const error = useApiErrorMessage(decide.error);
  const open = (next: 'approve' | 'reject') => {
    setPrice(money(request.basePriceMinor));
    setReason('');
    decide.reset();
    setMode(next);
  };
  const valid =
    mode === 'approve'
      ? (parseMoneyToMinor(price) ?? 0) > 0
      : reason.trim().length >= 5;

  return (
    <li className="flex flex-wrap items-center gap-4 border-t border-border px-(--ph-card-padding) py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{request.serviceName}</span>
        <span className="text-xs text-fg-subtle">
          {t('meta', {
            tenant: request.tenantName,
            at: formatDateTime(request.requestedAt),
            price: formatMoney(request.basePriceMinor),
          })}
        </span>
        {request.comment && (
          <span className="text-sm text-fg-muted">«{request.comment}»</span>
        )}
      </div>
      <Button variant="tertiary" onClick={() => open('reject')}>
        {t('reject')}
      </Button>
      <Button
        variant="success"
        iconStart="check"
        onClick={() => open('approve')}
      >
        {t('approve')}
      </Button>
      <Dialog
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === 'approve' ? t('approveTitle') : t('rejectTitle')}
        description={t(
          mode === 'approve' ? 'approveDescription' : 'rejectDescription',
          { tenant: request.tenantName, name: request.serviceName },
        )}
        closeLabel={tCommon('close')}
        icon={mode === 'reject' ? 'ban' : undefined}
        tone={mode === 'reject' ? 'danger' : undefined}
        footer={
          <>
            <Button variant="tertiary" onClick={() => setMode(null)}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant={mode === 'reject' ? 'destructive' : 'success'}
              loading={decide.isPending}
              disabled={!valid}
              onClick={() => mode && decide.mutate(mode)}
            >
              {mode === 'reject' ? t('reject') : t('approve')}
            </Button>
          </>
        }
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        {mode === 'approve' ? (
          <TextField
            label={t('price')}
            hint={t('priceHint')}
            inputMode="decimal"
            required
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        ) : (
          <TextareaField
            label={t('reason')}
            hint={t('reasonHint')}
            rows={2}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Dialog>
    </li>
  );
}

function ApprovedRow({ service }: { service: TenantServiceItem }) {
  const t = useTranslations('services.approved');
  return (
    <li className="flex flex-wrap items-center gap-4 border-t border-border px-(--ph-card-padding) py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{service.serviceName}</span>
        <span className="text-xs text-fg-subtle">
          {t('meta', {
            tenant: service.tenantName,
            at: formatDateTime(service.decidedAt),
            price: formatMoney(service.priceMinor ?? 0),
          })}
        </span>
      </div>
      <TenantServiceActions service={service} />
    </li>
  );
}

/** «Услуги»: requests of networks, approved services to provide, and the catalog. */
export function ServicesPage() {
  const t = useTranslations('services');
  const [editing, setEditing] = useState<PlatformService | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const services = useQuery({
    queryKey: serviceKeys.catalog,
    queryFn: ({ signal }) => apiRequest('services.list', { signal }),
  });
  const requests = useQuery({
    queryKey: serviceKeys.requests,
    queryFn: ({ signal }) => apiRequest('serviceRequests.list', { signal }),
  });
  const approved = useQuery({
    queryKey: [...serviceKeys.tenantServices, 'approved'],
    queryFn: ({ signal }) =>
      apiRequest('tenantServices.list', {
        query: { status: 'approved' },
        signal,
      }),
  });

  return (
    <>
      <PageHeader
        demoRoutes={['serviceRequests.list', 'services.list']}
        title={t('title')}
        subtitle={t('subtitle')}
      />
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

        <Card as="section" padding="none" aria-labelledby="approved-title">
          <CardHeader
            inset
            titleId="approved-title"
            title={t('approved.title')}
            description={t('approved.hint')}
          />
          <QueryState query={approved}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState icon="circle-check" title={t('approved.empty')} />
              ) : (
                <ul className="m-0 list-none p-0">
                  {rows.map((service) => (
                    <ApprovedRow key={service.id} service={service} />
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
                      <h3 className="font-bold">{service.nameRu}</h3>
                      <p className="text-sm text-fg-muted">
                        {service.descriptionRu}
                      </p>
                      <div className="mt-auto flex items-end justify-between gap-2">
                        <div className="flex flex-col">
                          <span className="text-lg font-bold tabular-nums">
                            {t('catalog.from', {
                              price: formatMoney(service.basePriceMinor),
                            })}
                          </span>
                          <span className="text-xs text-fg-subtle">
                            {t('catalog.usedBy', { count: service.tenants })}
                            {service.archived
                              ? ` · ${t('catalog.archived')}`
                              : !service.visible && ` · ${t('catalog.hidden')}`}
                          </span>
                        </div>
                        <Button
                          variant="tertiary"
                          iconStart="pencil"
                          aria-label={t('catalog.editFor', {
                            name: service.nameRu,
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
