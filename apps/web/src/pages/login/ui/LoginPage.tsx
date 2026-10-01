'use client';

import type { EmployeeSession } from '@pharmacy/shared-dto';
import { Alert, Button, Icon, SegmentedControl, Spinner } from '@pharmacy/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { LoginForm } from '@/features/auth-by-password';
import { PinLoginForm, useBoundTerminal } from '@/features/auth-by-pin';
import { StorePicker } from '@/features/select-store';
import { locales, setLocale, useLocale } from '@/shared/i18n';
import { landingRoute } from '@/widgets/app-shell';

type Method = 'pin' | 'password';

function LoginCard({
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

/**
 * Sign-in of the client product (UI mockup «Вход»): login + password, then the working store; on a
 * terminal bound to a store the cashier signs in by PIN (ADR-0008). A complete session goes on to
 * the first screen the role opens.
 */
export function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const session = useSession();
  const terminal = useBoundTerminal();
  const [method, setMethod] = useState<Method | null>(null);
  const ready = Boolean(session.data?.currentStoreId);

  useEffect(() => {
    if (ready) router.replace(landingRoute(session.data));
  }, [ready, router, session.data]);

  const goOn = (next: EmployeeSession) => {
    if (next.currentStoreId) router.replace(landingRoute(next));
  };

  if (session.isPending || terminal.isPending || ready) {
    return (
      <div className="grid min-h-dvh place-items-center text-primary">
        <Spinner size="xl" />
      </div>
    );
  }

  if (session.data) {
    return (
      <LoginCard
        title={t('store.title')}
        subtitle={`${session.data.employee.fullName} · ${session.data.role.name}`}
      >
        <StorePicker session={session.data} onSelected={goOn} />
      </LoginCard>
    );
  }

  const bound = terminal.data ?? null;
  const current: Method = method ?? (bound ? 'pin' : 'password');

  if (current === 'pin' && bound) {
    return (
      <LoginCard
        wide
        title={t('pin.title')}
        subtitle={t('pin.subtitle', {
          store: bound.store.name,
          terminal: bound.name,
        })}
      >
        <PinLoginForm terminal={bound} onSuccess={goOn} />
        <Button
          variant="tertiary"
          iconStart="key-round"
          className="self-start"
          onClick={() => setMethod('password')}
        >
          {t('usePassword')}
        </Button>
      </LoginCard>
    );
  }

  return (
    <LoginCard title={t('title')} subtitle={t('subtitle')}>
      {terminal.isError && <Alert tone="warning">{t('terminalUnknown')}</Alert>}
      <LoginForm onSuccess={goOn} />
      {bound && (
        <Button
          variant="tertiary"
          iconStart="calculator"
          block
          onClick={() => setMethod('pin')}
        >
          {t('usePin')}
        </Button>
      )}
      <p className="flex gap-2 text-xs text-fg-subtle">
        <Icon name="info" size="sm" />
        {t('resetHint')}
      </p>
    </LoginCard>
  );
}
