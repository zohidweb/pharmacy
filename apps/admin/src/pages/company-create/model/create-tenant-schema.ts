import type { CreateTenantRequest } from '@pharmacy/shared-dto';
import { z } from 'zod';

/** Error messages are keys under `validation` (ADR-0015). */
export type CreateTenantErrorKey =
  'required' | 'inn' | 'phone' | 'email' | 'login';

const PHONE = /^\+992(\s?\d){9}$/;
const INN = /^\d{9}$/;
// A sign-in login (ADR-0008): not shaped like a phone or an e-mail, which are separate identifiers.
const LOGIN = /^(?=.*[a-z])[a-z0-9._-]{3,64}$/i;

const required = z.string().trim().min(1, { error: 'required' });

export function createTenantSchema() {
  return z.object({
    name: required,
    city: required,
    inn: z.string().trim().regex(INN, { error: 'inn' }),
    ownerFullName: required,
    ownerPhone: z.string().trim().regex(PHONE, { error: 'phone' }),
    ownerLogin: z.string().trim().regex(LOGIN, { error: 'login' }),
    ownerEmail: z.union([
      z.literal(''),
      z
        .string()
        .trim()
        .pipe(z.email({ error: 'email' })),
    ]),
  });
}

export type CreateTenantValues = z.input<ReturnType<typeof createTenantSchema>>;

export function toCreateTenantRequest(
  values: CreateTenantValues,
): CreateTenantRequest {
  const email = values.ownerEmail.trim().toLowerCase();
  return {
    name: values.name.trim(),
    city: values.city.trim(),
    inn: values.inn.trim(),
    owner: {
      fullName: values.ownerFullName.trim(),
      phone: values.ownerPhone.replace(/\s/g, ''),
      login: values.ownerLogin.trim().toLowerCase(),
      ...(email !== '' && { email }),
    },
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
    value === 'login'
  );
}

/** Problem codes of POST /operator/tenants that belong to one field. */
export const FIELD_CONFLICTS: Readonly<
  Record<string, keyof CreateTenantValues>
> = {
  inn_taken: 'inn',
  login_taken: 'ownerLogin',
  phone_taken: 'ownerPhone',
  email_taken: 'ownerEmail',
};
