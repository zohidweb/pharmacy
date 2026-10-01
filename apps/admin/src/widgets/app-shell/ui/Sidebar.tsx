'use client';

import { Avatar, cx, Icon } from '@pharmacy/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { routes } from '@/shared/config';
import { activeRoute, navigation } from '../config/navigation';

export function Sidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const active = activeRoute(pathname ?? '/');
  const { data: session } = useSession();

  return (
    <aside className="sticky top-0 flex h-dvh w-sidebar shrink-0 flex-col border-e border-border bg-surface px-3 py-4">
      <div className="flex flex-col gap-0.5 px-3 pb-5">
        <span className="text-md font-bold tracking-tight text-fg">
          {t('shell.productName')}
        </span>
        <span className="text-2xs text-fg-subtle">
          {t('shell.productTagline')}
        </span>
      </div>

      <nav
        aria-label={t('shell.navLabel')}
        className="flex flex-1 flex-col gap-4 overflow-y-auto"
      >
        {navigation.map((section) => {
          const headingId = `nav-${section.title}`;
          return (
            <div key={section.title} className="flex flex-col gap-0.5">
              <h2
                id={headingId}
                className="px-3 py-1 text-2xs font-bold tracking-wide text-fg-subtle"
              >
                {t(`nav.${section.title}`)}
              </h2>
              <ul
                aria-labelledby={headingId}
                className="m-0 flex list-none flex-col gap-0.5 p-0"
              >
                {section.items.map((item) => {
                  const current = item.route === active;
                  return (
                    <li key={item.route}>
                      <Link
                        href={routes[item.route]()}
                        aria-current={current ? 'page' : undefined}
                        className={cx(
                          'flex min-h-(--ph-button-height) items-center gap-3 rounded-md px-3 text-sm transition-colors',
                          current
                            ? 'bg-(--ph-nav-item-bg-active) font-bold text-(--ph-nav-item-fg-active)'
                            : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
                        )}
                      >
                        <Icon name={item.icon} size="md" />
                        <span className="truncate">
                          {t(`nav.${item.label}`)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {session && (
        <Link
          href={routes.profile()}
          aria-label={t('shell.openProfile', {
            name: session.operator.fullName,
          })}
          className="mt-3 flex items-center gap-3 rounded-md border border-border p-3 transition-colors hover:bg-surface-sunken"
        >
          <Avatar name={session.operator.fullName} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-fg">
              {session.operator.fullName}
            </span>
            <span className="truncate text-xs text-fg-subtle">
              {t('shell.operatorRole')}
            </span>
          </span>
        </Link>
      )}
    </aside>
  );
}
