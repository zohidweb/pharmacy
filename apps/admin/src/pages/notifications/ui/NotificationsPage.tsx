'use client';

import type {
  AnnouncementScope,
  NotificationPreferences,
  NotificationTopic,
} from '@pharmacy/shared-dto';
import { formatDateTime, toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Chip,
  ChipGroup,
  cx,
  Dialog,
  EmptyState,
  Icon,
  StatusPill,
  Switch,
  TextareaField,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  attentionKeys,
  eventHref,
  eventIcon,
  eventTone,
  useEventText,
} from '@/entities/event';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const topics: NotificationTopic[] = ['billing', 'keys', 'services', 'sync'];
const scopes: AnnouncementScope[] = ['all', 'cloud', 'offline'];
const DUSHANBE_OFFSET = '+05:00';

const toneIcon = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  attention: 'text-attention',
  neutral: 'text-fg-muted',
} as const;

function toInstant(date: string, time: string): string | null {
  if (!date || !time) return null;
  const value = new Date(`${date}T${time}:00${DUSHANBE_OFFSET}`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function AnnouncementDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('notifications.announce');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = toAppDate();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState('01:00');
  const [endDate, setEndDate] = useState(today);
  const [endTime, setEndTime] = useState('03:00');
  const [scope, setScope] = useState<AnnouncementScope>('all');
  const [touched, setTouched] = useState(false);
  const startsAt = toInstant(startDate, startTime);
  const endsAt = toInstant(endDate, endTime);
  const errors = {
    title: title.trim().length < 3,
    text: text.trim().length < 10,
    range: !startsAt || !endsAt || endsAt <= startsAt,
  };
  const create = useMutation({
    mutationFn: () =>
      apiRequest('announcements.create', {
        body: {
          title: title.trim(),
          text: text.trim(),
          startsAt: startsAt ?? '',
          endsAt: endsAt ?? '',
          scope,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      toast.show(t('published'));
      setTitle('');
      setText('');
      setTouched(false);
      onClose();
    },
  });
  const error = useApiErrorMessage(create.error);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('title')}
      description={t('description')}
      closeLabel={tCommon('close')}
      size="md"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            loading={create.isPending}
            onClick={() => {
              setTouched(true);
              if (!errors.title && !errors.text && !errors.range)
                create.mutate();
            }}
          >
            {t('publish')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <TextField
        label={t('fieldTitle')}
        required
        value={title}
        error={touched && errors.title ? t('titleError') : undefined}
        onChange={(event) => setTitle(event.target.value)}
      />
      <TextareaField
        label={t('fieldText')}
        required
        rows={3}
        value={text}
        error={touched && errors.text ? t('textError') : undefined}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('startDate')}
          type="date"
          min={today}
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <TextField
          label={t('startTime')}
          type="time"
          value={startTime}
          onChange={(event) => setStartTime(event.target.value)}
        />
        <TextField
          label={t('endDate')}
          type="date"
          min={startDate}
          value={endDate}
          error={touched && errors.range ? t('rangeError') : undefined}
          onChange={(event) => setEndDate(event.target.value)}
        />
        <TextField
          label={t('endTime')}
          type="time"
          value={endTime}
          onChange={(event) => setEndTime(event.target.value)}
        />
      </div>
      <ChipGroup label={t('scope')}>
        {scopes.map((value) => (
          <Chip
            key={value}
            selected={scope === value}
            onClick={() => setScope(value)}
          >
            {t(`scopes.${value}`)}
          </Chip>
        ))}
      </ChipGroup>
      <Alert tone="info">{t('note')}</Alert>
    </Dialog>
  );
}

/** «Уведомления» (UI mockup «Уведомления»): platform events, announcements and bell preferences. */
export function NotificationsPage() {
  const t = useTranslations('notifications');
  const toast = useToast();
  const queryClient = useQueryClient();
  const text = useEventText();
  const [topic, setTopic] = useState<NotificationTopic | undefined>(undefined);
  const [announcing, setAnnouncing] = useState(false);
  const list = useQuery({
    queryKey: [...attentionKeys.notifications, topic],
    queryFn: ({ signal }) =>
      apiRequest('notifications.list', { query: { topic, limit: 50 }, signal }),
  });
  const announcements = useQuery({
    queryKey: ['announcements'],
    queryFn: ({ signal }) => apiRequest('announcements.list', { signal }),
  });
  const preferences = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: ({ signal }) =>
      apiRequest('me.notificationPreferences', { signal }),
  });
  const readAll = useMutation({
    mutationFn: () => apiRequest('notifications.readAll'),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: attentionKeys.notifications,
      });
      void queryClient.invalidateQueries({ queryKey: attentionKeys.counts });
      toast.show(t('allRead'));
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      apiRequest('announcements.cancel', { params: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      toast.show(t('announcements.cancelled'));
    },
  });
  const savePreferences = useMutation({
    mutationFn: (next: NotificationPreferences) =>
      apiRequest('me.updateNotificationPreferences', { body: next }),
    onSuccess: (saved) =>
      queryClient.setQueryData(['notification-preferences'], saved),
  });
  const preferencesError = useApiErrorMessage(savePreferences.error);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button iconStart="wrench" onClick={() => setAnnouncing(true)}>
            {t('announceAction')}
          </Button>
        }
      />
      <div className="grid grid-cols-3 items-start gap-4 p-6">
        <Card
          as="section"
          padding="none"
          aria-labelledby="events-title"
          className="col-span-2"
        >
          <CardHeader
            title={t('events')}
            titleId="events-title"
            inset
            actions={
              <Button
                variant="tertiary"
                iconStart="check"
                loading={readAll.isPending}
                disabled={(list.data?.unread ?? 0) === 0}
                onClick={() => readAll.mutate()}
              >
                {t('markAllRead')}
              </Button>
            }
          />
          <div className="px-(--ph-card-padding) pb-4">
            <ChipGroup label={t('topicLabel')}>
              <Chip
                selected={topic === undefined}
                count={list.data?.counts.all}
                onClick={() => setTopic(undefined)}
              >
                {t('topics.all')}
              </Chip>
              {topics.map((value) => (
                <Chip
                  key={value}
                  selected={topic === value}
                  count={list.data?.counts[value]}
                  onClick={() => setTopic(value)}
                >
                  {t(`topics.${value}`)}
                </Chip>
              ))}
            </ChipGroup>
          </div>
          <QueryState query={list}>
            {(data) =>
              data.items.length === 0 ? (
                <EmptyState
                  icon="bell-off"
                  title={t('empty')}
                  description={t('emptyDescription')}
                />
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {data.items.map((item) => {
                    const { title, detail } = text(item.kind, item.params);
                    return (
                      <li
                        key={item.id}
                        className={cx(
                          'flex items-start gap-3 border-t border-border px-(--ph-card-padding) py-3',
                          !item.read && 'bg-surface-highlight',
                        )}
                      >
                        <span
                          className={cx(
                            'mt-0.5',
                            toneIcon[eventTone[item.kind]],
                          )}
                        >
                          <Icon name={eventIcon[item.kind]} size="md" />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm font-medium">
                            {title}
                            {!item.read && (
                              <span className="ph-visually-hidden">
                                , {t('unread')}
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-fg-subtle">
                            {detail}
                          </span>
                          <span className="text-2xs text-fg-subtle">
                            {formatDateTime(item.createdAt)}
                          </span>
                        </div>
                        <Link
                          href={eventHref(item.target)}
                          className="text-sm text-primary hover:text-primary-hover"
                        >
                          {t('open')}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </QueryState>
        </Card>

        <div className="flex flex-col gap-4">
          <Card as="section" aria-labelledby="announcements-title">
            <CardHeader
              title={t('announcements.title')}
              titleId="announcements-title"
              description={t('announcements.hint')}
            />
            <QueryState query={announcements}>
              {(rows) =>
                rows.length === 0 ? (
                  <EmptyState icon="info" title={t('announcements.empty')} />
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-4 p-0">
                    {rows.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-col gap-1 border-b border-border pb-4 last:border-b-0 last:pb-0"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium">{item.title}</span>
                          <StatusPill
                            tone={
                              item.status === 'published' ? 'success' : 'info'
                            }
                          >
                            {t(
                              `announcements.status.${item.status === 'published' ? 'published' : 'scheduled'}`,
                            )}
                          </StatusPill>
                        </div>
                        <p className="text-sm text-fg-muted">{item.text}</p>
                        <p className="text-xs text-fg-subtle">
                          {t('announcements.window', {
                            from: formatDateTime(item.startsAt),
                            to: formatDateTime(item.endsAt),
                            scope: t(`announce.scopes.${item.scope}`),
                          })}
                        </p>
                        <Button
                          variant="tertiary"
                          className="self-start"
                          aria-label={t('announcements.cancelFor', {
                            title: item.title,
                          })}
                          loading={
                            cancel.isPending && cancel.variables === item.id
                          }
                          onClick={() => cancel.mutate(item.id)}
                        >
                          <span className="text-danger">
                            {item.status === 'published'
                              ? t('announcements.withdraw')
                              : t('announcements.cancel')}
                          </span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )
              }
            </QueryState>
          </Card>

          <Card as="section" aria-labelledby="bell-title">
            <CardHeader
              title={t('bell.title')}
              titleId="bell-title"
              description={t('bell.hint')}
            />
            {preferencesError && (
              <Alert tone="danger" live="assertive" className="mb-3">
                {preferencesError}
              </Alert>
            )}
            <QueryState query={preferences}>
              {(prefs) => (
                <div className="flex flex-col gap-4">
                  {topics.map((value) => (
                    <Switch
                      key={value}
                      label={t(`topics.${value}`)}
                      checked={prefs[value]}
                      onCheckedChange={(checked) =>
                        savePreferences.mutate({ ...prefs, [value]: checked })
                      }
                    />
                  ))}
                </div>
              )}
            </QueryState>
          </Card>
        </div>
      </div>
      <AnnouncementDialog
        open={announcing}
        onClose={() => setAnnouncing(false)}
      />
    </>
  );
}
