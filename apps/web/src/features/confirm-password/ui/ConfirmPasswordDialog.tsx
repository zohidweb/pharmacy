'use client';

import { Alert, Button, Dialog, TextField } from '@pharmacy/ui';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import {
  ApiError,
  apiRequest,
  freshAuthStore,
  useApiErrorMessage,
} from '@/shared/api';

/**
 * «Подтвердите пароль» (ADR-0008, amendment 2026-10-06): opens when an action answered 403
 * `fresh_auth_required` (withFreshAuth); the password renews the session's fresh sign-in and the
 * action is repeated. Closing the dialog drops the action. A PIN session cannot be confirmed.
 * Mounted once in the application providers.
 */
export function ConfirmPasswordDialog() {
  const open = useSyncExternalStore(
    freshAuthStore.subscribe,
    freshAuthStore.isPending,
    () => false,
  );
  if (!open) return null;
  return <ConfirmPasswordForm />;
}

function ConfirmPasswordForm() {
  const t = useTranslations('confirmPassword');
  const { data: session } = useSession();
  const [password, setPassword] = useState('');
  const confirm = useMutation({
    mutationFn: () => apiRequest('sessions.confirm', { body: { password } }),
    onSuccess: () => freshAuthStore.confirmed(),
  });
  const wrongPassword =
    confirm.error instanceof ApiError &&
    confirm.error.code === 'invalid_current_password';
  const error = useApiErrorMessage(wrongPassword ? null : confirm.error);
  const pinSession = session?.auth === 'pin';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password !== '') confirm.mutate();
  };

  return (
    <Dialog
      open
      onClose={() => freshAuthStore.cancelled()}
      title={t('title')}
      description={pinSession ? t('pinSession') : t('description')}
      closeLabel={t('cancel')}
      icon="key-round"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => freshAuthStore.cancelled()}
          >
            {t('cancel')}
          </Button>
          {!pinSession && (
            <Button
              type="submit"
              form="confirm-password-form"
              loading={confirm.isPending}
            >
              {t('submit')}
            </Button>
          )}
        </>
      }
    >
      {!pinSession && (
        <form
          id="confirm-password-form"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={submit}
        >
          <TextField
            label={t('password')}
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            error={wrongPassword ? t('wrong') : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
        </form>
      )}
    </Dialog>
  );
}
