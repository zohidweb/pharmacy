'use client';

import { Alert, Button, Spinner } from '@pharmacy/ui';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { routes } from '@/shared/config';
import { Sidebar } from './Sidebar';

/**
 * Frame of the signed-in admin: skip link, sidebar, main region. Without a session the operator
 * is sent to the login screen (the API enforces access; this only avoids an empty shell).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const session = useSession();
  const signedOut = session.isSuccess && session.data === null;

  useEffect(() => {
    if (signedOut) router.replace(routes.login());
  }, [signedOut, router]);

  if (session.isError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div className="flex max-w-(--ph-size-dialog-sm) flex-col gap-4">
          <Alert tone="danger" live="assertive">
            {tErrors('network')}
          </Alert>
          <Button
            variant="secondary"
            iconStart="refresh-cw"
            onClick={() => session.refetch()}
          >
            {t('retry')}
          </Button>
        </div>
      </div>
    );
  }

  if (!session.data) {
    return (
      <div className="grid min-h-dvh place-items-center text-primary">
        <Spinner size="xl" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-(--ph-z-tooltip) focus-visible:rounded-md focus-visible:bg-surface focus-visible:p-3"
      >
        {t('skipToContent')}
      </a>
      <Sidebar />
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
