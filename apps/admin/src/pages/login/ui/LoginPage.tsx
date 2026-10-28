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
      {/* the question, and the link under it, both centred (QA 2026-10-28) */}
      <p className="flex flex-col items-center gap-1 text-center text-sm">
        <span className="text-fg-muted">{t('activateQuestion')}</span>
        <Link
          href={routes.activate()}
          className="font-medium text-primary hover:text-primary-hover"
        >
          {t('activateLink')}
        </Link>
      </p>
    </AuthCard>
  );
}
