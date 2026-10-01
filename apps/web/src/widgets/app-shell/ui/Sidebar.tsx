'use client';

import { cx, Icon } from '@pharmacy/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { routes } from '@/shared/config';
import { activeRoute, visibleNavigation } from '../config/navigation';

const itemClass =
  'flex min-h-touch items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors';

/** Menu of the screens the employee's role opens (ADR-0018); hidden items are not rendered. */
export function Sidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const active = activeRoute(pathname ?? '/');
  const { data: session } = useSession();

  return (
    <nav
      aria-label={t('shell.navLabel')}
      className="sticky top-topbar flex h-(--ph-shell-body-height) w-sidebar shrink-0 flex-col gap-4 overflow-y-auto border-e border-border bg-surface px-3 py-4"
    >
      {visibleNavigation(session).map((section) => {
        const headingId = `nav-${section.key}`;
        return (
          <div key={section.key} className="flex flex-col gap-0.5">
            <h2
              id={headingId}
              className="px-3 py-1 text-2xs font-bold tracking-wide text-fg-subtle"
            >
              {t(`nav.sections.${section.key}`)}
            </h2>
            <ul
              aria-labelledby={headingId}
              className="m-0 flex list-none flex-col gap-0.5 p-0"
            >
              {section.items.map((item) => {
                const label = t(`nav.items.${item.route}`);
                if (!item.ready) {
                  return (
                    <li key={item.route}>
                      <span
                        aria-disabled="true"
                        className={cx(
                          itemClass,
                          'cursor-default text-fg-subtle',
                        )}
                      >
                        <Icon name={item.icon} size="md" />
                        <span className="min-w-0 flex-1">{label}</span>
                        <Icon name="clock" size="xs" label={t('shell.soon')} />
                      </span>
                    </li>
                  );
                }
                const current = item.route === active;
                return (
                  <li key={item.route}>
                    <Link
                      href={routes[item.route]()}
                      aria-current={current ? 'page' : undefined}
                      className={cx(
                        itemClass,
                        current
                          ? 'bg-(--ph-nav-item-bg-active) font-bold text-(--ph-nav-item-fg-active)'
                          : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
                      )}
                    >
                      <Icon name={item.icon} size="md" />
                      <span className="min-w-0 flex-1">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
