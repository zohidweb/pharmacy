'use client';

import { Spinner } from '@pharmacy/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { LoginForm } from '@/features/auth-by-password';
import { routes } from '@/shared/config';
import { AuthCard } from './AuthCard';

/** Operator sign-in (UI mockup "Вход", password step). An existing session goes to the dashboard. */
export function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const session = useSession();
  const signedIn = Boolean(session.data);

  useEffect(() => {
    if (signedIn) router.replace(routes.dashboard());
  }, [signedIn, router]);

  if (session.isPending || signedIn) {
    return (
      <div className="grid min-h-dvh place-items-center text-primary">
        <Spinner size="xl" />
      </div>
    );
  }

  return (
    <AuthCard title={t('title')} subtitle={t('subtitle')}>
      <LoginForm onSuccess={() => router.replace(routes.dashboard())} />
      <Link
        href={routes.activate()}
        className="self-start text-sm text-primary hover:text-primary-hover"
      >
        {t('activateLink')}
      </Link>
    </AuthCard>
  );
}
