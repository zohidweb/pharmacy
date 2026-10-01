'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { StoreDetails, SyncSchedule } from '@pharmacy/shared-dto';
import { formatDateOnly } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Select,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { useApiErrorMessage } from '@/shared/api';
import {
  useUpdateLicenseSettings,
  useUpdateStore,
} from '../api/store-mutations';

const PHONE = /^\+992(\s?\d){9}$/;

const paramsSchema = z.object({
  name: z.string().trim().min(1, { error: 'required' }),
  address: z.string().trim().min(1, { error: 'required' }),
  managerName: z.string().trim().min(1, { error: 'required' }),
  managerPhone: z.string().trim().regex(PHONE, { error: 'phone' }),
});
type ParamsValues = z.input<typeof paramsSchema>;

type FieldErrorKey = 'required' | 'phone' | 'notifyDays';
const fieldErrorKey = (
  message: string | undefined,
): FieldErrorKey | undefined =>
  message === 'required' || message === 'phone' || message === 'notifyDays'
    ? message
    : undefined;

export function StoreParamsForm({ store }: { store: StoreDetails }) {
  const t = useTranslations('store.params');
  const tErrors = useTranslations('validation');
  const toast = useToast();
  const update = useUpdateStore(store.id);
  const error = useApiErrorMessage(update.error);
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<ParamsValues>({
    resolver: zodResolver(paramsSchema),
    values: {
      name: store.name,
      address: store.address,
      managerName: store.managerName,
      managerPhone: store.managerPhone,
    },
  });
  const message = (value?: string) => {
    const key = fieldErrorKey(value);
    return key ? tErrors(key) : undefined;
  };

  return (
    <Card as="section" aria-labelledby="store-params-title">
      <CardHeader title={t('title')} titleId="store-params-title" />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) =>
          update.mutate(paramsSchema.parse(values), {
            onSuccess: (saved) => {
              reset({
                name: saved.name,
                address: saved.address,
                managerName: saved.managerName,
                managerPhone: saved.managerPhone,
              });
              toast.show(t('saved'));
            },
          }),
        )}
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <TextField
          label={t('name')}
          required
          error={message(errors.name?.message)}
          {...register('name')}
        />
        <TextField
          label={t('address')}
          required
          error={message(errors.address?.message)}
          {...register('address')}
        />
        <TextField
          label={t('mode')}
          readOnly
          value={t(`modeValue.${store.mode}`)}
          hint={t('modeHint')}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t('managerName')}
            required
            error={message(errors.managerName?.message)}
            {...register('managerName')}
          />
          <TextField
            label={t('managerPhone')}
            type="tel"
            placeholder="+992 00 000 00 00"
            required
            error={message(errors.managerPhone?.message)}
            {...register('managerPhone')}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={!isDirty} loading={update.isPending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

const schedules: SyncSchedule[] = ['daily', 'twice_daily', 'hourly', 'manual'];

const licenseSchema = z.object({
  notifyDaysBefore: z.coerce
    .number<string>()
    .int({ error: 'notifyDays' })
    .min(1, { error: 'notifyDays' })
    .max(60, { error: 'notifyDays' }),
  syncSchedule: z.enum(schedules),
});
type LicenseValues = z.input<typeof licenseSchema>;
type LicensePayload = z.output<typeof licenseSchema>;

export function LicenseSettingsForm({ store }: { store: StoreDetails }) {
  const t = useTranslations('store.license');
  const tErrors = useTranslations('validation');
  const toast = useToast();
  const update = useUpdateLicenseSettings(store.id);
  const error = useApiErrorMessage(update.error);
  const license = store.license;
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
  } = useForm<LicenseValues, unknown, LicensePayload>({
    resolver: zodResolver(licenseSchema),
    values: license
      ? {
          notifyDaysBefore: String(license.notifyDaysBefore),
          syncSchedule: license.syncSchedule,
        }
      : undefined,
  });
  if (!license) return null;
  const schedule = watch('syncSchedule') ?? license.syncSchedule;

  return (
    <Card as="section" aria-labelledby="store-license-title">
      <CardHeader title={t('title')} titleId="store-license-title" />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) =>
          update.mutate(values, {
            onSuccess: () => toast.show(t('saved')),
          }),
        )}
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-4">
          <TextField label={t('code')} value={license.code} readOnly mono />
          <TextField
            label={t('validUntil')}
            value={formatDateOnly(license.validUntil)}
            readOnly
          />
        </div>
        <TextField
          label={t('notifyDays')}
          inputMode="numeric"
          hint={t('notifyDaysHint')}
          error={
            fieldErrorKey(errors.notifyDaysBefore?.message)
              ? tErrors('notifyDays')
              : undefined
          }
          {...register('notifyDaysBefore')}
        />
        <Select
          label={t('schedule')}
          hint={t(`scheduleHint.${schedule}`)}
          options={schedules.map((value) => ({
            value,
            label: t(`scheduleValue.${value}`),
          }))}
          {...register('syncSchedule')}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!isDirty} loading={update.isPending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
