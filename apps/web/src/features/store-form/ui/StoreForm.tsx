'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { LegalEntitiesResponse, OwnerStore } from '@pharmacy/shared-dto';
import {
  Alert,
  Button,
  Select,
  Switch,
  TextField,
  TextareaField,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { sessionQueryKey } from '@/entities/session';
import { ApiError, apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import {
  isStoreFormErrorKey,
  NEW_LEGAL_ENTITY,
  storeFormDefaults,
  storeFormSchema,
  toCreateStoreRequest,
  toUpdateStoreRequest,
  type StoreFormPayload,
  type StoreFormValues,
} from '../model/store-form-schema';

export const legalEntitiesQueryKey = ['legal-entities'] as const;

export interface StoreFormProps {
  /** null — a new store. */
  store: OwnerStore | null;
  onSaved: (store: OwnerStore) => void;
  submitLabel: string;
  /** View only: no submit, every field disabled. */
  readOnly?: boolean;
  /** Extra buttons next to the submit (cancel, close the store). */
  actions?: ReactNode;
}

/**
 * The store and its legal entity (spec 2026-10-06-owner-stores, S2–S4): an existing legal entity or
 * a new one in the same request; code and kind only when the store is created. One
 * Idempotency-Key per mounted form, so a retried submit returns the same store.
 */
export function StoreForm(props: StoreFormProps) {
  const legalEntities = useQuery({
    queryKey: legalEntitiesQueryKey,
    queryFn: ({ signal }) => apiRequest('legalEntities.list', { signal }),
  });
  return (
    <QueryState query={legalEntities}>
      {(data) => <StoreFormFields {...props} legalEntities={data} />}
    </QueryState>
  );
}

function StoreFormFields({
  store,
  onSaved,
  submitLabel,
  readOnly = false,
  actions,
  legalEntities,
}: StoreFormProps & { legalEntities: LegalEntitiesResponse }) {
  const t = useTranslations('storeForm');
  const queryClient = useQueryClient();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const form = useForm<StoreFormValues, unknown, StoreFormPayload>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: storeFormDefaults(store, legalEntities),
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = form;
  const legalEntityId = useWatch({ control, name: 'legalEntityId' });
  const creatingLegalEntity = legalEntityId === NEW_LEGAL_ENTITY;

  const save = useMutation({
    mutationFn: async (values: StoreFormPayload) => {
      if (store === null) {
        return apiRequest('stores.create', {
          body: toCreateStoreRequest(values),
          idempotencyKey,
        });
      }
      // A store moves to a new legal entity: create it first, then point the store at it.
      const target = creatingLegalEntity
        ? (
            await apiRequest('legalEntities.create', {
              body: toCreateStoreRequest(values).newLegalEntity ?? values.le,
            })
          ).id
        : values.legalEntityId;
      return apiRequest('stores.update', {
        params: { id: store.id },
        body: { ...toUpdateStoreRequest(values), legalEntityId: target },
      });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['stores'] });
      void queryClient.invalidateQueries({ queryKey: legalEntitiesQueryKey });
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      onSaved(saved);
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.code === 'store_code_taken') {
        setError('code', { message: 'store_code_taken' });
      }
      if (error.code === 'tax_id_taken') {
        setError('le.taxId', { message: 'tax_id_taken' });
      }
    },
  });
  const fieldConflict =
    save.error instanceof ApiError &&
    (save.error.code === 'store_code_taken' ||
      save.error.code === 'tax_id_taken');
  const submitError = useApiErrorMessage(fieldConflict ? null : save.error);

  const message = (value: string | undefined) =>
    isStoreFormErrorKey(value) ? t(`errors.${value}`) : undefined;

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={handleSubmit((values) => save.mutate(values))}
    >
      {submitError && (
        <Alert tone="danger" live="assertive">
          {submitError}
        </Alert>
      )}
      <fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-bold">{t('store')}</legend>
        <TextField
          label={t('name')}
          required
          disabled={readOnly}
          className="col-span-2"
          error={message(errors.name?.message)}
          {...register('name')}
        />
        <TextField
          label={t('code')}
          required={store === null}
          disabled={readOnly || store !== null}
          hint={store === null ? t('codeHint') : t('codeFixed')}
          autoCapitalize="characters"
          spellCheck={false}
          error={message(errors.code?.message)}
          {...register('code')}
        />
        <Select
          label={t('kind')}
          disabled={readOnly || store !== null}
          hint={store === null ? t('kindHint') : t('kindFixed')}
          options={(['pharmacy', 'warehouse'] as const).map((value) => ({
            value,
            label: t(`kinds.${value}`),
          }))}
          {...register('kind')}
        />
        <TextField
          label={t('address')}
          required
          disabled={readOnly}
          className="col-span-2"
          error={message(errors.address?.message)}
          {...register('address')}
        />
        <Controller
          control={control}
          name="printReceiptDefault"
          render={({ field }) => (
            <Switch
              label={t('autoPrint')}
              description={t('autoPrintHint')}
              checked={field.value}
              disabled={readOnly}
              onCheckedChange={field.onChange}
              className="col-span-2"
            />
          )}
        />
      </fieldset>
      <fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-bold">
          {t('legalEntity')}
        </legend>
        <Select
          label={t('legalEntitySelect')}
          hint={t('legalEntityHint')}
          disabled={readOnly}
          className="col-span-2"
          error={message(errors.legalEntityId?.message)}
          options={[
            ...legalEntities.items.map((entity) => ({
              value: entity.id,
              label: `${entity.name} · ${t('taxIdShort', { taxId: entity.taxId })}`,
            })),
            { value: NEW_LEGAL_ENTITY, label: t('newLegalEntity') },
          ]}
          {...register('legalEntityId')}
        />
        {creatingLegalEntity && (
          <>
            <TextField
              label={t('leName')}
              required
              disabled={readOnly}
              className="col-span-2"
              error={message(errors.le?.name?.message)}
              {...register('le.name')}
            />
            <TextField
              label={t('leTaxId')}
              required
              inputMode="numeric"
              placeholder="000000000"
              disabled={readOnly}
              error={message(errors.le?.taxId?.message)}
              {...register('le.taxId')}
            />
            <TextField
              label={t('lePhone')}
              type="tel"
              placeholder="+992000000000"
              disabled={readOnly}
              error={message(errors.le?.phone?.message)}
              {...register('le.phone')}
            />
            <TextField
              label={t('leLegalAddress')}
              required
              disabled={readOnly}
              className="col-span-2"
              error={message(errors.le?.legalAddress?.message)}
              {...register('le.legalAddress')}
            />
            <TextField
              label={t('leEmail')}
              type="email"
              disabled={readOnly}
              className="col-span-2"
              error={message(errors.le?.email?.message)}
              {...register('le.email')}
            />
            <TextareaField
              label={t('leBankDetails')}
              rows={2}
              disabled={readOnly}
              className="col-span-2"
              error={message(errors.le?.bankDetails?.message)}
              {...register('le.bankDetails')}
            />
          </>
        )}
      </fieldset>
      {(actions || !readOnly) && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {actions}
          {!readOnly && (
            <Button type="submit" loading={save.isPending}>
              {submitLabel}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
