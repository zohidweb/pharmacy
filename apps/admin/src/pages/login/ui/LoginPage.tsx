'use client';

import { Icon, SegmentedControl, Spinner, type IconName } from '@pharmacy/ui';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { LoginForm } from '@/features/auth-by-password';
import { routes } from '@/shared/config';
import { locales, setLocale, useLocale } from '@/shared/i18n';

const promoItems: Array<{
  icon: IconName;
  key: 'companies' | 'billing' | 'licenses';
}> = [
  { icon: 'building-2', key: 'companies' },
  { icon: 'receipt', key: 'billing' },
  { icon: 'key-round', key: 'licenses' },
];

/** Operator sign-in (UI mockup "Вход", password step). An existing session goes to the dashboard. */
export function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
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
    <main className="grid min-h-dvh place-items-center bg-bg p-6">
      <div className="grid w-full max-w-(--ph-size-login) grid-cols-2 overflow-hidden rounded-lg bg-surface shadow-lg">
        <section
          aria-labelledby="login-title"
          className="flex flex-col gap-6 p-10"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1
                id="login-title"
                className="text-2xl font-bold tracking-tight text-fg"
              >
                {t('auth.title')}
              </h1>
              <p className="text-sm text-fg-subtle">{t('auth.subtitle')}</p>
            </div>
            <SegmentedControl
              label={t('shell.localeLabel')}
              value={locale}
              onValueChange={setLocale}
              options={locales.map((value) => ({
                value,
                label: value === 'tg' ? 'TJ' : 'RU',
                ariaLabel: t(`locales.${value}`),
              }))}
            />
          </div>
          <LoginForm onSuccess={() => router.replace(routes.dashboard())} />
        </section>

        <aside className="flex flex-col justify-between gap-8 bg-primary p-10 text-on-primary">
          <div className="flex flex-col gap-6">
            <p className="text-xl font-bold tracking-tight">
              {t('auth.promo.title')}
            </p>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {promoItems.map((item) => (
                <li key={item.key} className="flex items-center gap-3 text-sm">
                  <Icon name={item.icon} size="md" />
                  <span>{t(`auth.promo.${item.key}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs">{t('auth.promo.footnote')}</p>
        </aside>
      </div>
    </main>
  );
}
