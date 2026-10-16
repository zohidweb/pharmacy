'use client';

import type { TenantDiscount } from '@pharmacy/shared-dto';
import { formatDateOnly } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { billingKeys } from '@/entities/invoice';
import { tenantKeys } from '@/entities/tenant';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERCENT = /^(100|[1-9]\d?)([.,]\d{1,2})?$/;

/** «20» or «12,5» → basis points; null when it is not 1…100 %. */
function percentBp(value: string): number | null {
  const match = PERCENT.exec(value.trim());
  if (!match) return null;
  const [whole, fraction = ''] = value.trim().split(/[.,]/);
  const bp = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return bp >= 100 && bp <= 10_000 ? bp : null;
}

const percentText = (bp: number) => `${bp / 100}`.replace('.', ',');
const monthText = (month: string) => formatDateOnly(`${month}-01`).slice(3);

type Mode =
  | { kind: 'add' }
  | { kind: 'shorten'; discount: TenantDiscount }
  | { kind: 'remove'; discount: TenantDiscount };

/**
 * The discounts of a company on the store tariff for months «с» … «по» (spec
 * 2026-10-15-billing-services, A10): periods do not overlap; a discount on an invoice is not removed
 * and its period does not end before the last invoiced month. Changes need a recent sign-in.
 */
export function TenantDiscounts({ tenantId }: { tenantId: string }) {
  const t = useTranslations('company.discounts');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const discounts = useQuery({
    queryKey: tenantKeys.tab(tenantId, 'discounts'),
    queryFn: ({ signal }) =>
      apiRequest('tenants.discounts', { params: { id: tenantId }, signal }),
  });
  const [mode, setMode] = useState<Mode | null>(null);
  const [percent, setPercent] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const run = useMutation({
    mutationFn: async (current: Mode) => {
      if (current.kind === 'add') {
        await apiRequest('tenants.addDiscount', {
          params: { id: tenantId },
          body: {
            percentBp: percentBp(percent) ?? 0,
            fromMonth: from,
            toMonth: to,
          },
        });
        return 'added' as const;
      }
      if (current.kind === 'shorten') {
        await apiRequest('discounts.shorten', {
          params: { id: current.discount.id },
          body: { toMonth: to },
        });
        return 'shortened' as const;
      }
      await apiRequest('discounts.remove', {
        params: { id: current.discount.id },
      });
      return 'removed' as const;
    },
    onSuccess: (done) => {
      void queryClient.invalidateQueries({ queryKey: tenantKeys.all });
      void queryClient.invalidateQueries({ queryKey: billingKeys.all });
      toast.show(t(done));
      close();
    },
  });
  const error = useApiErrorMessage(run.error);

  function open(next: Mode) {
    run.reset();
    setPercent('');
    setFrom('');
    setTo(next.kind === 'shorten' ? next.discount.toMonth : '');
    setMode(next);
  }
  function close() {
    setMode(null);
    run.reset();
  }

  const monthsValid =
    MONTH.test(to) &&
    (mode?.kind !== 'add' || (MONTH.test(from) && from <= to));
  const valid =
    mode?.kind === 'remove' ||
    (mode?.kind === 'add' && percentBp(percent) !== null && monthsValid) ||
    (mode?.kind === 'shorten' && monthsValid);

  return (
    <Card as="section" aria-labelledby="discounts-title">
      <CardHeader
        title={t('title')}
        titleId="discounts-title"
        actions={
          <Button
            variant="secondary"
            iconStart="plus"
            onClick={() => open({ kind: 'add' })}
          >
            {t('add')}
          </Button>
        }
      />
      <p className="text-xs text-fg-subtle">{t('stepUp')}</p>
      {discounts.data && discounts.data.length === 0 ? (
        <EmptyState icon="receipt" title={t('empty')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {(discounts.data ?? []).map((discount) => (
            <li
              key={discount.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 last:border-b-0"
            >
              <span className="flex flex-col">
                <span className="font-bold tabular-nums">
                  {t('row', {
                    percent: percentText(discount.percentBp),
                    from: monthText(discount.fromMonth),
                    to: monthText(discount.toMonth),
                  })}
                </span>
                {discount.invoicedThrough && (
                  <span className="text-xs text-fg-subtle">
                    {t('invoicedThrough', {
                      month: monthText(discount.invoicedThrough),
                    })}
                  </span>
                )}
              </span>
              <span className="flex gap-1">
                <Button
                  variant="tertiary"
                  onClick={() => open({ kind: 'shorten', discount })}
                >
                  {t('shorten')}
                </Button>
                {discount.invoicedThrough === null && (
                  <Button
                    variant="tertiary"
                    onClick={() => open({ kind: 'remove', discount })}
                  >
                    <span className="text-danger">{t('remove')}</span>
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={mode !== null}
        onClose={close}
        title={
          mode?.kind === 'add'
            ? t('addTitle')
            : mode?.kind === 'shorten'
              ? t('shortenTitle')
              : mode?.kind === 'remove'
                ? t('removeTitle', {
                    percent: percentText(mode.discount.percentBp),
                  })
                : ''
        }
        description={
          mode?.kind === 'add'
            ? t('addDescription')
            : mode?.kind === 'shorten'
              ? t('shortenDescription')
              : mode?.kind === 'remove'
                ? t('removeDescription')
                : undefined
        }
        closeLabel={tCommon('close')}
        tone={mode?.kind === 'remove' ? 'danger' : undefined}
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant={mode?.kind === 'remove' ? 'destructive' : 'primary'}
              loading={run.isPending}
              disabled={!valid}
              onClick={() => mode && run.mutate(mode)}
            >
              {mode?.kind === 'add'
                ? t('confirm')
                : mode?.kind === 'shorten'
                  ? t('shorten')
                  : t('remove')}
            </Button>
          </>
        }
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        {mode?.kind === 'add' && (
          <TextField
            label={t('percent')}
            inputMode="decimal"
            required
            value={percent}
            error={
              percent !== '' && percentBp(percent) === null
                ? t('percentError')
                : undefined
            }
            onChange={(event) => setPercent(event.target.value)}
          />
        )}
        {mode !== null && mode.kind !== 'remove' && (
          <div className="grid grid-cols-2 gap-4">
            {mode.kind === 'add' && (
              <TextField
                label={t('from')}
                type="month"
                required
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            )}
            <TextField
              label={t('to')}
              type="month"
              required
              value={to}
              error={
                (to !== '' || from !== '') && !monthsValid
                  ? t('monthError')
                  : undefined
              }
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        )}
      </Dialog>
    </Card>
  );
}
