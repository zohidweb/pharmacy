'use client';

import type { TenantDetails } from '@pharmacy/shared-dto';
import { Alert, Button, Dialog } from '@pharmacy/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ActivationCodeCard } from '@/entities/tenant';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

/**
 * A new one-time activation code for the owner (a lost code, a forgotten password): the old code
 * stops working, the password stays until the new code is used. Shown once.
 */
export function IssueOwnerCode({ tenant }: { tenant: TenantDetails }) {
  const t = useTranslations('company.ownerCode');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const issue = useMutation({
    mutationFn: () =>
      apiRequest('tenants.ownerCode', { params: { id: tenant.id } }),
  });
  const error = useApiErrorMessage(issue.error);

  const close = () => {
    setOpen(false);
    issue.reset();
  };

  return (
    <>
      <Button
        variant="tertiary"
        iconStart="key-round"
        disabled={tenant.status === 'blocked'}
        onClick={() => setOpen(true)}
      >
        {t('action')}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={t('title', { name: tenant.name })}
        description={issue.data ? undefined : t('description')}
        closeLabel={tCommon('close')}
        icon="key-round"
        footer={
          issue.data ? (
            <Button onClick={close}>{tCommon('close')}</Button>
          ) : (
            <>
              <Button variant="tertiary" onClick={close}>
                {tCommon('cancel')}
              </Button>
              <Button loading={issue.isPending} onClick={() => issue.mutate()}>
                {t('confirm')}
              </Button>
            </>
          )
        }
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        {issue.data && (
          <ActivationCodeCard
            code={issue.data.activationCode}
            title={t('codeTitle')}
          />
        )}
      </Dialog>
    </>
  );
}
