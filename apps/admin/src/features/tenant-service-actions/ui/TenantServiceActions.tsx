'use client';

import type { TenantServiceItem } from '@pharmacy/shared-dto';
import {
  formatMoney,
  parseMoneyToMinor,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Dialog,
  TextareaField,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { invalidateServices } from '../lib/invalidate';

type Mode = 'provide' | 'unprovide' | 'price' | 'cancel';

/**
 * The operator's actions on a network's service (spec 2026-10-15-billing-services, A13): mark it
 * provided (with a date), take the mark back, change the price, cancel with a reason. Rejected and
 * cancelled services have none.
 */
export function TenantServiceActions({
  service,
}: {
  service: TenantServiceItem;
}) {
  const t = useTranslations('tenantServices');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode | null>(null);
  const [date, setDate] = useState('');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');

  const run = useMutation({
    mutationFn: (action: Mode) => {
      const params = { id: service.id };
      switch (action) {
        case 'provide':
          return apiRequest('tenantServices.provide', {
            params,
            body: { providedOn: date },
          });
        case 'unprovide':
          return apiRequest('tenantServices.unprovide', { params });
        case 'price':
          return apiRequest('tenantServices.update', {
            params,
            body: { priceMinor: parseMoneyToMinor(price) ?? 0 },
          });
        case 'cancel':
          return apiRequest('tenantServices.cancel', {
            params,
            body: { reason: reason.trim() },
          });
      }
    },
    onSuccess: (_, action) => {
      invalidateServices(queryClient, service.tenantId);
      toast.show(t(`done.${action}`, { name: service.serviceName }));
      close();
    },
  });
  const error = useApiErrorMessage(run.error);

  const open = (next: Mode) => {
    setDate(toAppDate());
    setPrice(
      service.priceMinor === null
        ? ''
        : formatMoney(service.priceMinor, {
            withSign: false,
            plainSpaces: true,
          }),
    );
    setReason('');
    run.reset();
    setMode(next);
  };
  const close = () => setMode(null);

  if (service.status === 'rejected' || service.status === 'cancelled')
    return null;

  const future = date > toAppDate();
  const priceOk = (parseMoneyToMinor(price) ?? 0) > 0;
  const valid =
    mode === 'provide'
      ? date !== '' && !future
      : mode === 'price'
        ? priceOk
        : mode === 'cancel'
          ? reason.trim().length >= 5
          : true;

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {service.status === 'approved' ? (
        <Button
          variant="tertiary"
          iconStart="check"
          onClick={() => open('provide')}
        >
          {t('actions.provide')}
        </Button>
      ) : (
        <Button variant="tertiary" onClick={() => open('unprovide')}>
          {t('actions.unprovide')}
        </Button>
      )}
      <Button variant="tertiary" onClick={() => open('price')}>
        {t('actions.price')}
      </Button>
      <Button variant="tertiary" onClick={() => open('cancel')}>
        <span className="text-danger">{t('actions.cancel')}</span>
      </Button>
      <Dialog
        open={mode !== null}
        onClose={close}
        title={mode ? t(`titles.${mode}`, { name: service.serviceName }) : ''}
        description={
          mode
            ? t(`descriptions.${mode}`, { tenant: service.tenantName })
            : undefined
        }
        closeLabel={tCommon('close')}
        tone={mode === 'cancel' ? 'danger' : undefined}
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant={mode === 'cancel' ? 'destructive' : 'primary'}
              loading={run.isPending}
              disabled={!valid}
              onClick={() => mode && run.mutate(mode)}
            >
              {mode ? t(`confirm.${mode}`) : ''}
            </Button>
          </>
        }
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        {mode === 'provide' && (
          <TextField
            label={t('providedOn')}
            type="date"
            required
            max={toAppDate()}
            value={date}
            error={future ? t('futureDate') : undefined}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
        {mode === 'price' && (
          <TextField
            label={t('price')}
            inputMode="decimal"
            required
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        )}
        {mode === 'cancel' && (
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
    </div>
  );
}
