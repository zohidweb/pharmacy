'use client';

import { formatDateTime } from '@pharmacy/shared-util';
import {
  buttonClassName,
  EmptyState,
  Icon,
  IconButton,
  Popover,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import {
  attentionKeys,
  eventHref,
  eventIcon,
  useAttentionCounts,
  useEventText,
} from '@/entities/event';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';

const PREVIEW = 5;

/** Bell with the latest unread events; the full list lives on «Уведомления». */
export function NotificationsBell() {
  const t = useTranslations('shell');
  const text = useEventText();
  const { data: counts } = useAttentionCounts();
  const unread = counts?.unreadNotifications ?? 0;
  const preview = useQuery({
    queryKey: [...attentionKeys.notifications, 'preview'],
    queryFn: ({ signal }) =>
      apiRequest('notifications.list', { query: { limit: 20 }, signal }),
  });
  const items = (preview.data?.items ?? [])
    .filter((item) => !item.read)
    .slice(0, PREVIEW);

  return (
    <Popover
      label={t('notifications')}
      trigger={(props) => (
        <IconButton
          icon="bell"
          label={
            unread > 0
              ? t('notificationsUnread', { count: unread })
              : t('notifications')
          }
          variant="surface"
          indicator={unread > 0}
          {...props}
        />
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          <p className="border-b border-border px-4 py-3 text-sm font-bold">
            {t('notifications')}
          </p>
          {items.length === 0 ? (
            <EmptyState icon="bell-off" title={t('noNotifications')} />
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {items.map((item) => {
                const { title, detail } = text(item.kind, item.params);
                return (
                  <li
                    key={item.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <Link
                      href={eventHref(item.target)}
                      onClick={close}
                      className="flex gap-3 px-4 py-3 text-sm hover:bg-surface-sunken"
                    >
                      <span className="mt-0.5 text-fg-muted">
                        <Icon name={eventIcon[item.kind]} size="sm" />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium text-fg">{title}</span>
                        <span className="text-xs text-fg-subtle">{detail}</span>
                        <span className="text-2xs text-fg-subtle">
                          {formatDateTime(item.createdAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-border p-2">
            <Link
              href={routes.notifications()}
              onClick={close}
              className={buttonClassName({ variant: 'tertiary', block: true })}
            >
              {t('allNotifications')}
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
