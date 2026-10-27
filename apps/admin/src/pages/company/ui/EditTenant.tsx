'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { TenantDetails } from '@pharmacy/shared-dto';
import { Alert, Button, Dialog, TextField, useToast } from '@pharmacy/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { ApiError, useApiErrorMessage } from '@/shared/api';
import { useUpdateTenant } from '../api/update-tenant';

const required = z.string().trim().min(1, { error: 'required' });
const schema = z.object({
  name: required,
  city: required,
  inn: z
    .string()
    .trim()
    .regex(/^\d{9}$/, { error: 'inn' }),
});
type Values = z.input<typeof schema>;
type Field = keyof Values;

/**
 * The network's name, city and INN as at creation (spec 2026-10-26-pilot-small-gaps, P9): a typo is fixed here;
 * the issued invoices keep their copy, the next ones take the new values.
 */
export function EditTenant({ tenant }: { tenant: TenantDetails }) {
  const t = useTranslations('company.edit');
  const tFields = useTranslations('companyCreate.fields');
  const tErrors = useTranslations('validation');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const update = useUpdateTenant(tenant.id);
  const defaults: Values = {
    name: tenant.name,
    city: tenant.city,
    inn: tenant.inn,
  };
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  // the INN of another network is shown at its field, not as a banner
  const innTaken =
    update.error instanceof ApiError && update.error.code === 'inn_taken';
  const error = useApiErrorMessage(innTaken ? null : update.error);

  const close = () => {
    setOpen(false);
    form.reset(defaults);
    update.reset();
  };
  const fieldError = (field: Field) => {
    if (field === 'inn' && innTaken) return t('innTaken');
    const message = form.formState.errors[field]?.message;
    return message === 'required' || message === 'inn'
      ? tErrors(message)
      : undefined;
  };

  return (
    <>
      <Button
        variant="tertiary"
        iconStart="pencil"
        onClick={() => {
          form.reset(defaults);
          setOpen(true);
        }}
      >
        {t('action')}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={t('title')}
        description={t('description')}
        closeLabel={tCommon('close')}
        footer={
          <>
            <Button variant="tertiary" onClick={close}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" form="edit-tenant" loading={update.isPending}>
              {t('save')}
            </Button>
          </>
        }
      >
        <form
          id="edit-tenant"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) =>
            update.mutate(
              {
                name: values.name.trim(),
                city: values.city.trim(),
                inn: values.inn.trim(),
              },
              {
                onSuccess: () => {
                  toast.show(t('saved'));
                  close();
                },
              },
            ),
          )}
        >
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          <TextField
            label={tFields('name')}
            required
            error={fieldError('name')}
            {...form.register('name')}
          />
          <TextField
            label={tFields('city')}
            required
            error={fieldError('city')}
            {...form.register('city')}
          />
          <TextField
            label={tFields('inn')}
            required
            inputMode="numeric"
            error={fieldError('inn')}
            {...form.register('inn', {
              // a corrected INN is no longer «taken» until the next save
              onChange: () => {
                if (innTaken) update.reset();
              },
            })}
          />
        </form>
      </Dialog>
    </>
  );
}
