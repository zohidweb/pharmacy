'use client';

import { formatDateTime } from '@pharmacy/shared-util';
import { Button, EmptyState, Icon, IconButton, Popover } from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';
import { reminderIcon, useReminderText } from '@/entities/reminder';
import { canWrite, useSession } from '@/entities/session';
import { apiRequest } from '@/shared/api';

const notificationsKey = ['notifications'] as const;
const LIMIT = 20;

/** Bell with the latest notifications of the employee: expiring batches, debts, transfers. */
export function NotificationsBell() {
  const t = useTranslations('shell');
  const text = useReminderText();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const list = useQuery({
    queryKey: notificationsKey,
    queryFn: ({ signal }) =>
      apiRequest('notifications.list', { query: { limit: LIMIT }, signal }),
  });
  const readAll = useMutation({
    mutationFn: () => apiRequest('notifications.readAll'),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationsKey }),
  });
  const unread = list.data?.unread ?? 0;
  const items = list.data?.items ?? [];

  return (
    <Popover
      label={t('notifications')}
      width="md"
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
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <p className="text-sm font-bold">{t('notifications')}</p>
          {unread > 0 && canWrite(session) && (
            <Button
              variant="tertiary"
              loading={readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              {t('markAllRead')}
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <EmptyState icon="bell-off" title={t('noNotifications')} />
        ) : (
          <ul className="m-0 flex max-h-(--ph-size-dialog-sm) list-none flex-col overflow-y-auto p-0">
            {items.map((item) => {
              const { title, detail } = text(item.kind, item.params);
              return (
                <li
                  key={item.id}
                  className={
                    item.read
                      ? 'flex gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0'
                      : 'flex gap-3 border-b border-border bg-surface-highlight px-4 py-3 text-sm last:border-b-0'
                  }
                >
                  <span className="mt-0.5 text-fg-muted">
                    <Icon name={reminderIcon[item.kind]} size="sm" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-fg">
                      {!item.read && (
                        <span className="ph-visually-hidden">
                          {t('unread')}:{' '}
                        </span>
                      )}
                      {title}
                    </span>
                    <span className="text-xs text-fg-subtle">{detail}</span>
                    <span className="text-2xs text-fg-subtle">
                      {formatDateTime(item.createdAt)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Popover>
  );
}
