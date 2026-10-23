'use client';

import { CountBadge, cx, Icon } from '@pharmacy/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { activeRoute, visibleNavigation } from '../config/navigation';
import { navCountersKey } from '../model/nav-counters';

const itemClass =
  'flex min-h-touch items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors';

/** Menu of the screens the employee's role opens (ADR-0018); hidden items are not rendered. */
export function Sidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const active = activeRoute(pathname ?? '/');
  const { data: session } = useSession();
  const storeId = session?.currentStoreId ?? null;
  const onPos = active === 'pos';
  const queryClient = useQueryClient();
  // Numbers of the working store (E2, E9): a minute old at most, refreshed at once after any own
  // change (the mutation cache of the app invalidates navCountersKey); an error keeps the last
  // numbers silently.
  const { data: counters } = useQuery({
    queryKey: [...navCountersKey, storeId],
    queryFn: ({ signal }) =>
      apiRequest('navCounters.get', {
        query: storeId ? { storeId } : {},
        signal,
      }),
    enabled: !!session,
    // not on the POS screen: there a waiting new version of the app activates between receipts,
    // and with this polling on it stayed waiting in the web-e2e run (cause not established); the
    // sales there go through the outbox, so leaving the POS refreshes the numbers at once
    refetchInterval: onPos ? false : 60_000,
  });
  const wasOnPos = useRef(onPos);
  useEffect(() => {
    if (wasOnPos.current && !onPos) {
      void queryClient.invalidateQueries({ queryKey: navCountersKey });
    }
    wasOnPos.current = onPos;
  }, [onPos, queryClient]);

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
                const count = item.counter
                  ? (counters?.[item.counter.key] ?? 0)
                  : 0;
                const href =
                  item.counter && count > 0 && storeId
                    ? item.counter.href(storeId)
                    : routes[item.route]();
                return (
                  <li key={item.route}>
                    <Link
                      href={href}
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
                      {item.counter && (
                        <CountBadge
                          count={count}
                          max={99}
                          tone={item.counter.tone}
                          label={t(`nav.counters.${item.counter.key}`, {
                            count,
                          })}
                        />
                      )}
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
