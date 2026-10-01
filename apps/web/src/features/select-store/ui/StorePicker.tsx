'use client';

import type { EmployeeSession } from '@pharmacy/shared-dto';
import { Alert, Button, RadioCardGroup } from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useApiErrorMessage } from '@/shared/api';
import { useSelectStore } from '../api/select-store';

export interface StorePickerProps {
  session: EmployeeSession;
  onSelected: (session: EmployeeSession) => void;
}

/** Choice of the working store among the stores of the employee scope (sign-in step 2). */
export function StorePicker({ session, onSelected }: StorePickerProps) {
  const t = useTranslations('auth.store');
  const tMode = useTranslations('store.mode');
  const [storeId, setStoreId] = useState(
    session.currentStoreId ?? session.stores[0]?.id ?? '',
  );
  const select = useSelectStore();
  const error = useApiErrorMessage(select.error);

  if (session.stores.length === 0) {
    return (
      <Alert tone="warning" title={t('noStoresTitle')}>
        {t('noStores')}
      </Alert>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        select.mutate(storeId, { onSuccess: onSelected });
      }}
    >
      <RadioCardGroup
        label={t('label')}
        hideLabel
        value={storeId}
        onValueChange={setStoreId}
        columns={1}
        options={session.stores.map((store) => ({
          value: store.id,
          title: store.name,
          description: `${store.address} · ${tMode(store.mode)}`,
          icon: store.mode === 'cloud' ? 'cloud' : 'cloud-off',
        }))}
      />
      <Alert tone="info">{t('hint')}</Alert>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <Button type="submit" size="lg" block loading={select.isPending}>
        {t('submit')}
      </Button>
    </form>
  );
}
