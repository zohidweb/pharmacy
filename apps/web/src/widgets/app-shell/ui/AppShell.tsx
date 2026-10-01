'use client';

import { Alert, Button, Icon, Spinner } from '@pharmacy/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { currentStoreOf, useSession } from '@/entities/session';
import { routes } from '@/shared/config';
import { landingRoute } from '../config/navigation';
import { ConnectionStatus } from './ConnectionStatus';
import { ImpersonationBanner } from './ImpersonationBanner';
import { NotificationsBell } from './NotificationsBell';
import { Sidebar } from './Sidebar';
import { StoreSwitcher } from './StoreSwitcher';
import { UserMenu } from './UserMenu';

/**
 * Frame of the signed-in client product: top bar (store, connection, notifications, employee),
 * sidebar, main region. Without a session or a chosen store the employee goes to the sign-in —
 * the API enforces access; this only avoids an empty shell.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const session = useSession();
  const needsSignIn =
    session.isSuccess && (!session.data || !session.data.currentStoreId);

  useEffect(() => {
    if (needsSignIn) router.replace(routes.login());
  }, [needsSignIn, router]);

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

  if (!session.data || needsSignIn) {
    return (
      <div className="grid min-h-dvh place-items-center text-primary">
        <Spinner size="xl" label={t('loading')} />
      </div>
    );
  }

  const data = session.data;
  return (
    <div className="min-h-dvh bg-bg">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-(--ph-z-tooltip) focus-visible:rounded-md focus-visible:bg-surface focus-visible:p-3"
      >
        {t('skipToContent')}
      </a>
      <header className="sticky top-0 z-(--ph-z-sticky) flex h-topbar items-center gap-4 border-b border-border bg-surface px-4">
        <Link
          href={landingRoute(data)}
          aria-label={t('home')}
          className="flex min-h-touch items-center gap-2 rounded-md px-2"
        >
          <span className="grid size-avatar-sm place-items-center rounded-md bg-primary text-on-primary">
            <Icon name="pill" size="md" />
          </span>
          <span
            aria-hidden="true"
            className="text-lg font-bold tracking-tight text-fg"
          >
            {t('productName')}
          </span>
        </Link>
        <StoreSwitcher session={data} />
        <div className="flex min-w-0 flex-1 justify-end">
          <ConnectionStatus store={currentStoreOf(data)} />
        </div>
        <NotificationsBell />
        <UserMenu session={data} />
      </header>
      <div className="flex">
        <Sidebar />
        <main
          id="main"
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col pb-6"
        >
          {data.impersonation && (
            <ImpersonationBanner info={data.impersonation} />
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
