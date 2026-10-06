'use client';

import type { EmployeeSession } from '@pharmacy/shared-dto';
import { Alert } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { useSelectStore } from '@/features/select-store';
import { SignOutButton } from '@/features/sign-out';
import { StoreForm } from '@/features/store-form';
import { useApiErrorMessage } from '@/shared/api';

/**
 * The first store of a new network (spec 2026-10-06-owner-stores, S4): the owner creates it with
 * its legal entity, and it becomes the working store. If choosing it fails, submitting the same
 * form again returns the same store (one Idempotency-Key per form) and retries the choice.
 */
export function FirstStoreStep({
  onDone,
}: {
  onDone: (session: EmployeeSession) => void;
}) {
  const t = useTranslations('auth.firstStore');
  const select = useSelectStore();
  const error = useApiErrorMessage(select.error);

  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info">{t('hint')}</Alert>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <StoreForm
        store={null}
        submitLabel={t('submit')}
        onSaved={(store) => select.mutate(store.id, { onSuccess: onDone })}
        actions={<SignOutButton />}
      />
    </div>
  );
}
