'use client';

import { Alert, Button, Dialog, type ButtonVariant } from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useOutboxCounts, useTerminalRuntime } from '@/entities/terminal';
import { useApiErrorMessage } from '@/shared/api';
import { useSignOut } from '../api/sign-out';

/**
 * Sign-out; with unsent POS operations it warns first (ADR-0015): they stay in this browser and are
 * sent after the next sign-in on this terminal.
 */
export function SignOutButton({
  variant = 'tertiary',
  block = false,
}: {
  variant?: ButtonVariant;
  block?: boolean;
}) {
  const t = useTranslations('signOut');
  const signOut = useSignOut();
  const counts = useOutboxCounts(useTerminalRuntime());
  const unsent = counts.pending + counts.quarantine;
  const [confirm, setConfirm] = useState(false);
  const error = useApiErrorMessage(signOut.error);
  return (
    <>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <Button
        variant={variant}
        iconStart="log-out"
        block={block}
        loading={signOut.isPending}
        onClick={() => (unsent > 0 ? setConfirm(true) : signOut.mutate())}
      >
        {t('action')}
      </Button>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('confirmTitle')}
        closeLabel={t('cancel')}
        icon="triangle-alert"
        tone="warning"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('unsent', { count: unsent })}</p>
      </Dialog>
    </>
  );
}
