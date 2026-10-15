'use client';

import type {
  ServiceCatalogItem,
  ServiceOrder,
  ServiceOrderStatus,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  formatMoney,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  StatusPill,
  TextareaField,
  type StatusTone,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { canWrite, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { DemoDataNotice, QueryState } from '@/shared/ui';

const servicesKey = ['services'] as const;

const statusTone: Record<ServiceOrderStatus, StatusTone> = {
  pending: 'info',
  approved: 'success',
  provided: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

function OrderDialog({
  service,
  onClose,
}: {
  service: ServiceCatalogItem | null;
  onClose: () => void;
}) {
  const t = useTranslations('ownerStores.services');
  const tCommon = useTranslations('ownerStores');
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const order = useMutation({
    mutationFn: (serviceId: string) =>
      apiRequest('serviceRequests.create', {
        body: { serviceId, comment: comment.trim() || null },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: servicesKey });
      close();
    },
  });
  const error = useApiErrorMessage(order.error);
  const close = () => {
    setComment('');
    order.reset();
    onClose();
  };
  return (
    <Dialog
      open={service !== null}
      onClose={close}
      title={t('orderTitle', { name: service?.name ?? '' })}
      description={t('orderDescription')}
      closeLabel={tCommon('close')}
      footer={
        <>
          <Button variant="tertiary" onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button
            loading={order.isPending}
            onClick={() => service && order.mutate(service.id)}
          >
            {t('orderConfirm')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <TextareaField
        label={t('comment')}
        hint={t('commentHint')}
        rows={3}
        maxLength={500}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
    </Dialog>
  );
}

function OrderRow({
  order,
  canWithdraw,
}: {
  order: ServiceOrder;
  canWithdraw: boolean;
}) {
  const t = useTranslations('ownerStores.services');
  const queryClient = useQueryClient();
  const withdraw = useMutation({
    mutationFn: (id: string) =>
      apiRequest('serviceRequests.withdraw', { params: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: servicesKey }),
  });
  const error = useApiErrorMessage(withdraw.error);
  const when = order.requestedAt ?? order.decidedAt;
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-border px-(--ph-card-padding) py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{order.serviceName}</span>
        <span className="text-xs text-fg-subtle">
          {when ? formatDateTime(when) : ''}
          {order.priceMinor !== null &&
            ` · ${t('price', { price: formatMoney(order.priceMinor) })}`}
          {order.providedOn &&
            ` · ${t('providedOn', { date: formatDateOnly(order.providedOn) })}`}
        </span>
        {order.comment && (
          <span className="text-sm text-fg-muted">«{order.comment}»</span>
        )}
        {order.reason && (
          <span className="text-sm text-fg-muted">
            {t('reason', { reason: order.reason })}
          </span>
        )}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
      <StatusPill tone={statusTone[order.status]}>
        {t(`statuses.${order.status}`)}
      </StatusPill>
      {order.status === 'pending' && canWithdraw && order.requestId && (
        <Button
          variant="tertiary"
          loading={withdraw.isPending}
          onClick={() => order.requestId && withdraw.mutate(order.requestId)}
        >
          {t('withdraw')}
        </Button>
      )}
    </li>
  );
}

/**
 * The services of the platform (spec 2026-10-15-billing-services, B7–B9, A12): the operator's
 * catalog with the base price, and the orders of the network with their decisions.
 */
export function ServicesSection() {
  const t = useTranslations('ownerStores.services');
  const { data: session } = useSession();
  const [ordering, setOrdering] = useState<ServiceCatalogItem | null>(null);
  const services = useQuery({
    queryKey: servicesKey,
    queryFn: ({ signal }) => apiRequest('services.list', { signal }),
  });
  const canOrder = canWrite(session, 'services:create');

  return (
    <div className="flex flex-col gap-4">
      <DemoDataNotice routes={['services.list']} />
      <QueryState query={services}>
        {(data) => (
          <div className="flex flex-col gap-4">
            <h2 id="catalog-title" className="text-md font-bold">
              {t('catalog')}
            </h2>
            {data.catalog.length === 0 ? (
              <EmptyState icon="sparkles" title={t('catalogEmpty')} />
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {data.catalog.map((service) => (
                  <Card key={service.id} className="flex flex-col gap-3">
                    <h3 className="text-md font-bold">{service.name}</h3>
                    <p className="flex-1 text-sm text-fg-muted">
                      {service.description}
                    </p>
                    <span className="font-bold tabular-nums">
                      {t('from', {
                        price: formatMoney(service.basePriceMinor),
                      })}
                    </span>
                    {canOrder && (
                      <Button
                        variant="secondary"
                        className="self-start"
                        onClick={() => setOrdering(service)}
                      >
                        {t('order')}
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            )}
            <p className="text-xs text-fg-subtle">{t('scopeHint')}</p>
            <Card as="section" padding="none" aria-labelledby="orders-title">
              <CardHeader inset titleId="orders-title" title={t('orders')} />
              {data.orders.length === 0 ? (
                <EmptyState icon="receipt" title={t('ordersEmpty')} />
              ) : (
                <ul className="m-0 list-none p-0">
                  {data.orders.map((order) => (
                    <OrderRow
                      key={
                        order.requestId ??
                        `${order.serviceId}-${order.decidedAt ?? ''}`
                      }
                      order={order}
                      canWithdraw={canOrder}
                    />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </QueryState>
      <OrderDialog service={ordering} onClose={() => setOrdering(null)} />
    </div>
  );
}
