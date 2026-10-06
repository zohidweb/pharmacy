'use client';

import type { EmployeeSession } from '@pharmacy/shared-dto';
import { Alert, Button, Icon, Spinner } from '@pharmacy/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { canWrite, useSession } from '@/entities/session';
import { LoginForm } from '@/features/auth-by-password';
import { PinLoginForm, useBoundTerminal } from '@/features/auth-by-pin';
import { StorePicker } from '@/features/select-store';
import { SignOutButton } from '@/features/sign-out';
import { routes } from '@/shared/config';
import { landingRoute } from '@/widgets/app-shell';
import { FirstStoreStep } from './FirstStoreStep';
import { LoginCard } from './LoginCard';

type Method = 'pin' | 'password';

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

  // A network without stores: the owner creates the first one (spec 2026-10-06-owner-stores, S4).
  if (session.data && session.data.stores.length === 0) {
    const owner = canWrite(session.data, 'stores:create');
    return (
      <LoginCard
        wide={owner}
        title={owner ? t('firstStore.title') : t('store.noStoresTitle')}
        subtitle={`${session.data.employee.fullName} · ${session.data.role.name}`}
      >
        {owner ? (
          <FirstStoreStep onDone={goOn} />
        ) : (
          <>
            <StorePicker session={session.data} onSelected={goOn} />
            <SignOutButton variant="secondary" block />
          </>
        )}
      </LoginCard>
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
      <Link
        href={routes.activate()}
        className="self-start text-sm text-primary hover:text-primary-hover"
      >
        {t('activateLink')}
      </Link>
      <p className="flex gap-2 text-xs text-fg-subtle">
        <Icon name="info" size="sm" />
        {t('resetHint')}
      </p>
    </LoginCard>
  );
}
