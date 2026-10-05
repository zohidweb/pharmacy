'use client';

import type { OperatorMe } from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  Icon,
  SegmentedControl,
  StatusPill,
  TextField,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { sessionQueryKey } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { setLocale, type Locale } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const PHONE = /^\+992(\s?\d){9}$/;

/** Password rules shown as a checklist (ADR-0008 sets hashing; length/complexity per the mockup). */
const passwordRules = [
  { key: 'length', test: (value: string) => value.length >= 8 },
  { key: 'upper', test: (value: string) => /\p{Lu}/u.test(value) },
  { key: 'digit', test: (value: string) => /\d/.test(value) },
] as const;

function PersonalData({ me }: { me: OperatorMe }) {
  const t = useTranslations('profile.personal');
  const tLocales = useTranslations('locales');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(me.fullName);
  const [phone, setPhone] = useState(me.phone);
  const [position, setPosition] = useState(me.position);
  const [locale, setLocaleValue] = useState<Locale>(me.locale);
  // «От имени» is not available in the MVP (ADR-0008 amendment 2026-10-05): the setting is kept
  // as it is and not shown.
  const reminder = me.impersonationReminder;
  const [touched, setTouched] = useState(false);
  const invalid = {
    fullName: fullName.trim().length < 3,
    phone: !PHONE.test(phone.trim()),
  };
  const update = useMutation({
    mutationFn: () =>
      apiRequest('me.update', {
        body: {
          fullName: fullName.trim(),
          phone: phone.trim(),
          position: position.trim(),
          locale,
          impersonationReminder: reminder,
        },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['me'], saved);
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      setLocale(saved.locale);
      toast.show(t('saved'));
    },
  });
  const error = useApiErrorMessage(update.error);
  return (
    <Card
      as="section"
      aria-labelledby="personal-title"
      className="flex flex-col gap-4"
    >
      <CardHeader title={t('title')} titleId="personal-title" />
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('fullName')}
          value={fullName}
          error={touched && invalid.fullName ? t('fullNameError') : undefined}
          onChange={(event) => setFullName(event.target.value)}
        />
        <TextField
          label={t('login')}
          value={me.login}
          readOnly
          hint={t('loginHint')}
        />
        <TextField
          label={t('phone')}
          type="tel"
          value={phone}
          error={touched && invalid.phone ? t('phoneError') : undefined}
          onChange={(event) => setPhone(event.target.value)}
        />
        <TextField
          label={t('position')}
          value={position}
          onChange={(event) => setPosition(event.target.value)}
        />
      </div>
      <SegmentedControl
        label={t('locale')}
        value={locale}
        onValueChange={setLocaleValue}
        options={(['ru', 'tg'] as const).map((value) => ({
          value,
          label: tLocales(value),
        }))}
      />
      <div className="flex justify-end">
        <Button
          loading={update.isPending}
          onClick={() => {
            setTouched(true);
            if (!invalid.fullName && !invalid.phone) update.mutate();
          }}
        >
          {t('save')}
        </Button>
      </div>
    </Card>
  );
}

