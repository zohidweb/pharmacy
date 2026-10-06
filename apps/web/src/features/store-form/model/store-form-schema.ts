import type {
  CreateStoreRequest,
  LegalEntitiesResponse,
  OwnerStore,
  StoreKind,
  UpdateOwnerStoreRequest,
} from '@pharmacy/shared-dto';
import { z } from 'zod';

/** Error messages are i18n keys under `storeForm.errors` (ADR-0015: no English texts in schemas). */
export type StoreFormErrorKey =
  | 'required'
  | 'tooLong'
  | 'codeFormat'
  | 'taxIdFormat'
  | 'phoneFormat'
  | 'emailFormat'
  | 'store_code_taken'
  | 'tax_id_taken';

const ERROR_KEYS: readonly StoreFormErrorKey[] = [
  'required',
  'tooLong',
  'codeFormat',
  'taxIdFormat',
  'phoneFormat',
  'emailFormat',
  'store_code_taken',
  'tax_id_taken',
];

export function isStoreFormErrorKey(value: unknown): value is StoreFormErrorKey {
  return (ERROR_KEYS as readonly unknown[]).includes(value);
}

/** The select value that opens the fields of a new legal entity. */
export const NEW_LEGAL_ENTITY = 'new';

const error = (key: StoreFormErrorKey) => ({ error: key });
const text = (max: number) =>
  z.string().trim().min(1, error('required')).max(max, error('tooLong'));

// Limits of spec 2026-10-06-owner-stores, section 7; the API checks the same.
const TAX_ID = /^\d{9}$/;
const STORE_CODE = /^[A-Z0-9]{1,8}$/;
const PHONE = /^\+[1-9][0-9]{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const storeFormSchema = z
  .object({
    legalEntityId: z.string().min(1, error('required')),
    le: z.object({
      name: z.string().trim(),
      taxId: z.string().trim(),
      legalAddress: z.string().trim(),
      phone: z.string().trim(),
      email: z.string().trim(),
      bankDetails: z.string().trim(),
    }),
    name: text(120),
    code: z.string().trim().toUpperCase(),
    address: text(300),
    kind: z.enum(['pharmacy', 'warehouse']),
    printReceiptDefault: z.boolean(),
    /** Code and kind are set only when the store is created. */
    creating: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const issue = (path: (string | number)[], key: StoreFormErrorKey) =>
      ctx.addIssue({ code: 'custom', path, message: key });
    if (values.creating && !STORE_CODE.test(values.code)) {
      issue(['code'], values.code === '' ? 'required' : 'codeFormat');
    }
    if (values.legalEntityId !== NEW_LEGAL_ENTITY) return;
    const le = values.le;
    if (le.name === '') issue(['le', 'name'], 'required');
    else if (le.name.length > 120) issue(['le', 'name'], 'tooLong');
    if (!TAX_ID.test(le.taxId)) {
      issue(['le', 'taxId'], le.taxId === '' ? 'required' : 'taxIdFormat');
    }
    if (le.legalAddress === '') issue(['le', 'legalAddress'], 'required');
    else if (le.legalAddress.length > 300) {
      issue(['le', 'legalAddress'], 'tooLong');
    }
    if (le.phone !== '' && !PHONE.test(le.phone)) {
      issue(['le', 'phone'], 'phoneFormat');
    }
    if (le.email !== '' && (!EMAIL.test(le.email) || le.email.length > 254)) {
      issue(['le', 'email'], 'emailFormat');
    }
    if (le.bankDetails.length > 1000) issue(['le', 'bankDetails'], 'tooLong');
  });

export type StoreFormValues = z.input<typeof storeFormSchema>;
export type StoreFormPayload = z.output<typeof storeFormSchema>;

/** Initial values: the store's own, or a new store with the first legal entity (or a new one). */
export function storeFormDefaults(
  store: OwnerStore | null,
  legalEntities: LegalEntitiesResponse,
): StoreFormValues {
  const first = legalEntities.items[0];
  return {
    legalEntityId:
      store?.legalEntityId ?? (first ? first.id : NEW_LEGAL_ENTITY),
    // The first legal entity of a network is prefilled with the network's name and INN.
    le: {
      name: first ? '' : legalEntities.defaults.name,
      taxId: first ? '' : (legalEntities.defaults.taxId ?? ''),
      legalAddress: '',
      phone: '',
      email: '',
      bankDetails: '',
    },
    name: store?.name ?? '',
    code: store?.code ?? '',
    address: store?.address ?? '',
    kind: store?.kind ?? ('pharmacy' satisfies StoreKind),
    printReceiptDefault: store?.printReceiptDefault ?? true,
    creating: store === null,
  };
}

const orNull = (value: string) => (value === '' ? null : value);

export function toCreateStoreRequest(values: StoreFormPayload): CreateStoreRequest {
  const base = {
    name: values.name,
    code: values.code,
    address: values.address,
    kind: values.kind,
    printReceiptDefault: values.printReceiptDefault,
  };
  return values.legalEntityId === NEW_LEGAL_ENTITY
    ? {
        ...base,
        newLegalEntity: {
          name: values.le.name,
          taxId: values.le.taxId,
          legalAddress: values.le.legalAddress,
          phone: orNull(values.le.phone),
          email: orNull(values.le.email),
          bankDetails: orNull(values.le.bankDetails),
        },
      }
    : { ...base, legalEntityId: values.legalEntityId };
}

export function toUpdateStoreRequest(
  values: StoreFormPayload,
): UpdateOwnerStoreRequest {
  return {
    name: values.name,
    address: values.address,
    legalEntityId: values.legalEntityId,
    printReceiptDefault: values.printReceiptDefault,
  };
}
