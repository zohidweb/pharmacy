'use client';

import type { EmployeeSession } from '@pharmacy/shared-dto';
import {
  Avatar,
  buttonClassName,
  Popover,
  SegmentedControl,
} from '@pharmacy/ui';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { SignOutButton } from '@/features/sign-out';
import { routes } from '@/shared/config';
import { locales, setLocale, useLocale } from '@/shared/i18n';

/** Employee menu: who is signed in, interface language, profile and sign-out. */
export function UserMenu({ session }: { session: EmployeeSession }) {
  const t = useTranslations();
  const locale = useLocale();
  const { fullName, phone } = session.employee;

  return (
    <Popover
      label={t('shell.userMenu')}
      trigger={(props) => (
        <button
          type="button"
          aria-label={t('shell.openUserMenu', { name: fullName })}
          className="flex min-h-touch items-center gap-3 rounded-md px-2 text-start transition-colors hover:bg-surface-sunken"
          {...props}
        >
          <Avatar name={fullName} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-fg">
              {fullName}
            </span>
            <span className="truncate text-xs text-fg-subtle">
              {session.role.name}
            </span>
          </span>
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={fullName} size="md" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold">{fullName}</span>
              <span className="truncate text-xs text-fg-subtle">
                {session.role.name} · {phone}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-sm text-fg-muted">
              {t('shell.localeLabel')}
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
          <Link
            href={routes.profile()}
            onClick={close}
            className={buttonClassName({ variant: 'secondary', block: true })}
          >
            {t('shell.profile')}
          </Link>
          <SignOutButton block />
        </div>
      )}
    </Popover>
  );
}
