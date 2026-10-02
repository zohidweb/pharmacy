'use client';

import {
  checkPin,
  passwordProblems,
  passwordRules as domainPasswordRules,
} from '@pharmacy/shared-domain';
import type { EmployeeMe, MyTerminal } from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  EmptyState,
  Icon,
  SegmentedControl,
  StatusPill,
  TextField,
  useToast,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { can, canWrite, useSession } from '@/entities/session';
import { SignOutButton } from '@/features/sign-out';
import { ApiError, apiRequest, useApiErrorMessage } from '@/shared/api';
import { locales, setLocale, type Locale, WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const meKey = ['me'] as const;
const terminalsKey = ['me', 'terminals'] as const;

/** Password rules shown as a checklist (ADR-0008, shared-domain `passwordProblems`). */
const passwordRules = domainPasswordRules.map((key) => ({
  key,
  test: (value: string) => !passwordProblems(value).includes(key),
}));

const fieldErrorOf = (error: unknown, field: string) =>
  error instanceof ApiError && error.errors.some((e) => e.field === field);

function MainInfo({ me, readOnly }: { me: EmployeeMe; readOnly: boolean }) {
  const t = useTranslations('profile.main');
  const tLocales = useTranslations('locales');
  const toast = useToast();
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (locale: Locale) =>
      apiRequest('me.update', { body: { locale } }),
    onSuccess: (saved) => {
      queryClient.setQueryData(meKey, saved);
      setLocale(saved.locale);
      toast.show(t('localeSaved'));
    },
  });
  const error = useApiErrorMessage(update.error);
  const rows: Array<[string, string]> = [
    [t('fullName'), me.fullName],
    [t('phone'), me.phone],
    [t('login'), me.login],
    [t('role'), me.roleName],
  ];
  return (
    <Card
      as="section"
      aria-labelledby="main-title"
      className="flex flex-col gap-4"
    >
      <CardHeader title={t('title')} titleId="main-title" />
      <dl className="m-0 grid grid-cols-4 gap-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="text-xs text-fg-subtle">{label}</dt>
            <dd className="m-0 text-sm font-medium">{value}</dd>
          </div>
        ))}
        <div className="col-span-4 flex flex-col gap-2">
          <dt className="text-xs text-fg-subtle">{t('stores')}</dt>
          <dd className="m-0">
            {me.scope === 'network' ? (
              <StatusPill tone="info" icon="store">
                {t('wholeNetwork')}
              </StatusPill>
            ) : (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {me.storeNames.map((name) => (
                  <li key={name}>
                    <StatusPill tone="neutral" icon="store">
                      {name}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <span className="text-sm text-fg-muted">{t('locale')}</span>
        <SegmentedControl
          label={t('locale')}
          value={me.locale}
          onValueChange={(locale) => {
            if (!readOnly) update.mutate(locale);
          }}
          options={locales.map((value) => ({
            value,
            label: tLocales(value),
          }))}
        />
        <span className="text-xs text-fg-subtle">{t('localeHint')}</span>
      </div>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </Card>
  );
}

function PasswordCard({ locked }: { locked: string | null }) {
  const t = useTranslations('profile.password');
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [touched, setTouched] = useState(false);
  const rulesOk = passwordRules.every((rule) => rule.test(next));
  const change = useMutation({
    mutationFn: () =>
      apiRequest('me.changePassword', {
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setRepeat('');
      setTouched(false);
      toast.show(t('changed'));
    },
  });
  const wrongCurrent = fieldErrorOf(change.error, 'currentPassword');
  const error = useApiErrorMessage(wrongCurrent ? null : change.error);
  return (
    <Card
      as="section"
      aria-labelledby="password-title"
      className="flex flex-col gap-4"
    >
      <CardHeader
        title={t('title')}
        titleId="password-title"
        description={t('hint')}
      />
      {locked && <Alert tone="info">{locked}</Alert>}
      <TextField
        label={t('current')}
        type="password"
        autoComplete="current-password"
        disabled={Boolean(locked)}
        value={current}
        error={
          wrongCurrent
            ? t('wrongCurrent')
            : touched && current === ''
              ? t('currentRequired')
              : undefined
        }
        onChange={(event) => setCurrent(event.target.value)}
      />
      <TextField
        label={t('next')}
        type="password"
        autoComplete="new-password"
        disabled={Boolean(locked)}
        value={next}
        error={touched && !rulesOk ? t('rulesError') : undefined}
        onChange={(event) => setNext(event.target.value)}
      />
      <TextField
        label={t('repeat')}
        type="password"
        autoComplete="new-password"
        disabled={Boolean(locked)}
        value={repeat}
        error={touched && repeat !== next ? t('mismatch') : undefined}
        onChange={(event) => setRepeat(event.target.value)}
      />
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
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <div className="flex justify-end">
        <Button
          disabled={Boolean(locked)}
          loading={change.isPending}
          onClick={() => {
            setTouched(true);
            if (current !== '' && rulesOk && repeat === next) change.mutate();
          }}
        >
          {t('save')}
        </Button>
      </div>
    </Card>
  );
}

function PinCard({ me, locked }: { me: EmployeeMe; locked: string | null }) {
  const t = useTranslations('profile.pin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [touched, setTouched] = useState(false);
  const problem = checkPin(next);
  const change = useMutation({
    mutationFn: () =>
      apiRequest('me.changePin', {
        body: { currentPin: me.pinSet ? current : null, newPin: next },
      }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setTouched(false);
      void queryClient.invalidateQueries({ queryKey: meKey });
      toast.show(t('changed'));
    },
  });
  const wrongCurrent = fieldErrorOf(change.error, 'currentPin');
  const error = useApiErrorMessage(wrongCurrent ? null : change.error);
  const digits = (value: string) => value.replace(/\D/g, '');
  return (
    <Card
      as="section"
      aria-labelledby="pin-title"
      className="flex flex-col gap-4"
    >
      <CardHeader
        title={me.pinSet ? t('title') : t('titleNew')}
        titleId="pin-title"
        description={t('hint')}
      />
      {locked && <Alert tone="info">{locked}</Alert>}
      {me.pinSet && (
        <TextField
          label={t('current')}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          mono
          disabled={Boolean(locked)}
          value={current}
          error={
            wrongCurrent
              ? t('wrongCurrent')
              : touched && current === ''
                ? t('currentRequired')
                : undefined
          }
          onChange={(event) => setCurrent(digits(event.target.value))}
        />
      )}
      <TextField
        label={t('next')}
        hint={t('rules')}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        mono
        disabled={Boolean(locked)}
        value={next}
        error={touched && problem ? t(`problems.${problem}`) : undefined}
        onChange={(event) => setNext(digits(event.target.value))}
      />
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <div className="flex justify-end">
        <Button
          disabled={Boolean(locked)}
          loading={change.isPending}
          onClick={() => {
            setTouched(true);
            if (!problem && (!me.pinSet || current !== '')) change.mutate();
          }}
        >
          {t('save')}
        </Button>
      </div>
    </Card>
  );
}

function TerminalsCard({ canUnbind }: { canUnbind: boolean }) {
  const t = useTranslations('profile.terminals');
  const toast = useToast();
  const queryClient = useQueryClient();
  const terminals = useQuery({
    queryKey: terminalsKey,
    queryFn: ({ signal }) => apiRequest('me.terminals', { signal }),
  });
  const [target, setTarget] = useState<MyTerminal | null>(null);
  const unbind = useMutation({
    mutationFn: (id: string) =>
      apiRequest('terminals.unbind', { params: { id } }),
    onSuccess: () => {
      setTarget(null);
      void queryClient.invalidateQueries({ queryKey: terminalsKey });
      void queryClient.invalidateQueries({ queryKey: ['terminal'] });
      toast.show(t('unbound'));
    },
  });
  const error = useApiErrorMessage(unbind.error);
  const columns: DataTableColumn<MyTerminal>[] = [
    {
      key: 'device',
      header: t('device'),
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <span className="font-medium">{row.name}</span>
          {row.current && (
            <StatusPill tone="success">{t('thisDevice')}</StatusPill>
          )}
        </span>
      ),
    },
    { key: 'store', header: t('store'), cell: (row) => row.storeName ?? '—' },
    {
      key: 'boundAt',
      header: t('boundAt'),
      nowrap: true,
      cell: (row) => formatDateTime(row.boundAt),
    },
    {
      key: 'lastSeenAt',
      header: t('lastSeen'),
      nowrap: true,
      cell: (row) => formatDateTime(row.lastSeenAt),
    },
    ...(canUnbind
      ? [
          {
            key: 'actions',
            header: <span className="ph-visually-hidden">{t('actions')}</span>,
            align: 'end' as const,
            cell: (row: MyTerminal) => (
              <Button
                variant="tertiary"
                aria-label={t('unbindNamed', { name: row.name })}
                onClick={() => setTarget(row)}
              >
                {t('unbind')}
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <Card as="section" padding="none" aria-labelledby="terminals-title">
      <CardHeader
        title={t('title')}
        titleId="terminals-title"
        description={t('hint')}
        inset
      />
      <QueryState query={terminals}>
        {(rows) => (
          <DataTable
            caption={t('title')}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            empty={<EmptyState icon="monitor" title={t('empty')} />}
          />
        )}
      </QueryState>
      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={t('confirmTitle')}
        description={
          target ? t('confirmText', { name: target.name }) : undefined
        }
        closeLabel={t('cancel')}
        icon="triangle-alert"
        tone="danger"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={unbind.isPending}
              onClick={() => target && unbind.mutate(target.id)}
            >
              {t('unbind')}
            </Button>
          </>
        }
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
      </Dialog>
    </Card>
  );
}

/** Profile of the signed-in employee (UI mockup «Профиль»). */
function ProfilePageView() {
  const t = useTranslations('profile');
  const { data: session } = useSession();
  const me = useQuery({
    queryKey: meKey,
    queryFn: ({ signal }) => apiRequest('me.get', { signal }),
  });
  const readOnly = Boolean(session?.impersonation);
  // step-up (ADR-0008): secrets change only in a session opened by password
  const locked = readOnly
    ? t('readOnly')
    : session?.auth === 'pin'
      ? t('stepUp')
      : null;

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <QueryState query={me}>
          {(data) => (
            <>
              <Card className="flex flex-wrap items-center gap-5">
                <Avatar name={data.fullName} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h2 className="text-xl font-bold tracking-tight">
                    {data.fullName}
                  </h2>
                  <p className="text-sm text-fg-muted">
                    {data.roleName}
                    {data.lastLoginAt &&
                      ` · ${t('lastLogin', { at: formatDateTime(data.lastLoginAt) })}`}
                  </p>
                </div>
                <SignOutButton variant="secondary" />
              </Card>
              <MainInfo me={data} readOnly={readOnly} />
              <div className="grid grid-cols-2 items-start gap-4">
                <PasswordCard locked={locked} />
                <PinCard me={data} locked={locked} />
              </div>
              <TerminalsCard
                canUnbind={
                  canWrite(session, 'terminals:delete') &&
                  can(session, 'terminals:view') &&
                  session?.auth === 'password'
                }
              />
            </>
          )}
        </QueryState>
      </div>
    </>
  );
}

export function ProfilePage() {
  return (
    <WithMessages groups={['home']}>
      <ProfilePageView />
    </WithMessages>
  );
}
