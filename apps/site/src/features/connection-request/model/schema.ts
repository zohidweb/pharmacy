/*
 * The connection request form (spec 6.4): the same limits as SubmitConnectionRequestDto of the API, the phone and
 * the e-mail checked by the same normalizeIdentifier (W10), so a value the form accepts is not refused by the API.
 * Error messages are keys under `connect.errors` (ADR-0015).
 */
import type { SubmitConnectionRequest, UiLocale } from '@pharmacy/shared-dto';
import { normalizeIdentifier } from '@pharmacy/shared-util';
import { z } from 'zod/mini';

export type ConnectionRequestErrorKey =
  | 'required'
  | 'tooShort'
  | 'tooLong'
  | 'storeCount'
  | 'phone'
  | 'email'
  | 'inn'
  | 'consent'
  | 'invalid';

/** Maximum lengths of the text fields (SubmitConnectionRequestDto); `tooLong` shows the field's one. */
export const FIELD_MAX_LENGTH = {
  networkName: 120,
  city: 120,
  contactName: 120,
  email: 254,
  callTime: 100,
  comment: 500,
} as const;

const MIN_STORE_COUNT = 1;
const MAX_STORE_COUNT = 500;
const MIN_CONTACT_NAME = 2;
const INN = /^(\d{9})?$/;
const STORE_COUNT = /^\d{1,3}$/;

const filled = () => z.minLength(1, { error: 'required' });
const atMost = (max: number) => z.maxLength(max, { error: 'tooLong' });

const required = (max: number) =>
  z.string().check(z.trim(), filled(), atMost(max));

const optional = (max: number) => z.string().check(z.trim(), atMost(max));

const storeCountInRange = (value: string) => {
  const count = Number(value);
  return count >= MIN_STORE_COUNT && count <= MAX_STORE_COUNT;
};

// zod/mini: the form is the only client-heavy part of the site, and classic zod alone would triple its bundle
export function connectionRequestSchema() {
  return z.object({
    networkName: required(FIELD_MAX_LENGTH.networkName),
    city: required(FIELD_MAX_LENGTH.city),
    storeCount: z.pipe(
      z
        .string()
        .check(
          z.trim(),
          filled(),
          z.regex(STORE_COUNT, { error: 'storeCount' }),
          z.refine(storeCountInRange, { error: 'storeCount' }),
        ),
      z.transform(Number),
    ),
    contactName: z
      .string()
      .check(
        z.trim(),
        filled(),
        z.minLength(MIN_CONTACT_NAME, { error: 'tooShort' }),
        atMost(FIELD_MAX_LENGTH.contactName),
      ),
    phone: z.string().check(
      z.trim(),
      filled(),
      z.refine((value) => normalizeIdentifier(value)?.kind === 'phone', {
        error: 'phone',
      }),
    ),
    email: z.string().check(
      z.trim(),
      atMost(FIELD_MAX_LENGTH.email),
      z.refine(
        (value) => value === '' || normalizeIdentifier(value)?.kind === 'email',
        { error: 'email' },
      ),
    ),
    inn: z.string().check(z.trim(), z.regex(INN, { error: 'inn' })),
    callTime: optional(FIELD_MAX_LENGTH.callTime),
    comment: optional(FIELD_MAX_LENGTH.comment),
    consent: z
      .boolean()
      .check(z.refine((value) => value, { error: 'consent' })),
    // the trap: never checked here, the API makes a filled one spam (spec 7.3)
    website: z.string(),
  });
}

type Schema = ReturnType<typeof connectionRequestSchema>;
export type ConnectionRequestInput = z.input<Schema>;
export type ConnectionRequestValues = z.output<Schema>;
export type ConnectionRequestField = keyof ConnectionRequestInput;

export const EMPTY_CONNECTION_REQUEST: ConnectionRequestInput = {
  networkName: '',
  city: '',
  storeCount: '',
  contactName: '',
  phone: '',
  email: '',
  inn: '',
  callTime: '',
  comment: '',
  consent: false,
  website: '',
};

export function isConnectionRequestErrorKey(
  value: unknown,
): value is ConnectionRequestErrorKey {
  return (
    value === 'required' ||
    value === 'tooShort' ||
    value === 'tooLong' ||
    value === 'storeCount' ||
    value === 'phone' ||
    value === 'email' ||
    value === 'inn' ||
    value === 'consent' ||
    value === 'invalid'
  );
}

/** The fields of the form the API may name in `errors[]` (the rest — locale, openedAt — are not the visitor's). */
export function isConnectionRequestField(
  value: string,
): value is Exclude<ConnectionRequestField, 'website'> {
  return value !== 'website' && value in EMPTY_CONNECTION_REQUEST;
}

/** The body of POST public/connection-requests; empty optional fields are left out. */
export function toSubmitBody(
  values: ConnectionRequestValues,
  locale: UiLocale,
  openedAt: string,
): SubmitConnectionRequest {
  const optionalText = (value: string) => (value === '' ? undefined : value);
  return {
    networkName: values.networkName,
    city: values.city,
    storeCount: values.storeCount,
    contactName: values.contactName,
    phone: values.phone,
    email: optionalText(values.email),
    inn: optionalText(values.inn),
    callTime: optionalText(values.callTime),
    comment: optionalText(values.comment),
    locale,
    consent: true,
    website: optionalText(values.website),
    openedAt,
  };
}
