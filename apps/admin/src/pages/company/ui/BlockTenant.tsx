'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { TenantDetails } from '@pharmacy/shared-dto';
import { Alert, Button, Dialog, TextareaField, useToast } from '@pharmacy/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { useApiErrorMessage } from '@/shared/api';
import { useBlockTenant, useUnblockTenant } from '../api/block-tenant';

const schema = z.object({
  reason: z.string().trim().min(5, { error: 'reasonRequired' }),
});
type Values = z.input<typeof schema>;

/** Block (with a mandatory reason) or unblock a tenant; data is kept, billing stops. */
export function BlockTenant({ tenant }: { tenant: TenantDetails }) {
  const t = useTranslations('company.block');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const block = useBlockTenant(tenant.id);
  const unblock = useUnblockTenant(tenant.id);
  const error = useApiErrorMessage(block.error ?? unblock.error);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '' },
  });

  if (tenant.status === 'blocked') {
    return (
      <Button
        variant="success"
        iconStart="check"
        loading={unblock.isPending}
        onClick={() =>
          unblock.mutate(undefined, {
            onSuccess: () => toast.show(t('unblocked')),
          })
        }
      >
        {t('unblock')}
      </Button>
    );
  }

  const close = () => {
    setOpen(false);
    form.reset();
    block.reset();
  };

  return (
    <>
      <Button
        variant="destructive"
        iconStart="ban"
        onClick={() => setOpen(true)}
      >
        {t('action')}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={t('title', { name: tenant.name })}
        description={t('description')}
        closeLabel={tCommon('close')}
        icon="ban"
        tone="danger"
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              type="submit"
              form="block-tenant"
              loading={block.isPending}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <form
          id="block-tenant"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit(({ reason }) =>
            block.mutate(reason.trim(), {
              onSuccess: () => {
                toast.show(t('blocked'));
                close();
              },
            }),
          )}
        >
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          <TextareaField
            label={t('reason')}
            rows={2}
            required
            error={
              form.formState.errors.reason ? t('reasonRequired') : undefined
            }
            {...form.register('reason')}
          />
        </form>
      </Dialog>
    </>
  );
}
