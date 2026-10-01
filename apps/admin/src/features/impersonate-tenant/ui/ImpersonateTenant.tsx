'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  Dialog,
  IconButton,
  TextareaField,
  useToast,
} from '@pharmacy/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { useApiErrorMessage } from '@/shared/api';
import { submitHandoff, useImpersonate } from '../api/impersonate';

const schema = z.object({
  reason: z.string().trim().min(5, { error: 'reasonRequired' }),
});
type Values = z.input<typeof schema>;

export interface ImpersonateTenantProps {
  tenant: { id: string; name: string };
  /** "icon" — compact row action in tables; "button" — labelled button in a page header. */
  appearance?: 'icon' | 'button';
  disabled?: boolean;
}

/**
 * «Войти от имени владельца» (ADR-0008): the reason is mandatory and goes to the tenant's audit
 * log; the owner sees the session there. The client product opens in a new tab, read-only.
 */
export function ImpersonateTenant({
  tenant,
  appearance = 'button',
  disabled = false,
}: ImpersonateTenantProps) {
  const t = useTranslations('impersonation');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const impersonate = useImpersonate();
  const errorMessage = useApiErrorMessage(impersonate.error);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '' },
  });

  const close = () => {
    setOpen(false);
    form.reset();
    impersonate.reset();
  };

  const onSubmit = form.handleSubmit(({ reason }) =>
    impersonate.mutate(
      { tenantId: tenant.id, reason: reason.trim() },
      {
        onSuccess: (handoff) => {
          if (handoff.handoffUrl) submitHandoff(handoff);
          toast.show(t('started', { name: tenant.name }));
          close();
        },
      },
    ),
  );

  return (
    <>
      {appearance === 'icon' ? (
        <IconButton
          icon="log-in"
          label={t('actionFor', { name: tenant.name })}
          disabled={disabled}
          onClick={() => setOpen(true)}
        />
      ) : (
        <Button
          variant="secondary"
          iconStart="log-in"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {t('action')}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={close}
        title={t('title')}
        description={t('description', { name: tenant.name })}
        closeLabel={tCommon('close')}
        icon="user-check"
        tone="attention"
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              form={`impersonate-${tenant.id}`}
              loading={impersonate.isPending}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <form
          id={`impersonate-${tenant.id}`}
          noValidate
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
        >
          {errorMessage && (
            <Alert tone="danger" live="assertive">
              {errorMessage}
            </Alert>
          )}
          <TextareaField
            label={t('reason')}
            hint={t('reasonHint')}
            rows={2}
            required
            error={
              form.formState.errors.reason ? t('reasonRequired') : undefined
            }
            {...form.register('reason')}
          />
          <Alert tone="attention">{t('readOnlyNote')}</Alert>
        </form>
      </Dialog>
    </>
  );
}
