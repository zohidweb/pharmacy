'use client';

import { formatMoney, parseMoneyToMinor, uuidv7 } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Dialog,
  Select,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { invalidateServices, serviceKeys } from '../lib/invalidate';

/**
 * A service the operator adds to a network without a request (spec 2026-10-15-billing-services,
 * A13): approved at once, at the price set here (the base price by default). Archived services are
 * not offered; hidden ones are, with a mark. The UUIDv7 `id` made when the dialog opens is the
 * idempotency key (B17): a retried submit cannot add the service twice.
 */
export function AddTenantService({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const t = useTranslations('tenantServices.add');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [price, setPrice] = useState('');
  const catalog = useQuery({
    queryKey: serviceKeys.catalog,
    queryFn: ({ signal }) => apiRequest('services.list', { signal }),
    enabled: open,
  });
  const offered = (catalog.data ?? []).filter((service) => !service.archived);
  const add = useMutation({
    mutationFn: () =>
      apiRequest('tenants.addService', {
        params: { id: tenantId },
        body: { id: key, serviceId, priceMinor: parseMoneyToMinor(price) ?? 0 },
      }),
    onSuccess: (added) => {
      invalidateServices(queryClient, tenantId);
      toast.show(t('added', { name: added.serviceName }));
      close();
    },
  });
  const error = useApiErrorMessage(add.error);
  const close = () => {
    setOpen(false);
    setServiceId('');
    setPrice('');
    add.reset();
  };
  const choose = (id: string) => {
    setServiceId(id);
    const service = offered.find((item) => item.id === id);
    if (service) {
      setPrice(
        formatMoney(service.basePriceMinor, {
          withSign: false,
          plainSpaces: true,
        }),
      );
    }
  };
  const valid = serviceId !== '' && (parseMoneyToMinor(price) ?? 0) > 0;

  return (
    <>
      <Button
        variant="secondary"
        iconStart="plus"
        onClick={() => {
          setKey(uuidv7());
          setOpen(true);
        }}
      >
        {t('action')}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={t('title', { tenant: tenantName })}
        description={t('description')}
        closeLabel={tCommon('close')}
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              {tCommon('cancel')}
            </Button>
            <Button
              loading={add.isPending}
              disabled={!valid}
              onClick={() => add.mutate()}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <Select
          label={t('service')}
          required
          placeholder={t('servicePlaceholder')}
          value={serviceId}
          options={offered.map((service) => ({
            value: service.id,
            label: service.visible
              ? service.nameRu
              : `${service.nameRu} ${t('hidden')}`,
          }))}
          onChange={(event) => choose(event.target.value)}
        />
        <TextField
          label={t('price')}
          inputMode="decimal"
          required
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </Dialog>
    </>
  );
}
