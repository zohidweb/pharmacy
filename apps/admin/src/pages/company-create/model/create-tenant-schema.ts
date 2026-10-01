import type { CreateTenantRequest } from '@pharmacy/shared-dto';
import { parseMoneyToMinor } from '@pharmacy/shared-util';
import { z } from 'zod';

/** Error messages are keys under `validation` (ADR-0015). */
export type CreateTenantErrorKey =
  'required' | 'inn' | 'phone' | 'email' | 'dateFromToday' | 'money';

const PHONE = /^\+992(\s?\d){9}$/;
const INN = /^\d{9}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const required = z.string().trim().min(1, { error: 'required' });

export function createTenantSchema(today: string) {
  return z.object({
    name: required,
    city: required,
    inn: z.string().trim().regex(INN, { error: 'inn' }),
    ownerFullName: required,
    ownerPhone: z.string().trim().regex(PHONE, { error: 'phone' }),
    ownerLogin: z
      .string()
      .trim()
      .pipe(z.email({ error: 'email' })),
    storeName: required,
    storeAddress: required,
    mode: z.enum(['cloud', 'offline']),
    licenseTerm: z.enum(['week', 'quarter', 'year']),
    syncSchedule: z.enum(['daily', 'twice_daily', 'hourly', 'manual']),
    paidUntil: z
      .string()
      .regex(DATE, { error: 'dateFromToday' })
      .refine((value) => value >= today, { error: 'dateFromToday' }),
    price: z.string().refine((value) => (parseMoneyToMinor(value) ?? 0) > 0, {
      error: 'money',
    }),
  });
}

export type CreateTenantValues = z.input<ReturnType<typeof createTenantSchema>>;

/** Fields validated before leaving each wizard step. */
export const stepFields: Array<Array<keyof CreateTenantValues>> = [
  ['name', 'city', 'inn', 'ownerFullName', 'ownerPhone', 'ownerLogin'],
  ['storeName', 'storeAddress', 'mode', 'licenseTerm', 'syncSchedule'],
  ['paidUntil', 'price'],
];

export function toCreateTenantRequest(
  values: CreateTenantValues,
): CreateTenantRequest {
  const offline = values.mode === 'offline';
  return {
    name: values.name.trim(),
    city: values.city.trim(),
    inn: values.inn.trim(),
    owner: {
      fullName: values.ownerFullName.trim(),
      phone: values.ownerPhone.trim(),
      login: values.ownerLogin.trim().toLowerCase(),
    },
    firstStore: {
      name: values.storeName.trim(),
      address: values.storeAddress.trim(),
      mode: values.mode,
      ...(offline && {
        licenseTerm: values.licenseTerm,
        syncSchedule: values.syncSchedule,
      }),
    },
    paidUntil: values.paidUntil,
    pricePerStoreMinor: parseMoneyToMinor(values.price) ?? 0,
  };
}

export function isCreateTenantErrorKey(
  value: unknown,
): value is CreateTenantErrorKey {
  return (
    value === 'required' ||
    value === 'inn' ||
    value === 'phone' ||
    value === 'email' ||
    value === 'dateFromToday' ||
    value === 'money'
  );
}
