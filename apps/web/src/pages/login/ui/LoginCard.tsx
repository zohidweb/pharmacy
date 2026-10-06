'use client';

import { Icon, SegmentedControl } from '@pharmacy/ui';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { locales, setLocale, useLocale } from '@/shared/i18n';

/** The card of the sign-in screens (UI mockup «Вход»): product, language, title and the step. */
export function LoginCard({
  title,
  subtitle,
  wide = false,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  /** The PIN step: form and keypad side by side to fit a 1280×800 screen. */
  wide?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-6">
      <section
        aria-labelledby="login-title"
        className={
          wide
            ? 'flex w-full max-w-(--ph-size-login) flex-col gap-6 rounded-lg bg-surface p-8 shadow-lg'
            : 'flex w-full max-w-(--ph-size-dialog-md) flex-col gap-6 rounded-lg bg-surface p-8 shadow-lg'
        }
      >
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <span className="grid size-avatar-sm place-items-center rounded-md bg-primary text-on-primary">
              <Icon name="pill" size="md" />
            </span>
            <span className="text-lg font-bold tracking-tight">
              {t('shell.productName')}
            </span>
          </span>
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
        <div className="flex flex-col gap-1">
          <h1
            id="login-title"
            className="text-2xl font-bold tracking-tight text-fg"
          >
            {title}
          </h1>
          <p className="text-sm text-fg-subtle">{subtitle}</p>
        </div>
        {children}
      </section>
    </main>
  );
}
