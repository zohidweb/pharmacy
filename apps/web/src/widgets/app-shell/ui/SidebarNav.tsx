'use client';

import type { EmployeeSession, NavCounters } from '@pharmacy/shared-dto';
import { CountBadge, cx, Icon } from '@pharmacy/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { routes } from '@/shared/config';
import { activeRoute, visibleNavigation } from '../config/navigation';

const itemClass =
  'flex min-h-touch items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors';

/** Whether a menu item the employee sees has waiting work (a counter above zero): the dot on the phone menu button. */
export function hasNavAttention(
  session: EmployeeSession | null | undefined,
  counters: NavCounters | undefined,
): boolean {
  if (!counters) return false;
  return visibleNavigation(session).some((section) =>
    section.items.some(
      (item) =>
        item.ready && !!item.counter && (counters[item.counter.key] ?? 0) > 0,
    ),
  );
}

/**
 * Sections and items of the menu the employee's role opens (ADR-0018); hidden items are not rendered. Shared by the
 * sidebar and the phone menu (ADR-0007, amendment 2026-11-10); `onNavigate` runs when an item is chosen.
 */
export function SidebarNav({
  counters,
  storeId,
  onNavigate,
}: {
  counters: NavCounters | undefined;
  storeId: string | null;
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const active = activeRoute(pathname ?? '/');
  const { data: session } = useSession();
  // the sidebar stays mounted (hidden) while the phone menu is open: ids must not repeat
  const idPrefix = useId();

  return (
    <>
      {visibleNavigation(session).map((section) => {
        const headingId = `${idPrefix}-nav-${section.key}`;
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
                      onClick={onNavigate}
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
    </>
  );
}