function Security() {
  const t = useTranslations('profile.security');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [touched, setTouched] = useState(false);
  const rulesOk = passwordRules.every((rule) => rule.test(next));
  const change = useMutation({
    mutationFn: () =>
      apiRequest('me.changePassword', {
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
      setCurrent('');
      setNext('');
      setTouched(false);
      toast.show(t('changed'));
    },
  });
  const error = useApiErrorMessage(change.error);
  return (
    <Card
      as="section"
      aria-labelledby="security-title"
      className="flex flex-col gap-4"
    >
      <CardHeader
        title={t('title')}
        titleId="security-title"
        description={t('hint')}
      />
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('current')}
          type="password"
          autoComplete="current-password"
          value={current}
          error={touched && current === '' ? t('currentRequired') : undefined}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <TextField
          label={t('next')}
          type="password"
          autoComplete="new-password"
          value={next}
          hint={t('nextHint')}
          error={touched && !rulesOk ? t('rulesError') : undefined}
          onChange={(event) => setNext(event.target.value)}
        />
      </div>
      <ul
        className="m-0 flex list-none flex-col gap-1 p-0 text-sm"
        aria-label={t('rulesLabel')}
      >
        {passwordRules.map((rule) => {
          const ok = rule.test(next);
          return (
            <li
              key={rule.key}
              className={
                ok
                  ? 'flex items-center gap-2 text-success'
                  : 'flex items-center gap-2 text-fg-muted'
              }
            >
              <Icon name={ok ? 'circle-check' : 'circle-alert'} size="sm" />
              {t(`rules.${rule.key}`)}
              <span className="ph-visually-hidden">
                , {ok ? t('ruleMet') : t('ruleNotMet')}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <Button
          loading={change.isPending}
          onClick={() => {
            setTouched(true);
            if (current !== '' && rulesOk) change.mutate();
          }}
        >
          {t('change')}
        </Button>
      </div>
    </Card>
  );
}

function Sessions() {
  const t = useTranslations('profile.sessions');
  const toast = useToast();
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['me', 'sessions'],
    queryFn: ({ signal }) => apiRequest('me.sessions', { signal }),
  });
  const endOthers = useMutation({
    mutationFn: () => apiRequest('me.endOtherSessions'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
      toast.show(t('ended'));
    },
  });
  return (
    <Card as="section" aria-labelledby="sessions-title">
      <CardHeader
        title={t('title')}
        titleId="sessions-title"
        actions={
          <Button
            variant="tertiary"
            loading={endOthers.isPending}
            disabled={(sessions.data ?? []).every((session) => session.current)}
            onClick={() => endOthers.mutate()}
          >
            <span className="text-danger">{t('endOthers')}</span>
          </Button>
        }
      />
      <QueryState query={sessions}>
        {(rows) => (
          <ul className="m-0 flex list-none flex-col p-0">
            {rows.map((session) => (
              <li
                key={session.id}
                className="flex items-center gap-3 border-t border-border py-3"
              >
                <span className="text-fg-muted">
                  <Icon name="monitor" size="md" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm">{session.device}</span>
                  <span className="text-xs text-fg-subtle">
                    {t('lastSeen', { at: formatDateTime(session.lastSeenAt) })}
                  </span>
                </div>
                {session.current && (
                  <StatusPill tone="success">{t('current')}</StatusPill>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}

/** Profile of the signed-in operator (UI mockup «Профиль»). */
export function ProfilePage() {
  const t = useTranslations('profile');
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => apiRequest('me.get', { signal }),
  });
  const activity = useQuery({
    queryKey: ['me', 'activity'],
    queryFn: ({ signal }) => apiRequest('me.activity', { signal }),
  });
  const logout = useMutation({
    mutationFn: () => apiRequest('operator.sessions.delete'),
    onSuccess: () => {
      queryClient.setQueryData(sessionQueryKey, null);
      router.replace(routes.login());
    },
  });
  const logoutError = useApiErrorMessage(logout.error);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 p-6">
        <QueryState query={me}>
          {(data) => (
            <>
              <Card className="flex flex-wrap items-center gap-5">
                <Avatar name={data.fullName} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold tracking-tight">
                      {data.fullName}
                    </h2>
                    <StatusPill tone="info" icon={null}>
                      {t('role')}
                    </StatusPill>
                  </div>
                  <p className="text-sm text-fg-muted">
                    {data.login} · {data.phone}
                    {data.lastLoginAt &&
                      ` · ${t('lastLogin', { at: formatDateTime(data.lastLoginAt) })}`}
                  </p>
                </div>
              </Card>
              <div className="grid grid-cols-3 items-start gap-4">
                <div className="col-span-2 flex flex-col gap-4">
                  <PersonalData me={data} />
                  <Security />
                  <Sessions />
                </div>
                <div className="flex flex-col gap-4">
                  <Card as="section" aria-labelledby="permissions-title">
                    <CardHeader
                      title={t('permissions.title')}
                      titleId="permissions-title"
                      description={t('permissions.hint')}
                    />
                    <ul className="m-0 flex list-none flex-col gap-3 p-0">
                      {(
                        [
                          'companies',
                          'billing',
                          'licenses',
                          'services',
                          'impersonation',
                          'settings',
                        ] as const
                      ).map((key) => (
                        <li key={key} className="flex gap-2 text-sm">
                          <span className="mt-0.5 text-success">
                            <Icon name="circle-check" size="sm" />
                          </span>
                          <span className="flex flex-col">
                            <span className="font-medium">
                              {t(`permissions.items.${key}.title`)}
                            </span>
                            <span className="text-xs text-fg-subtle">
                              {t(`permissions.items.${key}.detail`)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                  <Card as="section" aria-labelledby="activity-title">
                    <CardHeader
                      title={t('activity.title')}
                      titleId="activity-title"
                    />
                    <QueryState query={activity}>
                      {(rows) => (
                        <ul className="m-0 flex list-none flex-col gap-3 p-0">
                          {rows.map((item) => (
                            <li key={item.id} className="flex flex-col text-sm">
                              <span>{item.description}</span>
                              <span className="text-xs text-fg-subtle">
                                {formatDateTime(item.at)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </QueryState>
                  </Card>
                  {logoutError && (
                    <Alert tone="danger" live="assertive">
                      {logoutError}
                    </Alert>
                  )}
                  <Button
                    variant="destructive"
                    iconStart="log-out"
                    block
                    loading={logout.isPending}
                    onClick={() => logout.mutate()}
                  >
                    {t('logout')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </QueryState>
      </div>
    </>
  );
}
